import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { assertInside, safeFileId } from "./safe-id.js";

export type MediaKind = "image" | "video" | "audio";

export interface MediaCacheDeps {
  /** Root directory the cache is written under. Defaults to `.media/` in cwd. */
  cacheDir?: string;
  /** Resizes an image buffer to a 200x200 webp thumbnail. Defaults to sharp. */
  imageThumbnailer?: (input: Buffer) => Promise<Buffer>;
  /** Runs an external command (ffmpeg). Defaults to child_process.execFile. */
  execRunner?: (cmd: string, args: string[]) => Promise<void>;
  /**
   * Path to the ffmpeg binary. Defaults to $FFMPEG_PATH, else bare "ffmpeg"
   * from PATH. The launcher downloads a static ffmpeg into the venv (it is not
   * on PATH) and exports FFMPEG_PATH when spawning this sidecar.
   */
  ffmpegPath?: string;
}

export interface ThumbnailResult {
  /** Absolute path to the generated thumbnail/waveform file. */
  thumbPath: string;
}

const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), ".media");

function resolveCacheDir(deps: MediaCacheDeps): string {
  return deps.cacheDir ?? DEFAULT_CACHE_DIR;
}

function resolveFfmpeg(deps: MediaCacheDeps): string {
  return deps.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
}

async function defaultImageThumbnailer(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(input).resize(200, 200, { fit: "cover" }).webp().toBuffer();
}

function defaultExecRunner(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Ensures the cache directory exists and returns the thumbnail path for a
 * message ID.
 *
 * These functions are exported and callable on their own, so the message ID is
 * sanitised here too rather than trusting media-downloader to have done it: a
 * raw `key.id` can contain `../` or start with `-`, which ffmpeg would read as
 * an option instead of a filename.
 */
async function thumbPathFor(deps: MediaCacheDeps, msgId: string, ext: string): Promise<string> {
  const dir = resolveCacheDir(deps);
  await fs.mkdir(dir, { recursive: true });
  const thumbPath = path.join(dir, `${safeFileId(msgId)}.${ext}`);
  assertInside(dir, thumbPath);
  return thumbPath;
}

/** Image: resize a source image buffer to a 200x200 webp thumbnail, cached on disk. */
export async function cacheImageThumbnail(
  msgId: string,
  sourcePath: string,
  deps: MediaCacheDeps = {},
): Promise<ThumbnailResult> {
  const thumbnailer = deps.imageThumbnailer ?? defaultImageThumbnailer;
  const input = await fs.readFile(sourcePath);
  const output = await thumbnailer(input);
  const thumbPath = await thumbPathFor(deps, msgId, "webp");
  await fs.writeFile(thumbPath, output);
  return { thumbPath };
}

/** Video: extract a frame at 1s via ffmpeg, then resize it to a 200x200 webp thumbnail. */
export async function cacheVideoThumbnail(
  msgId: string,
  sourcePath: string,
  deps: MediaCacheDeps = {},
): Promise<ThumbnailResult> {
  const run = deps.execRunner ?? defaultExecRunner;
  const dir = resolveCacheDir(deps);
  await fs.mkdir(dir, { recursive: true });
  const framePath = path.join(dir, `${safeFileId(msgId)}.frame.png`);
  assertInside(dir, framePath);

  await run(resolveFfmpeg(deps), [
    "-y",
    "-ss",
    "1",
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=200:200:force_original_aspect_ratio=increase,crop=200:200",
    framePath,
  ]);

  return cacheImageThumbnail(msgId, framePath, deps);
}

/**
 * Audio: render an 800x100 waveform PNG.
 *
 * This used to shell out to `audiowaveform`, which nothing ever installed: the
 * plan assumed `static-ffmpeg` shipped it, but that package provides only
 * ffmpeg and ffprobe. It only appeared to work on the dev machine, which has
 * audiowaveform from Homebrew. ffmpeg's own `showwavespic` filter produces the
 * same 800x100 waveform with the binary we actually ship.
 */
export async function cacheAudioWaveform(
  msgId: string,
  sourcePath: string,
  deps: MediaCacheDeps = {},
): Promise<ThumbnailResult> {
  const run = deps.execRunner ?? defaultExecRunner;
  const thumbPath = await thumbPathFor(deps, msgId, "waveform.png");

  await run(resolveFfmpeg(deps), [
    "-y",
    "-i",
    sourcePath,
    "-filter_complex",
    "showwavespic=s=800x100:colors=#25d366",
    "-frames:v",
    "1",
    // Without -update the image2 muxer warns it expects a numbered sequence.
    "-update",
    "1",
    thumbPath,
  ]);

  return { thumbPath };
}

/** Dispatches to the right thumbnailer for the given media kind. */
export async function cacheMediaThumbnail(
  kind: MediaKind,
  msgId: string,
  sourcePath: string,
  deps: MediaCacheDeps = {},
): Promise<ThumbnailResult> {
  if (kind === "image") return cacheImageThumbnail(msgId, sourcePath, deps);
  if (kind === "video") return cacheVideoThumbnail(msgId, sourcePath, deps);
  return cacheAudioWaveform(msgId, sourcePath, deps);
}
