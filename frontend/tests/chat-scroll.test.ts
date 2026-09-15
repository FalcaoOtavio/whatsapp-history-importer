import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
  loadChatMessages,
  appendMessage,
  attachInfiniteScroll,
  isAtTop,
  scrollToBottom,
} from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(testDir, "..", "public", "index.html"), "utf-8");

function makeDoc() {
  return new JSDOM(html).window.document;
}

function makeMessage(overrides = {}) {
  return {
    id: "m1",
    chat_jid: "a@s.whatsapp.net",
    sender_jid: "a@s.whatsapp.net",
    sender_name: "Alice",
    from_me: 0,
    timestamp: 1700000000000,
    type: "text",
    text: "oi",
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 1700000000000,
    ...overrides,
  };
}

// jsdom does not lay out content, so scrollHeight is always 0 and scrollTop
// never moves on its own. Give the element a fake layout so scroll math is
// observable: a fixed scrollHeight and a writable scrollTop.
function fakeLayout(el, scrollHeight) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v) => {
      top = v;
    },
  });
}

describe("scrollToBottom / isAtTop", () => {
  it("scrollToBottom pins scrollTop to scrollHeight", () => {
    const doc = makeDoc();
    const list = doc.getElementById("message-list");
    fakeLayout(list, 1000);

    scrollToBottom(list);
    expect(list.scrollTop).toBe(1000);
  });

  it("isAtTop is true near the top and false further down", () => {
    const doc = makeDoc();
    const list = doc.getElementById("message-list");
    fakeLayout(list, 1000);

    list.scrollTop = 0;
    expect(isAtTop(list)).toBe(true);

    list.scrollTop = 500;
    expect(isAtTop(list)).toBe(false);
  });
});

describe("loadChatMessages scroll behavior", () => {
  it("scrolls to the bottom after rendering 100 messages", async () => {
    const doc = makeDoc();
    const list = doc.getElementById("message-list");
    fakeLayout(list, 5000);

    const messages = Array.from({ length: 100 }, (_, i) =>
      makeMessage({ id: `m${i}`, timestamp: 1700000000000 + i * 1000 }),
    );
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages }) });

    await loadChatMessages("a@s.whatsapp.net", { fetch: fetchMock, document: doc });

    expect(doc.querySelectorAll("#message-list .message")).toHaveLength(100);
    expect(list.scrollTop).toBe(5000);
  });
});

describe("appendMessage", () => {
  it("appends a new bubble and re-pins to the bottom", () => {
    const doc = makeDoc();
    const list = doc.getElementById("message-list");
    fakeLayout(list, 2000);
    list.scrollTop = 0;

    appendMessage(doc, makeMessage({ id: "new1", text: "nova" }));

    expect(doc.querySelectorAll("#message-list .message")).toHaveLength(1);
    expect(list.scrollTop).toBe(2000);
  });
});

describe("attachInfiniteScroll", () => {
  let doc;
  let list;

  beforeEach(() => {
    doc = makeDoc();
    list = doc.getElementById("message-list");
    fakeLayout(list, 3000);
  });

  it("fetches older messages with an `until` param anchored at the oldest rendered message", async () => {
    const older = [
      makeMessage({ id: "old2", timestamp: 1699999000000 }),
      makeMessage({ id: "old1", timestamp: 1699998000000 }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages: older }) });

    const scroller = attachInfiniteScroll("a@s.whatsapp.net", {
      fetch: fetchMock,
      document: doc,
      oldestTimestamp: 1700000000000,
    });

    await scroller.loadOlder();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("chatId=a%40s.whatsapp.net");
    expect(url).toContain("until=1700000000000");
  });

  it("prepends older messages in chronological order", async () => {
    const older = [
      makeMessage({ id: "old2", timestamp: 1699999000000, text: "segundo" }),
      makeMessage({ id: "old1", timestamp: 1699998000000, text: "primeiro" }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages: older }) });

    const scroller = attachInfiniteScroll("a@s.whatsapp.net", {
      fetch: fetchMock,
      document: doc,
      oldestTimestamp: 1700000000000,
    });
    await scroller.loadOlder();

    const ids = [...doc.querySelectorAll("#message-list .message")].map(
      (el) => el.dataset.messageId,
    );
    expect(ids).toEqual(["old1", "old2"]);
  });

  it("triggers a fetch when the user scrolls to the top", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ messages: [makeMessage({ id: "old1" })] }) });

    attachInfiniteScroll("a@s.whatsapp.net", {
      fetch: fetchMock,
      document: doc,
      oldestTimestamp: 1700000000000,
    });

    list.scrollTop = 0;
    list.dispatchEvent(new doc.defaultView.Event("scroll"));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not fetch when the user scrolls somewhere other than the top", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages: [] }) });

    attachInfiniteScroll("a@s.whatsapp.net", {
      fetch: fetchMock,
      document: doc,
      oldestTimestamp: 1700000000000,
    });

    list.scrollTop = 1500;
    list.dispatchEvent(new doc.defaultView.Event("scroll"));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops fetching once the backend returns no more history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages: [] }) });

    const scroller = attachInfiniteScroll("a@s.whatsapp.net", {
      fetch: fetchMock,
      document: doc,
      oldestTimestamp: 1700000000000,
    });

    await scroller.loadOlder();
    await scroller.loadOlder();
    await scroller.loadOlder();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
