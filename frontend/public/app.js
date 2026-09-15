// WhatsApp History Importer — frontend app entry point.
// Views swap based on the URL hash route: #welcome (default), #sync, #chats.

const VIEWS = ["welcome", "sync", "chats"];
const DEFAULT_VIEW = "welcome";

/** Parses the current location hash into a view name, falling back to the default. */
export function routeFromHash(hash) {
  const name = (hash || "").replace(/^#\/?/, "").trim();
  return VIEWS.includes(name) ? name : DEFAULT_VIEW;
}

/** Shows the <section data-view="..."> matching `view`, hides the others. Pure DOM, no globals. */
export function applyRoute(doc, view) {
  for (const name of VIEWS) {
    const section = doc.querySelector(`[data-view="${name}"]`);
    if (!section) continue;
    section.hidden = name !== view;
  }
}

/** Reads location.hash, resolves it to a view, and applies it to the document. */
export function renderCurrentRoute(win = window, doc = document) {
  const view = routeFromHash(win.location.hash);
  applyRoute(doc, view);
  return view;
}

export function initRouter(win = window, doc = document) {
  const handler = () => renderCurrentRoute(win, doc);
  win.addEventListener("hashchange", handler);
  handler();
  return handler;
}

// --- QR polling (Task 3.3) ---------------------------------------------
//
// Polls GET /qr every `intervalMs` while the backend reports state "qr",
// rendering the returned data URL into #qr-image. Stops itself once the
// backend reports "connected" (or answers 204, meaning nothing to show).

const QR_POLL_INTERVAL_MS = 2000;

/** Updates the #qr-image / #qr-placeholder elements with a QR data URL. */
export function renderQr(doc, dataUrl) {
  const img = doc.getElementById("qr-image");
  const placeholder = doc.getElementById("qr-placeholder");
  if (img) {
    img.src = dataUrl;
    img.hidden = false;
  }
  if (placeholder) {
    placeholder.hidden = true;
  }
}

/**
 * Creates a QR poller. Injectable fetch/document/setInterval/clearInterval for testing;
 * defaults to the real browser globals.
 */
export function createQrPoller(opts = {}) {
  const fetchFn = opts.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);
  const setIntervalFn = opts.setInterval ?? setInterval;
  const clearIntervalFn = opts.clearInterval ?? clearInterval;
  const intervalMs = opts.intervalMs ?? QR_POLL_INTERVAL_MS;

  let timer = null;

  async function poll() {
    const res = await fetchFn("/qr");
    if (res.status === 204) {
      stop();
      return { state: "connected" };
    }
    const data = await res.json();
    if (data.qr) {
      renderQr(doc, data.qr);
    }
    if (data.state === "connected") {
      stop();
    }
    return data;
  }

  function start() {
    void poll();
    timer = setIntervalFn(() => {
      void poll();
    }, intervalMs);
  }

  function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  return { start, stop, poll };
}

// Real browsers only — skip auto-start under jsdom (unit tests import this module
// directly and drive router/poller manually with injected fakes).
function isRealBrowser() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !(typeof navigator !== "undefined" && navigator.userAgent?.includes("jsdom"))
  );
}

if (isRealBrowser()) {
  initRouter();
  createQrPoller().start();
}
