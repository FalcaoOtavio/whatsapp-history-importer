import type { SqliteDb } from "./db/sqlite.js";
import { getChat, insertMessage, upsertChat } from "./db/sqlite.js";
import type { Chat, Message, MessageType } from "./types.js";

/**
 * How historical messages actually arrive in Baileys (verified against the
 * installed @whiskeysockets/baileys .d.ts files, not assumed):
 *
 * There is no `socket.getChats()` or `socket.loadHistory()` in the real API.
 * WhatsApp pushes history automatically after connecting as
 * `messaging-history.set` events (chats + contacts + messages, possibly
 * split across several events, with `isLatest`/`progress` marking the end).
 * There is also `socket.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp)`
 * for on-demand pagination, but multiple open issues report WhatsApp servers
 * silently never responding to it (whiskeysockets/baileys#2452, #1934,
 * #1834, #2462) - it is not a reliable pull mechanism. So we build history
 * entirely from the automatic push events: attach a listener, persist every
 * batch, and filter out anything older than the retention cutoff.
 */
export const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

export interface BaileysMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

/** A Long-like 64-bit value (protobufjs `Long`) or a plain number. */
export type LongLike = number | { toNumber(): number };

/** Minimal shape of a Baileys chat (proto.IConversation) we read from. */
export interface BaileysChat {
  id: string;
  name?: string | null;
  conversationTimestamp?: LongLike | null;
  unreadCount?: number | null;
}

/** Minimal shape of a Baileys message (proto.IWebMessageInfo) we read from. */
export interface BaileysMessage {
  key: BaileysMessageKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: Record<string, any> | null;
  messageTimestamp?: LongLike | null;
  pushName?: string | null;
}

/** Shape of a `messaging-history.set` event payload. */
export interface HistorySyncPayload {
  chats?: BaileysChat[];
  messages?: BaileysMessage[];
  isLatest?: boolean;
  progress?: number | null;
}

export interface HistorySyncOptions {
  /** Now, in ms since epoch. Defaults to Date.now(). Injectable for tests. */
  nowMs?: number;
  /** Retention window in ms. Defaults to THREE_YEARS_MS. */
  maxAgeMs?: number;
  /** Called after each batch is persisted - lets callers (e.g. server.ts) mirror to
   * optional writers and emit sync progress events. */
  onBatch?: (result: HistorySyncResult, payload: HistorySyncPayload) => void;
  /**
   * Called for every message actually written, with the parsed row and the raw
   * Baileys `message` node it came from. History only carries media *metadata*,
   * so the bytes have to be fetched separately - server.ts hangs the media
   * download queue off this hook. Must not throw and must not block: it runs
   * inside the synchronous batch loop.
   */
  onMessage?: (message: Message, raw: Record<string, unknown> | null | undefined) => void;
}

export interface HistorySyncResult {
  chatsWritten: number;
  messagesWritten: number;
  messagesSkippedOld: number;
}

function toNumber(value: LongLike | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return value.toNumber();
}

