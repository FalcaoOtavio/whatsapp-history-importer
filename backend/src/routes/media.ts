import fs from "node:fs";
import { Router } from "express";
import type { SqliteDb } from "../db/sqlite.js";
import { getMessage } from "../db/sqlite.js";

/** GET /media/:msgId -> streams the cached media file for a message. 404 if not cached. */
export function mediaRouter(db: SqliteDb): Router {
  const router = Router();

  router.get("/media/:msgId", (req, res) => {
    const message = getMessage(db, req.params.msgId);
    if (!message || !message.media_path) {
      res.status(404).json({ error: "media not found" });
      return;
    }

    if (!fs.existsSync(message.media_path)) {
      res.status(404).json({ error: "media not found" });
      return;
    }

    res.status(200);
    res.type(message.media_mime ?? "application/octet-stream");
    fs.createReadStream(message.media_path).pipe(res);
  });

  return router;
}
