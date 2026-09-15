# WhatsApp History Importer — Implementation Plan

> **For Hermes / Claude Code:** Use subagent-driven-development to implement this plan task-by-task. Each task must end with a passing test. Commit after every task.

## Goal

A single-user desktop app (Python + Node + PyWebView) that connects to a personal WhatsApp account via QR, downloads the last ~3 years of message history for **groups and 1:1 chats**, persists it to **SQLite (canonical) + optional Postgres + optional MongoDB**, and renders it in a faithful WhatsApp-Web-style UI inside one native window. No browser opens. No login. Scheduled daily resync at 01:00 BRT. Use is personal, data stays local, full "not affiliated with WhatsApp" disclaimer.

## Hard constraints (from user)

- **No auth, no login screen.** Open the app, it works.
- **Everything inside ONE Python window.** No browser. No opening ports on `0.0.0.0`. Localhost loopback only, port random/ephemeral.
- **PyWebView, not Electron, not Chromium.** Uses the OS-native WebKit/WebView2/WebKitGTK.
- **Lightest possible binary.** No React/Vue. No bundled Chromium. ffmpeg downloaded on demand, single static binary.
- **Best possible media quality** for what's stored: original files preserved, plus generated thumbnails (image/video) and waveform (audio).
- **Intuitive enough for a 90-year-old.** Single primary action button at each step, plain-language copy, errors translated to PT-BR, large fonts (16px base, 18px buttons), high contrast.
- **Disclaimer visible at first run:** "Este aplicativo não é afiliado ao WhatsApp. Uso pessoal apenas. Seus dados ficam no seu computador."
- **If CC gets stuck during implementation, search issues in `whiskeysockets/baileys` on GitHub** before asking the user.
- **Deadline:** ready by 12:00 PM BRT on the day work starts.
- **Repository destination:** public GitHub repo. Owner = `FalcaoOtavio` (default; confirm before push).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  User double-clicks app icon                            │
│  (or runs `python initial.py` on first install)         │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  initial.py  (Python, single entry point)               │
│  ├── 1. Check Python ≥ 3.11, Node ≥ 18                  │
│  ├── 2. Create venv, pip install -r requirements.txt    │
│  ├── 3. Download Node deps if missing (`npm ci`)        │
│  ├── 4. First-run? → show welcome window                │
│  ├── 5. Spawn `node dist/server.js` (Baileys sidecar)   │
│  ├── 6. Start APScheduler (daily 01:00 BRT sync)        │
│  └── 7. Open PyWebView window pointing at                │
│         http://127.0.0.1:<random-port>/                 │
└─────────────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Node sidecar  (Baileys, TS compiled to dist/)          │
│  - Express server on random localhost port              │
│  - /qr        → returns current QR as base64 PNG        │
│  - /status    → connection state                        │
│  - /chats     → list all chats                          │
│  - /messages?chatId=&since=&until= → paginated messages  │
│  - /media/:id → serves media from local cache           │
│  - /sync      → triggers full historical sync (SSE)     │
│  - Persists via better-sqlite3 (shared file with Py)    │
└─────────────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Frontend  (vanilla HTML+CSS+JS, 1 file, no framework)  │
│  Served by the Node sidecar at /                        │
│  Three views:                                           │
│   ① Welcome + QR scan                                   │
│   ② Sync progress (SSE)                                 │
│   ③ Conversations list + Chat view (WhatsApp Web style)│
└─────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Library | Why |
|---|---|---|
| Launcher | Python 3.11+ stdlib only for bootstrap | Zero deps for first run |
| Window | `pywebview` | Native WebKit/WebView2/WebKitGTK, ~5 MB wheel |
| Scheduler | `apscheduler` | In-process cron, no extra services |
| HTTP bridge | Node 20+ built-in `http`, Express only for routing | Tiny |
| WhatsApp | `@whiskeysockets/baileys` | The reference non-official lib |
| QR | `qrcode` (Node) + Baileys' built-in `QRRECI]` | No extra deps |
| SQLite (canonical) | `better-sqlite3` | Sync, fast, 1 file |
| Postgres (opt-in) | `pg` | Lazy connect, only if checkbox on |
| MongoDB (opt-in) | `mongodb` | Lazy connect, only if checkbox on |
| Media metadata | `sharp` (image thumbs) | Best-in-class, prebuilt wheels |
| Audio waveform | `audiowaveform` static binary (downloaded on demand via `static-ffmpeg`) | Best output, 1 binary |
| Video thumbs | `ffmpeg` static binary (same `static-ffmpeg`) | Single binary, no install |
| Logging | `pino` (Node) + `logging` (Py stdlib) | Lightweight |
| Tests | `vitest` (Node) + `pytest` (Py) | Fast, ESM-friendly |
| Lint | `eslint` + `ruff` | Standard |

