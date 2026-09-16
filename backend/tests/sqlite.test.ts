import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_SIZE,
  clampLimit,
  getChat,
  getMessage,
  insertMessage,
  listChats,
  listMessages,
  openDb,
  setMediaPaths,
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

  describe("clampLimit", () => {
    it("keeps a sane limit as-is", () => {
      expect(clampLimit(25)).toBe(25);
    });

    it("rejects a negative limit, which SQLite reads as unbounded", () => {
      expect(clampLimit(-1)).toBe(1);
      expect(clampLimit(0)).toBe(1);
    });

    it("caps an oversized limit", () => {
      expect(clampLimit(1_000_000)).toBe(MAX_PAGE_SIZE);
    });

    it("falls back for undefined and non-finite values", () => {
      expect(clampLimit(undefined)).toBe(50);
      expect(clampLimit(Number.NaN)).toBe(50);
      expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(50);
    });
  });

  it("does not let ?limit=-1 dump the whole table", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    for (let i = 0; i < 5; i++) {
      insertMessage(db, makeMessage({ id: `m${i}`, timestamp: 100 + i }));
    }

    const messages = listMessages(db, "5511999999999@s.whatsapp.net", { limit: -1 });
    expect(messages).toHaveLength(1);
    db.close();
  });

  it("writes media paths for the matching chat", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    insertMessage(db, makeMessage({ id: "m1", type: "image" }));

    setMediaPaths(db, "m1", "5511999999999@s.whatsapp.net", "/tmp/a.jpg", "/tmp/a.webp");

    const row = getMessage(db, "m1");
    expect(row?.media_path).toBe("/tmp/a.jpg");
    expect(row?.media_thumb_path).toBe("/tmp/a.webp");
    db.close();
  });

  it("refuses to write media paths onto a message from another chat", () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat());
    insertMessage(db, makeMessage({ id: "m1", type: "image" }));

    // key.id is chosen by the sender and only unique per conversation, so a
    // download must never be able to attach its file to a row it did not come
    // from. The chat_jid in the WHERE clause is what enforces that.
    setMediaPaths(db, "m1", "mallory@s.whatsapp.net", "/tmp/evil.jpg", null);

    expect(getMessage(db, "m1")?.media_path).toBeNull();
    db.close();
  });
});
