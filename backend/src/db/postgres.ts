import type { Chat, Message } from "../types.js";

export const PG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chats (
  jid           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  is_group      BOOLEAN NOT NULL,
  last_message_at BIGINT,
  unread_count  INTEGER DEFAULT 0,
  profile_pic_path TEXT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  chat_jid      TEXT NOT NULL REFERENCES chats(jid),
  sender_jid    TEXT,
  sender_name   TEXT,
  from_me       BOOLEAN NOT NULL,
  timestamp     BIGINT NOT NULL,
  type          TEXT NOT NULL,
  text          TEXT,
  media_path    TEXT,
  media_mime    TEXT,
  media_size    BIGINT,
  media_thumb_path TEXT,
  media_duration BIGINT,
  raw_json      TEXT,
  indexed_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            SERIAL PRIMARY KEY,
  started_at    BIGINT NOT NULL,
  finished_at   BIGINT,
  status        TEXT NOT NULL,
  messages_indexed INTEGER DEFAULT 0,
  media_downloaded INTEGER DEFAULT 0,
  error         TEXT
);
`;

/** Minimal shape of the `pg` Pool we depend on — lets tests use a fake without pulling in `pg`. */
export interface PgLikePool {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export interface PostgresWriter {
  enabled: boolean;
  pool: PgLikePool | null;
  writeChat(chat: Chat): Promise<void>;
  writeMessage(message: Message): Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates an opt-in Postgres writer. Lazy-connects only when a connection
 * string is provided; otherwise all writes are no-ops (`enabled: false`).
 *
 * `poolFactory` is injectable for tests to avoid a real `pg` dependency.
 */
export function createPostgresWriter(
  connectionString: string | undefined,
  poolFactory?: (connectionString: string) => PgLikePool,
): PostgresWriter {
  if (!connectionString) {
    return {
      enabled: false,
      pool: null,
      async writeChat() {},
      async writeMessage() {},
      async close() {},
    };
  }

  let pool: PgLikePool | undefined;
  let initialized: Promise<void> | null = null;

  async function getPool(): Promise<PgLikePool> {
    if (!pool) {
      if (poolFactory) {
        pool = poolFactory(connectionString as string);
      } else {
        // Lazy dynamic import: only pulled in when a DATABASE_URL is actually set.
        const pg = await import("pg");
        const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: typeof pg.Pool }).Pool;
        pool = new Pool({ connectionString }) as unknown as PgLikePool;
      }
    }
    return pool;
  }

  async function ensureSchema(): Promise<void> {
    if (!initialized) {
      initialized = getPool().then((p) => p.query(PG_SCHEMA_SQL).then(() => undefined));
    }
    return initialized;
  }

  return {
    enabled: true,
    get pool() {
      return pool ?? null;
    },
    async writeChat(chat: Chat) {
      await ensureSchema();
      const p = await getPool();
      await p.query(
        `INSERT INTO chats (jid, name, is_group, last_message_at, unread_count, profile_pic_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (jid) DO UPDATE SET
           name = EXCLUDED.name,
           is_group = EXCLUDED.is_group,
           last_message_at = EXCLUDED.last_message_at,
           unread_count = EXCLUDED.unread_count,
           profile_pic_path = EXCLUDED.profile_pic_path`,
        [
          chat.jid,
          chat.name,
          Boolean(chat.is_group),
          chat.last_message_at,
          chat.unread_count,
          chat.profile_pic_path,
          chat.created_at,
        ],
      );
    },
    async writeMessage(message: Message) {
      await ensureSchema();
      const p = await getPool();
      await p.query(
        `INSERT INTO messages (
           id, chat_jid, sender_jid, sender_name, from_me, timestamp, type, text,
           media_path, media_mime, media_size, media_thumb_path, media_duration,
           raw_json, indexed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          message.chat_jid,
          message.sender_jid,
          message.sender_name,
          Boolean(message.from_me),
          message.timestamp,
          message.type,
          message.text,
          message.media_path,
          message.media_mime,
          message.media_size,
          message.media_thumb_path,
          message.media_duration,
          message.raw_json,
          message.indexed_at,
        ],
      );
    },
    async close() {
      if (pool) {
        await pool.end();
      }
    },
  };
}
