import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { applySyncEvent, createSyncListener } from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(testDir, "..", "public", "index.html"), "utf-8");

function makeDoc() {
  return new JSDOM(html).window.document;
}

describe("applySyncEvent", () => {
  it("resets counters and progress on sync.started", () => {
    const doc = makeDoc();
    const state = { chatsProcessed: 3, messagesTotal: 40, percent: 50 };
    applySyncEvent(doc, state, { event: "sync.started" });

    expect(state).toEqual({ chatsProcessed: 0, messagesTotal: 0, percent: 0 });
    expect(doc.getElementById("sync-progress").value).toBe(0);
    expect(doc.getElementById("sync-chat-count").textContent).toBe("0");
    expect(doc.getElementById("sync-message-count").textContent).toBe("0");
  });

  it("accumulates chat count and message total on sync.chat, advances progress", () => {
    const doc = makeDoc();
    const state = { chatsProcessed: 0, messagesTotal: 0, percent: 0 };

    applySyncEvent(doc, state, { event: "sync.chat", jid: "a@s.whatsapp.net", total: 12 });
    expect(state.chatsProcessed).toBe(1);
    expect(state.messagesTotal).toBe(12);
    expect(doc.getElementById("sync-progress").value).toBe(state.percent);
    expect(doc.getElementById("sync-chat-count").textContent).toBe("1");
    expect(doc.getElementById("sync-message-count").textContent).toBe("12");

    applySyncEvent(doc, state, { event: "sync.chat", jid: "b@s.whatsapp.net", total: 8 });
    expect(state.chatsProcessed).toBe(2);
    expect(state.messagesTotal).toBe(20);
    expect(doc.getElementById("sync-progress").value).toBe(state.percent);
  });

  it("sets progress to exactly 100 on sync.done", () => {
    const doc = makeDoc();
    const state = { chatsProcessed: 5, messagesTotal: 60, percent: 50 };
    applySyncEvent(doc, state, { event: "sync.done" });

    expect(state.percent).toBe(100);
    expect(doc.getElementById("sync-progress").value).toBe(100);
  });

  it("caps progress below 100 before sync.done, even with many chats", () => {
    const doc = makeDoc();
    const state = { chatsProcessed: 0, messagesTotal: 0, percent: 0 };
    for (let i = 0; i < 50; i++) {
      applySyncEvent(doc, state, { event: "sync.chat", jid: `c${i}@s.whatsapp.net`, total: 1 });
    }
    expect(state.percent).toBeLessThan(100);
    expect(doc.getElementById("sync-progress").value).toBe(state.percent);
  });
});

describe("createSyncListener", () => {
  let doc;
  let listeners;
  let fakeSource;
  let FakeEventSource;

  beforeEach(() => {
    doc = makeDoc();
    listeners = {};
    fakeSource = {
      addEventListener: vi.fn((name, cb) => {
        listeners[name] = cb;
      }),
      close: vi.fn(),
    };
    FakeEventSource = vi.fn(() => fakeSource);
  });

  it("opens an EventSource to /sync and registers listeners for all event types", () => {
    const sync = createSyncListener({ EventSource: FakeEventSource, document: doc });
    sync.start();

    expect(FakeEventSource).toHaveBeenCalledWith("/sync");
    expect(Object.keys(listeners).sort()).toEqual(
      ["sync.chat", "sync.done", "sync.message", "sync.started"].sort(),
    );
  });

  it("progress bar value matches the percent computed from sync.chat events", () => {
    const sync = createSyncListener({ EventSource: FakeEventSource, document: doc });
    sync.start();

    listeners["sync.started"]({ data: "{}" });
    listeners["sync.chat"]({ data: JSON.stringify({ jid: "a@s.whatsapp.net", total: 5 }) });

    const progress = doc.getElementById("sync-progress");
    expect(progress.value).toBe(sync.state.percent);
    expect(sync.state.percent).toBeGreaterThan(0);
  });

  it("closes the EventSource on sync.done", () => {
    const sync = createSyncListener({ EventSource: FakeEventSource, document: doc });
    sync.start();

    listeners["sync.done"]({ data: "{}" });

    expect(fakeSource.close).toHaveBeenCalled();
    expect(doc.getElementById("sync-progress").value).toBe(100);
  });
});
