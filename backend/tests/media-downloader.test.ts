import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMediaQueue,
  downloadMessageMedia,
  extensionFor,
  mediaNodeFor,
} from "../src/media-downloader.js";
import { getMessage, insertMessage, openDb, upsertChat, type SqliteDb } from "../src/db/sqlite.js";
import type { Message, MessageType } from "../src/types.js";

const NOW = 1_700_000_000_000;
const CHAT_JID = "chat1@s.whatsapp.net";

let mediaDir: string;
let db: SqliteDb;

beforeEach(async () => {
  mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-dl-test-"));
  db = openDb(":memory:");
  upsertChat(db, {
    jid: CHAT_JID,
    name: "Alice",
    is_group: 0,
    last_message_at: NOW,
    unread_count: 0,
    profile_pic_path: null,
    created_at: NOW,
  });
});

afterEach(async () => {
  db.close();
  await fs.rm(mediaDir, { recursive: true, force: true });
});

function makeMessage(id: string, type: MessageType, mime: string | null = "image/jpeg"): Message {
  const message: Message = {
    id,
    chat_jid: CHAT_JID,
    sender_jid: CHAT_JID,
    sender_name: "Alice",
    from_me: 0,
    timestamp: NOW,
    type,
    text: null,
    media_path: null,
    media_mime: mime,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: "{}",
    indexed_at: NOW,
  };
  insertMessage(db, message);
  return message;
}

/** Stands in for Baileys' downloadContentFromMessage: yields fixed bytes. */
function fakeDownloader(bytes = "jpeg-bytes") {
  return async () => Readable.from([Buffer.from(bytes)]);
}

/** Stands in for media-cache: records the call and reports a thumbnail path. */
function fakeThumbnailer(calls: string[]) {
  return async (kind: string, msgId: string) => {
    calls.push(`${kind}:${msgId}`);
    return { thumbPath: path.join(mediaDir, `${msgId}.webp`) };
  };
}

describe("extensionFor", () => {
  it("maps known MIME types and tolerates parameters", () => {
    expect(extensionFor("image/jpeg")).toBe(".jpg");
    expect(extensionFor("audio/ogg; codecs=opus")).toBe(".ogg");
  });

  it("falls back to .bin for unknown or missing types", () => {
    expect(extensionFor("application/x-whatever")).toBe(".bin");
    expect(extensionFor(null)).toBe(".bin");
  });
});

describe("mediaNodeFor", () => {
  it("pulls the node matching the message type", () => {
    const raw = { imageMessage: { mimetype: "image/jpeg" } };
    expect(mediaNodeFor(raw, "image")).toEqual({ mimetype: "image/jpeg" });
    expect(mediaNodeFor(raw, "video")).toBeNull();
    expect(mediaNodeFor(null, "image")).toBeNull();
  });
});

