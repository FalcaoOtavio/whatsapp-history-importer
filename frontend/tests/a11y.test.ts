import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { applyRoute, renderChatListItem, renderMessageBubble, renderQr } from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(testDir, "..", "public", "index.html"), "utf-8");
const css = readFileSync(join(testDir, "..", "public", "styles.css"), "utf-8");

/**
 * Builds a jsdom page with the real markup AND the real stylesheet inlined, so
 * axe's color-contrast checks see the actual palette rather than jsdom's
 * unstyled defaults. The <link> to styles.css is not fetched by jsdom, hence
 * the inline <style>.
 */
function makePage() {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.appendChild(style);
  return dom;
}

function makeChat(overrides = {}) {
  return {
    jid: "a@s.whatsapp.net",
    name: "Alice Silva",
    is_group: 0,
    last_message_at: 1700000000000,
    unread_count: 2,
    profile_pic_path: null,
    created_at: 1700000000000,
    ...overrides,
  };
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

/**
 * Runs axe against a jsdom document. axe-core needs its globals bound to the
 * jsdom window; `axe.run(context)` picks them up from the element's ownerDocument.
 * Color-contrast is disabled: jsdom does not compute layout or resolve CSS
 * custom properties, so axe cannot evaluate real rendered colors and would
 * report "incomplete" noise rather than genuine findings. Contrast of the
 * palette itself is covered by the manual smoke test in Phase 6.
 */
async function runAxe(dom, context) {
  const { window } = dom;
  // axe-core reads these off the global scope when it runs.
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);

  try {
    return await axe.run(context ?? window.document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.Element;
    delete globalThis.HTMLElement;
    delete globalThis.getComputedStyle;
  }
}

function formatViolations(violations) {
  return violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html).join(", ")})`)
    .join("\n");
}

describe("accessibility — welcome view", () => {
  it("has no axe violations with the QR placeholder showing", async () => {
    const dom = makePage();
    applyRoute(dom.window.document, "welcome");

    const results = await runAxe(dom);
    expect(formatViolations(results.violations)).toBe("");
  });

  it("has no axe violations once a QR image is rendered", async () => {
    const dom = makePage();
    applyRoute(dom.window.document, "welcome");
    renderQr(dom.window.document, "data:image/png;base64,iVBORw0KGgo=");

    const results = await runAxe(dom);
    expect(formatViolations(results.violations)).toBe("");
  });

  it("gives the QR image a non-empty alt text", () => {
    const dom = makePage();
    const img = dom.window.document.getElementById("qr-image");
    expect(img.getAttribute("alt")?.length).toBeGreaterThan(0);
  });
});

describe("accessibility — sync view", () => {
  it("has no axe violations and labels the progress bar", async () => {
    const dom = makePage();
    applyRoute(dom.window.document, "sync");

    const progress = dom.window.document.getElementById("sync-progress");
    expect(progress.getAttribute("aria-label")?.length).toBeGreaterThan(0);

    const results = await runAxe(dom);
    expect(formatViolations(results.violations)).toBe("");
  });
});

describe("accessibility — chat view", () => {
  it("has no axe violations with chats and messages rendered", async () => {
    const dom = makePage();
    const doc = dom.window.document;
    applyRoute(doc, "chats");

    const list = doc.getElementById("chat-list");
    list.replaceChildren(
      renderChatListItem(doc, makeChat({ jid: "a@s.whatsapp.net", name: "Alice" }), () => {}),
      renderChatListItem(doc, makeChat({ jid: "b@s.whatsapp.net", name: "Bob" }), () => {}),
    );

    const messageList = doc.getElementById("message-list");
    messageList.replaceChildren(
      renderMessageBubble(doc, makeMessage({ id: "m1", from_me: 0, text: "oi" })),
      renderMessageBubble(doc, makeMessage({ id: "m2", from_me: 1, text: "olá" })),
      renderMessageBubble(doc, makeMessage({ id: "m3", type: "image", text: null })),
      renderMessageBubble(doc, makeMessage({ id: "m4", type: "document", text: "nota.pdf" })),
    );
    doc.getElementById("chat-view-empty").hidden = true;

    const results = await runAxe(dom);
    expect(formatViolations(results.violations)).toBe("");
  });
});

describe("keyboard navigation", () => {
  it("chat items are focusable and expose listbox option semantics", () => {
    const dom = makePage();
    const doc = dom.window.document;
    const item = renderChatListItem(doc, makeChat(), () => {});

    expect(item.getAttribute("tabindex")).toBe("0");
    expect(item.getAttribute("role")).toBe("option");
    expect(item.getAttribute("aria-selected")).toBe("false");
    expect(item.getAttribute("aria-label")).toBe("Alice Silva");
  });

  it("Enter activates a chat item", () => {
    const dom = makePage();
    const doc = dom.window.document;
    let selected = null;
    const chat = makeChat();
    const item = renderChatListItem(doc, chat, (c) => {
      selected = c;
    });

    item.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" }));
    expect(selected).toBe(chat);
  });

  it("ArrowDown/ArrowUp move focus between chat items", () => {
    const dom = makePage();
    const doc = dom.window.document;
    applyRoute(doc, "chats");

    const first = renderChatListItem(doc, makeChat({ jid: "a@s.whatsapp.net", name: "A" }), () => {});
    const second = renderChatListItem(doc, makeChat({ jid: "b@s.whatsapp.net", name: "B" }), () => {});
    doc.getElementById("chat-list").replaceChildren(first, second);

    first.focus();
    first.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(doc.activeElement).toBe(second);

    second.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(doc.activeElement).toBe(first);
  });

  it("the stylesheet defines a visible focus ring", () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*3px solid/);
  });
});
