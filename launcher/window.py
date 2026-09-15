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


def launch_app(webview_module=None, sidecar_starter=None):
    """Full launch: pick a port, start the sidecar, open the window, block until closed."""
    port = find_free_port()

    if sidecar_starter is not None:
        sidecar_starter(port)

    if webview_module is None:
        import webview as webview_module

    create_window(port, webview_module=webview_module)
    webview_module.start()
