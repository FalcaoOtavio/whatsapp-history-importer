import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { syncRouter, SyncBroadcaster, type SyncEvent } from "../src/routes/sync.js";

function makeApp(broadcaster: SyncBroadcaster) {
  const app = express();
  app.use(syncRouter(broadcaster));
  return app;
}

/** Parses a raw SSE text body into `{event, data}` blocks. */
function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      return {
        event: eventLine?.slice("event: ".length) ?? "",
        data: JSON.parse(dataLine?.slice("data: ".length) ?? "{}"),
      };
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("GET /sync", () => {
  it("streams the full sync.started -> sync.chat -> sync.message -> sync.done sequence", async () => {
    const broadcaster = new SyncBroadcaster();
    // supertest only sends the request once `.then()` is invoked, so start it eagerly
    // (before sleeping) instead of awaiting it directly - otherwise emit() below would
    // fire before anyone is subscribed.
    const resPromise = request(makeApp(broadcaster)).get("/sync").then((r) => r);

    const events: SyncEvent[] = [
      { event: "sync.started" },
      { event: "sync.chat", jid: "a@s.whatsapp.net", total: 3 },
      { event: "sync.message", jid: "a@s.whatsapp.net", count: 1 },
      { event: "sync.message", jid: "a@s.whatsapp.net", count: 2 },
      { event: "sync.done" },
    ];
    await sleep(20);
    for (const evt of events) broadcaster.emit(evt);

    const res = await resPromise;

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    const parsed = parseSse(res.text);
    expect(parsed.map((p) => p.event)).toEqual([
      "sync.started",
      "sync.chat",
      "sync.message",
      "sync.message",
      "sync.done",
    ]);
    expect(parsed[1].data).toEqual({ jid: "a@s.whatsapp.net", total: 3 });
    expect(parsed[3].data).toEqual({ jid: "a@s.whatsapp.net", count: 2 });
  });

  it("closes the stream after sync.done, not delivering later events", async () => {
    const broadcaster = new SyncBroadcaster();
    const resPromise = request(makeApp(broadcaster)).get("/sync").then((r) => r);

    await sleep(20);
    broadcaster.emit({ event: "sync.started" });
    broadcaster.emit({ event: "sync.done" });
    await sleep(10);
    broadcaster.emit({ event: "sync.chat", jid: "late@s.whatsapp.net", total: 1 });

    const res = await resPromise;
    const parsed = parseSse(res.text);
    expect(parsed.map((p) => p.event)).toEqual(["sync.started", "sync.done"]);
  });
});
