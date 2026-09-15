from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

from launcher.bootstrap import (
    check_node_version,
    check_python_version,
    ensure_ffmpeg,
    ensure_node_deps,
    ensure_venv,
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


def test_check_node_version_passes_on_22():
    runner = MagicMock(return_value=MagicMock(stdout="v22.11.0\n"))
    result = check_node_version(runner=runner)
    assert result.ok is True


def test_check_node_version_fails_on_20():
    """better-sqlite3 needs Node >= 22: under 20 it segfaults on the first
    query, so the check must reject 20 instead of letting the app crash."""
    runner = MagicMock(return_value=MagicMock(stdout="v20.20.2\n"))
    result = check_node_version(runner=runner)
    assert result.ok is False
    assert "20" in result.message


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


def test_ensure_venv_creates_and_installs_when_missing(tmp_path: Path):
    venv_dir = tmp_path / ".venv"
    req_file = tmp_path / "requirements.txt"
    req_file.write_text("pywebview\n")
    runner = MagicMock()
    creator = MagicMock(side_effect=lambda d: d.mkdir(parents=True))

    result = ensure_venv(venv_dir=venv_dir, requirements_file=req_file, runner=runner, venv_creator=creator)

    assert result.ok is True
    creator.assert_called_once_with(venv_dir)
    assert runner.call_count == 1
    assert (venv_dir / ".requirements-installed").is_file()


def test_ensure_venv_idempotent_when_up_to_date(tmp_path: Path):
    venv_dir = tmp_path / ".venv"
    venv_dir.mkdir()
    req_file = tmp_path / "requirements.txt"
    req_file.write_text("pywebview\n")
    runner = MagicMock()
    creator = MagicMock()

    # First run installs and writes the marker.
    first = ensure_venv(venv_dir=venv_dir, requirements_file=req_file, runner=runner, venv_creator=creator)
    assert first.ok is True
    assert runner.call_count == 1

    # Second run: venv exists, requirements unchanged -> no reinstall, no recreate.
    second = ensure_venv(venv_dir=venv_dir, requirements_file=req_file, runner=runner, venv_creator=creator)
    assert second.ok is True
    assert runner.call_count == 1  # not called again
    creator.assert_not_called()


def test_ensure_venv_reinstalls_when_requirements_change(tmp_path: Path):
    venv_dir = tmp_path / ".venv"
    venv_dir.mkdir()
    req_file = tmp_path / "requirements.txt"
    req_file.write_text("pywebview\n")
    runner = MagicMock()

    first = ensure_venv(venv_dir=venv_dir, requirements_file=req_file, runner=runner, venv_creator=MagicMock())
    assert first.ok is True
    assert runner.call_count == 1

    req_file.write_text("pywebview\napscheduler\n")  # changed content -> new mtime/size
    second = ensure_venv(venv_dir=venv_dir, requirements_file=req_file, runner=runner, venv_creator=MagicMock())
    assert second.ok is True
    assert runner.call_count == 2


def test_ensure_ffmpeg_success(tmp_path: Path):
    ffmpeg_file = tmp_path / "ffmpeg"
    ffprobe_file = tmp_path / "ffprobe"
    ffmpeg_file.write_text("binary")
    ffprobe_file.write_text("binary")
    fetcher = MagicMock(return_value=(str(ffmpeg_file), str(ffprobe_file)))

    result = ensure_ffmpeg(fetcher=fetcher)

    assert result.ok is True
    assert result.ffmpeg_path == str(ffmpeg_file)
    fetcher.assert_called_once()


def test_ensure_ffmpeg_reports_ok_on_cached_fetcher_response():
    # static_ffmpeg itself caches on disk and skips the download when the
    # binaries already exist; here we just assert a successful fetcher
    # response (cached or fresh) is reported as ok.
    fetcher = MagicMock(return_value=("/bin/ffmpeg", "/bin/ffprobe"))
    with patch("pathlib.Path.is_file", return_value=True):
        result = ensure_ffmpeg(fetcher=fetcher)
    assert result.ok is True


def test_ensure_ffmpeg_falls_back_gracefully_on_download_failure():
    fetcher = MagicMock(side_effect=RuntimeError("network unreachable"))

    result = ensure_ffmpeg(fetcher=fetcher)

    assert result.ok is False
    assert "ffmpeg.org" in result.message
