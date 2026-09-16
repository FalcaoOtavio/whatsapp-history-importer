import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { cacheMediaThumbnail, type MediaCacheDeps, type MediaKind } from "./media-cache.js";
import type { SqliteDb } from "./db/sqlite.js";
import { setMediaPaths } from "./db/sqlite.js";
import type { Message } from "./types.js";
import { assertInside, safeFileId } from "./safe-id.js";
import { logBackgroundError } from "./log.js";

/**
 * Downloads the media attached to a message and records where it landed.
 *
 * history-sync only persists message *metadata*: `media_path` was always left
 * null, so `GET /media/:msgId` answered 404 for every message and the whole of
 * media-cache.ts was unreachable. This module closes that gap - it is what
 * turns a stored message into a file on disk plus a thumbnail.
 *
 * Media is fetched from WhatsApp's CDN and decrypted with the message's own
 * key, which Baileys' `downloadContentFromMessage` handles. That is the only
 * network call; the bytes are written straight to `.media/` on this machine.
 */

const DEFAULT_MEDIA_DIR = path.resolve(process.cwd(), ".media");

/** Baileys media types we can download, keyed by our own message type. */
const BAILEYS_TYPE: Record<string, "image" | "video" | "audio" | "document" | "sticker"> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  sticker: "sticker",
};

/** Which message types get a generated thumbnail, and of which kind. */
const THUMBNAIL_KIND: Record<string, MediaKind> = {
  image: "image",
  video: "video",
  audio: "audio",
  sticker: "image",
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
};

/** Derives a file extension from the MIME type, falling back to `.bin`. */
export function extensionFor(mime: string | null): string {
  if (!mime) return ".bin";
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? ".bin";
}

export interface MediaDownloaderDeps {
  /** Directory media is written to. Defaults to `.media/` in cwd. */
  mediaDir?: string;
  /**
   * Returns a readable stream of the decrypted media. Defaults to Baileys'
   * `downloadContentFromMessage`. Injectable so tests never hit the network.
   */
  downloader?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: Record<string, any>,
    type: string,
  ) => Promise<Readable>;
  /** Thumbnail generation, injectable for tests. Defaults to media-cache. */
  thumbnailer?: typeof cacheMediaThumbnail;
  /** Passed through to the thumbnailer (cache dir, ffmpeg path, ...). */
  cacheDeps?: MediaCacheDeps;
}

export interface DownloadResult {
  mediaPath: string | null;
  thumbPath: string | null;
}

/** Pulls the media node (imageMessage, videoMessage, ...) out of a raw message. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mediaNodeFor(raw: Record<string, any> | null | undefined, type: string) {
  if (!raw) return null;
  const key = `${type}Message`;
  return raw[key] ?? null;
}

async function defaultDownloader(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Record<string, any>,
  type: string,
): Promise<Readable> {
  const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
  return (await downloadContentFromMessage(
    content as never,
    type as never,
  )) as unknown as Readable;
}

/**
 * Downloads one message's media into the cache and writes both paths back to
 * SQLite. Returns nulls for messages that carry no media.
 *
 * Failures are returned, never thrown: WhatsApp expires media URLs after a
 * while, so old history routinely has attachments that can no longer be
 * fetched. One dead attachment must not abort a sync of thousands of messages.
 */
export async function downloadMessageMedia(
  db: SqliteDb,
  message: Message,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Record<string, any> | null | undefined,
  deps: MediaDownloaderDeps = {},
): Promise<DownloadResult> {
  const baileysType = BAILEYS_TYPE[message.type];
  if (!baileysType) return { mediaPath: null, thumbPath: null };

  const node = mediaNodeFor(raw, message.type);
  if (!node) return { mediaPath: null, thumbPath: null };

  const dir = deps.mediaDir ?? DEFAULT_MEDIA_DIR;
  await fsp.mkdir(dir, { recursive: true });

  // message.id is sender-controlled: never let it be a path segment.
  const fileId = safeFileId(message.id);
  const mediaPath = path.join(dir, `${fileId}${extensionFor(message.media_mime)}`);
  assertInside(dir, mediaPath);
  const download = deps.downloader ?? defaultDownloader;

  try {
    const stream = await download(node, baileysType);
    await pipeline(stream, fs.createWriteStream(mediaPath));
  } catch {
    // Expired URL, revoked media or a network failure: keep the metadata we
    // already have and move on. Drop whatever partial bytes landed, otherwise a
    // truncated file would be served as if it were the real attachment.
    await fsp.rm(mediaPath, { force: true });
    return { mediaPath: null, thumbPath: null };
  }

  let thumbPath: string | null = null;
  const thumbKind = THUMBNAIL_KIND[message.type];
  if (thumbKind) {
    const thumbnailer = deps.thumbnailer ?? cacheMediaThumbnail;
    try {
      const result = await thumbnailer(thumbKind, fileId, mediaPath, {
        cacheDir: dir,
        ...deps.cacheDeps,
      });
      thumbPath = result.thumbPath;
    } catch {
      // No ffmpeg, or a file ffmpeg cannot read: the media itself downloaded
      // fine and is still served, just without a thumbnail.
      thumbPath = null;
    }
  }

  setMediaPaths(db, message.id, message.chat_jid, mediaPath, thumbPath);
  return { mediaPath, thumbPath };
}

export interface MediaQueue {
  /** Schedules one message's media for download. Returns immediately. */
  enqueue(message: Message, raw: Record<string, unknown> | null | undefined): void;
  /** Resolves once everything enqueued so far has been processed. */
  drain(): Promise<void>;
  /** How many messages are still waiting. */
  readonly pending: number;
}

/**
 * Serialises media downloads behind the history sync.
 *
 * A single `messaging-history.set` batch can carry thousands of messages. Firing
 * a download per message as they are parsed would open thousands of concurrent
 * CDN connections and stall the sync; running them one at a time keeps the
 * sidecar responsive and lets `GET /chats` answer while media still trickles in.
 */
export function createMediaQueue(db: SqliteDb, deps: MediaDownloaderDeps = {}): MediaQueue {
  const queue: Array<[Message, Record<string, unknown> | null | undefined]> = [];
  let running: Promise<void> | null = null;

  async function drainQueue(): Promise<void> {
    while (queue.length > 0) {
      const [message, raw] = queue.shift()!;
      try {
        await downloadMessageMedia(db, message, raw, deps);
      } catch (error) {
        // downloadMessageMedia already swallows per-message failures; this only
        // guards against a bug in it taking the whole queue down with it.
        logBackgroundError("media:download", error);
      }
    }
    running = null;
  }

  return {
    enqueue(message, raw) {
      queue.push([message, raw]);
      running ??= drainQueue();
    },
    async drain() {
      while (running) await running;
    },
    get pending() {
      return queue.length;
    },
  };
}
