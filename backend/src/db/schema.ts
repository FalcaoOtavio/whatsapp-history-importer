export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS chats (
  jid           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  is_group      INTEGER NOT NULL,
  last_message_at INTEGER,
  unread_count  INTEGER DEFAULT 0,
  profile_pic_path TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  chat_jid      TEXT NOT NULL REFERENCES chats(jid),
  sender_jid    TEXT,
  sender_name   TEXT,
  from_me       INTEGER NOT NULL,
  timestamp     INTEGER NOT NULL,
  type          TEXT NOT NULL,
  text          TEXT,
  media_path    TEXT,
  media_mime    TEXT,
  media_size    INTEGER,
  media_thumb_path TEXT,
  media_duration INTEGER,
  raw_json      TEXT,
  indexed_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_jid, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_chats_lastmsg ON chats(last_message_at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  status        TEXT NOT NULL,
  messages_indexed INTEGER DEFAULT 0,
  media_downloaded INTEGER DEFAULT 0,
  error         TEXT
);
`;

export const SCHEMA_VERSION = 1;
