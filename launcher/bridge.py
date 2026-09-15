"""HTTP bridge: launcher (Python) <-> Node sidecar (Baileys)."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
DEFAULT_TIMEOUT = 10


class SidecarBridge:
    """Talks to the Node sidecar over HTTP."""

    def __init__(self, port: int, base_url: str | None = None):
        self.port = port
        self.base_url = base_url or f"http://127.0.0.1:{port}"
        self._process: subprocess.Popen | None = None

    # -- process management -------------------------------------------------

    def start_sidecar(
        self,
        node_bin: str = "node",
        entry: Path | None = None,
        env: dict | None = None,
        popen=subprocess.Popen,
        ffmpeg_locator=None,
    ) -> subprocess.Popen:
        """Spawn `node dist/server.js PORT` and remember the process handle.

        The sidecar shells out to ffmpeg for video thumbnails and audio
        waveforms, but the static ffmpeg the launcher downloads lives inside the
        venv and is never added to PATH — so its location is passed explicitly
        as FFMPEG_PATH. `ffmpeg_locator` is injectable for tests.
        """
        entry = entry or (BACKEND_DIR / "dist" / "server.js")
        import os

        full_env = {**os.environ, "PORT": str(self.port)}

        if ffmpeg_locator is None:
            from launcher.bootstrap import ensure_ffmpeg

            ffmpeg_locator = ensure_ffmpeg

        # A missing ffmpeg is not fatal: everything except thumbnails and
        # waveforms still works, so the sidecar starts either way.
        try:
            ffmpeg_result = ffmpeg_locator()
            if ffmpeg_result.ok and ffmpeg_result.ffmpeg_path:
                full_env["FFMPEG_PATH"] = ffmpeg_result.ffmpeg_path
        except Exception as exc:  # noqa: BLE001 - see comment above
            print(f"ffmpeg indisponível; miniaturas serão ignoradas: {exc}")

        if env:
            full_env.update(env)

        self._process = popen(
            [node_bin, str(entry)],
            cwd=str(BACKEND_DIR),
            env=full_env,
        )
        return self._process

    def stop_sidecar(self) -> None:
        if self._process is None:
            return
        self._process.terminate()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)
        self._process = None

    def wait_until_ready(self, timeout: float = 15.0, poll_interval: float = 0.2) -> bool:
        """Poll /health until it responds 200 or timeout elapses."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                resp = requests.get(f"{self.base_url}/health", timeout=1)
                if resp.status_code == 200:
                    return True
            except requests.RequestException:
                pass
            time.sleep(poll_interval)
        return False

    # -- data methods ---------------------------------------------------------

    def get_qr(self) -> dict:
        resp = requests.get(f"{self.base_url}/qr", timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_status(self) -> dict:
        resp = requests.get(f"{self.base_url}/status", timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_chats(self, limit: int | None = None, offset: int | None = None) -> dict:
        params = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        resp = requests.get(f"{self.base_url}/chats", params=params, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_messages(self, chat_id: str, since: int | None = None, limit: int | None = None) -> dict:
        params = {"chatId": chat_id}
        if since is not None:
            params["since"] = since
        if limit is not None:
            params["limit"] = limit
        resp = requests.get(f"{self.base_url}/messages", params=params, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def trigger_sync(self) -> dict:
        resp = requests.post(f"{self.base_url}/sync", timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
