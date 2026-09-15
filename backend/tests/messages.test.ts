import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { messagesRouter } from "../src/routes/messages.js";
import { openDb, insertMessage, upsertChat, type SqliteDb } from "../src/db/sqlite.js";
import type { Chat, Message } from "../src/types.js";

const CHAT_JID = "chat1@s.whatsapp.net";
const OTHER_JID = "chat2@s.whatsapp.net";

function makeChat(jid: string): Chat {
  return {
    jid,
    name: jid,
    is_group: 0,
    last_message_at: 0,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 0,
  };
}

function makeMessage(chatJid: string, i: number): Message {
  return {
    id: `${chatJid}-m${i}`,
    chat_jid: chatJid,
    sender_jid: chatJid,
    sender_name: "Alice",
    from_me: 0,
    timestamp: i,
    type: "text",
    text: `message ${i}`,
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: i,
  };
}

let db: SqliteDb;

beforeEach(() => {
  db = openDb(":memory:");
  upsertChat(db, makeChat(CHAT_JID));
  upsertChat(db, makeChat(OTHER_JID));
  for (let i = 1; i <= 50; i++) insertMessage(db, makeMessage(CHAT_JID, i));
  insertMessage(db, makeMessage(OTHER_JID, 1));
});

function makeApp() {
  const app = express();
  app.use(messagesRouter(db));
  return app;
}

describe("GET /messages", () => {
  it("requires chatId", async () => {
    const res = await request(makeApp()).get("/messages");
    expect(res.status).toBe(400);
  });

  it("returns the most recent messages for a chat, DESC by default", async () => {
    const res = await request(makeApp()).get("/messages").query({ chatId: CHAT_JID, limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(5);
    expect(res.body.messages.map((m: Message) => m.timestamp)).toEqual([50, 49, 48, 47, 46]);
  });

  it("returns messages since a timestamp in ASC order", async () => {
    const res = await request(makeApp())
      .get("/messages")
      .query({ chatId: CHAT_JID, since: 47, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: Message) => m.timestamp)).toEqual([47, 48, 49, 50]);
  });

  it("only returns messages for the requested chat", async () => {
    const res = await request(makeApp()).get("/messages").query({ chatId: OTHER_JID });

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].chat_jid).toBe(OTHER_JID);
  });
});
