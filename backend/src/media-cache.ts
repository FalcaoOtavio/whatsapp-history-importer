import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type MediaKind = "image" | "video" | "audio";

export interface MediaCacheDeps {
  /** Root directory the cache is written under. Defaults to `.media/` in cwd. */
  cacheDir?: string;
  /** Resizes an image buffer to a 200x200 webp thumbnail. Defaults to sharp. */
  imageThumbnailer?: (input: Buffer) => Promise<Buffer>;
  /** Runs an external command (ffmpeg / audiowaveform). Defaults to child_process.execFile. */
  execRunner?: (cmd: string, args: string[]) => Promise<void>;
}

export interface ThumbnailResult {
  /** Absolute path to the generated thumbnail/waveform file. */
  thumbPath: string;
}

const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), ".media");

function resolveCacheDir(deps: MediaCacheDeps): string {
  return deps.cacheDir ?? DEFAULT_CACHE_DIR;
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

/** Ensures the cache directory exists and returns the thumbnail path for a message ID. */
async function thumbPathFor(deps: MediaCacheDeps, msgId: string, ext: string): Promise<string> {
  const dir = resolveCacheDir(deps);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${msgId}.${ext}`);
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
  const framePath = path.join(dir, `${msgId}.frame.png`);

  await run("ffmpeg", [
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

/** Audio: render an 800x100 waveform PNG via audiowaveform. */
export async function cacheAudioWaveform(
  msgId: string,
  sourcePath: string,
  deps: MediaCacheDeps = {},
): Promise<ThumbnailResult> {
  const run = deps.execRunner ?? defaultExecRunner;
  const thumbPath = await thumbPathFor(deps, msgId, "waveform.png");

  await run("audiowaveform", [
    "-i",
    sourcePath,
    "-o",
    thumbPath,
    "-w",
    "800",
    "-h",
    "100",
    "--no-axis-labels",
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
