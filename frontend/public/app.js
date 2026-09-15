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

function isBrowserEnvironment() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function initRouter(win = window, doc = document) {
  const handler = () => renderCurrentRoute(win, doc);
  win.addEventListener("hashchange", handler);
  handler();
  return handler;
}

if (isBrowserEnvironment()) {
  initRouter();
}
