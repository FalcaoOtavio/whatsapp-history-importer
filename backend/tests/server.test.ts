import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createServer, createServerHandle } from "../src/server.js";
import { openDb, upsertChat, insertMessage } from "../src/db/sqlite.js";
import type { BaileysClient } from "../src/baileys-client.js";
import type { Chat, Message } from "../src/types.js";

function makeFakeClient(overrides: Partial<BaileysClient> = {}): BaileysClient {
  return {
    socket: null,
    state: "connecting",
    currentQr: null,
    async connect() {
      return { ev: { on() {} } };
    },
    onStateChange() {},
    onHistorySync() {},
    ...overrides,
  };
}

function makeChat(jid: string): Chat {
  return {
    jid,
    name: "Alice",
    is_group: 0,
    last_message_at: 100,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 50,
  };
}

function makeMessage(id: string, chatJid: string): Message {
  return {
    id,
    chat_jid: chatJid,
    sender_jid: chatJid,
    sender_name: "Alice",
    from_me: 0,
    timestamp: 100,
    type: "text",
    text: "oi",
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 100,
  };
}

describe("server", () => {
  it("GET /health returns 200 ok", async () => {
    const app = createServer({ db: openDb(":memory:"), client: makeFakeClient() });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /status reflects the Baileys client's connection state", async () => {
    const app = createServer({ db: openDb(":memory:"), client: makeFakeClient({ state: "qr" }) });
    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "qr" });
  });

  it("GET /qr returns 204 when connected (no QR pending)", async () => {
    const client = makeFakeClient({ state: "connected", currentQr: null });
    const app = createServer({ db: openDb(":memory:"), client });
    const res = await request(app).get("/qr");
    expect(res.status).toBe(204);
  });

  it("GET /chats and GET /messages read from the wired SQLite DB", async () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat("a@s.whatsapp.net"));
    insertMessage(db, makeMessage("m1", "a@s.whatsapp.net"));
    const app = createServer({ db, client: makeFakeClient() });

    const chatsRes = await request(app).get("/chats");
    expect(chatsRes.status).toBe(200);
    expect(chatsRes.body.chats).toHaveLength(1);

    const messagesRes = await request(app).get("/messages?chatId=a@s.whatsapp.net");
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.messages).toHaveLength(1);
  });

  it("GET /media/:msgId returns 404 for a message without media", async () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat("a@s.whatsapp.net"));
    insertMessage(db, makeMessage("m1", "a@s.whatsapp.net"));
    const app = createServer({ db, client: makeFakeClient() });

    const res = await request(app).get("/media/m1");
    expect(res.status).toBe(404);
  });

  it("POST /sync returns 200 immediately and drives sync.started/.done via the broadcaster", async () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat("a@s.whatsapp.net"));
    const { app, broadcaster } = createServerHandle({ db, client: makeFakeClient() });

    const events: string[] = [];
    broadcaster.on((evt) => events.push(evt.event));

    const res = await request(app).post("/sync");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "started" });
    // The driver runs fire-and-forget after the response is sent; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toContain("sync.started");
    expect(events).toContain("sync.done");
  });

  it("wires messaging-history.set events from the client straight into SQLite", async () => {
    const db = openDb(":memory:");
    const listeners: ((payload: unknown) => void)[] = [];
    const client = makeFakeClient({
      onHistorySync(listener) {
        listeners.push(listener);
      },
    });
    createServerHandle({ db, client });

    for (const listener of listeners) {
      listener({
        chats: [{ id: "b@s.whatsapp.net", name: "Bob" }],
        messages: [
          {
            key: { remoteJid: "b@s.whatsapp.net", fromMe: false, id: "hm1" },
            message: { conversation: "hey" },
            messageTimestamp: Math.floor(Date.now() / 1000),
          },
        ],
      });
    }

    const app = createServer({ db, client: makeFakeClient() });
    const res = await request(app).get("/messages?chatId=b@s.whatsapp.net");
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].text).toBe("hey");
  });

  it("queues media downloads for messages arriving from history sync", async () => {
    // Without this wiring media_path stays null forever and GET /media/:msgId
    // answers 404 for every message in the archive.
    const db = openDb(":memory:");
    const listeners: ((payload: unknown) => void)[] = [];
    const client = makeFakeClient({
      onHistorySync(listener) {
        listeners.push(listener);
      },
    });
    const queued: string[] = [];
    const mediaQueue = {
      enqueue: (message: { id: string }) => queued.push(message.id),
      drain: async () => {},
      pending: 0,
    };

    createServerHandle({ db, client, mediaQueue });

    for (const listener of listeners) {
      listener({
        messages: [
          {
            key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "img9" },
            message: { imageMessage: { mimetype: "image/jpeg" } },
            messageTimestamp: Math.floor(Date.now() / 1000),
          },
        ],
      });
    }

    expect(queued).toEqual(["img9"]);
  });

  it("clamps GET /messages?limit=-1 instead of returning the whole chat", async () => {
    const db = openDb(":memory:");
    upsertChat(db, makeChat("c@s.whatsapp.net"));
    for (let i = 0; i < 5; i++) {
      insertMessage(db, makeMessage(`m${i}`, "c@s.whatsapp.net"));
    }

    const app = createServer({ db, client: makeFakeClient() });
    const res = await request(app).get("/messages?chatId=c@s.whatsapp.net&limit=-1");

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it("answers 500 without a stack trace when a route throws", async () => {
    const db = openDb(":memory:");
    // A failing query is the realistic way a handler throws: a corrupt DB file,
    // a locked database, a disk error. Express's default handler would put the
    // stack trace - absolute paths included - in the response body.
    db.prepare = () => {
      throw new Error("SqliteError: database disk image is malformed at /Users/otaviofalcao/db");
    };

    const app = createServer({ db, client: makeFakeClient() });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/chats");
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
    expect(res.text).not.toContain("/Users/otaviofalcao");
  });
});
