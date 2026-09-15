import { describe, expect, it, vi } from "vitest";
import { createBaileysClient, type BaileysLikeSocket } from "../src/baileys-client.js";

/** A fake Baileys socket: a tiny event emitter matching the `.ev.on` shape we use. */
function makeFakeSocket() {
  const handlers = new Map<string, ((arg: unknown) => void)[]>();
  const socket: BaileysLikeSocket = {
    ev: {
      on(event, listener) {
        const list = handlers.get(event) ?? [];
        list.push(listener as (arg: unknown) => void);
        handlers.set(event, list);
      },
    },
  };
  return {
    socket,
    emit(event: string, arg: unknown) {
      for (const listener of handlers.get(event) ?? []) listener(arg);
    },
  };
}

function makeDeps() {
  const { socket, emit } = makeFakeSocket();
  const saveCreds = vi.fn().mockResolvedValue(undefined);
  const authStateFactory = vi.fn().mockResolvedValue({ state: {}, saveCreds });
  const socketFactory = vi.fn().mockResolvedValue(socket);
  return { socket, emit, saveCreds, authStateFactory, socketFactory };
}

describe("baileys-client", () => {
  it("starts in connecting state", () => {
    const client = createBaileysClient({ authDir: "/tmp/x" });
    expect(client.state).toBe("connecting");
  });

  it("transitions to qr state and exposes the qr string on connection.update", async () => {
    const { emit, authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({ authStateFactory, socketFactory });
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    await client.connect();
    emit("connection.update", { qr: "2@abc..." });

    expect(client.state).toBe("qr");
    expect(client.currentQr).toBe("2@abc...");
    expect(states).toContain("qr");
  });

  it("transitions to connected state and clears qr when connection opens", async () => {
    const { emit, authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({ authStateFactory, socketFactory });

    await client.connect();
    emit("connection.update", { qr: "2@abc..." });
    emit("connection.update", { connection: "open" });

    expect(client.state).toBe("connected");
    expect(client.currentQr).toBeNull();
  });

  it("transitions to disconnected on connection close", async () => {
    const { emit, authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({ authStateFactory, socketFactory });

    await client.connect();
    emit("connection.update", { connection: "close" });

    expect(client.state).toBe("disconnected");
  });

  it("persists creds on creds.update", async () => {
    const { emit, saveCreds, authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({ authStateFactory, socketFactory });

    await client.connect();
    emit("creds.update", {});
    await Promise.resolve(); // let the fire-and-forget saveCreds() settle

    expect(saveCreds).toHaveBeenCalledTimes(1);
  });

  it("re-exposes messaging-history.set to history listeners", async () => {
    const { emit, authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({ authStateFactory, socketFactory });
    const payloads: unknown[] = [];
    client.onHistorySync((p) => payloads.push(p));

    await client.connect();
    emit("messaging-history.set", { chats: [], contacts: [], messages: [] });

    expect(payloads).toEqual([{ chats: [], contacts: [], messages: [] }]);
  });

  it("uses the configured authDir when loading auth state", async () => {
    const { authStateFactory, socketFactory } = makeDeps();
    const client = createBaileysClient({
      authStateFactory,
      socketFactory,
      authDir: "/custom/auth",
    });

    await client.connect();

    expect(authStateFactory).toHaveBeenCalledWith("/custom/auth");
  });
});
