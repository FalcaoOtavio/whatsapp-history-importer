import path from "node:path";
import { fireAndForget, logBackgroundError } from "./log.js";

const AUTH_DIR = path.resolve(process.cwd(), "auth_info");

export type ConnState = "qr" | "connecting" | "connected" | "disconnected";

/** Minimal shape of the parts of a Baileys WASocket we depend on. */
export interface BaileysLikeSocket {
  ev: {
    on<T = unknown>(event: string, listener: (arg: T) => void): void;
  };
  end?(error?: Error): void;
}

export interface AuthState {
  state: unknown;
  saveCreds: () => Promise<void>;
}

export interface BaileysClientDeps {
  /** Creates a socket given the auth state. Defaults to the real `makeWASocket`. */
  socketFactory?: (authState: AuthState) => BaileysLikeSocket | Promise<BaileysLikeSocket>;
  /** Loads/creates the auth state. Defaults to the real `useMultiFileAuthState`. */
  authStateFactory?: (dir: string) => Promise<AuthState>;
  authDir?: string;
}

export interface BaileysClient {
  socket: BaileysLikeSocket | null;
  state: ConnState;
  currentQr: string | null;
  connect(): Promise<BaileysLikeSocket>;
  onStateChange(listener: (state: ConnState, qr: string | null) => void): void;
  onHistorySync(listener: (payload: unknown) => void): void;
}

/**
 * Wraps the Baileys connection lifecycle: connects, tracks connection state
 * (qr/connecting/connected/disconnected), persists creds, and re-exposes the
 * `messaging-history.set` event for history-sync.ts to consume.
 */
export function createBaileysClient(deps: BaileysClientDeps = {}): BaileysClient {
  const authDir = deps.authDir ?? AUTH_DIR;
  const stateListeners: ((state: ConnState, qr: string | null) => void)[] = [];
  const historyListeners: ((payload: unknown) => void)[] = [];

  const client: BaileysClient = {
    socket: null,
    state: "connecting",
    currentQr: null,
    onStateChange(listener) {
      stateListeners.push(listener);
    },
    onHistorySync(listener) {
      historyListeners.push(listener);
    },
    async connect() {
      const authStateFactory = deps.authStateFactory ?? defaultAuthStateFactory;
      const authState = await authStateFactory(authDir);

      const socketFactory = deps.socketFactory ?? defaultSocketFactory;
      const socket = await socketFactory(authState);
      client.socket = socket;

      socket.ev.on<Partial<{ connection: string; qr: string }>>("connection.update", (update) => {
        if (update.qr) {
          client.currentQr = update.qr;
          setState("qr");
        } else if (update.connection === "open") {
          client.currentQr = null;
          setState("connected");
        } else if (update.connection === "connecting") {
          setState("connecting");
        } else if (update.connection === "close") {
          setState("disconnected");
        }
      });

      socket.ev.on("creds.update", () => {
        // Detached write: a full disk or a permissions problem here must not
        // become an unhandled rejection that takes the sidecar down.
        fireAndForget("baileys:saveCreds", authState.saveCreds());
      });

      socket.ev.on("messaging-history.set", (payload: unknown) => {
        // Baileys invokes this from its own event emitter. Anything thrown by a
        // listener - a DB write failing mid-batch, say - would propagate into
        // the emitter and abort the remaining listeners along with the sync.
        // Isolate each one so a single bad batch cannot end the import.
        for (const listener of historyListeners) {
          try {
            listener(payload);
          } catch (error) {
            logBackgroundError("historySync:listener", error);
          }
        }
      });

      return socket;
    },
  };

  function setState(next: ConnState) {
    client.state = next;
    for (const listener of stateListeners) listener(next, client.currentQr);
  }

  return client;
}

async function defaultAuthStateFactory(dir: string): Promise<AuthState> {
  const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");
  return useMultiFileAuthState(dir);
}

async function defaultSocketFactory(authState: AuthState): Promise<BaileysLikeSocket> {
  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket = baileys.default;
  return makeWASocket({
    auth: authState.state as never,
    printQRInTerminal: false,
  }) as unknown as BaileysLikeSocket;
}