## Repo layout

```
whatsapp-history-importer/
├── initial.py                    # Single entry point — install + launch
├── requirements.txt              # pywebview, apscheduler, requests
├── pyproject.toml                # ruff + pytest config for the Python bits
├── README.md                     # PT-BR + EN, screenshot, disclaimer
├── DISCLAIMER.md                 # "Not affiliated with WhatsApp"
├── LICENSE                       # MIT
├── .gitignore
├── .github/workflows/ci.yml      # lint + test on push
│
├── launcher/                     # Python source
│   ├── __init__.py
│   ├── bootstrap.py              # check python/node, install deps, download static-ffmpeg
│   ├── window.py                 # PyWebView window mgmt
│   ├── scheduler.py              # APScheduler 01:00 BRT daily sync
│   ├── bridge.py                 # talks to Node sidecar over HTTP
│   └── tests/
│       ├── test_bootstrap.py
│       └── test_bridge.py
│
├── backend/                      # Node + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── server.ts             # Express + SSE
│   │   ├── baileys-client.ts     # Connection, event handling
│   │   ├── history-sync.ts       # Historical pull logic
│   │   ├── media-cache.ts        # Download + thumbnail
│   │   ├── db/
│   │   │   ├── sqlite.ts         # better-sqlite3 (canonical)
│   │   │   ├── postgres.ts       # pg (opt-in)
│   │   │   └── mongo.ts          # mongodb (opt-in)
│   │   ├── routes/
│   │   │   ├── qr.ts
│   │   │   ├── chats.ts
│   │   │   ├── messages.ts
│   │   │   ├── media.ts
│   │   │   └── sync.ts           # SSE stream
│   │   └── types.ts
│   └── tests/
│       ├── sqlite.test.ts
│       ├── history-sync.test.ts  # uses a fake socket
│       └── routes.test.ts
│
├── frontend/                     # Vanilla HTML/CSS/JS, served by Node
│   ├── public/
│   │   ├── index.html            # 3 views, swapped by JS
│   │   ├── styles.css            # WhatsApp Web colors, large fonts
│   │   └── app.js                # ~300 lines, no framework
│   └── tests/
│       └── app.test.ts           # vitest + jsdom
│
└── scripts/
    ├── verify-install.sh         # Used in CI smoke test
    └── dev.sh                    # `npm run dev` convenience
```

## Database schema (SQLite canonical)

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE chats (
  jid           TEXT PRIMARY KEY,           -- e.g. "5511...@s.whatsapp.net" or "120363...@g.us"
  name          TEXT NOT NULL,
  is_group      INTEGER NOT NULL,
  last_message_at INTEGER,                  -- unix ms
  unread_count  INTEGER DEFAULT 0,
  profile_pic_path TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,           -- Baileys message id
  chat_jid      TEXT NOT NULL REFERENCES chats(jid),
  sender_jid    TEXT,
  sender_name   TEXT,
  from_me       INTEGER NOT NULL,
  timestamp     INTEGER NOT NULL,           -- unix ms
  type          TEXT NOT NULL,              -- text|image|video|audio|document|sticker|revoked|...
  text          TEXT,
  media_path    TEXT,                       -- relative path under .media/
  media_mime    TEXT,
  media_size    INTEGER,
  media_thumb_path TEXT,                    -- generated thumbnail
  media_duration INTEGER,                   -- ms for audio/video
  raw_json      TEXT,                       -- full Baileys payload, for replay/debug
  indexed_at    INTEGER NOT NULL
);

