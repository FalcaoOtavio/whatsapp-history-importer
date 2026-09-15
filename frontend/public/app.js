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

// --- Sync progress via SSE (Task 3.4) -----------------------------------
//
// Opens an EventSource to GET /sync and renders progress into the "sync" view:
// - #sync-progress <progress> value, as a percent estimate (total chat count
//   is unknown up front, so each chat processed advances by a fixed step,
//   capped short of 100% until sync.done sets it to exactly 100)
// - #sync-chat-count: number of chats processed so far
// - #sync-message-count: cumulative message count across processed chats

const SYNC_PERCENT_STEP_PER_CHAT = 10;
const SYNC_PERCENT_CAP_BEFORE_DONE = 95;

/** Updates the sync view's progress bar + counters for one SSE event. Pure DOM + state. */
export function applySyncEvent(doc, state, evt) {
  switch (evt.event) {
    case "sync.started":
      state.chatsProcessed = 0;
      state.messagesTotal = 0;
      state.percent = 0;
      break;
    case "sync.chat":
      state.chatsProcessed += 1;
      state.messagesTotal += evt.total ?? 0;
      state.percent = Math.min(
        SYNC_PERCENT_CAP_BEFORE_DONE,
        state.chatsProcessed * SYNC_PERCENT_STEP_PER_CHAT,
      );
      break;
    case "sync.done":
      state.percent = 100;
      break;
    default:
      break;
  }

  const progress = doc.getElementById("sync-progress");
  const chatCount = doc.getElementById("sync-chat-count");
  const messageCount = doc.getElementById("sync-message-count");
  if (progress) progress.value = state.percent;
  if (chatCount) chatCount.textContent = String(state.chatsProcessed);
  if (messageCount) messageCount.textContent = String(state.messagesTotal);

  return state;
}

/**
 * Opens an EventSource to /sync and wires each event into the sync view.
 * Injectable EventSource/document constructor for testing.
 */
export function createSyncListener(opts = {}) {
  const EventSourceCtor = opts.EventSource ?? (typeof EventSource !== "undefined" ? EventSource : undefined);
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);
  const state = { chatsProcessed: 0, messagesTotal: 0, percent: 0 };

  let source = null;

  function handleMessage(eventName) {
    return (evt) => {
      let data = {};
      try {
        data = evt.data ? JSON.parse(evt.data) : {};
      } catch {
        data = {};
      }
      applySyncEvent(doc, state, { event: eventName, ...data });
      if (eventName === "sync.done") {
        stop();
      }
    };
  }

  function start() {
    source = new EventSourceCtor("/sync");
    for (const name of ["sync.started", "sync.chat", "sync.message", "sync.done"]) {
      source.addEventListener(name, handleMessage(name));
    }
  }

  function stop() {
    if (source) {
      source.close();
      source = null;
    }
  }

  return { start, stop, state };
}

// Real browsers only — skip auto-start under jsdom (unit tests import this module
// directly and drive router/poller/listener manually with injected fakes).
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
