import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheAudioWaveform,
  cacheImageThumbnail,
  cacheMediaThumbnail,
  cacheVideoThumbnail,
} from "../src/media-cache.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

let cacheDir: string;

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

    const sharp = (await import("sharp")).default;
    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(200);
  }, 15000);

  it("extracts a frame from a video and caches it as a 200x200 webp thumbnail", async () => {
    const { thumbPath } = await cacheVideoThumbnail("m2", path.join(FIXTURES, "fixture.mp4"), {
      cacheDir,
    });

    expect(thumbPath).toBe(path.join(cacheDir, "m2.webp"));
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);

    const sharp = (await import("sharp")).default;
    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(200);
  }, 15000);

  it("renders an 800x100 waveform PNG for audio", async () => {
    const { thumbPath } = await cacheAudioWaveform("m3", path.join(FIXTURES, "fixture.wav"), {
      cacheDir,
    });

    expect(thumbPath).toBe(path.join(cacheDir, "m3.waveform.png"));
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(0);

    const sharp = (await import("sharp")).default;
    const metadata = await sharp(thumbPath).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(100);
  }, 15000);

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