CREATE INDEX idx_messages_chat_time ON messages(chat_jid, timestamp);
CREATE INDEX idx_messages_sender ON messages(sender_jid);
CREATE INDEX idx_chats_lastmsg ON chats(last_message_at DESC);

CREATE TABLE sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  status        TEXT NOT NULL,              -- running|done|error
  messages_indexed INTEGER DEFAULT 0,
  media_downloaded INTEGER DEFAULT 0,
  error         TEXT
);
```

Postgres and MongoDB mirror the same shape (tables `chats`, `messages`, `sync_runs` or collections).

## Tasks (bite-sized, TDD, every task ends with `git commit`)

### Phase 0 — Scaffolding

**Task 0.1: Create repo on GitHub (FalcaoOtavio/whatsapp-history-importer, public, MIT)**
- Files: none locally
- Verify: `gh repo view FalcaoOtavio/whatsapp-history-importer --json name,visibility,license`
- Commit: initial empty commit on `main`

**Task 0.2: Local clone + skeleton folders + .gitignore + README skeleton + DISCLAIMER**
- Files: `.gitignore`, `README.md`, `DISCLAIMER.md`, dirs `launcher/`, `backend/`, `frontend/public/`, `scripts/`
- Test: `git status` clean, `ls` shows structure
- Commit: `chore: scaffold project layout`

### Phase 1 — Python launcher

**Task 1.1: `launcher/bootstrap.py` — check Python ≥ 3.11 and Node ≥ 18**
- Test (`tests/test_bootstrap.py`): current Python and Node pass; mocks for 3.10 and Node 16 fail
- Verifier: `pytest launcher/tests/test_bootstrap.py -v`
- Commit: `feat(launcher): bootstrap prerequisite check`

**Task 1.2: `launcher/bootstrap.py` — create venv + pip install requirements**
- Test: idempotent (running twice doesn't re-install if venv exists and is up to date)
- Commit: `feat(launcher): idempotent venv setup`

**Task 1.3: `launcher/bootstrap.py` — ensure `npm ci` succeeded (run if `node_modules` missing)**
- Test: mocks subprocess.run, asserts correct command
- Commit: `feat(launcher): ensure node deps installed`

**Task 1.4: `launcher/bootstrap.py` — download static-ffmpeg binary on first run**
- Use `static-ffmpeg` package or direct download from BtbN/ffmpeg-release
- Test: skips download if binary already exists; verifies checksum when it does
- Commit: `feat(launcher): static ffmpeg downloader`

**Task 1.5: `initial.py` — orchestrate bootstrap, print friendly PT-BR progress to stdout**
- No GUI yet, just CLI feedback
- Test: subprocess test, run `python initial.py --check`, expect success exit + PT-BR banner
- Commit: `feat: initial.py CLI bootstrap`

**Task 1.6: `launcher/window.py` — PyWebView window opens a URL on a random localhost port**
- Use `webview.create_window('WhatsApp History', 'http://127.0.0.1:<port>/')`
- Test: unit test that starts an HTTP server on port 0, reads the bound port, asserts window would target it
- Commit: `feat(launcher): pywebview window wrapper`

**Task 1.7: `launcher/bridge.py` — HTTP client talking to Node sidecar**
- Methods: `start_sidecar()`, `get_qr()`, `get_status()`, `get_chats()`, `get_messages(chat_id, since)`, `trigger_sync()`
- Test: uses `pytest-httpserver` to mock Node sidecar, asserts each method returns the parsed JSON
- Commit: `feat(launcher): bridge to node sidecar`

**Task 1.8: `initial.py` — start Node sidecar, open PyWebView, handle shutdown**
- Process management: spawn `node dist/server.js`, capture logs to file
- On Ctrl-C / window close: graceful shutdown, kill child process
- Test: integration test that spawns a fake Node process and asserts it gets killed on exit
- Commit: `feat: glue launcher + window + sidecar`

### Phase 2 — Node sidecar (Baileys + DB)

**Task 2.1: `backend/package.json` + `tsconfig.json` + `src/server.ts` skeleton**
- Express on port 0, `/health` returns 200
- Test: supertest hits `/health`
- Commit: `feat(backend): express skeleton with health endpoint`

**Task 2.2: `backend/src/db/sqlite.ts` — open/migrate SQLite**
- Test: vitest, opens in-memory, applies schema, inserts a chat + message, reads them back
- Commit: `feat(db): sqlite canonical store`

**Task 2.3: `backend/src/db/postgres.ts` — opt-in writer (lazy connect)**
- Test: skips if no `DATABASE_URL` env, otherwise connects and writes
- Commit: `feat(db): postgres optional writer`

**Task 2.4: `backend/src/db/mongo.ts` — opt-in writer (lazy connect)**
- Test: same pattern as Postgres
- Commit: `feat(db): mongo optional writer`

**Task 2.5: `backend/src/types.ts` + Baileys event types**
- Define `Chat`, `Message`, `SyncRun` types matching DB schema
- Test: type-level test that `Chat` matches the SELECT result
- Commit: `feat(types): shared chat/message types`

**Task 2.6: `backend/src/baileys-client.ts` — connect, expose events**
- Use `makeWASocket`, handle `connection.update` (qr/connected/disconnected), `creds.update`
- Persist creds to `auth_info/` (gitignored)
- Test: integration test with mock socket (use Baileys' test helpers if available; otherwise fake the event emitter)
- Commit: `feat(baileys): connection lifecycle`

**Task 2.7: `backend/src/routes/qr.ts` — `GET /qr` returns current QR as base64 PNG**
- Holds latest QR string in memory; renders via `qrcode` package
- Test: supertest asserts 200 + valid base64 PNG when QR is set, 204 when connected
- Commit: `feat(route): qr endpoint`

**Task 2.8: `backend/src/routes/chats.ts` — `GET /chats` returns paginated chat list**
- Reads from SQLite, supports `?limit=&offset=`
- Test: seed 5 chats, request limit=2, assert ordering by last_message_at DESC
- Commit: `feat(route): chats list`

**Task 2.9: `backend/src/routes/messages.ts` — `GET /messages?chatId=&since=&limit=`**
- Test: seed 50 messages, request with since param, assert correct slice
- Commit: `feat(route): messages pagination`

**Task 2.10: `backend/src/media-cache.ts` — download media on demand, cache, generate thumbnail**
- Image: sharp → 200x200 webp
- Video: ffmpeg → frame at 1s → 200x200 webp
- Audio: audiowaveform → 800x100 png waveform
- Test: with a fixture image/audio/video, asserts thumbnail file exists and is valid
- Commit: `feat(media): cache + thumbnails + waveforms`

**Task 2.11: `backend/src/routes/media.ts` — `GET /media/:msgId` serves cached media**
- Streams from disk, correct MIME, 404 if not in cache
- Test: supertest
- Commit: `feat(route): media serve`

**Task 2.12: `backend/src/history-sync.ts` — pull historical messages per chat**
- Strategy: on connect, enumerate chats via `socket.getChats()`, then for each chat call `loadHistory(pageCount=50)` until empty or until messages older than `(now - 3y)` are reached
- **Issue-driven:** if Baileys `loadHistory` is limited or unstable, search `whiskeysockets/baileys` issues for "loadHistory" / "history sync" before falling back to other strategies
- Test: with a fake socket that returns N pages of messages, asserts DB ends with all N messages and stops at the cutoff
- Commit: `feat(sync): historical pull per chat`

**Task 2.13: `backend/src/routes/sync.ts` — `GET /sync` SSE stream of progress events**
- Emits `sync.started`, `sync.chat {jid, total}`, `sync.message {jid, count}`, `sync.done`
- Test: supertest + SSE parser asserts event sequence
- Commit: `feat(route): sync progress stream`

**Task 2.14: `backend/src/server.ts` — wire routes + Baileys + DB together**
- On startup: connect Baileys, log QR to console (for `--check` mode), start Express
- Test: full integration, mock Baileys
- Commit: `feat(backend): server wiring`

### Phase 3 — Frontend (vanilla, WhatsApp Web look)

**Task 3.1: `frontend/public/index.html` — three `<section>` views, swapped via `data-view`**
- Welcome + Disclaimer + QR scan (large QR image, "Abra o WhatsApp → Menu → Aparelhos conectados → Conectar")
- Sync progress (progress bar, chat count, message count)
- Conversations list + chat view (WhatsApp Web layout: left sidebar, right pane)
- Test: jsdom test that views swap based on hash route
- Commit: `feat(ui): three-view skeleton`

**Task 3.2: `frontend/public/styles.css` — WhatsApp Web colors, large fonts (16px base, 18px buttons), high contrast**
- Variables for `--wa-green: #00a884`, `--wa-bg-panel: #efeae2`, etc.
- System font stack only
- Test: snapshot of computed background color of `.message-in` is near `--wa-bg-panel`
- Commit: `feat(ui): whatsapp-style stylesheet`

