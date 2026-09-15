import { Router } from "express";
import type { SqliteDb } from "../db/sqlite.js";
import { listChats } from "../db/sqlite.js";

/** GET /chats?limit=&offset= -> paginated chat list, ordered by last_message_at DESC. */
export function chatsRouter(db: SqliteDb): Router {
  const router = Router();

  router.get("/chats", (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 50);
    const offset = parsePositiveInt(req.query.offset, 0);

    const chats = listChats(db, limit, offset);
    res.status(200).json({ chats });
  });

  return router;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
