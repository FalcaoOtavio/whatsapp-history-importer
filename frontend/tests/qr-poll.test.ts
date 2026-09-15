import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createQrPoller, renderQr } from "../public/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(testDir, "..", "public", "index.html"), "utf-8");

function makeDoc() {
  return new JSDOM(html).window.document;
}

describe("renderQr", () => {
  it("sets the QR image src and unhides it, hides the placeholder", () => {
    const doc = makeDoc();
    renderQr(doc, "data:image/png;base64,xyz");
    const img = doc.getElementById("qr-image");
    const placeholder = doc.getElementById("qr-placeholder");
    expect(img.src).toBe("data:image/png;base64,xyz");
    expect(img.hidden).toBe(false);
    expect(placeholder.hidden).toBe(true);
  });
});

describe("createQrPoller", () => {
  let doc;
  let fakeSetInterval;
  let fakeClearInterval;
  let intervalCallback;
  let intervalId;

  beforeEach(() => {
    doc = makeDoc();
    intervalId = null;
    intervalCallback = null;
    fakeSetInterval = vi.fn((cb) => {
      intervalCallback = cb;
      intervalId = {};
      return intervalId;
    });
    fakeClearInterval = vi.fn();
  });

  it("fetches /qr immediately on start and renders the image", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ qr: "data:image/png;base64,abc", state: "qr" }),
    });

    const poller = createQrPoller({
      fetch: fetchMock,
      document: doc,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("/qr");
    expect(doc.getElementById("qr-image").src).toBe("data:image/png;base64,abc");
    expect(fakeSetInterval).toHaveBeenCalledTimes(1);
  });

  it("polls again on each interval tick while state is qr", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ qr: "data:image/png;base64,tick", state: "qr" }),
    });

    const poller = createQrPoller({
      fetch: fetchMock,
      document: doc,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await intervalCallback();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling once the backend reports connected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ state: "connected" }),
    });

    const poller = createQrPoller({
      fetch: fetchMock,
      document: doc,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeClearInterval).toHaveBeenCalledWith(intervalId);
  });

  it("stops polling on a 204 response (nothing to show)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });

    const poller = createQrPoller({
      fetch: fetchMock,
      document: doc,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeClearInterval).toHaveBeenCalledWith(intervalId);
  });
});
