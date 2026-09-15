#!/usr/bin/env bash
#
# verify-install.sh — runs the full bootstrap the way a new user would.
#
# Clones the repository at HEAD into a scratch directory (so nothing in the
# working copy is reused — no .venv, no node_modules, no ffmpeg cache) and runs
# `python initial.py --check` there. Exits 0 only if every prerequisite check
# and every install step succeeds.
#
# Usage:
#   scripts/verify-install.sh              # clean clone, full bootstrap
#   scripts/verify-install.sh --keep       # leave the scratch dir for inspection
#   scripts/verify-install.sh --skip-ffmpeg  # skip the static-ffmpeg download
#
set -euo pipefail

KEEP=0
SKIP_FFMPEG=""

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --skip-ffmpeg) SKIP_FFMPEG="--skip-ffmpeg" ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opção desconhecida: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/whi-verify-XXXXXX")"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "Cópia limpa mantida em: $SCRATCH"
  else
    rm -rf "$SCRATCH"
  fi
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$1"; }

step "Clonando HEAD para uma cópia limpa"
# --no-hardlinks so the clone cannot share objects with the source checkout.
git clone --quiet --no-hardlinks "$REPO_ROOT" "$SCRATCH/repo"
cd "$SCRATCH/repo"

# Guard: the whole point is that nothing is pre-installed. If the clone carried
# any of these across, the run would pass without proving anything.
for stale in .venv backend/node_modules frontend/node_modules; do
  if [ -e "$stale" ]; then
    echo "ERRO: a cópia limpa contém '$stale' — o teste não provaria nada." >&2
    exit 1
  fi
done

step "Verificando pré-requisitos e instalando dependências"
# initial.py --check creates the venv, pip-installs requirements.txt, runs
# npm ci in backend/, and (unless skipped) fetches static ffmpeg.
python3 initial.py --check $SKIP_FFMPEG

step "Confirmando que o bootstrap produziu o ambiente esperado"
test -x .venv/bin/python || { echo "ERRO: .venv/bin/python não foi criado." >&2; exit 1; }
test -d backend/node_modules || { echo "ERRO: backend/node_modules não foi criado." >&2; exit 1; }
.venv/bin/python -c "import webview, apscheduler, requests" \
  || { echo "ERRO: dependências Python não importáveis." >&2; exit 1; }

step "Compilando o sidecar Node"
(cd backend && npm run --silent build)
test -f backend/dist/server.js || { echo "ERRO: backend/dist/server.js não foi gerado." >&2; exit 1; }

printf '\n✓ Instalação limpa verificada com sucesso.\n'
