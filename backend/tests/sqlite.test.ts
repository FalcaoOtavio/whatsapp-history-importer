import { describe, expect, it } from "vitest";
import {
  getChat,
  getMessage,
  insertMessage,
  listChats,
  listMessages,
  openDb,
  upsertChat,
} from "../src/db/sqlite.js";
import type { Chat, Message } from "../src/types.js";

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    jid: "5511999999999@s.whatsapp.net",
    name: "Alice",
    is_group: 0,
    last_message_at: 1000,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 500,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    chat_jid: "5511999999999@s.whatsapp.net",
    sender_jid: "5511999999999@s.whatsapp.net",
    sender_name: "Alice",
    from_me: 0,
    timestamp: 1000,
    type: "text",
    text: "oi",
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 1000,
    ...overrides,
  };
}

describe("sqlite store", () => {
  it("opens in-memory db and applies schema", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["chats", "messages", "sync_runs", "schema_version"]),
    );
    db.close();
  });

  it("inserts a chat and reads it back", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    const chat = getChat(db, "5511999999999@s.whatsapp.net");
    expect(chat?.name).toBe("Alice");
    db.close();
  });

  it("upserts a chat: second call updates instead of duplicating", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    upsertChat(db, makeChat({ name: "Alice Updated", unread_count: 3 }));
    const chat = getChat(db, "5511999999999@s.whatsapp.net");
    expect(chat?.name).toBe("Alice Updated");
    expect(chat?.unread_count).toBe(3);

    const all = listChats(db);
    expect(all).toHaveLength(1);
    db.close();
  });

  it("inserts a message and reads it back", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    insertMessage(db, makeMessage());
    const msg = getMessage(db, "msg-1");
    expect(msg?.text).toBe("oi");
    db.close();
  });

  it("lists chats ordered by last_message_at desc", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat({ jid: "a", last_message_at: 100 }));
    upsertChat(db, makeChat({ jid: "b", last_message_at: 300 }));
    upsertChat(db, makeChat({ jid: "c", last_message_at: 200 }));

    const chats = listChats(db, 2, 0);
    expect(chats.map((c) => c.jid)).toEqual(["b", "c"]);
    db.close();
  });

  it("lists messages for a chat ordered by timestamp", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    insertMessage(db, makeMessage({ id: "m1", timestamp: 100 }));
    insertMessage(db, makeMessage({ id: "m2", timestamp: 300 }));
    insertMessage(db, makeMessage({ id: "m3", timestamp: 200 }));

    const messages = listMessages(db, "5511999999999@s.whatsapp.net", { limit: 10 });
    // default (no since/until): DESC
    expect(messages.map((m) => m.id)).toEqual(["m2", "m3", "m1"]);
    db.close();
  });

  it("lists messages since a timestamp, ascending", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    insertMessage(db, makeMessage({ id: "m1", timestamp: 100 }));
    insertMessage(db, makeMessage({ id: "m2", timestamp: 300 }));
    insertMessage(db, makeMessage({ id: "m3", timestamp: 200 }));

    const messages = listMessages(db, "5511999999999@s.whatsapp.net", { since: 150 });
    expect(messages.map((m) => m.id)).toEqual(["m3", "m2"]);
    db.close();
  });
});
