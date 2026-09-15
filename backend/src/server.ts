import express, { type Express } from "express";
import { createBaileysClient, type BaileysClient } from "./baileys-client.js";
import { attachHistorySync } from "./history-sync.js";
import { createSyncDriver } from "./sync-driver.js";
import { openDb, type SqliteDb } from "./db/sqlite.js";
import { createPostgresWriter } from "./db/postgres.js";
import { createMongoWriter } from "./db/mongo.js";
import { qrRouter } from "./routes/qr.js";
import { statusRouter } from "./routes/status.js";
import { chatsRouter } from "./routes/chats.js";
import { messagesRouter } from "./routes/messages.js";
import { mediaRouter } from "./routes/media.js";
import { syncRouter, SyncBroadcaster } from "./routes/sync.js";

export interface ServerDeps {
  db?: SqliteDb;
  client?: BaileysClient;
  sqlitePath?: string;
  /** Postgres connection string. Defaults to process.env.DATABASE_URL (opt-in, no-op if unset). */
  databaseUrl?: string;
  /** MongoDB connection string. Defaults to process.env.MONGODB_URL (opt-in, no-op if unset). */
  mongoUrl?: string;
}

export interface ServerHandle {
  app: Express;
  db: SqliteDb;
  client: BaileysClient;
  broadcaster: SyncBroadcaster;
}

/** Wires DB + Baileys client + all routes together. Does not connect() or listen() - callers do that. */
export function createServerHandle(deps: ServerDeps = {}): ServerHandle {
  const db = deps.db ?? openDb(deps.sqlitePath ?? "whatsapp-history.sqlite3");
  const client = deps.client ?? createBaileysClient();
  const broadcaster = new SyncBroadcaster();

  const postgres = createPostgresWriter(deps.databaseUrl ?? process.env.DATABASE_URL);
  const mongo = createMongoWriter(deps.mongoUrl ?? process.env.MONGODB_URL);

  attachHistorySync(client, db, {
    onBatch: (result, payload) => {
      for (const chat of payload.chats ?? []) {
        void postgres.writeChat(toChatForMirror(chat));
        void mongo.writeChat(toChatForMirror(chat));
      }
      void result; // counts already reflected in DB; mirrors below are best-effort
    },
  });

  const syncDriver = createSyncDriver({ db, broadcaster });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(statusRouter(client));
  app.use(qrRouter(client));
  app.use(chatsRouter(db));
  app.use(messagesRouter(db));
  app.use(mediaRouter(db));
  app.use(syncRouter(broadcaster));

  app.post("/sync", (_req, res) => {
    res.status(200).json({ status: "started" });
    void syncDriver.run();
  });

  return { app, db, client, broadcaster };
}

// Mirrors only need enough shape to reuse the writers' upsert-by-jid semantics;
// history-sync's own SQLite path already validated/normalized the chat.
function toChatForMirror(raw: { id: string; name?: string | null }) {
  return {
    jid: raw.id,
    name: raw.name ?? raw.id,
    is_group: raw.id.endsWith("@g.us") ? (1 as const) : (0 as const),
    last_message_at: null,
    unread_count: 0,
    profile_pic_path: null,
    created_at: Date.now(),
  };
}

export function createServer(deps: ServerDeps = {}): Express {
  return createServerHandle(deps).app;
}

function isMainModule(): boolean {
  return process.argv[1] === new URL(import.meta.url).pathname;
}

if (isMainModule()) {
  const handle = createServerHandle();
  const port = Number(process.env.PORT ?? 0);

  void handle.client.connect().then(() => {
    handle.client.onStateChange((state, qr) => {
      if (state === "qr" && qr) {
        // eslint-disable-next-line no-console
        console.log(`[server] scan this QR in WhatsApp: ${qr}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[server] connection state: ${state}`);
      }
    });
  });

  const server = handle.app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://127.0.0.1:${boundPort}`);
  });
}
