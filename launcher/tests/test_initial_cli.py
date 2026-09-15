"""Integration test for `python initial.py --check` as a subprocess.

Only exercises the pure prerequisite checks (Python/Node version) — venv and
node_modules setup are unit-tested in test_bootstrap.py and require the real
backend/ to exist, which lands in Phase 2.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_check_flag_prints_banner_when_prereqs_pass():
    # Prereqs (Python/Node version) are expected to pass on the dev/CI machine.
    # venv/node_modules/ffmpeg steps may still fail if backend/ isn't scaffolded
    # yet — this test only asserts the banner + prereq lines appear and the
    # process runs to completion without crashing.
    result = subprocess.run(
        [sys.executable, "initial.py", "--check"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert "WhatsApp History Importer" in result.stdout
    assert "Python" in result.stdout
    assert "Node.js" in result.stdout
