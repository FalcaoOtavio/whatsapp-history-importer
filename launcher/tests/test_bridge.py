from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pytest_httpserver import HTTPServer

from launcher.bridge import SidecarBridge


@pytest.fixture
def bridge(httpserver: HTTPServer) -> SidecarBridge:
    return SidecarBridge(port=httpserver.port, base_url=httpserver.url_for("").rstrip("/"))


def test_get_qr(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/qr").respond_with_json({"qr": "base64png", "state": "qr"})
    result = bridge.get_qr()
    assert result == {"qr": "base64png", "state": "qr"}


def test_get_status(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/status").respond_with_json({"state": "connected"})
    result = bridge.get_status()
    assert result == {"state": "connected"}


def test_get_chats(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/chats", query_string="limit=2&offset=0").respond_with_json(
        {"chats": [{"jid": "a"}, {"jid": "b"}]}
    )
    result = bridge.get_chats(limit=2, offset=0)
    assert result == {"chats": [{"jid": "a"}, {"jid": "b"}]}


def test_get_messages(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/messages", query_string="chatId=123&since=100").respond_with_json(
        {"messages": [{"id": "m1"}]}
    )
    result = bridge.get_messages(chat_id="123", since=100)
    assert result == {"messages": [{"id": "m1"}]}


def test_trigger_sync(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/sync", method="POST").respond_with_json({"status": "started"})
    result = bridge.trigger_sync()
    assert result == {"status": "started"}


def test_wait_until_ready_true_when_health_responds(bridge: SidecarBridge, httpserver: HTTPServer):
    httpserver.expect_request("/health").respond_with_json({"ok": True})
    assert bridge.wait_until_ready(timeout=2, poll_interval=0.05) is True


def test_wait_until_ready_false_on_timeout():
    bridge = SidecarBridge(port=1, base_url="http://127.0.0.1:1")  # nothing listening
    assert bridge.wait_until_ready(timeout=0.3, poll_interval=0.1) is False


def test_start_sidecar_spawns_node_with_port_env():
    bridge = SidecarBridge(port=54321)
    fake_popen = MagicMock(return_value=MagicMock())

    bridge.start_sidecar(popen=fake_popen)

    fake_popen.assert_called_once()
    args, kwargs = fake_popen.call_args
    assert kwargs["env"]["PORT"] == "54321"
    assert args[0][0] == "node"


def test_stop_sidecar_terminates_process():
    bridge = SidecarBridge(port=54321)
    fake_process = MagicMock()
    fake_popen = MagicMock(return_value=fake_process)
    bridge.start_sidecar(popen=fake_popen)

    bridge.stop_sidecar()

    fake_process.terminate.assert_called_once()
    fake_process.wait.assert_called_once()
