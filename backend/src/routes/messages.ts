import { Router } from "express";
import type { SqliteDb } from "../db/sqlite.js";
import { listMessages } from "../db/sqlite.js";

/** GET /messages?chatId=&since=&until=&limit= -> messages for a chat. */
export function messagesRouter(db: SqliteDb): Router {
  const router = Router();

  router.get("/messages", (req, res) => {
    const chatId = req.query.chatId;
    if (typeof chatId !== "string" || chatId.length === 0) {
      res.status(400).json({ error: "chatId is required" });
      return;
    }

    const since = parseOptionalInt(req.query.since);
    const until = parseOptionalInt(req.query.until);
    const limit = parseOptionalInt(req.query.limit) ?? 50;

    const messages = listMessages(db, chatId, { since, until, limit });
    res.status(200).json({ messages });
  });

  return router;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}
