import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Finds an ffmpeg the media-cache tests can actually run.
 *
 * The launcher downloads a static ffmpeg into the venv rather than onto PATH,
 * so tests must not assume a bare `ffmpeg` resolves — on a clean Linux box it
 * does not, and the tests failed with ENOENT instead of skipping. Resolution
 * order matches the sidecar's own (media-cache.ts): $FFMPEG_PATH, then the
 * venv copy, then PATH.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function venvCandidates(): string[] {
  const base = path.join(REPO_ROOT, ".venv", "lib");
  let pythonDirs: string[] = [];
  try {
    pythonDirs = fs.readdirSync(base).filter((d) => d.startsWith("python"));
  } catch {
    return [];
  }

  const platform = os.platform() === "darwin" ? "darwin" : "linux";
  const arch = os.arch() === "arm64" ? "arm64" : "x86_64";

  return pythonDirs.map((d) =>
    path.join(base, d, "site-packages", "static_ffmpeg", "bin", `${platform}_${arch}`, "ffmpeg"),
  );
}

function isRunnable(candidate: string): boolean {
  try {
    execFileSync(candidate, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Absolute ffmpeg path, or null when no usable ffmpeg exists on this machine. */
export function findFfmpeg(): string | null {
  const candidates = [
    ...(process.env.FFMPEG_PATH ? [process.env.FFMPEG_PATH] : []),
    ...venvCandidates(),
    "ffmpeg",
  ];

  for (const candidate of candidates) {
    if (isRunnable(candidate)) return candidate;
  }
  return null;
}

export const FFMPEG_PATH = findFfmpeg();
