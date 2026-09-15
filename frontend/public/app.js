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

// --- Chat list sidebar (Task 3.5) ---------------------------------------
//
// Loads GET /chats and renders one .chat-list-item per chat into #chat-list:
// avatar (initials), name, last-message timestamp, and an unread badge.
// Note: the Chat record has no stored message-preview text (see backend
// Chat type), so the preview line shows the unread count instead of a
// message snippet — there is no snippet to show without inventing one.

/** First letters of up to two words in `name`, uppercased — used as the avatar glyph. */
export function chatInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const second = words.length > 1 ? (words[1][0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Formats a unix-ms timestamp as a short local time/date string, "" if null. */
export function formatChatTimestamp(ms) {
  if (ms === null || ms === undefined) return "";
  const date = new Date(ms);
  const now = new Date(Date.now());
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR");
}

/** Builds one .chat-list-item element for `chat` (plain data object matching the Chat type). */
export function renderChatListItem(doc, chat, onSelect) {
  const item = doc.createElement("div");
  item.className = "chat-list-item";
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  item.dataset.jid = chat.jid;
  item.setAttribute("aria-selected", "false");

  const avatar = doc.createElement("div");
  avatar.className = "chat-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = chatInitials(chat.name);

  const meta = doc.createElement("div");
  meta.className = "chat-list-meta";

  const name = doc.createElement("div");
  name.className = "chat-list-name";
  name.textContent = chat.name;

  const preview = doc.createElement("div");
  preview.className = "chat-list-preview";
  preview.textContent =
    chat.unread_count > 0
      ? `${chat.unread_count} mensagem${chat.unread_count === 1 ? "" : "s"} não lida${chat.unread_count === 1 ? "" : "s"}`
      : "";

  meta.append(name, preview);

  const timestamp = doc.createElement("div");
  timestamp.className = "chat-list-timestamp";
  timestamp.textContent = formatChatTimestamp(chat.last_message_at);

  item.append(avatar, meta, timestamp);

  const select = () => onSelect?.(chat);
  item.addEventListener("click", select);
  item.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      select();
    }
  });

  return item;
}

/** Fetches GET /chats and renders the sidebar list into #chat-list. */
export async function loadChatList(opts = {}) {
  const fetchFn = opts.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);
  const onSelect = opts.onSelect;

  const res = await fetchFn("/chats");
  const data = await res.json();
  const chats = data.chats ?? [];

  const list = doc.getElementById("chat-list");
  if (list) {
    list.replaceChildren(...chats.map((chat) => renderChatListItem(doc, chat, onSelect)));
  }
  return chats;
}

// --- Chat view bubbles (Task 3.6) ---------------------------------------
//
// Loads GET /messages?chatId= for a selected chat and renders one .message
// bubble per message into #message-list: inbound (from_me=0) on the left in
// gray (.message-in), outbound (from_me=1) on the right in green
// (.message-out). Media messages (image/video/audio/document) point their
// source at GET /media/:msgId.

/** Formats a unix-ms/seconds-ish timestamp as a short local time string. */
export function formatMessageTimestamp(ts) {
  if (ts === null || ts === undefined) return "";
  // Backend timestamps observed as unix ms in fixtures/tests; treat as ms directly.
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function appendTimestamp(doc, bubble, message) {
  const ts = doc.createElement("span");
  ts.className = "message-timestamp";
  ts.textContent = formatMessageTimestamp(message.timestamp);
  bubble.appendChild(ts);
}

function buildMediaBody(doc, message) {
  const mediaUrl = `/media/${encodeURIComponent(message.id)}`;

  switch (message.type) {
    case "image": {
      const wrap = doc.createElement("div");
      wrap.className = "message-media";
      const img = doc.createElement("img");
      img.src = mediaUrl;
      img.alt = message.text ?? "Imagem";
      wrap.appendChild(img);
      return wrap;
    }
    case "video": {
      const wrap = doc.createElement("div");
      wrap.className = "message-media";
      const video = doc.createElement("video");
      video.src = mediaUrl;
      const overlay = doc.createElement("div");
      overlay.className = "message-media-play-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.textContent = "▶";
      wrap.append(video, overlay);
      return wrap;
    }
    case "audio": {
      const wrap = doc.createElement("div");
      wrap.className = "message-audio";
      const audio = doc.createElement("audio");
      audio.setAttribute("controls", "");
      audio.src = mediaUrl;
      const waveform = doc.createElement("div");
      waveform.className = "message-waveform";
      waveform.setAttribute("aria-hidden", "true");
      wrap.append(audio, waveform);
      return wrap;
    }
    case "document": {
      const wrap = doc.createElement("div");
      wrap.className = "message-document";
      const link = doc.createElement("a");
      link.href = mediaUrl;
      link.className = "message-document-filename";
      link.textContent = message.text || "Documento";
      wrap.appendChild(link);
      return wrap;
    }
    default:
      return null;
  }
}

/** Builds one .message bubble element for `message` (matching the backend Message type). */
export function renderMessageBubble(doc, message) {
  const bubble = doc.createElement("div");
  bubble.className = `message ${message.from_me ? "message-out" : "message-in"}`;
  bubble.dataset.messageId = message.id;
  bubble.dataset.messageType = message.type;

  const mediaBody = buildMediaBody(doc, message);
  if (mediaBody) {
    bubble.appendChild(mediaBody);
    if (message.type === "document" && message.text) {
      // filename already shown by buildMediaBody; nothing further needed.
    } else if (message.text && message.type === "image") {
      const caption = doc.createElement("div");
      caption.className = "message-text";
      caption.textContent = message.text;
      bubble.appendChild(caption);
    }
  } else {
    const text = doc.createElement("div");
    text.className = "message-text";
    text.textContent = message.text ?? "";
    bubble.appendChild(text);
  }

  appendTimestamp(doc, bubble, message);
  return bubble;
}

/** Fetches GET /messages?chatId= and renders bubbles into #message-list. */
export async function loadChatMessages(chatJid, opts = {}) {
  const fetchFn = opts.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);

  const res = await fetchFn(`/messages?chatId=${encodeURIComponent(chatJid)}`);
  const data = await res.json();
  const messages = data.messages ?? [];

  const list = doc.getElementById("message-list");
  const empty = doc.getElementById("chat-view-empty");
  if (list) {
    list.replaceChildren(...messages.map((message) => renderMessageBubble(doc, message)));
    scrollToBottom(list);
  }
  if (empty) {
    empty.hidden = true;
  }
  return messages;
}

