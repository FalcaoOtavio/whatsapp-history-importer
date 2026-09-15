import { Router } from "express";
import type { ConnState } from "../baileys-client.js";

export interface QrSource {
  state: ConnState;
  currentQr: string | null;
}

export type QrRenderer = (text: string) => Promise<string>;

async function defaultRenderer(text: string): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(text);
}

/** GET /qr -> { qr: "data:image/png;base64,..." } or 204 if already connected / no QR yet. */
export function qrRouter(source: QrSource, renderer: QrRenderer = defaultRenderer): Router {
  const router = Router();

  router.get("/qr", async (_req, res) => {
    if (source.state === "connected" || !source.currentQr) {
      res.status(204).end();
      return;
    }

    const dataUrl = await renderer(source.currentQr);
    res.status(200).json({ qr: dataUrl, state: source.state });
  });

  return router;
}
