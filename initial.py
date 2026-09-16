#!/usr/bin/env python3
"""WhatsApp History Importer — single entry point.

Uso:
    python initial.py            # instala dependências (se preciso) e abre o app
    python initial.py --check    # só verifica os pré-requisitos e sai (para CI)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from launcher.bootstrap import (  # noqa: E402
    VENV_DIR,
    check_prerequisites,
    ensure_ffmpeg,
    ensure_node_deps,
    ensure_venv,
    venv_python,
)

BANNER = "WhatsApp History Importer — verificação de pré-requisitos"

# Set on the child process so a re-exec can never re-exec again. Without it a
# broken venv (one whose python exists but lacks the dependencies) would loop.
REEXEC_MARKER = "WHI_VENV_REEXEC"


def running_inside_venv(prefix: str | None = None) -> bool:
    """True when this interpreter is using the repo's own .venv.

    Compares sys.prefix rather than sys.executable: `.venv/bin/python` is a
    symlink to the base interpreter, so resolve() collapses the two paths and
    every interpreter would look like the venv. sys.prefix is the venv
    directory itself while inside it, and the base installation outside.
    """
    try:
        return Path(sys.prefix if prefix is None else prefix).resolve() == VENV_DIR.resolve()
    except OSError:
        return False


def reexec_into_venv(argv: list[str] | None = None, env: dict[str, str] | None = None) -> None:
    """Replace this process with the same command run under the repo's venv.

    `ensure_venv()` installs requirements.txt into .venv, but the interpreter
    that ran `python3 initial.py` is whatever the user happened to type —
    normally the system Python, which has none of those packages. Importing
    static_ffmpeg or webview from it raises ModuleNotFoundError. Re-exec so the
    rest of the run sees the dependencies that were just installed.

    Does nothing when already inside the venv, when the venv interpreter is
    missing, or when the marker says this process is already the child.
    """
    env = os.environ if env is None else env
    if env.get(REEXEC_MARKER) or running_inside_venv():
        return

    python_bin = venv_python()
    if not python_bin.exists():
        return

    argv = sys.argv if argv is None else argv
    child_env = dict(env)
    child_env[REEXEC_MARKER] = "1"

    # execve replaces the process image without running Python's exit handlers,
    # so anything still sitting in the stdio buffers is lost. That is invisible
    # on a terminal (line-buffered) but silently eats the banner and the first
    # check lines whenever output is redirected to a file or a pipe.
    sys.stdout.flush()
    sys.stderr.flush()

    os.execve(str(python_bin), [str(python_bin), *argv], child_env)


def run_checks(skip_ffmpeg: bool = False) -> bool:
    # After a re-exec the parent already printed the banner, the prerequisite
    # lines and the venv line; repeating them would show every check twice.
    resumed = bool(os.environ.get(REEXEC_MARKER))
    if resumed:
        return _run_checks_after_venv(skip_ffmpeg=skip_ffmpeg, all_ok=True)

    print(f"\n{BANNER}\n{'-' * len(BANNER)}")

    all_ok = True

    for result in check_prerequisites():
        symbol = "✓" if result.ok else "✗"
        print(f"  {symbol} {result.message}")
        all_ok = all_ok and result.ok

    if not all_ok:
        print("\nCorrija os itens acima antes de continuar.")
        return False

    venv_result = ensure_venv()
    print(f"  {'✓' if venv_result.ok else '✗'} {venv_result.message}")
    all_ok = all_ok and venv_result.ok

    # The venv now has requirements.txt installed, but this process is still
    # running under whatever interpreter the user typed. Hand over to the venv
    # before anything imports static_ffmpeg or webview. Does not return.
    if venv_result.ok:
        reexec_into_venv()

    return _run_checks_after_venv(skip_ffmpeg=skip_ffmpeg, all_ok=all_ok)


def _run_checks_after_venv(skip_ffmpeg: bool, all_ok: bool) -> bool:
    """Checks that need requirements.txt installed — run under the venv.

    Split out of run_checks() so the re-exec'd child can resume here instead of
    repeating the prerequisite and venv lines the parent already printed.
    """
    node_result = ensure_node_deps()
    print(f"  {'✓' if node_result.ok else '✗'} {node_result.message}")
    all_ok = all_ok and node_result.ok

    if not skip_ffmpeg:
        ffmpeg_result = ensure_ffmpeg()
        print(f"  {'✓' if ffmpeg_result.ok else '✗'} {ffmpeg_result.message}")
        all_ok = all_ok and ffmpeg_result.ok

    if all_ok:
        print("\nTudo pronto! ✓\n")
    else:
        print("\nAlgo deu errado. Veja as mensagens acima.\n")

    return all_ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WhatsApp History Importer")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Apenas verifica pré-requisitos e sai (não abre a janela).",
    )
    parser.add_argument(
        "--skip-ffmpeg",
        action="store_true",
        help="Pula o download do ffmpeg (útil em CI/smoke tests rápidos).",
    )
    args = parser.parse_args(argv)

    ok = run_checks(skip_ffmpeg=args.skip_ffmpeg)
    if not ok:
        return 1

    if args.check:
        return 0

    # Full launch: start sidecar + scheduler + window.
    from launcher.window import launch_app

    launch_app()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
