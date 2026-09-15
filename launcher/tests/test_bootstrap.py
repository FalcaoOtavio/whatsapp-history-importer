from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock

from launcher.bootstrap import (
    check_node_version,
    check_python_version,
    ensure_node_deps,
)


def test_check_python_version_passes_on_current():
    result = check_python_version()
    assert result.ok is True


def test_check_python_version_fails_on_310():
    result = check_python_version(version_info=(3, 10, 5))
    assert result.ok is False
    assert "3.10" in result.message


def test_check_python_version_passes_on_311():
    result = check_python_version(version_info=(3, 11, 0))
    assert result.ok is True


def test_check_node_version_passes_on_20():
    runner = MagicMock(return_value=MagicMock(stdout="v20.11.0\n"))
    result = check_node_version(runner=runner)
    assert result.ok is True


def test_check_node_version_fails_on_16():
    runner = MagicMock(return_value=MagicMock(stdout="v16.20.0\n"))
    result = check_node_version(runner=runner)
    assert result.ok is False
    assert "16" in result.message


def test_check_node_version_fails_when_node_missing(monkeypatch):
    monkeypatch.setattr("launcher.bootstrap.shutil.which", lambda _: None)
    result = check_node_version()
    assert result.ok is False
    assert "não encontrado" in result.message


def test_ensure_node_deps_skips_when_node_modules_exists(tmp_path: Path):
    backend_dir = tmp_path / "backend"
    (backend_dir / "node_modules").mkdir(parents=True)
    runner = MagicMock()

    result = ensure_node_deps(runner=runner, backend_dir=backend_dir)

    assert result.ok is True
    runner.assert_not_called()


def test_ensure_node_deps_runs_npm_ci_when_missing(tmp_path: Path):
    backend_dir = tmp_path / "backend"
    backend_dir.mkdir(parents=True)
    runner = MagicMock()

    result = ensure_node_deps(runner=runner, backend_dir=backend_dir)

    assert result.ok is True
    assert runner.call_count == 1
    args, kwargs = runner.call_args
    assert args[0][-1] == "ci"
    assert kwargs["cwd"] == str(backend_dir)


def test_ensure_node_deps_reports_failure(tmp_path: Path):
    backend_dir = tmp_path / "backend"
    backend_dir.mkdir(parents=True)
    runner = MagicMock(side_effect=subprocess.CalledProcessError(1, "npm ci"))

    result = ensure_node_deps(runner=runner, backend_dir=backend_dir)

    assert result.ok is False
