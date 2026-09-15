import { Router } from "express";
import type { ConnState } from "../baileys-client.js";

export interface StatusSource {
  state: ConnState;
}

/** GET /status -> { state: "qr" | "connecting" | "connected" | "disconnected" }. */
export function statusRouter(source: StatusSource): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.status(200).json({ state: source.state });
  });

  return router;
}
