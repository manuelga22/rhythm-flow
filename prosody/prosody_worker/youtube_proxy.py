"""Residential proxy for YouTube downloads.

YouTube asks datacenter IPs (Modal, cloud VMs) to "sign in to confirm
you're not a bot". Setting PROSODY_YOUTUBE_PROXY to a rotating residential
proxy's HTTP endpoint (http://user:pass@host:port) sends yt-dlp, and nothing
else, through it; each connection gets a new exit IP. Unset means download
directly, which is fine from a home connection.

The variable is read on every call, so it works however the environment was
loaded (Modal secret, shell, or the repo-root .env via prosody_worker.config).
"""

from __future__ import annotations

import os

ENV_VAR = "PROSODY_YOUTUBE_PROXY"


def proxy_url() -> str | None:
    return os.environ.get(ENV_VAR) or None


def with_proxy(options: dict) -> dict:
    """Return yt-dlp ``options`` routed through the proxy, if one is set."""
    url = proxy_url()
    return {**options, "proxy": url} if url else options


def redact(message: str) -> str:
    """Hide the proxy URL, credentials included, in error text. Proxy
    failures can echo it, and that text is stored on the row and shown in
    the UI."""
    url = proxy_url()
    return message.replace(url, "<proxy>") if url else message