// --- Chat scroll behavior (Task 3.7) ------------------------------------
//
// Auto-scrolls the message list to the bottom when a chat loads or a new
// message arrives, and pages in older messages when the user scrolls to the
// top ("infinite scroll up").
//
// Pagination param note: the plan's task sketch says the scroll-up fetch
// carries `since`, but the backend's listMessages treats `since` as
// "timestamp >= since ASC" (i.e. NEWER messages) and `until` as
// "timestamp < until ORDER BY DESC" (i.e. OLDER messages). Loading older
// history on scroll-up therefore uses `until`, anchored to the oldest
// message currently rendered. See backend/src/db/sqlite.ts listMessages.

const SCROLL_TOP_THRESHOLD_PX = 50;

/** Pins the list to its bottom — newest message visible. */
export function scrollToBottom(list) {
  if (!list) return;
  list.scrollTop = list.scrollHeight;
}

/** True when the list is scrolled (near) its top, i.e. older history should page in. */
export function isAtTop(list, threshold = SCROLL_TOP_THRESHOLD_PX) {
  if (!list) return false;
  return list.scrollTop <= threshold;
}

/** Appends one newly-arrived message and keeps the view pinned to the bottom. */
export function appendMessage(doc, message) {
  const list = doc.getElementById("message-list");
  if (!list) return null;
  const bubble = renderMessageBubble(doc, message);
  list.appendChild(bubble);
  scrollToBottom(list);
  return bubble;
}

/**
 * Wires infinite-scroll-up on #message-list: when the user reaches the top,
 * fetches older messages (anchored at the oldest rendered timestamp) and
 * prepends them, preserving the user's scroll position.
 */
export function attachInfiniteScroll(chatJid, opts = {}) {
  const fetchFn = opts.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);
  const list = doc.getElementById("message-list");
  if (!list) return () => {};

  let loading = false;
  let exhausted = false;
  let oldestTimestamp = opts.oldestTimestamp ?? null;

  async function loadOlder() {
    if (loading || exhausted) return [];
    loading = true;
    try {
      const params = new URLSearchParams({ chatId: chatJid });
      if (oldestTimestamp !== null) params.set("until", String(oldestTimestamp));

      const res = await fetchFn(`/messages?${params.toString()}`);
      const data = await res.json();
      const older = data.messages ?? [];

      if (older.length === 0) {
        exhausted = true;
        return [];
      }

      const heightBefore = list.scrollHeight;
      // Backend returns older pages newest-first; prepend oldest-first so the
      // rendered order stays chronological.
      const ordered = [...older].sort((a, b) => a.timestamp - b.timestamp);
      list.prepend(...ordered.map((message) => renderMessageBubble(doc, message)));
      oldestTimestamp = ordered[0].timestamp;

      // Keep the previously-visible message under the user's eye.
      list.scrollTop = list.scrollHeight - heightBefore;
      return ordered;
    } finally {
      loading = false;
    }
  }

  const handler = () => {
    if (isAtTop(list)) void loadOlder();
  };

  list.addEventListener("scroll", handler);
  return { detach: () => list.removeEventListener("scroll", handler), loadOlder };
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
  let scroller = null;
  void loadChatList({
    onSelect: (chat) => {
      const items = document.querySelectorAll("#chat-list .chat-list-item");
      for (const el of items) {
        el.setAttribute("aria-selected", el.dataset.jid === chat.jid ? "true" : "false");
      }
      scroller?.detach?.();
      void loadChatMessages(chat.jid).then((messages) => {
        scroller = attachInfiniteScroll(chat.jid, {
          oldestTimestamp: messages.length > 0 ? messages[0].timestamp : null,
        });
      });
    },
  });
}
