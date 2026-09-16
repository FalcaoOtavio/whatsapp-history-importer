import crypto from "node:crypto";
import path from "node:path";

/**
 * Turns a WhatsApp message ID into something safe to use as a filename.
 *
 * `key.id` comes straight off the wire and is whatever the *sender's* client
 * put there - a patched client can send `../../../../Users/me/Documents/taxes`.
 * Joined onto the media directory that escapes it, and `fs.createWriteStream`
 * would then overwrite an arbitrary file (and the failure path's `rm` would
 * delete one). It can equally start with `-`, which ffmpeg reads as an option
 * rather than a filename.
 *
 * Well-formed IDs (WhatsApp uses hex/base64url-ish strings) are kept verbatim so
 * files stay recognisable and the mapping is stable across syncs; anything else
 * is replaced by a SHA-256 of the original. Hashing rather than rejecting means
 * a hostile ID still gets its media downloaded, just under a boring name.
 *
 * The first character is deliberately stricter than the rest: `-` is fine inside
 * an ID but not at the start, where ffmpeg would parse the filename as an option
 * (`-i`, `-y`) instead. Real WhatsApp IDs never begin with one.
 */
export function safeFileId(id: string): string {
  if (/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(id)) return id;
  return crypto.createHash("sha256").update(id).digest("hex");
}

/**
 * Asserts `candidate` really sits inside `dir`.
 *
 * Belt-and-braces behind safeFileId: any future caller that builds a path from
 * remote data still cannot write outside the media directory.
 */
export function assertInside(dir: string, candidate: string): void {
  const root = path.resolve(dir) + path.sep;
  if (!path.resolve(candidate).startsWith(root)) {
    throw new Error(`refusing to write outside ${dir}: ${candidate}`);
  }
}
