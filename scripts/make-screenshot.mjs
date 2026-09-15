/**
 * make-screenshot.mjs — renders the chats view with fixture data and captures
 * docs/screenshot.png for the README.
 *
 * Real markup (public/index.html), real stylesheet (public/styles.css) and the
 * real render functions (public/app.js) are used — the screenshot shows the
 * shipped UI, not a mockup. Only the data is synthetic, so no personal WhatsApp
 * content is ever committed.
 *
 * Usage: node scripts/make-screenshot.mjs [--chrome <path>]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const publicDir = join(repoRoot, "frontend", "public");
const docsDir = join(repoRoot, "docs");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ...(process.env.HOME
    ? [
        `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
      ]
    : []),
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

function findChrome() {
  const flagIndex = process.argv.indexOf("--chrome");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "Nenhum Chrome/Chromium encontrado. Passe o caminho com --chrome <path>.",
    );
  }
  return found;
}

const CHATS = [
  { jid: "1@s.whatsapp.net", name: "Família", is_group: 1, unread_count: 3, last_message_at: null },
  { jid: "2@s.whatsapp.net", name: "Ana Souza", is_group: 0, unread_count: 0, last_message_at: null },
  { jid: "3@s.whatsapp.net", name: "Trabalho", is_group: 1, unread_count: 1, last_message_at: null },
  { jid: "4@s.whatsapp.net", name: "Bruno Lima", is_group: 0, unread_count: 0, last_message_at: null },
  { jid: "5@s.whatsapp.net", name: "Faculdade 2019", is_group: 1, unread_count: 0, last_message_at: null },
];

const MESSAGES = [
  { id: "m1", from_me: 0, type: "text", text: "Oi! Achou as fotos da viagem de 2019?" },
  { id: "m2", from_me: 1, type: "text", text: "Achei sim, estavam no backup antigo 🙂" },
  { id: "m3", from_me: 1, type: "text", text: "Olha essa aqui:" },
  { id: "m4", from_me: 0, type: "text", text: "Que saudade dessa praia!" },
  { id: "m5", from_me: 0, type: "audio", text: null },
  { id: "m6", from_me: 1, type: "document", text: "roteiro-viagem.pdf" },
  { id: "m7", from_me: 1, type: "text", text: "Guardei tudo aqui no importador, não some mais." },
];

// Fixed timestamps — Date.now() would make the screenshot differ on every run.
const BASE_TS = Date.UTC(2026, 2, 10, 14, 0, 0);

async function main() {
  const { JSDOM } = await import(pathToFileURL(join(repoRoot, "frontend", "node_modules", "jsdom", "lib", "api.js")).href);
  const app = await import(pathToFileURL(join(publicDir, "app.js")).href);

  const html = readFileSync(join(publicDir, "index.html"), "utf-8");
  const css = readFileSync(join(publicDir, "styles.css"), "utf-8");

  const dom = new JSDOM(html, { url: "http://localhost/" });
  const doc = dom.window.document;

  app.applyRoute(doc, "chats");

  const chats = CHATS.map((c, i) => ({ ...c, last_message_at: BASE_TS - i * 3_600_000 }));
  const list = doc.getElementById("chat-list");
  list.replaceChildren(...chats.map((chat) => app.renderChatListItem(doc, chat, () => {})));
  list.firstElementChild.setAttribute("aria-selected", "true");
  list.firstElementChild.classList.add("chat-list-item--selected");

  const messageList = doc.getElementById("message-list");
  messageList.replaceChildren(
    ...MESSAGES.map((m, i) =>
      app.renderMessageBubble(doc, {
        ...m,
        chat_jid: chats[0].jid,
        timestamp: BASE_TS - (MESSAGES.length - i) * 120_000,
      }),
    ),
  );
  doc.getElementById("chat-view-empty").hidden = true;

  // Inline the stylesheet and drop the module script: the capture is a static
  // snapshot, and app.js would immediately try to fetch /qr and /chats.
  doc.querySelector('link[rel="stylesheet"]')?.remove();
  doc.querySelector('script[type="module"]')?.remove();
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.appendChild(style);

  // Stand-ins for the media the fixture messages reference — /media/:id is not
  // being served here, and a broken-image icon would misrepresent the UI.
  for (const img of doc.querySelectorAll(".message-media img")) {
    img.removeAttribute("src");
    img.style.cssText = "width:220px;height:150px;background:#c8d5cd;border-radius:6px";
  }

  const scratch = join(tmpdir(), `whi-shot-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  const pagePath = join(scratch, "page.html");
  writeFileSync(pagePath, dom.serialize(), "utf-8");

  mkdirSync(docsDir, { recursive: true });
  const outPath = join(docsDir, "screenshot.png");

  execFileSync(
    findChrome(),
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      "--window-size=1280,800",
      `--screenshot=${outPath}`,
      pathToFileURL(pagePath).href,
    ],
    { stdio: "inherit" },
  );

  rmSync(scratch, { recursive: true, force: true });
  console.log(`✓ ${outPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
