import type { SqliteDb } from "./db/sqlite.js";
import { listChats, listMessages } from "./db/sqlite.js";
import type { SyncBroadcaster } from "./routes/sync.js";

export interface SyncDriverDeps {
  db: SqliteDb;
  broadcaster: SyncBroadcaster;
  /**
   * Best-effort per-chat backfill request, e.g. wired to Baileys'
   * `socket.fetchMessageHistory`. Optional and fire-and-forget per chat:
   * multiple open whiskeysockets/baileys issues (#2452, #1934, #1834, #2462)
   * confirm WhatsApp servers frequently never respond to it, so failures and
   * timeouts here are expected and swallowed rather than surfaced. Actual
   * historical data (if any arrives) is persisted separately via the
   * `messaging-history.set` listener wired in history-sync.ts - this driver
   * only reports current DB state as progress and best-effort nudges for more.
   */
  fetchMessageHistory?: (chatJid: string) => Promise<unknown>;
}

export interface SyncDriver {
  /** Runs one sync pass: emits sync.started, sync.chat per known chat (with
   * its current message count), best-effort backfill nudge per chat, sync.done. */
  run(): Promise<void>;
}

export function createSyncDriver(deps: SyncDriverDeps): SyncDriver {
  return {
    async run(): Promise<void> {
      deps.broadcaster.emit({ event: "sync.started" });

      const chats = listChats(deps.db, 1000, 0);
      for (const chat of chats) {
        const messages = listMessages(deps.db, chat.jid, { limit: 100_000 });
        deps.broadcaster.emit({ event: "sync.chat", jid: chat.jid, total: messages.length });

        if (deps.fetchMessageHistory) {
          try {
            await deps.fetchMessageHistory(chat.jid);
          } catch {
            // Expected: see fetchMessageHistory doc above.
          }
        }
      }

      deps.broadcaster.emit({ event: "sync.done" });
    },
  };
}
