import type { Chat, Message } from "../types.js";

/** Minimal shape of the `mongodb` collections/db we depend on — lets tests use a fake. */
export interface MongoLikeCollection {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert: boolean },
  ): Promise<unknown>;
}

export interface MongoLikeClient {
  db(name?: string): { collection(name: string): MongoLikeCollection };
  close(): Promise<void>;
}

export interface MongoWriter {
  enabled: boolean;
  client: MongoLikeClient | null;
  writeChat(chat: Chat): Promise<void>;
  writeMessage(message: Message): Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates an opt-in MongoDB writer. Lazy-connects only when a connection
 * string is provided; otherwise all writes are no-ops (`enabled: false`).
 *
 * `clientFactory` is injectable for tests to avoid a real `mongodb` dependency.
 */
export function createMongoWriter(
  connectionString: string | undefined,
  clientFactory?: (connectionString: string) => MongoLikeClient,
  dbName = "whatsapp_history",
): MongoWriter {
  if (!connectionString) {
    return {
      enabled: false,
      client: null,
      async writeChat() {},
      async writeMessage() {},
      async close() {},
    };
  }

  let client: MongoLikeClient | undefined;

  async function getClient(): Promise<MongoLikeClient> {
    if (!client) {
      if (clientFactory) {
        client = clientFactory(connectionString as string);
      } else {
        // Lazy dynamic import: only pulled in when a MONGO_URL is actually set.
        const mongodb = await import("mongodb");
        const MongoClient = mongodb.MongoClient;
        const realClient = new MongoClient(connectionString as string);
        await realClient.connect();
        client = realClient as unknown as MongoLikeClient;
      }
    }
    return client;
  }

  return {
    enabled: true,
    get client() {
      return client ?? null;
    },
    async writeChat(chat: Chat) {
      const c = await getClient();
      await c
        .db(dbName)
        .collection("chats")
        .updateOne({ jid: chat.jid }, { $set: chat }, { upsert: true });
    },
    async writeMessage(message: Message) {
      const c = await getClient();
      await c
        .db(dbName)
        .collection("messages")
        .updateOne({ id: message.id }, { $set: message }, { upsert: true });
    },
    async close() {
      if (client) {
        await client.close();
      }
    },
  };
}
