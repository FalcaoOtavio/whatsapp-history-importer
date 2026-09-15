#!/usr/bin/env python3
"""WhatsApp History Importer — single entry point.

Uso:
    python initial.py            # instala dependências (se preciso) e abre o app
    python initial.py --check    # só verifica os pré-requisitos e sai (para CI)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from launcher.bootstrap import (  # noqa: E402
    check_prerequisites,
    ensure_ffmpeg,
    ensure_node_deps,
    ensure_venv,
)

BANNER = "WhatsApp History Importer — verificação de pré-requisitos"


def run_checks(skip_ffmpeg: bool = False) -> bool:
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
