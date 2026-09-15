import { describe, expect, it, vi } from "vitest";
import { createPostgresWriter, type PgLikePool } from "../src/db/postgres.js";
import type { Chat, Message } from "../src/types.js";

function makeChat(): Chat {
  return {
    jid: "a@s.whatsapp.net",
    name: "Alice",
    is_group: 0,
    last_message_at: 100,
    unread_count: 0,
    profile_pic_path: null,
    created_at: 50,
  };
}

function makeMessage(): Message {
  return {
    id: "m1",
    chat_jid: "a@s.whatsapp.net",
    sender_jid: "a@s.whatsapp.net",
    sender_name: "Alice",
    from_me: 0,
    timestamp: 100,
    type: "text",
    text: "oi",
    media_path: null,
    media_mime: null,
    media_size: null,
    media_thumb_path: null,
    media_duration: null,
    raw_json: null,
    indexed_at: 100,
  };
}

function makeFakePool(): PgLikePool & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(text: string) {
      queries.push(text);
      return { rows: [] };
    },
    async end() {},
  };
}

describe("postgres writer", () => {
  it("is disabled (no-op) when no connection string is given", async () => {
    const writer = createPostgresWriter(undefined);
    expect(writer.enabled).toBe(false);
    await expect(writer.writeChat(makeChat())).resolves.toBeUndefined();
    await expect(writer.writeMessage(makeMessage())).resolves.toBeUndefined();
  });

  it("does not create a pool until the first write when a connection string is given", () => {
    const poolFactory = vi.fn(() => makeFakePool());
    const writer = createPostgresWriter("postgres://localhost/test", poolFactory);
    expect(writer.enabled).toBe(true);
    expect(poolFactory).not.toHaveBeenCalled();
    expect(writer.pool).toBeNull();
  });

  it("connects and writes a chat", async () => {
    const fakePool = makeFakePool();
    const poolFactory = vi.fn(() => fakePool);
    const writer = createPostgresWriter("postgres://localhost/test", poolFactory);

    await writer.writeChat(makeChat());

    expect(poolFactory).toHaveBeenCalledTimes(1);
    expect(fakePool.queries.some((q) => q.includes("INSERT INTO chats"))).toBe(true);
  });

  it("connects and writes a message", async () => {
    const fakePool = makeFakePool();
    const poolFactory = vi.fn(() => fakePool);
    const writer = createPostgresWriter("postgres://localhost/test", poolFactory);

    await writer.writeMessage(makeMessage());

    expect(fakePool.queries.some((q) => q.includes("INSERT INTO messages"))).toBe(true);
  });

  it("reuses the same pool across writes (connects once)", async () => {
    const poolFactory = vi.fn(() => makeFakePool());
    const writer = createPostgresWriter("postgres://localhost/test", poolFactory);

    await writer.writeChat(makeChat());
    await writer.writeMessage(makeMessage());

    expect(poolFactory).toHaveBeenCalledTimes(1);
  });
});
