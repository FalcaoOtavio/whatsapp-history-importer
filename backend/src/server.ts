import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { fireAndForget, installProcessGuards, logBackgroundError } from "./log.js";
import { createBaileysClient, type BaileysClient } from "./baileys-client.js";
import { attachHistorySync } from "./history-sync.js";
import { createMediaQueue, type MediaQueue } from "./media-downloader.js";
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
  /** Where downloaded media is written. Defaults to `.media/` in cwd. */
  mediaDir?: string;
  /** Override the media queue - tests inject one with a fake downloader. */
  mediaQueue?: MediaQueue;
}

export interface ServerHandle {
  app: Express;
  db: SqliteDb;
  client: BaileysClient;
  broadcaster: SyncBroadcaster;
  /** Serialised media downloads fed by history sync. `drain()` in tests. */
  mediaQueue: MediaQueue;
}

/** Wires DB + Baileys client + all routes together. Does not connect() or listen() - callers do that. */
export function createServerHandle(deps: ServerDeps = {}): ServerHandle {
  const db = deps.db ?? openDb(deps.sqlitePath ?? "whatsapp-history.sqlite3");
  const client = deps.client ?? createBaileysClient();
  const broadcaster = new SyncBroadcaster();

  const postgres = createPostgresWriter(deps.databaseUrl ?? process.env.DATABASE_URL);
  const mongo = createMongoWriter(deps.mongoUrl ?? process.env.MONGODB_URL);

  // History carries media metadata only; the bytes are fetched afterwards so a
  // huge batch does not open thousands of CDN connections at once.
  const mediaQueue = deps.mediaQueue ?? createMediaQueue(db, { mediaDir: deps.mediaDir });

  attachHistorySync(client, db, {
    onMessage: (message, raw) => {
      mediaQueue.enqueue(message, raw);
    },
    onBatch: (result, payload) => {
      for (const chat of payload.chats ?? []) {
        // Mirrors are best-effort and opt-in: SQLite is canonical. A bad
        // DATABASE_URL must degrade to a logged (credential-scrubbed) error,
        // not an unhandled rejection that kills the sidecar mid-sync.
        fireAndForget("mirror:postgres", postgres.writeChat(toChatForMirror(chat)));
        fireAndForget("mirror:mongo", mongo.writeChat(toChatForMirror(chat)));
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
    fireAndForget("sync:run", syncDriver.run());
  });

  app.use(errorHandler);

  return { app, db, client, broadcaster, mediaQueue };
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

/**
 * Terminal error handler.
 *
 * Express's built-in one writes the error's stack trace into the response body.
 * That hands anything that can reach the loopback port the absolute paths of
 * the user's home directory, the install location and the app's internals. Log
 * the (credential-scrubbed) error and answer with a bare 500 instead.
 *
 * The four-argument signature is what marks a middleware as an error handler in
 * Express, so `next` has to stay in the list even though it is never called.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logBackgroundError("http", error);
  if (res.headersSent) {
    // Body already streaming: the only honest thing left is to cut it off so
    // the client sees a truncated response rather than a silent short read.
    res.destroy();
    return;
  }
  res.status(500).json({ error: "internal error" });
}

export function createServer(deps: ServerDeps = {}): Express {
  return createServerHandle(deps).app;
}

/**
 * True when this file is the entrypoint node was handed, rather than an import.
 *
 * Must compare two *filesystem* paths. `new URL(import.meta.url).pathname` is
 * percent-encoded - a space becomes %20, `~` becomes %7E - while argv[1] is the
 * raw path, so comparing them fails on any install path with such a character
 * and the server silently never calls listen(). That includes this project's
 * own iCloud Drive location ("Mobile Documents", "com~apple~CloudDocs") and any
 * `~/My Projects/` style directory. `path.resolve` on both sides also normalises
 * a relative argv[1] and resolves symlinked components.
 */
export function isMainModule(argv1 = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!argv1) return false;
  return path.resolve(argv1) === path.resolve(fileURLToPath(moduleUrl));
}

if (isMainModule()) {
  installProcessGuards();

  const handle = createServerHandle();
  const port = Number(process.env.PORT ?? 0);

  // Register the listener before connecting, otherwise the QR emitted during
  // connect() is missed and the user stares at an empty screen.
  handle.client.onStateChange((state, qr) => {
    if (state === "qr" && qr) {
      // eslint-disable-next-line no-console
      console.log(`[server] scan this QR in WhatsApp: ${qr}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[server] connection state: ${state}`);
    }
  });

  // connect() rejects when WhatsApp is unreachable or the stored creds are
  // stale. That must not kill the process: the UI still needs /health and
  // /status to answer so it can tell the user what went wrong.
  fireAndForget("baileys:connect", handle.client.connect());

  const server = handle.app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://127.0.0.1:${boundPort}`);
  });
}