/** WhatsApp proto timestamps are unix seconds; our schema stores ms. */
function toMillis(value: LongLike | null | undefined): number | null {
  const seconds = toNumber(value);
  return seconds === null ? null : seconds * 1000;
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function toChat(raw: BaileysChat, nowMs: number): Chat | null {
  if (!raw.id) return null;
  return {
    jid: raw.id,
    name: raw.name ?? raw.id,
    is_group: isGroupJid(raw.id) ? 1 : 0,
    last_message_at: toMillis(raw.conversationTimestamp) ?? nowMs,
    unread_count: raw.unreadCount ?? 0,
    profile_pic_path: null,
    created_at: nowMs,
  };
}

interface ParsedContent {
  type: MessageType;
  text: string | null;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaDuration: number | null;
}

const EMPTY_CONTENT: ParsedContent = {
  type: "unknown",
  text: null,
  mediaMime: null,
  mediaSize: null,
  mediaDuration: null,
};

const REVOKE_PROTOCOL_TYPE = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMessageContent(msg: Record<string, any> | null | undefined): ParsedContent {
  if (!msg) return EMPTY_CONTENT;

  if (msg.protocolMessage?.type === REVOKE_PROTOCOL_TYPE) {
    return { ...EMPTY_CONTENT, type: "revoked" };
  }
  if (typeof msg.conversation === "string") {
    return { ...EMPTY_CONTENT, type: "text", text: msg.conversation };
  }
  if (typeof msg.extendedTextMessage?.text === "string") {
    return { ...EMPTY_CONTENT, type: "text", text: msg.extendedTextMessage.text };
  }
  if (msg.imageMessage) {
    return {
      type: "image",
      text: msg.imageMessage.caption ?? null,
      mediaMime: msg.imageMessage.mimetype ?? null,
      mediaSize: toNumber(msg.imageMessage.fileLength),
      mediaDuration: null,
    };
  }
  if (msg.videoMessage) {
    return {
      type: "video",
      text: msg.videoMessage.caption ?? null,
      mediaMime: msg.videoMessage.mimetype ?? null,
      mediaSize: toNumber(msg.videoMessage.fileLength),
      mediaDuration: msg.videoMessage.seconds ?? null,
    };
  }
  if (msg.audioMessage) {
    return {
      type: "audio",
      text: null,
      mediaMime: msg.audioMessage.mimetype ?? null,
      mediaSize: toNumber(msg.audioMessage.fileLength),
      mediaDuration: msg.audioMessage.seconds ?? null,
    };
  }
  if (msg.documentMessage) {
    return {
      type: "document",
      text: msg.documentMessage.caption ?? msg.documentMessage.fileName ?? null,
      mediaMime: msg.documentMessage.mimetype ?? null,
      mediaSize: toNumber(msg.documentMessage.fileLength),
      mediaDuration: null,
    };
  }
  if (msg.stickerMessage) {
    return {
      type: "sticker",
      text: null,
      mediaMime: msg.stickerMessage.mimetype ?? null,
      mediaSize: toNumber(msg.stickerMessage.fileLength),
      mediaDuration: null,
    };
  }
  return EMPTY_CONTENT;
}

export function toMessage(raw: BaileysMessage, nowMs: number): Message | null {
  const chatJid = raw.key.remoteJid;
  const id = raw.key.id;
  const timestamp = toMillis(raw.messageTimestamp);
  if (!chatJid || !id || timestamp === null) return null;

  const content = parseMessageContent(raw.message);
  const fromMe: 0 | 1 = raw.key.fromMe ? 1 : 0;
  const senderJid = fromMe ? null : (raw.key.participant ?? chatJid);

  return {
    id,
    chat_jid: chatJid,
    sender_jid: senderJid,
    sender_name: raw.pushName ?? null,
    from_me: fromMe,
    timestamp,
    type: content.type,
    text: content.text,
    media_path: null,
    media_mime: content.mediaMime,
    media_size: content.mediaSize,
    media_thumb_path: null,
    media_duration: content.mediaDuration,
    raw_json: JSON.stringify(raw),
    indexed_at: nowMs,
  };
}

/** Upserts a minimal placeholder chat so a message insert never trips the FK constraint. */
function ensureChatExists(db: SqliteDb, jid: string, nowMs: number): void {
  if (getChat(db, jid)) return;
  upsertChat(db, {
    jid,
    name: jid,
    is_group: isGroupJid(jid) ? 1 : 0,
    last_message_at: nowMs,
    unread_count: 0,
    profile_pic_path: null,
    created_at: nowMs,
  });
}

/**
 * Persists one `messaging-history.set` batch: upserts chats, inserts messages
 * newer than the retention cutoff (default: 3 years), skips older ones.
 */
export function processHistorySyncPayload(
  db: SqliteDb,
  payload: HistorySyncPayload,
  opts: HistorySyncOptions = {},
): HistorySyncResult {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? THREE_YEARS_MS;
  const cutoff = nowMs - maxAgeMs;

  let chatsWritten = 0;
  for (const rawChat of payload.chats ?? []) {
    const chat = toChat(rawChat, nowMs);
    if (!chat) continue;
    upsertChat(db, chat);
    chatsWritten++;
  }

  let messagesWritten = 0;
  let messagesSkippedOld = 0;
  for (const rawMessage of payload.messages ?? []) {
    const message = toMessage(rawMessage, nowMs);
    if (!message) continue;
    if (message.timestamp < cutoff) {
      messagesSkippedOld++;
      continue;
    }
    ensureChatExists(db, message.chat_jid, nowMs);
    insertMessage(db, message);
    opts.onMessage?.(message, rawMessage.message);
    messagesWritten++;
  }

  return { chatsWritten, messagesWritten, messagesSkippedOld };
}

/** Minimal shape of the part of BaileysClient this module depends on. */
export interface HistorySyncSource {
  onHistorySync(listener: (payload: unknown) => void): void;
}

/** Wires a client's history-sync events straight into the DB. */
export function attachHistorySync(
  client: HistorySyncSource,
  db: SqliteDb,
  opts: HistorySyncOptions = {},
): void {
  client.onHistorySync((payload) => {
    const typed = payload as HistorySyncPayload;
    const result = processHistorySyncPayload(db, typed, opts);
    opts.onBatch?.(result, typed);
  });
}
