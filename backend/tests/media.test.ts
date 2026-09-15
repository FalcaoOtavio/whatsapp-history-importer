import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediaRouter } from "../src/routes/media.js";
import { openDb, insertMessage, upsertChat, type SqliteDb } from "../src/db/sqlite.js";
import type { Chat, Message } from "../src/types.js";

const CHAT_JID = "chat1@s.whatsapp.net";

function makeChat(): Chat {
  return {
    jid: CHAT_JID,
    name: "Chat",
    is_group: 0,
    last_message_at: 0,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 0,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    chat_jid: CHAT_JID,
    sender_jid: CHAT_JID,
    sender_name: "Alice",
    from_me: 0,
    timestamp: 1,
    type: "image",
    text: null,
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 1,
    ...overrides,
  };
}

let db: SqliteDb;
let dir: string;

beforeEach(async () => {
  db = openDb(":memory:");
  upsertChat(db, makeChat());
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "media-route-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeApp() {
  const app = express();
  app.use(mediaRouter(db));
  return app;
}

describe("GET /media/:msgId", () => {
  it("streams the cached media file with the correct MIME type", async () => {
    const mediaPath = path.join(dir, "photo.jpg");
    await fs.writeFile(mediaPath, "fake-jpeg-bytes");
    insertMessage(db, makeMessage({ media_path: mediaPath, media_mime: "image/jpeg" }));

    const res = await request(makeApp()).get("/media/m1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(Buffer.from(res.body).toString()).toBe("fake-jpeg-bytes");
  });

  it("returns 404 when the message does not exist", async () => {
    const res = await request(makeApp()).get("/media/missing");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the message has no media", async () => {
    insertMessage(db, makeMessage({ id: "m2", type: "text", text: "hi", media_path: null }));

    const res = await request(makeApp()).get("/media/m2");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the media file is missing from disk", async () => {
    insertMessage(
      db,
      makeMessage({ id: "m3", media_path: path.join(dir, "gone.jpg"), media_mime: "image/jpeg" }),
    );

    const res = await request(makeApp()).get("/media/m3");
    expect(res.status).toBe(404);
  });
});
