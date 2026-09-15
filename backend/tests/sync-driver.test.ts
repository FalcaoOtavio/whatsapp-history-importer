import { describe, expect, it, vi } from "vitest";
import { createSyncDriver } from "../src/sync-driver.js";
import { openDb, upsertChat, insertMessage, type SqliteDb } from "../src/db/sqlite.js";
import { SyncBroadcaster, type SyncEvent } from "../src/routes/sync.js";
import type { Chat, Message } from "../src/types.js";

function makeChat(jid: string): Chat {
  return {
    jid,
    name: jid,
    is_group: 0,
    last_message_at: 1,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 1,
  };
}

function makeMessage(id: string, chatJid: string): Message {
  return {
    id,
    chat_jid: chatJid,
    sender_jid: chatJid,
    sender_name: null,
    from_me: 0,
    timestamp: 1,
    type: "text",
    text: "hi",
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 1,
  };
}

function collect(broadcaster: SyncBroadcaster): SyncEvent[] {
  const events: SyncEvent[] = [];
  broadcaster.on((evt) => events.push(evt));
  return events;
}

describe("sync driver", () => {
  it("emits started -> chat (per chat, with message count) -> done", async () => {
    const db: SqliteDb = openDb(":memory:");
    upsertChat(db, makeChat("a@s.whatsapp.net"));
    insertMessage(db, makeMessage("m1", "a@s.whatsapp.net"));
    insertMessage(db, makeMessage("m2", "a@s.whatsapp.net"));

    const broadcaster = new SyncBroadcaster();
    const events = collect(broadcaster);
    const driver = createSyncDriver({ db, broadcaster });

    await driver.run();

    expect(events[0]).toEqual({ event: "sync.started" });
    expect(events).toContainEqual({ event: "sync.chat", jid: "a@s.whatsapp.net", total: 2 });
    expect(events[events.length - 1]).toEqual({ event: "sync.done" });
  });

  it("calls fetchMessageHistory per chat and swallows failures", async () => {
    const db: SqliteDb = openDb(":memory:");
    upsertChat(db, makeChat("a@s.whatsapp.net"));
    upsertChat(db, makeChat("b@s.whatsapp.net"));

    const fetchMessageHistory = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("timeout"));
    const broadcaster = new SyncBroadcaster();
    const driver = createSyncDriver({ db, broadcaster, fetchMessageHistory });

    await expect(driver.run()).resolves.toBeUndefined();
    expect(fetchMessageHistory).toHaveBeenCalledTimes(2);
  });
});