**Task 3.3: `frontend/public/app.js` — fetch /qr every 2s, render QR `<img>`**
- Poll while `state === 'qr'`, stop when `connected`
- Test: with fetch mock, asserts QR element updated
- Commit: `feat(ui): qr polling`

**Task 3.4: `frontend/public/app.js` — open SSE to /sync, render progress**
- Test: with EventSource mock, asserts progress bar width matches percent
- Commit: `feat(ui): sync progress`

**Task 3.5: `frontend/public/app.js` — load /chats, render sidebar with avatar (initials), name, last message preview, timestamp**
- Test: with fetch mock, assert 3 chat items rendered with correct names
- Commit: `feat(ui): chat list sidebar`

**Task 3.6: `frontend/public/app.js` — load /messages?chatId=, render chat view with bubbles**
- Inbound messages left (gray), outbound right (green)
- Text, image, video (with play overlay), audio (with waveform + play), document (with filename)
- Test: with fetch mock, assert 4 message bubbles with correct classes
- Commit: `feat(ui): chat view with bubbles`

**Task 3.7: `frontend/public/app.js` — auto-scroll to bottom on new message, infinite scroll up for older**
- Test: with mocked 100 messages, scroll to bottom on load, scroll up triggers fetch with `since` param
- Commit: `feat(ui): chat scroll behavior`

