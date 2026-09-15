#!/usr/bin/env bash
#
# smoke-linux.sh — runs the install and the Node sidecar on Linux, in Docker.
#
# The dev machine is macOS, so this is how Linux gets covered. It clones the
# repository HEAD into a scratch directory (never the working copy, which has
# .venv and node_modules built by macOS and would not even load), mounts that
# clone into a Debian 12 container and there:
#
#   1. runs `python3 initial.py --check` (creates the venv, pip-installs,
#      npm ci in backend/, fetches ffmpeg unless skipped),
#   2. builds the sidecar and boots it,
#   3. asserts GET /health and GET /status answer on loopback,
#   4. asserts the port is NOT reachable from outside loopback.
#
# The window itself is not opened: containers have no display, and PyWebView is
# covered by launcher/tests. This checks the parts that must work per-OS —
# native modules (better-sqlite3), the bootstrap and the HTTP surface.
#
# Usage:
#   scripts/smoke-linux.sh                # full run
#   scripts/smoke-linux.sh --skip-ffmpeg  # skip the static-ffmpeg download
#   scripts/smoke-linux.sh --keep         # keep the scratch clone
set -euo pipefail

KEEP=0
SKIP_FFMPEG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --skip-ffmpeg) SKIP_FFMPEG="--skip-ffmpeg" ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="whi-smoke:bookworm"

# The scratch clone must live somewhere the Docker daemon can bind-mount. On
# macOS the daemon runs in a VM (Docker Desktop, colima) that shares $HOME but
# not $TMPDIR (/var/folders/...), so a mktemp default would fail the mount.
# WHI_SMOKE_DIR overrides this for environments that share a different path.
SCRATCH_BASE="${WHI_SMOKE_DIR:-$HOME/.cache/whi-smoke}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/run-XXXXXX")"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "Clone preservado em: $SCRATCH"
  else
    rm -rf "$SCRATCH"
  fi
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$1"; }

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: o Docker não está rodando. Inicie o Docker (ou 'colima start') e tente de novo." >&2
  exit 1
fi

step "Preparando cópia limpa do HEAD"
git clone --quiet --no-hardlinks "$REPO_ROOT" "$SCRATCH/repo"

# Same guard as verify-install.sh: if the clone carried build artifacts across,
# the run would pass without proving a fresh Linux install works.
for stale in .venv backend/node_modules frontend/node_modules; do
  if [ -e "$SCRATCH/repo/$stale" ]; then
    echo "ERRO: cópia limpa contém '$stale' — o teste não provaria nada." >&2
    exit 1
  fi
done

step "Construindo a imagem Debian 12 (Python 3.11 + Node 22)"
docker build --quiet -t "$IMAGE" -f "$REPO_ROOT/docker/Dockerfile.smoke" "$REPO_ROOT/docker" >/dev/null

step "Instalando e testando dentro do container"
docker run --rm \
  --mount "type=bind,src=$SCRATCH/repo,dst=/repo" \
  -e "SKIP_FFMPEG=$SKIP_FFMPEG" \
  "$IMAGE" \
  bash -euo pipefail -c '
    echo "--- Sistema ---"
    python3 --version
    node --version

    echo "--- Bootstrap (initial.py --check) ---"
    python3 initial.py --check $SKIP_FFMPEG

    test -x .venv/bin/python || { echo "ERRO: .venv/bin/python não foi criado." >&2; exit 1; }
    test -d backend/node_modules || { echo "ERRO: backend/node_modules não foi criado." >&2; exit 1; }

    echo "--- Módulo nativo (better-sqlite3) sob Linux ---"
    node -e "
      const Database = require(\"/repo/backend/node_modules/better-sqlite3\");
      const db = new Database(\":memory:\");
      db.exec(\"create table t(x)\");
      db.prepare(\"insert into t values (?)\").run(42);
      if (db.prepare(\"select x from t\").get().x !== 42) process.exit(1);
      console.log(\"better-sqlite3 OK\");
    "

    echo "--- Compilando o sidecar ---"
    cd backend && npm run --silent build && cd /repo
    test -f backend/dist/server.js || { echo "ERRO: backend/dist/server.js não foi gerado." >&2; exit 1; }

    echo "--- Testes do sidecar sob Linux ---"
    (cd backend && npm test --silent 2>&1 | tail -5)

    echo "--- Subindo o sidecar ---"
    PORT=8899 node backend/dist/server.js > /tmp/sidecar.log 2>&1 &
    SIDECAR_PID=$!
    trap "kill $SIDECAR_PID 2>/dev/null || true" EXIT

    for _ in $(seq 1 40); do
      if curl -sf http://127.0.0.1:8899/health >/dev/null 2>&1; then break; fi
      sleep 0.25
    done

    echo "--- GET /health ---"
    curl -sf http://127.0.0.1:8899/health || { echo; echo "ERRO: /health não respondeu."; cat /tmp/sidecar.log; exit 1; }
    echo
    echo "--- GET /status ---"
    curl -sf http://127.0.0.1:8899/status || { echo; echo "ERRO: /status não respondeu."; exit 1; }
    echo
    echo "--- GET /chats ---"
    curl -sf "http://127.0.0.1:8899/chats?limit=5&offset=0" || { echo; echo "ERRO: /chats não respondeu."; exit 1; }
    echo

    # The sidecar must bind loopback only. The container has another local
    # address; if the server answers there, the 127.0.0.1 bind regressed.
    echo "--- Confirmando bind apenas em loopback ---"
    OTHER_IP="$(hostname -i | awk "{print \$1}")"
    if [ "$OTHER_IP" != "127.0.0.1" ] && curl -s --max-time 2 "http://$OTHER_IP:8899/health" >/dev/null 2>&1; then
      echo "ERRO: o servidor respondeu em $OTHER_IP — deveria escutar só em 127.0.0.1." >&2
      exit 1
    fi
    echo "Não acessível em $OTHER_IP ✓"
  '

printf '\n✓ Smoke test no Linux concluído com sucesso.\n'
