import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertInside, safeFileId } from "../src/safe-id.js";

describe("safeFileId", () => {
  it("keeps well-formed WhatsApp ids verbatim so filenames stay stable", () => {
    expect(safeFileId("3EB0A1B2C3D4E5F6")).toBe("3EB0A1B2C3D4E5F6");
    expect(safeFileId("abc-123_XYZ")).toBe("abc-123_XYZ");
  });

  it("hashes ids containing path separators", () => {
    const hashed = safeFileId("../../../../Users/me/Documents/taxes");
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed).not.toContain("/");
    expect(hashed).not.toContain("..");
  });

  it("hashes ids that would be read as a command-line option", () => {
    // ffmpeg reads a leading '-' as a flag, not a filename.
    expect(safeFileId("-i")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes ids with NUL bytes, spaces and absolute paths", () => {
    for (const hostile of ["a\u0000b", "with space", "/etc/passwd", "C:\\Windows\\hosts"]) {
      expect(safeFileId(hostile)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("hashes over-long ids", () => {
    expect(safeFileId("a".repeat(65))).toMatch(/^[a-f0-9]{64}$/);
    expect(safeFileId("a".repeat(64))).toBe("a".repeat(64));
  });

  it("hashes the empty id", () => {
    expect(safeFileId("")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic, so re-syncing the same message reuses the same file", () => {
    expect(safeFileId("../evil")).toBe(safeFileId("../evil"));
  });
});

describe("assertInside", () => {
  const dir = "/tmp/media";

  it("accepts a path directly inside the directory", () => {
    expect(() => assertInside(dir, path.join(dir, "file.jpg"))).not.toThrow();
  });

  it("rejects an escape via ..", () => {
    expect(() => assertInside(dir, path.join(dir, "..", "escaped.jpg"))).toThrow(
      /refusing to write outside/,
    );
  });

  it("rejects the directory itself", () => {
    expect(() => assertInside(dir, dir)).toThrow(/refusing to write outside/);
  });

  it("rejects a sibling directory sharing the same prefix", () => {
    // /tmp/mediaXX must not count as inside /tmp/media.
    expect(() => assertInside(dir, "/tmp/mediaXX/file.jpg")).toThrow(/refusing to write outside/);
  });
});
