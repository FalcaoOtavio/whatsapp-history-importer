"""Bootstrap: checks prerequisites and prepares the Python/Node environments.

All user-facing strings are PT-BR (see the project's a11y/UX constraints).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

MIN_PYTHON = (3, 11)
MIN_NODE = 18

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = REPO_ROOT / ".venv"
REQUIREMENTS_FILE = REPO_ROOT / "requirements.txt"
BACKEND_DIR = REPO_ROOT / "backend"
NODE_MODULES_DIR = BACKEND_DIR / "node_modules"


@dataclass
class CheckResult:
    ok: bool
    message: str


def check_python_version(version_info: tuple[int, int, int] | None = None) -> CheckResult:
    """Check the running (or given) Python version is >= MIN_PYTHON."""
    info = version_info if version_info is not None else sys.version_info
    current = (info[0], info[1])
    if current >= MIN_PYTHON:
        return CheckResult(
            ok=True,
            message=f"Python {info[0]}.{info[1]} encontrado (mínimo {MIN_PYTHON[0]}.{MIN_PYTHON[1]}).",
        )
    return CheckResult(
        ok=False,
        message=(
            f"Python {info[0]}.{info[1]} é muito antigo. "
            f"É necessário Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} ou mais recente."
        ),
    )


def _parse_node_version(raw: str) -> int | None:
    """Parse `v20.11.0` style output into a major version int."""
    raw = raw.strip()
    if raw.startswith("v"):
        raw = raw[1:]
    try:
        return int(raw.split(".")[0])
    except (ValueError, IndexError):
        return None


def check_node_version(runner=subprocess.run) -> CheckResult:
    """Check `node --version` reports >= MIN_NODE. `runner` is injectable for tests."""
    node_path = shutil.which("node")
    if node_path is None:
        return CheckResult(
            ok=False,
            message="Node.js não encontrado. Instale o Node.js 18 ou mais recente em nodejs.org.",
        )
    try:
        result = runner([node_path, "--version"], capture_output=True, text=True, check=True)
    except (subprocess.CalledProcessError, OSError):
        return CheckResult(ok=False, message="Não foi possível executar 'node --version'.")

    major = _parse_node_version(result.stdout)
    if major is None:
        return CheckResult(ok=False, message=f"Versão do Node.js não reconhecida: {result.stdout!r}")

    if major >= MIN_NODE:
        return CheckResult(ok=True, message=f"Node.js {result.stdout.strip()} encontrado (mínimo {MIN_NODE}).")
    return CheckResult(
        ok=False,
        message=f"Node.js {result.stdout.strip()} é muito antigo. É necessário Node.js {MIN_NODE} ou mais recente.",
    )


def check_prerequisites(version_info=None, runner=subprocess.run) -> list[CheckResult]:
    """Run all prerequisite checks."""
    return [check_python_version(version_info), check_node_version(runner)]


def ensure_node_deps(runner=subprocess.run, backend_dir: Path = BACKEND_DIR) -> CheckResult:
    """Run `npm ci` in backend/ if node_modules is missing."""
    node_modules = backend_dir / "node_modules"
    if node_modules.is_dir():
        return CheckResult(ok=True, message="Dependências do Node já instaladas.")

    npm_path = shutil.which("npm")
    if npm_path is None:
        return CheckResult(ok=False, message="npm não encontrado. Instale o Node.js (inclui npm).")

    try:
        runner([npm_path, "ci"], cwd=str(backend_dir), check=True)
    except (subprocess.CalledProcessError, OSError) as exc:
        return CheckResult(ok=False, message=f"Falha ao instalar dependências do Node: {exc}")

    return CheckResult(ok=True, message="Dependências do Node instaladas com sucesso.")
