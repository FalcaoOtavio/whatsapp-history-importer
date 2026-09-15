import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "../src/server.js";

describe("server", () => {
  it("GET /health returns 200 ok", async () => {
    const app = createServer();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
