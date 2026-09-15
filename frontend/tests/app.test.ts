import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { applyRoute, routeFromHash, renderCurrentRoute } from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(testDir, "..", "public", "index.html");
const html = readFileSync(htmlPath, "utf-8");

function makeDom(hash = "") {
  const dom = new JSDOM(html, { url: `http://localhost/${hash}` });
  return dom;
}

describe("routeFromHash", () => {
  it("defaults to welcome when hash is empty", () => {
    expect(routeFromHash("")).toBe("welcome");
  });

  it("resolves known routes", () => {
    expect(routeFromHash("#sync")).toBe("sync");
    expect(routeFromHash("#chats")).toBe("chats");
  });

  it("falls back to welcome for unknown routes", () => {
    expect(routeFromHash("#nonsense")).toBe("welcome");
  });
});

describe("applyRoute", () => {
  let dom;

  beforeEach(() => {
    dom = makeDom();
  });

  it("shows only the welcome view by default markup state", () => {
    applyRoute(dom.window.document, "welcome");
    const { document } = dom.window;
    expect(document.querySelector('[data-view="welcome"]').hidden).toBe(false);
    expect(document.querySelector('[data-view="sync"]').hidden).toBe(true);
    expect(document.querySelector('[data-view="chats"]').hidden).toBe(true);
  });

  it("switches to the sync view", () => {
    applyRoute(dom.window.document, "sync");
    const { document } = dom.window;
    expect(document.querySelector('[data-view="welcome"]').hidden).toBe(true);
    expect(document.querySelector('[data-view="sync"]').hidden).toBe(false);
    expect(document.querySelector('[data-view="chats"]').hidden).toBe(true);
  });

  it("switches to the chats view", () => {
    applyRoute(dom.window.document, "chats");
    const { document } = dom.window;
    expect(document.querySelector('[data-view="welcome"]').hidden).toBe(true);
    expect(document.querySelector('[data-view="sync"]').hidden).toBe(true);
    expect(document.querySelector('[data-view="chats"]').hidden).toBe(false);
  });
});

describe("renderCurrentRoute", () => {
  it("reads location.hash and shows the matching view", () => {
    const dom = makeDom("#sync");
    const view = renderCurrentRoute(dom.window, dom.window.document);
    expect(view).toBe("sync");
    expect(dom.window.document.querySelector('[data-view="sync"]').hidden).toBe(false);
    expect(dom.window.document.querySelector('[data-view="welcome"]').hidden).toBe(true);
  });

  it("reacts to hash changes", () => {
    const dom = makeDom("");
    renderCurrentRoute(dom.window, dom.window.document);
    expect(dom.window.document.querySelector('[data-view="welcome"]').hidden).toBe(false);

    dom.window.location.hash = "#chats";
    renderCurrentRoute(dom.window, dom.window.document);
    expect(dom.window.document.querySelector('[data-view="chats"]').hidden).toBe(false);
    expect(dom.window.document.querySelector('[data-view="welcome"]').hidden).toBe(true);
  });
});