describe("downloadMessageMedia", () => {
  it("writes the media to disk, thumbnails it and records both paths", async () => {
    const message = makeMessage("m1", "image");
    const thumbCalls: string[] = [];

    const result = await downloadMessageMedia(
      db,
      message,
      { imageMessage: { mimetype: "image/jpeg" } },
      {
        mediaDir,
        downloader: fakeDownloader(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        thumbnailer: fakeThumbnailer(thumbCalls) as any,
      },
    );

    expect(result.mediaPath).toBe(path.join(mediaDir, "m1.jpg"));
    expect(await fs.readFile(result.mediaPath!, "utf8")).toBe("jpeg-bytes");
    expect(thumbCalls).toEqual(["image:m1"]);

    const stored = getMessage(db, "m1")!;
    expect(stored.media_path).toBe(result.mediaPath);
    expect(stored.media_thumb_path).toBe(result.thumbPath);
  });

  it("renders a waveform for audio and treats stickers as images", async () => {
    const audio = makeMessage("m2", "audio", "audio/ogg");
    const sticker = makeMessage("m3", "sticker", "image/webp");
    const thumbCalls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deps = { mediaDir, downloader: fakeDownloader(), thumbnailer: fakeThumbnailer(thumbCalls) as any };

    await downloadMessageMedia(db, audio, { audioMessage: { mimetype: "audio/ogg" } }, deps);
    await downloadMessageMedia(db, sticker, { stickerMessage: { mimetype: "image/webp" } }, deps);

    expect(thumbCalls).toEqual(["audio:m2", "image:m3"]);
    expect(getMessage(db, "m2")!.media_path).toBe(path.join(mediaDir, "m2.ogg"));
    expect(getMessage(db, "m3")!.media_path).toBe(path.join(mediaDir, "m3.webp"));
  });

  it("downloads documents but does not try to thumbnail them", async () => {
    const message = makeMessage("m4", "document", "application/pdf");
    const thumbCalls: string[] = [];

    const result = await downloadMessageMedia(
      db,
      message,
      { documentMessage: { mimetype: "application/pdf" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { mediaDir, downloader: fakeDownloader("pdf"), thumbnailer: fakeThumbnailer(thumbCalls) as any },
    );

    expect(result.mediaPath).toBe(path.join(mediaDir, "m4.pdf"));
    expect(result.thumbPath).toBeNull();
    expect(thumbCalls).toEqual([]);
  });

  it("returns nulls for a message that carries no media", async () => {
    const message = makeMessage("m5", "text", null);

    const result = await downloadMessageMedia(db, message, { conversation: "hi" }, { mediaDir });

    expect(result).toEqual({ mediaPath: null, thumbPath: null });
    expect(getMessage(db, "m5")!.media_path).toBeNull();
  });

  it("returns nulls for a media type whose node is absent from the raw payload", async () => {
    const message = makeMessage("m6", "image");

    const result = await downloadMessageMedia(db, message, {}, { mediaDir });

    expect(result).toEqual({ mediaPath: null, thumbPath: null });
  });

  it("swallows a failed download instead of aborting the sync", async () => {
    // WhatsApp expires media URLs, so old history routinely has attachments
    // that can no longer be fetched. One dead one must not kill the batch.
    const message = makeMessage("m7", "image");

    const result = await downloadMessageMedia(
      db,
      message,
      { imageMessage: { mimetype: "image/jpeg" } },
      {
        mediaDir,
        downloader: async () => {
          throw new Error("410 Gone");
        },
      },
    );

    expect(result).toEqual({ mediaPath: null, thumbPath: null });
    expect(getMessage(db, "m7")!.media_path).toBeNull();
    // No truncated leftover, or /media/:msgId would serve a broken file.
    await expect(fs.stat(path.join(mediaDir, "m7.jpg"))).rejects.toThrow();
  });

  it("keeps the media when only the thumbnail fails", async () => {
    // No ffmpeg on the box is a degraded experience, not a lost attachment.
    const message = makeMessage("m8", "image");

    const result = await downloadMessageMedia(
      db,
      message,
      { imageMessage: { mimetype: "image/jpeg" } },
      {
        mediaDir,
        downloader: fakeDownloader(),
        thumbnailer: async () => {
          throw new Error("spawn ffmpeg ENOENT");
        },
      },
    );

    expect(result.mediaPath).toBe(path.join(mediaDir, "m8.jpg"));
    expect(result.thumbPath).toBeNull();

    const stored = getMessage(db, "m8")!;
    expect(stored.media_path).toBe(result.mediaPath);
    expect(stored.media_thumb_path).toBeNull();
  });
});

describe("createMediaQueue", () => {
  it("runs downloads one at a time in order", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const queue = createMediaQueue(db, {
      mediaDir,
      downloader: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return Readable.from([Buffer.from("bytes")]);
      },
      thumbnailer: async (_kind, msgId) => {
        order.push(msgId);
        return { thumbPath: path.join(mediaDir, `${msgId}.webp`) };
      },
    });

    for (const id of ["q1", "q2", "q3"]) {
      queue.enqueue(makeMessage(id, "image"), { imageMessage: { mimetype: "image/jpeg" } });
    }
    await queue.drain();

    expect(order).toEqual(["q1", "q2", "q3"]);
    expect(maxActive).toBe(1);
  });

  it("keeps draining after one message throws", async () => {
    let calls = 0;
    const queue = createMediaQueue(db, {
      mediaDir,
      downloader: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return Readable.from([Buffer.from("bytes")]);
      },
      thumbnailer: async (_kind, msgId) => ({ thumbPath: path.join(mediaDir, `${msgId}.webp`) }),
    });

    queue.enqueue(makeMessage("q4", "image"), { imageMessage: { mimetype: "image/jpeg" } });
    queue.enqueue(makeMessage("q5", "image"), { imageMessage: { mimetype: "image/jpeg" } });
    await queue.drain();

    expect(getMessage(db, "q4")!.media_path).toBeNull();
    expect(getMessage(db, "q5")!.media_path).toBe(path.join(mediaDir, "q5.jpg"));
  });
});
