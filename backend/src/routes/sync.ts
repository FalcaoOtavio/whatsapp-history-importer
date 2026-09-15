import { Router } from "express";

export type SyncEvent =
  | { event: "sync.started" }
  | { event: "sync.chat"; jid: string; total: number }
  | { event: "sync.message"; jid: string; count: number }
  | { event: "sync.done" };

export interface SyncEventSource {
  /** Subscribes to sync progress events. Returns an unsubscribe function. */
  on(listener: (evt: SyncEvent) => void): () => void;
}

/** In-process pub/sub for sync progress, shared between the sync driver and the SSE route. */
export class SyncBroadcaster implements SyncEventSource {
  private listeners = new Set<(evt: SyncEvent) => void>();

  on(listener: (evt: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(evt: SyncEvent): void {
    for (const listener of this.listeners) listener(evt);
  }
}

function writeSseEvent(res: import("express").Response, evt: SyncEvent): void {
  const { event, ...data } = evt;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** GET /sync -> Server-Sent Events stream of sync progress (sync.started/.chat/.message/.done). */
export function syncRouter(source: SyncEventSource): Router {
  const router = Router();

  router.get("/sync", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsubscribe = source.on((evt) => {
      writeSseEvent(res, evt);
      if (evt.event === "sync.done") {
        unsubscribe();
        res.end();
      }
    });

    req.on("close", unsubscribe);
  });

  return router;
}
