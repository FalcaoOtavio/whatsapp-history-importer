import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cacheAudioWaveform,
  cacheImageThumbnail,
  cacheMediaThumbnail,
  cacheVideoThumbnail,
} from "../src/media-cache.js";
import { FFMPEG_PATH } from "./ffmpeg-path.js";

// ffmpeg is downloaded on demand by the launcher, so a machine that has not
// bootstrapped yet (or ran `initial.py --check --skip-ffmpeg`) legitimately has
// none. Skip those two cases instead of failing with ENOENT; everything that
// does not shell out still runs.
const itWithFfmpeg = FFMPEG_PATH ? it : it.skip;

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

let cacheDir: string;
let sharp: typeof import("sharp").default;

// sharp loads an 18 MB native libvips on first import. That is milliseconds once
// the file is in the page cache, but a cold read - a fresh `npm ci` on CI, or a
// checkout on iCloud Drive, where the dylib is evicted and must come back over
// the network - can take minutes. Paying it here keeps it out of the per-test
// budget below, which measures image work (single-digit ms), not module loading.
beforeAll(async () => {
  sharp = (await import("sharp")).default;
}, 300_000);

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-cache-test-"));
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe("media-cache", () => {
  it("caches a 200x200 webp thumbnail for an image", async () => {
    const { thumbPath } = await cacheImageThumbnail("m1", path.join(FIXTURES, "fixture.png"), {
      cacheDir,
    });

    expect(thumbPath).toBe(path.join(cacheDir, "m1.webp"));
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);

    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(200);
  }, 15000);

  itWithFfmpeg("extracts a frame from a video and caches it as a 200x200 webp thumbnail", async () => {
    const { thumbPath } = await cacheVideoThumbnail("m2", path.join(FIXTURES, "fixture.mp4"), {
      cacheDir,
      ffmpegPath: FFMPEG_PATH ?? undefined,
    });

    expect(thumbPath).toBe(path.join(cacheDir, "m2.webp"));
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);

    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(200);
  }, 15000);

  itWithFfmpeg("renders an 800x100 waveform PNG for audio", async () => {
    const { thumbPath } = await cacheAudioWaveform("m3", path.join(FIXTURES, "fixture.wav"), {
      cacheDir,
      ffmpegPath: FFMPEG_PATH ?? undefined,
    });

    expect(thumbPath).toBe(path.join(cacheDir, "m3.waveform.png"));
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);

    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(100);
  }, 15000);

  it("uses the configured ffmpeg binary rather than assuming one on PATH", async () => {
    // The static ffmpeg the launcher downloads lives in the venv, not on PATH,
    // so an absolute path must reach execFile verbatim for both media kinds.
    const calls: string[] = [];
    // Stands in for ffmpeg: records the binary and writes the frame the video
    // path then reads back, so no real ffmpeg is needed to assert resolution.
    const execRunner = async (cmd: string, args: string[]) => {
      calls.push(cmd);
      const output = args[args.length - 1];
      await fs.writeFile(output, Buffer.from("fake-frame"));
    };

    await cacheAudioWaveform("m6", path.join(FIXTURES, "fixture.wav"), {
      cacheDir,
      execRunner,
      ffmpegPath: "/opt/whi/ffmpeg",
    });

    await cacheVideoThumbnail("m7", path.join(FIXTURES, "fixture.mp4"), {
      cacheDir,
      execRunner,
      ffmpegPath: "/opt/whi/ffmpeg",
      imageThumbnailer: async () => Buffer.from("stub"),
    });

    expect(calls).toEqual(["/opt/whi/ffmpeg", "/opt/whi/ffmpeg"]);
  });

  it("falls back to FFMPEG_PATH from the environment", async () => {
    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/env/ffmpeg";
    try {
      const calls: string[] = [];
      await cacheAudioWaveform("m8", path.join(FIXTURES, "fixture.wav"), {
        cacheDir,
        execRunner: async (cmd: string, args: string[]) => {
          calls.push(cmd);
          await fs.writeFile(args[args.length - 1], Buffer.from("fake-waveform"));
        },
      });
      expect(calls).toEqual(["/env/ffmpeg"]);
    } finally {
      if (original === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = original;
    }
  });

  it("dispatches to the right thumbnailer via cacheMediaThumbnail", async () => {
    const { thumbPath } = await cacheMediaThumbnail(
      "image",
      "m4",
      path.join(FIXTURES, "fixture.png"),
      { cacheDir },
    );

    expect(thumbPath).toBe(path.join(cacheDir, "m4.webp"));
  }, 15000);

  it("creates the cache directory if it does not exist yet", async () => {
    const nested = path.join(cacheDir, "nested", "dir");
    const { thumbPath } = await cacheImageThumbnail("m5", path.join(FIXTURES, "fixture.png"), {
      cacheDir: nested,
    });

    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);
  }, 15000);
});
