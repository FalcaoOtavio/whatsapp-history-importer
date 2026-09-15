import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { chatsRouter } from "../src/routes/chats.js";
import { openDb, upsertChat, type SqliteDb } from "../src/db/sqlite.js";
import type { Chat } from "../src/types.js";

function makeChat(i: number): Chat {
  return {
    jid: `chat${i}@s.whatsapp.net`,
    name: `Chat ${i}`,
    is_group: 0,
    last_message_at: i * 1000,
    unread_count: 0,
    profile_pic_path: null,
    created_at: i * 500,
  };
}

let db: SqliteDb;

beforeEach(() => {
  db = openDb(":memory:");
  for (let i = 1; i <= 5; i++) upsertChat(db, makeChat(i));
});

function makeApp() {
  const app = express();
  app.use(chatsRouter(db));
  return app;
}

describe("GET /chats", () => {
  it("returns chats ordered by last_message_at DESC", async () => {
    const res = await request(makeApp()).get("/chats");

    expect(res.status).toBe(200);
    expect(res.body.chats.map((c: Chat) => c.jid)).toEqual([
      "chat5@s.whatsapp.net",
      "chat4@s.whatsapp.net",
      "chat3@s.whatsapp.net",
      "chat2@s.whatsapp.net",
      "chat1@s.whatsapp.net",
    ]);
  });

  it("respects limit and offset", async () => {
    const res = await request(makeApp()).get("/chats").query({ limit: 2, offset: 1 });

    expect(res.status).toBe(200);
    expect(res.body.chats).toHaveLength(2);
    expect(res.body.chats.map((c: Chat) => c.jid)).toEqual([
      "chat4@s.whatsapp.net",
      "chat3@s.whatsapp.net",
    ]);
  });

  it("falls back to defaults for invalid limit/offset", async () => {
    const res = await request(makeApp()).get("/chats").query({ limit: "abc", offset: "-5" });

    expect(res.status).toBe(200);
    expect(res.body.chats).toHaveLength(5);
  });
});
