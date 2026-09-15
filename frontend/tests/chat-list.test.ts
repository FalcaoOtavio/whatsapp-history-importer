import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { chatInitials, formatChatTimestamp, renderChatListItem, loadChatList } from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(testDir, "..", "public", "index.html"), "utf-8");

function makeDoc() {
  return new JSDOM(html).window.document;
}

function makeChat(overrides = {}) {
  return {
    jid: "a@s.whatsapp.net",
    name: "Alice Silva",
    is_group: 0,
    last_message_at: Date.now(),
    unread_count: 0,
    profile_pic_path: null,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("chatInitials", () => {
  it("takes the first letter of up to two words, uppercased", () => {
    expect(chatInitials("Alice Silva")).toBe("AS");
    expect(chatInitials("Bob")).toBe("B");
  });

  it("falls back to ? for empty/missing names", () => {
    expect(chatInitials("")).toBe("?");
    expect(chatInitials(undefined)).toBe("?");
  });
});

describe("formatChatTimestamp", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatChatTimestamp(null)).toBe("");
    expect(formatChatTimestamp(undefined)).toBe("");
  });

  it("formats a real timestamp as a non-empty string", () => {
    expect(formatChatTimestamp(1700000000000).length).toBeGreaterThan(0);
  });
});

describe("renderChatListItem", () => {
  it("renders name, initials, and is keyboard-activatable", () => {
    const doc = makeDoc();
    const onSelect = vi.fn();
    const chat = makeChat({ name: "Carlos Souza" });
    const item = renderChatListItem(doc, chat, onSelect);

    expect(item.querySelector(".chat-list-name").textContent).toBe("Carlos Souza");
    expect(item.querySelector(".chat-avatar").textContent).toBe("CS");
    expect(item.getAttribute("tabindex")).toBe("0");

    item.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(chat);
  });

  it("shows an unread-count preview when unread_count > 0", () => {
    const doc = makeDoc();
    const chat = makeChat({ unread_count: 3 });
    const item = renderChatListItem(doc, chat, () => {});
    expect(item.querySelector(".chat-list-preview").textContent).toContain("3");
  });
});

describe("loadChatList", () => {
  let doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  it("fetches /chats and renders 3 chat items with correct names", async () => {
    const chats = [
      makeChat({ jid: "a@s.whatsapp.net", name: "Alice" }),
      makeChat({ jid: "b@s.whatsapp.net", name: "Bob" }),
      makeChat({ jid: "c@s.whatsapp.net", name: "Carol" }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ chats }) });

    await loadChatList({ fetch: fetchMock, document: doc });

    expect(fetchMock).toHaveBeenCalledWith("/chats");
    const items = doc.querySelectorAll("#chat-list .chat-list-item");
    expect(items).toHaveLength(3);
    expect([...items].map((el) => el.querySelector(".chat-list-name").textContent)).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("invokes onSelect with the right chat when an item is clicked", async () => {
    const chats = [makeChat({ jid: "x@s.whatsapp.net", name: "Xico" })];
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ chats }) });
    const onSelect = vi.fn();

    await loadChatList({ fetch: fetchMock, document: doc, onSelect });
    doc.querySelector(".chat-list-item").dispatchEvent(new doc.defaultView.Event("click"));

    expect(onSelect).toHaveBeenCalledWith(chats[0]);
  });
});
