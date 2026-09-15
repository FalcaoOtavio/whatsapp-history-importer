import { describe, expect, it, vi } from "vitest";
import { createMongoWriter, type MongoLikeClient, type MongoLikeCollection } from "../src/db/mongo.js";
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

function makeFakeClient(): MongoLikeClient & { calls: { collection: string; filter: unknown }[] } {
  const calls: { collection: string; filter: unknown }[] = [];
  const makeCollection = (name: string): MongoLikeCollection => ({
    async updateOne(filter) {
      calls.push({ collection: name, filter });
      return { acknowledged: true };
    },
  });
  return {
    calls,
    db() {
      return { collection: (name: string) => makeCollection(name) };
    },
    async close() {},
  };
}

describe("mongo writer", () => {
  it("is disabled (no-op) when no connection string is given", async () => {
    const writer = createMongoWriter(undefined);
    expect(writer.enabled).toBe(false);
    await expect(writer.writeChat(makeChat())).resolves.toBeUndefined();
    await expect(writer.writeMessage(makeMessage())).resolves.toBeUndefined();
  });

  it("does not create a client until the first write", () => {
    const clientFactory = vi.fn(() => makeFakeClient());
    const writer = createMongoWriter("mongodb://localhost/test", clientFactory);
    expect(writer.enabled).toBe(true);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(writer.client).toBeNull();
  });

  it("connects and upserts a chat", async () => {
    const fakeClient = makeFakeClient();
    const clientFactory = vi.fn(() => fakeClient);
    const writer = createMongoWriter("mongodb://localhost/test", clientFactory);

    await writer.writeChat(makeChat());

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls).toEqual([{ collection: "chats", filter: { jid: "a@s.whatsapp.net" } }]);
  });

  it("connects and upserts a message", async () => {
    const fakeClient = makeFakeClient();
    const clientFactory = vi.fn(() => fakeClient);
    const writer = createMongoWriter("mongodb://localhost/test", clientFactory);

    await writer.writeMessage(makeMessage());

    expect(fakeClient.calls).toEqual([{ collection: "messages", filter: { id: "m1" } }]);
  });

  it("reuses the same client across writes (connects once)", async () => {
    const clientFactory = vi.fn(() => makeFakeClient());
    const writer = createMongoWriter("mongodb://localhost/test", clientFactory);

    await writer.writeChat(makeChat());
    await writer.writeMessage(makeMessage());

    expect(clientFactory).toHaveBeenCalledTimes(1);
  });
});
