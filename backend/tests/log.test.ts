import { describe, expect, it, vi } from "vitest";
import { describeError, fireAndForget, logBackgroundError, redactSecrets } from "../src/log.js";

describe("redactSecrets", () => {
  it("removes the password from a Postgres URL", () => {
    expect(redactSecrets("postgres://otavio:hunter2@localhost:5432/db")).toBe(
      "postgres://otavio:***@localhost:5432/db",
    );
  });

  it("removes the password from a MongoDB URL", () => {
    expect(redactSecrets("mongodb+srv://user:s3cr3t@cluster.example.net/db")).toBe(
      "mongodb+srv://user:***@cluster.example.net/db",
    );
  });

  it("redacts every URL in a longer message", () => {
    const text = "bad postgres://a:p1@h/db and mongodb://b:p2@h/db";
    const out = redactSecrets(text);
    expect(out).not.toContain("p1");
    expect(out).not.toContain("p2");
  });

  it("leaves credential-free text alone", () => {
    expect(redactSecrets("ECONNREFUSED 127.0.0.1:5432")).toBe("ECONNREFUSED 127.0.0.1:5432");
  });
});

describe("describeError", () => {
  it("scrubs credentials out of an Error message", () => {
    const error = new Error('invalid connection string: "postgres://u:letmein@h/db"');
    const described = describeError(error);
    expect(described).not.toContain("letmein");
    expect(described).toContain("Error:");
  });

  it("handles non-Error throws", () => {
    expect(describeError("plain string")).toBe("plain string");
  });
});

describe("fireAndForget", () => {
  it("swallows a rejection instead of letting it go unhandled", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fireAndForget("test", Promise.reject(new Error("boom postgres://u:pw@h/db")));
    await new Promise((resolve) => setImmediate(resolve));

    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).not.toContain("pw");
    spy.mockRestore();
  });
});

describe("logBackgroundError", () => {
  it("prefixes the context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logBackgroundError("mirror:postgres", new Error("nope"));
    expect(spy).toHaveBeenCalledWith("[mirror:postgres] Error: nope");
    spy.mockRestore();
  });
});
