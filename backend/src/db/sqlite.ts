import Database from "better-sqlite3";
import type { Chat, Message } from "../types.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type SqliteDb = Database.Database;

/** Open (or create) the SQLite store at `path` and apply the schema. Pass ":memory:" for tests. */
export function openDb(path: string): SqliteDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  }

  return db;
}

export function upsertChat(db: SqliteDb, chat: Chat): void {
  db.prepare(
    `INSERT INTO chats (jid, name, is_group, last_message_at, unread_count, profile_pic_path, created_at)
     VALUES (@jid, @name, @is_group, @last_message_at, @unread_count, @profile_pic_path, @created_at)
     ON CONFLICT(jid) DO UPDATE SET
       name = excluded.name,
       is_group = excluded.is_group,
       last_message_at = excluded.last_message_at,
       unread_count = excluded.unread_count,
       profile_pic_path = excluded.profile_pic_path`,
  ).run(chat);
}

export function getChat(db: SqliteDb, jid: string): Chat | undefined {
  return db.prepare("SELECT * FROM chats WHERE jid = ?").get(jid) as Chat | undefined;
}

export function listChats(db: SqliteDb, limit = 50, offset = 0): Chat[] {
  return db
    .prepare("SELECT * FROM chats ORDER BY last_message_at DESC LIMIT ? OFFSET ?")
    .all(clampLimit(limit), Math.max(0, Math.trunc(offset) || 0)) as Chat[];
}

export function insertMessage(db: SqliteDb, message: Message): void {
  db.prepare(
    `INSERT INTO messages (
       id, chat_jid, sender_jid, sender_name, from_me, timestamp, type, text,
       media_path, media_mime, media_size, media_thumb_path, media_duration,
       raw_json, indexed_at
     ) VALUES (
       @id, @chat_jid, @sender_jid, @sender_name, @from_me, @timestamp, @type, @text,
       @media_path, @media_mime, @media_size, @media_thumb_path, @media_duration,
       @raw_json, @indexed_at
     )
     ON CONFLICT(id) DO NOTHING`,
  ).run(message);
}

export function getMessage(db: SqliteDb, id: string): Message | undefined {
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Message | undefined;
}

/**
 * Records where a message's media and thumbnail were written.
 *
 * Messages are inserted from history with both paths null - the bytes are
 * fetched afterwards (see media-downloader.ts), so this fills them in once the
 * download lands.
 *
 * `chatJid` is part of the WHERE clause on purpose. A WhatsApp `key.id` is only
 * unique per conversation, and the sender picks it: a peer can reuse the id of
 * a message in *another* chat, and this UPDATE would then point that unrelated
 * message at the attacker's file. Matching on both columns keeps the write on
 * the row the download was actually for.
 */
export function setMediaPaths(
  db: SqliteDb,
  id: string,
  chatJid: string,
  mediaPath: string | null,
  thumbPath: string | null,
): void {
  db.prepare(
    "UPDATE messages SET media_path = ?, media_thumb_path = ? WHERE id = ? AND chat_jid = ?",
  ).run(mediaPath, thumbPath, id, chatJid);
}

/** Page size ceiling: one response must not be able to pull the whole archive. */
export const MAX_PAGE_SIZE = 500;

/**
 * SQLite reads a negative LIMIT as "no limit at all", so `?limit=-1` would make
 * a single request serialise every message in the chat to JSON. The HTTP layer
 * clamps too; this is the backstop for any other caller.
 */
export function clampLimit(value: number | undefined, fallback = 50): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

export function listMessages(
  db: SqliteDb,
  chatJid: string,
  opts: { since?: number; until?: number; limit?: number } = {},
): Message[] {
  const limit = clampLimit(opts.limit);
  if (opts.since !== undefined) {
    return db
      .prepare(
        "SELECT * FROM messages WHERE chat_jid = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT ?",
      )
      .all(chatJid, opts.since, limit) as Message[];
  }
  if (opts.until !== undefined) {
    return db
      .prepare(
        "SELECT * FROM messages WHERE chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?",
      )
      .all(chatJid, opts.until, limit) as Message[];
  }
  return db
    .prepare("SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?")
    .all(chatJid, limit) as Message[];
}
