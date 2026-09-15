import { describe, expect, it } from "vitest";
import {
  attachHistorySync,
  processHistorySyncPayload,
  THREE_YEARS_MS,
  type BaileysMessage,
  type HistorySyncPayload,
} from "../src/history-sync.js";
import { openDb, listMessages, type SqliteDb } from "../src/db/sqlite.js";

const NOW = 1_700_000_000_000; // fixed reference instant, ms
const CHAT_JID = "chat1@s.whatsapp.net";

function makeTextMessage(id: string, timestampSec: number): BaileysMessage {
  return {
    key: { remoteJid: CHAT_JID, fromMe: false, id, participant: undefined },
    message: { conversation: `hello ${id}` },
    messageTimestamp: timestampSec,
    pushName: "Alice",
  };
}

function makeDb(): SqliteDb {
  return openDb(":memory:");
}

describe("processHistorySyncPayload", () => {
  it("upserts chats and inserts messages within the retention window", () => {
    const db = makeDb();
    const payload: HistorySyncPayload = {
      chats: [{ id: CHAT_JID, name: "Alice", conversationTimestamp: NOW / 1000, unreadCount: 2 }],
      messages: [makeTextMessage("m1", NOW / 1000), makeTextMessage("m2", NOW / 1000 - 10)],
    };

    const result = processHistorySyncPayload(db, payload, { nowMs: NOW });

    expect(result).toEqual({ chatsWritten: 1, messagesWritten: 2, messagesSkippedOld: 0 });
    const messages = listMessages(db, CHAT_JID, { limit: 10 });
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("hello m1");
  });

  it("skips messages older than the retention cutoff (default 3 years)", () => {
    const db = makeDb();
    const tooOldSec = (NOW - THREE_YEARS_MS - 1000) / 1000;
    const payload: HistorySyncPayload = {
      chats: [{ id: CHAT_JID, name: "Alice" }],
      messages: [makeTextMessage("recent", NOW / 1000), makeTextMessage("ancient", tooOldSec)],
    };

    const result = processHistorySyncPayload(db, payload, { nowMs: NOW });

    expect(result).toEqual({ chatsWritten: 1, messagesWritten: 1, messagesSkippedOld: 1 });
    const messages = listMessages(db, CHAT_JID, { limit: 10 });
    expect(messages.map((m) => m.id)).toEqual(["recent"]);
  });

  it("accumulates across multiple pages/batches for the same chat", () => {
    const db = makeDb();
    processHistorySyncPayload(
      db,
      { chats: [{ id: CHAT_JID, name: "Alice" }], messages: [makeTextMessage("p1", NOW / 1000)] },
      { nowMs: NOW },
    );
    processHistorySyncPayload(
      db,
      { messages: [makeTextMessage("p2", NOW / 1000 - 5), makeTextMessage("p3", NOW / 1000 - 8)] },
      { nowMs: NOW },
    );

    const messages = listMessages(db, CHAT_JID, { limit: 10 });
    expect(messages).toHaveLength(3);
  });

  it("derives message type and media fields from image messages", () => {
    const db = makeDb();
    const payload: HistorySyncPayload = {
      chats: [{ id: CHAT_JID, name: "Alice" }],
      messages: [
        {
          key: { remoteJid: CHAT_JID, fromMe: false, id: "img1" },
          message: {
            imageMessage: { mimetype: "image/jpeg", caption: "look", fileLength: 12345 },
          },
          messageTimestamp: NOW / 1000,
        },
      ],
    };

    processHistorySyncPayload(db, payload, { nowMs: NOW });

    const [message] = listMessages(db, CHAT_JID, { limit: 1 });
    expect(message.type).toBe("image");
    expect(message.text).toBe("look");
    expect(message.media_mime).toBe("image/jpeg");
    expect(message.media_size).toBe(12345);
  });

  it("creates a placeholder chat for a message whose chat was never upserted", () => {
    const db = makeDb();
    const payload: HistorySyncPayload = { messages: [makeTextMessage("orphan", NOW / 1000)] };

    const result = processHistorySyncPayload(db, payload, { nowMs: NOW });

    expect(result.messagesWritten).toBe(1);
    expect(listMessages(db, CHAT_JID, { limit: 1 })).toHaveLength(1);
  });
});

describe("attachHistorySync", () => {
  it("persists messaging-history.set payloads emitted by the client", () => {
    const db = makeDb();
    const listeners: ((payload: unknown) => void)[] = [];
    const fakeClient = {
      onHistorySync(listener: (payload: unknown) => void) {
        listeners.push(listener);
      },
    };

    attachHistorySync(fakeClient, db, { nowMs: NOW });
    for (const listener of listeners) {
      listener({
        chats: [{ id: CHAT_JID, name: "Alice" }],
        messages: [makeTextMessage("m1", NOW / 1000)],
      });
    }

    expect(listMessages(db, CHAT_JID, { limit: 10 })).toHaveLength(1);
  });
});
