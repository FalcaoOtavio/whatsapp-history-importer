import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { statusRouter, type StatusSource } from "../src/routes/status.js";

function makeApp(source: StatusSource) {
  const app = express();
  app.use(statusRouter(source));
  return app;
}

describe("GET /status", () => {
  it("returns the current connection state", async () => {
    const res = await request(makeApp({ state: "connected" })).get("/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "connected" });
  });

  it("reflects qr state", async () => {
    const res = await request(makeApp({ state: "qr" })).get("/status");
    expect(res.body).toEqual({ state: "qr" });
  });
});
