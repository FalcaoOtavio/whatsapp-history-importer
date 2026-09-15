import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { qrRouter, type QrSource } from "../src/routes/qr.js";

function makeApp(source: QrSource) {
  const app = express();
  app.use(qrRouter(source, async (text) => `data:image/png;base64,FAKE(${text})`));
  return app;
}

describe("GET /qr", () => {
  it("returns 200 + base64 PNG when a QR is pending", async () => {
    const source: QrSource = { state: "qr", currentQr: "2@abc..." };
    const res = await request(makeApp(source)).get("/qr");

    expect(res.status).toBe(200);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.state).toBe("qr");
  });

  it("returns 204 when already connected", async () => {
    const source: QrSource = { state: "connected", currentQr: null };
    const res = await request(makeApp(source)).get("/qr");

    expect(res.status).toBe(204);
  });

  it("returns 204 when no QR has been issued yet", async () => {
    const source: QrSource = { state: "connecting", currentQr: null };
    const res = await request(makeApp(source)).get("/qr");

    expect(res.status).toBe(204);
  });
});
