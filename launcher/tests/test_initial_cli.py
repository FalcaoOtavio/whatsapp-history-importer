"""Integration test for `python initial.py --check` as a subprocess.

Only exercises the pure prerequisite checks (Python/Node version) — venv and
node_modules setup are unit-tested in test_bootstrap.py and require the real
backend/ to exist, which lands in Phase 2.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import initial
from launcher.bootstrap import VENV_DIR

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


def test_running_inside_venv_compares_prefix_not_executable():
    """.venv/bin/python is a symlink to the base interpreter.

    Comparing resolved executables makes every interpreter look like the venv,
    which silently disables the re-exec. sys.prefix is what actually differs.
    """
    assert initial.running_inside_venv(prefix=str(VENV_DIR)) is True
    assert initial.running_inside_venv(prefix=sys.base_prefix) is False


def test_reexec_is_skipped_once_the_marker_is_set():
    """The child must not re-exec again, or a venv missing its dependencies
    would spawn processes forever instead of failing with a clear error."""
    calls = []
    env = {initial.REEXEC_MARKER: "1"}

    original = os.execve
    os.execve = lambda *a: calls.append(a)
    try:
        initial.reexec_into_venv(argv=["initial.py", "--check"], env=env)
    finally:
        os.execve = original

    assert calls == []


def test_reexec_is_skipped_when_venv_interpreter_is_missing(tmp_path, monkeypatch):
    """A half-built venv must fall through to the normal error path rather than
    exec'ing a path that does not exist."""
    calls = []
    monkeypatch.setattr(initial, "venv_python", lambda: tmp_path / "bin" / "python")
    monkeypatch.setattr(initial, "running_inside_venv", lambda *a, **k: False)
    monkeypatch.setattr(os, "execve", lambda *a: calls.append(a))

    initial.reexec_into_venv(argv=["initial.py", "--check"], env={})

    assert calls == []


def test_reexec_passes_marker_and_argv_to_the_venv_interpreter(tmp_path, monkeypatch):
    calls = []
    fake_python = tmp_path / "bin" / "python"
    fake_python.parent.mkdir(parents=True)
    fake_python.touch()

    monkeypatch.setattr(initial, "venv_python", lambda: fake_python)
    monkeypatch.setattr(initial, "running_inside_venv", lambda *a, **k: False)
    monkeypatch.setattr(os, "execve", lambda *a: calls.append(a))

    initial.reexec_into_venv(argv=["initial.py", "--check"], env={"PATH": "/usr/bin"})

    assert len(calls) == 1
    executable, argv, child_env = calls[0]
    assert executable == str(fake_python)
    assert argv == [str(fake_python), "initial.py", "--check"]
    assert child_env[initial.REEXEC_MARKER] == "1"
    assert child_env["PATH"] == "/usr/bin"


def test_check_flag_reports_ffmpeg_without_crashing():
    """Regression: initial.py prepared the venv but kept running under the
    interpreter the user typed, so importing static_ffmpeg raised
    ModuleNotFoundError. --skip-ffmpeg hid it, which is why the smoke test
    never caught it."""
    result = subprocess.run(
        [sys.executable, "initial.py", "--check"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert "ModuleNotFoundError" not in result.stderr
    assert "Traceback" not in result.stderr
    assert "ffmpeg" in result.stdout


def test_reexec_child_does_not_reprint_the_banner():
    """The parent already printed the banner and the prereq lines; the child
    resumes after the venv step instead of repeating them."""
    env = dict(os.environ)
    env[initial.REEXEC_MARKER] = "1"
    result = subprocess.run(
        [sys.executable, "initial.py", "--check", "--skip-ffmpeg"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
    )
    assert result.stdout.count("WhatsApp History Importer") == 0
    assert "Node" in result.stdout
