"""PyWebView window management.

Opens a single native window pointed at the Node sidecar's localhost URL.
No browser, no remote hosts — loopback only, ephemeral port.
"""

from __future__ import annotations

import socket


def find_free_port() -> int:
    """Bind to port 0 on loopback to let the OS pick a free ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def build_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/"


def create_window(port: int, webview_module=None):
    """Create (but do not start) the PyWebView window targeting the given port.

    `webview_module` is injectable for tests — defaults to the real `webview`
    package, which requires a native GUI toolkit and can't run headless in CI.
    """
    if webview_module is None:
        import webview as webview_module

    url = build_url(port)
    return webview_module.create_window(
        "WhatsApp History",
        url,
        width=1200,
        height=800,
        min_size=(800, 600),
    )


def launch_app(webview_module=None, sidecar_starter=None, bridge_factory=None):
    """Full launch: pick a port, start the sidecar, open the window, block until closed.

    On window close (or Ctrl-C), the sidecar process is terminated gracefully.
    `sidecar_starter(port)` is injectable for tests; defaults to spawning the
    real Node process via `SidecarBridge.start_sidecar`.
    `bridge_factory` (used only when `sidecar_starter` is None) is injectable
    for tests and defaults to `SidecarBridge`.
    """
    port = find_free_port()

    if bridge_factory is None:
        from launcher.bridge import SidecarBridge

        bridge_factory = SidecarBridge

    bridge = bridge_factory(port)

    if sidecar_starter is not None:
        sidecar_starter(port)
    else:
        bridge.start_sidecar()
        bridge.wait_until_ready()

    if webview_module is None:
        import webview as webview_module

    window = create_window(port, webview_module=webview_module)

    def _on_closed():
        bridge.stop_sidecar()

    closed_event = getattr(window, "events", None)
    closed_event = getattr(closed_event, "closed", None) if closed_event else None
    if closed_event is not None:
        closed_event += _on_closed

    try:
        webview_module.start()
    finally:
        bridge.stop_sidecar()
