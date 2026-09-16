import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../src/server.js";

/**
 * Regression test for the bug that made the app non-functional on this
 * project's own install path.
 *
 * isMainModule() used to compare `process.argv[1]` against
 * `new URL(import.meta.url).pathname`, which is percent-encoded. On any path
 * containing a space or `~` - "Mobile Documents", "com~apple~CloudDocs",
 * "~/My Projects" - the two strings never matched, so the sidecar started,
 * skipped listen(), and exited 0 with no output and no socket. The launcher
 * then waited forever for a port that would never open.
 */
describe("isMainModule", () => {
  const paths = [
    "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/app/server.js",
    "/Users/me/My Projects/whatsapp/server.js",
    "/Users/me/projeção/server.js",
    "/repo/backend/dist/server.js",
  ];

  for (const p of paths) {
    it(`matches argv[1] against its own file URL for ${p}`, () => {
      expect(isMainModule(p, pathToFileURL(p).href)).toBe(true);
    });
  }

  it("normalises a relative argv[1]", () => {
    const abs = `${process.cwd()}/dist/server.js`;
    expect(isMainModule("./dist/server.js", pathToFileURL(abs).href)).toBe(true);
  });

  it("is false when the file was merely imported", () => {
    expect(
      isMainModule("/usr/local/bin/vitest", pathToFileURL("/repo/dist/server.js").href),
    ).toBe(false);
  });

  it("is false when node got no script argument", () => {
    expect(isMainModule(undefined, pathToFileURL("/repo/dist/server.js").href)).toBe(false);
  });
});