**Task 3.8: Accessibility — keyboard nav, ARIA labels, focus rings**
- Tab through sidebar, Enter opens chat
- Test: jsdom + axe-core (no violations on welcome + chat views)
- Commit: `feat(ui): a11y pass`

### Phase 4 — Scheduled sync

**Task 4.1: `launcher/scheduler.py` — APScheduler, daily 01:00 BRT, calls `bridge.trigger_sync()`**
- Timezone: `America/Sao_Paulo`
- Test: with APScheduler's `BackgroundScheduler` patched, asserts trigger called at the right moment
- Commit: `feat(scheduler): daily 01:00 BRT sync`

**Task 4.2: `initial.py` — start scheduler on launch, log "Próxima sincronização: …" in PT-BR**
- Test: log assertion
- Commit: `feat: scheduler wired into launcher`

### Phase 5 — CI + cross-platform

**Task 5.1: `.github/workflows/ci.yml` — lint + test on push (Python 3.11, Node 20)**
- Steps: checkout, setup-python, setup-node, pip install -r requirements.txt + pytest, npm ci + npm run lint + npm test
- Commit: `ci: lint + test workflow`

**Task 5.2: `scripts/verify-install.sh` — runs the full bootstrap from a clean checkout**
- Exits 0 if everything installs and `initial.py --check` passes
- Commit: `chore: clean-install verifier`

**Task 5.3: README.md — quickstart in PT-BR and EN, screenshot, disclaimer**
- Commit: `docs: bilingual readme`

**Task 5.4: Test on macOS (dev machine), then a smoke test on Linux (Docker)**
- Manual verification only; not committed
- Commit: `chore: verified mac + linux`

### Phase 6 — Final QA

**Task 6.1: Mantis security review on the Node sidecar**
- Run `mantis-review backend/src --deterministic-only`
- Address any HIGH/CRITICAL findings
- Commit: `chore: mantis security review`

