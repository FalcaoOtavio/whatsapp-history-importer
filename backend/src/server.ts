import express, { type Express } from "express";

export function createServer(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

function isMainModule(): boolean {
  return process.argv[1] === new URL(import.meta.url).pathname;
}

if (isMainModule()) {
  const app = createServer();
  const port = Number(process.env.PORT ?? 0);
  const server = app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://127.0.0.1:${boundPort}`);
  });
}
