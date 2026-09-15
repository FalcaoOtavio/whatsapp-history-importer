import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { renderMessageBubble, loadChatMessages } from "../public/app.js";

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

describe("renderMessageBubble", () => {
  it("renders inbound text messages on the left (gray)", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage({ from_me: 0, text: "oi" }));
    expect(bubble.className).toContain("message-in");
    expect(bubble.className).not.toContain("message-out");
    expect(bubble.querySelector(".message-text").textContent).toBe("oi");
  });

  it("renders outbound text messages on the right (green)", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage({ from_me: 1, text: "oi de volta" }));
    expect(bubble.className).toContain("message-out");
    expect(bubble.className).not.toContain("message-in");
  });

  it("renders image messages with an <img> pointed at /media/:id", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage({ id: "img1", type: "image", text: null }));
    const img = bubble.querySelector(".message-media img");
    expect(img.src).toContain("/media/img1");
  });

  it("renders video messages with a play overlay", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage({ id: "vid1", type: "video", text: null }));
    expect(bubble.querySelector(".message-media video").src).toContain("/media/vid1");
    expect(bubble.querySelector(".message-media-play-overlay")).not.toBeNull();
  });

  it("renders audio messages with a waveform + playable control", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage({ id: "aud1", type: "audio", text: null }));
    const audio = bubble.querySelector(".message-audio audio");
    expect(audio.src).toContain("/media/aud1");
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(bubble.querySelector(".message-waveform")).not.toBeNull();
  });

  it("renders document messages with the filename", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(
      doc,
      makeMessage({ id: "doc1", type: "document", text: "contrato.pdf" }),
    );
    const link = bubble.querySelector(".message-document-filename");
    expect(link.textContent).toBe("contrato.pdf");
    expect(link.getAttribute("href")).toContain("/media/doc1");
  });

  it("includes a timestamp in every bubble", () => {
    const doc = makeDoc();
    const bubble = renderMessageBubble(doc, makeMessage());
    expect(bubble.querySelector(".message-timestamp").textContent.length).toBeGreaterThan(0);
  });
});

describe("loadChatMessages", () => {
  let doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  it("fetches /messages?chatId= and renders 4 bubbles with correct classes", async () => {
    const messages = [
      makeMessage({ id: "m1", type: "text", from_me: 0, text: "oi" }),
      makeMessage({ id: "m2", type: "image", from_me: 1, text: null }),
      makeMessage({ id: "m3", type: "audio", from_me: 0, text: null }),
      makeMessage({ id: "m4", type: "document", from_me: 1, text: "arquivo.pdf" }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages }) });

    await loadChatMessages("a@s.whatsapp.net", { fetch: fetchMock, document: doc });

    expect(fetchMock).toHaveBeenCalledWith("/messages?chatId=a%40s.whatsapp.net");
    const bubbles = doc.querySelectorAll("#message-list .message");
    expect(bubbles).toHaveLength(4);
    expect(bubbles[0].className).toContain("message-in");
    expect(bubbles[1].className).toContain("message-out");
    expect(bubbles[1].querySelector(".message-media img")).not.toBeNull();
    expect(bubbles[2].querySelector(".message-audio")).not.toBeNull();
    expect(bubbles[3].querySelector(".message-document")).not.toBeNull();
  });

  it("hides the empty-state placeholder once messages load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ messages: [makeMessage()] }) });

    expect(doc.getElementById("chat-view-empty").hidden).toBe(false);
    await loadChatMessages("a@s.whatsapp.net", { fetch: fetchMock, document: doc });
    expect(doc.getElementById("chat-view-empty").hidden).toBe(true);
  });
});
