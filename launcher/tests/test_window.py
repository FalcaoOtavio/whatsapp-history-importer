from __future__ import annotations

import socket
from unittest.mock import MagicMock

import pytest

from launcher.window import build_url, create_window, find_free_port, launch_app


def test_find_free_port_returns_bindable_port():
    port = find_free_port()
    assert 1024 < port < 65536

    # The port should be free again immediately after (best-effort check).
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", port))


def test_build_url_uses_loopback_only():
    url = build_url(54321)
    assert url == "http://127.0.0.1:54321/"
    assert "0.0.0.0" not in url


def test_create_window_targets_bound_port():
    fake_webview = MagicMock()
    fake_webview.create_window = MagicMock(return_value="window-handle")

    handle = create_window(54321, webview_module=fake_webview)

    assert handle == "window-handle"
    fake_webview.create_window.assert_called_once()
    args, kwargs = fake_webview.create_window.call_args
    assert args[1] == "http://127.0.0.1:54321/"


def test_launch_app_starts_sidecar_on_chosen_port_then_opens_window():
    fake_webview = MagicMock()
    sidecar_starter = MagicMock()

    launch_app(webview_module=fake_webview, sidecar_starter=sidecar_starter)

    sidecar_starter.assert_called_once()
    used_port = sidecar_starter.call_args[0][0]
    assert 1024 < used_port < 65536
    fake_webview.create_window.assert_called_once()
    fake_webview.start.assert_called_once()


def test_launch_app_starts_and_stops_bridge_by_default():
    fake_webview = MagicMock()
    fake_bridge = MagicMock()
    bridge_factory = MagicMock(return_value=fake_bridge)

    launch_app(webview_module=fake_webview, bridge_factory=bridge_factory)

    fake_bridge.start_sidecar.assert_called_once()
    fake_bridge.wait_until_ready.assert_called_once()
    fake_webview.start.assert_called_once()
    fake_bridge.stop_sidecar.assert_called_once()


def test_launch_app_stops_sidecar_even_if_webview_start_raises():
    fake_webview = MagicMock()
    fake_webview.start.side_effect = RuntimeError("window crashed")
    fake_bridge = MagicMock()
    bridge_factory = MagicMock(return_value=fake_bridge)

    with pytest.raises(RuntimeError):
        launch_app(webview_module=fake_webview, bridge_factory=bridge_factory)

    fake_bridge.stop_sidecar.assert_called_once()


def test_launch_app_starts_daily_scheduler_bound_to_bridge_sync():
    fake_webview = MagicMock()
    fake_bridge = MagicMock()
    fake_scheduler = MagicMock()
    scheduler_factory = MagicMock(return_value=fake_scheduler)

    launch_app(
        webview_module=fake_webview,
        bridge_factory=MagicMock(return_value=fake_bridge),
        scheduler_factory=scheduler_factory,
    )

    scheduler_factory.assert_called_once()
    # The scheduler must call the live bridge's trigger_sync, not a stub.
    assert scheduler_factory.call_args[0][0] == fake_bridge.trigger_sync


def test_launch_app_shuts_down_scheduler_when_window_closes():
    fake_webview = MagicMock()
    fake_scheduler = MagicMock()

    launch_app(
        webview_module=fake_webview,
        bridge_factory=MagicMock(return_value=MagicMock()),
        scheduler_factory=MagicMock(return_value=fake_scheduler),
    )

    fake_scheduler.shutdown.assert_called_once()


def test_launch_app_shuts_down_scheduler_even_if_webview_start_raises():
    fake_webview = MagicMock()
    fake_webview.start.side_effect = RuntimeError("window crashed")
    fake_scheduler = MagicMock()

    with pytest.raises(RuntimeError):
        launch_app(
            webview_module=fake_webview,
            bridge_factory=MagicMock(return_value=MagicMock()),
            scheduler_factory=MagicMock(return_value=fake_scheduler),
        )

    fake_scheduler.shutdown.assert_called_once()


def test_launch_app_announces_next_run_in_ptbr(capsys):
    fake_webview = MagicMock()
    fake_scheduler = MagicMock()
    fake_scheduler.next_run_message.return_value = "Próxima sincronização: 11/03/2026 às 01:00 (-03)"

    launch_app(
        webview_module=fake_webview,
        bridge_factory=MagicMock(return_value=MagicMock()),
        scheduler_factory=MagicMock(return_value=fake_scheduler),
    )

    out = capsys.readouterr().out
    assert "Próxima sincronização: 11/03/2026 às 01:00" in out


def test_launch_app_survives_scheduler_start_failure(capsys):
    """A scheduler that refuses to start must not block the window from opening —
    the app is still usable for browsing history and manual syncs."""
    fake_webview = MagicMock()
    scheduler_factory = MagicMock(side_effect=RuntimeError("no timer available"))

    launch_app(
        webview_module=fake_webview,
        bridge_factory=MagicMock(return_value=MagicMock()),
        scheduler_factory=scheduler_factory,
    )

    fake_webview.start.assert_called_once()
    assert "agendador" in capsys.readouterr().out.lower()