**Task 6.2: Full E2E manual smoke test — install on clean machine, scan QR, sync, browse chats**
- Commit: nothing (manual verification only)

**Task 6.3: Tag v0.1.0 + GitHub Release with notes**
- `gh release create v0.1.0 --notes-file RELEASE_NOTES.md`
- Commit: tag is enough

**Task 6.4: Final PDF report (≤ 2 pages), delivered to user**
- Content: executive summary (what was built, key features), what works / what's verified (per checklist), known limitations, how to install (one-liner), how to use (3-step flow with screenshot if possible), license + disclaimer, GitHub URL.
- Tool: generate with pandoc + lualatex (already on dev machine) → `REPORT.pdf`, max 2 pages, single column, 11pt.
- Path: `/Users/otaviofalcao/Library/Mobile Documents/com~apple~CloudDocs/Documents/Projects/whatsapp-history-importer/REPORT.pdf`
- Hermes then sends the PDF to the user via `MEDIA:/…/REPORT.pdf` on Telegram.
- Commit: `docs: final PDF report`

## Verification gates (before declaring done)

- [ ] `python initial.py --check` exits 0 with PT-BR banner
- [ ] `python initial.py` opens PyWebView, shows welcome + disclaimer
- [ ] QR scan in WhatsApp connects the sidecar (state transitions to `connected`)
- [ ] First sync downloads at least 1 chat with messages from ~3 years ago
- [ ] SQLite contains the messages; Postgres and MongoDB contain them if their checkboxes were on at first run
- [ ] UI shows chat list, click opens chat, messages render with bubbles, images, videos, audio waveforms
- [ ] Closing window kills the Node sidecar
- [ ] Scheduled task fires at 01:00 BRT tomorrow (verified by log line "Próxima sincronização: …")
- [ ] `pytest` and `npm test` both green
- [ ] `mantis-review backend/src` has no unaddressed HIGH/CRITICAL
- [ ] Repository is public, README has screenshot + disclaimer

## Open questions (need user confirmation before starting)

1. **Repo destination:** confirm `FalcaoOtavio/whatsapp-history-importer` (public, MIT). Or `NathanAshford/…`? Or both as fork?
2. **Where to put the working copy during dev:** iCloud `Projects/whatsapp-history-importer/` (created above) seems right since Otávio's projects live there.
3. **Postgres + MongoDB:** ship as opt-in checkboxes in the welcome screen? Or only SQLite and ignore the user's "3 formats" wording? My read: ship as opt-in (default off) — installing Postgres+Mongo on a personal Mac without consent is a bad first-run experience.
4. **Migration from existing `Aquecedor WhatsApp` or `Bot Atendimento e WhatsMeow`:** any code we should reuse, or fresh start?

## Decision points during implementation (CC's autonomy)

- Use the smallest dependency set possible. If a stdlib alternative exists, prefer it.
- If a Baileys issue blocks historical pull (the 3-year window is the most uncertain feature), search `whiskeysockets/baileys` issues first. If unsolved there, fall back to a one-time full message fetch per chat via `socket.fetchMessageHistory` (older API).
- If `static-ffmpeg` download fails on first run on Windows, fall back to a friendlier instruction screen ("Instale o ffmpeg de ffmpeg.org e reinicie") instead of a stack trace.
- All PT-BR strings live in a single `frontend/public/strings.js` for easy translation later.

## Why this will ship by 12:00 PM

- 1 task ≈ 5–15 min
- ~33 tasks total
- Phases 0–3 are the bulk (scaffolding, launcher, sidecar, UI) and can run on Opus-5 in parallel where independent
- Phase 4–5 are quick
- Phase 6 is the gate
- Reserve the last hour of the budget for fixes found in QA

## Review checkpoints

After Phase 1 (Python launcher ready) — short Telegram message with status.
After Phase 2 (Node sidecar ready, can connect to WhatsApp) — short message + log URL.
After Phase 3 (UI ready) — short message + maybe a screenshot if headless render works.
At 11:00 — final readiness report.
