"""Resolve an analysis row's source to a local audio file.

Two of the kinds of source in ``analyses.source_type`` are fetched here (the
third, ``generated``, is created by ``prosody_worker/generate.py``):

    youtube   source_key = "youtube:<11-char video id>". The audio is pulled
              with yt-dlp and decoded to WAV with PyAV. The URL is rebuilt
              from the id rather than using the pasted ``source_url``, so
              only YouTube is ever fetched.
    upload    source_key = "upload:<sha256>". The WAV was uploaded by the
              browser to Storage; its bytes are re-hashed here so a client
              cannot attach the wrong audio to someone else's cache key.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from prosody_coach.audio import AudioError, decode_to_wav
from prosody_worker import youtube_proxy
from prosody_worker.config import MAX_SOURCE_SECONDS, MAX_UPLOAD_BYTES


log = logging.getLogger(__name__)

# YouTube signs stream URLs through a JavaScript challenge. yt-dlp only
# enables Deno by default; Node is what this repo already requires for the
# web app, so allow any of them. Without one, downloads 403 intermittently.
JS_RUNTIMES = ("deno", "node", "bun")

# Each attempt re-extracts, which gets freshly signed stream URLs and, through
# a rotating proxy, a new exit IP.
YOUTUBE_ATTEMPTS = 3

# YouTube's "Sign in to confirm you're not a bot" page, served to IPs it
# distrusts (datacenters such as Modal's). It has used both apostrophes.
_BOT_CHECK_MARKERS = ("confirm you're not a bot", "confirm you’re not a bot")
BOT_CHECK_MESSAGE = (
    "YouTube blocked the download as automated traffic. Try again in a few "
    "minutes, or upload the audio file instead."
)


class SourceError(RuntimeError):
    """Raised when a source cannot be fetched or fails validation."""


@dataclass
class ResolvedSource:
    path: Path
    title: str | None = None


_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}


def parse_youtube_id(url: str) -> str | None:
    """Extract the video id from the common YouTube URL shapes.

    Mirrors ``youtubeId`` in ``src/lib/analysis.ts``; the two must agree on
    what counts as the same video or the cache key splits.
    """
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    candidate: str | None = None

    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host in _YOUTUBE_HOSTS:
        if parsed.path == "/watch":
            candidate = (parse_qs(parsed.query).get("v") or [None])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
                candidate = parts[1]

    if candidate and _VIDEO_ID.match(candidate):
        return candidate
    return None


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_bot_check(message: str) -> bool:
    return any(marker in message for marker in _BOT_CHECK_MARKERS)


def download_youtube_audio(video_id: str, dest: Path) -> ResolvedSource:
    """Download a video's audio track as WAV into ``dest``."""
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise SourceError("yt-dlp is not installed; pip install -r requirements-worker.txt") from exc

    url = f"https://www.youtube.com/watch?v={video_id}"
    # No yt-dlp postprocessors: those shell out to the ffmpeg and ffprobe
    # executables. A single audio-only stream needs no merging, and PyAV
    # decodes it to WAV below.
    options = youtube_proxy.with_proxy({
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": str(dest / "download.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "js_runtimes": {name: {} for name in JS_RUNTIMES},
        # Error text ends up in the row and the UI; keep ANSI codes out of it.
        "color": {"stdout": "no_color", "stderr": "no_color"},
    })

    for attempt in range(1, YOUTUBE_ATTEMPTS + 1):
        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=False)
                duration = info.get("duration") or 0
                if duration > MAX_SOURCE_SECONDS:
                    raise SourceError(
                        f"Video is {duration // 60} min long; clips must be under "
                        f"{MAX_SOURCE_SECONDS // 60} min."
                    )
                # Reuse the metadata already fetched instead of resolving the URL again.
                info = ydl.process_ie_result(info, download=True)
            break
        except DownloadError as exc:
            message = youtube_proxy.redact(str(exc))
            bot_check = _is_bot_check(message)
            if not bot_check and "HTTP Error 403" not in message:
                raise SourceError(f"Could not download the YouTube audio: {message}") from exc
            if bot_check and not youtube_proxy.proxy_url() and attempt == 1:
                log.warning(
                    "YouTube bot check for %s; set %s to download through a residential proxy",
                    video_id, youtube_proxy.ENV_VAR,
                )
            if attempt == YOUTUBE_ATTEMPTS:
                if bot_check:
                    raise SourceError(BOT_CHECK_MESSAGE) from exc
                raise SourceError(
                    "YouTube refused the download (HTTP 403). Try again in a minute."
                ) from exc
            log.warning(
                "YouTube %s for %s (attempt %d/%d), retrying",
                "bot check" if bot_check else "403", video_id, attempt, YOUTUBE_ATTEMPTS,
            )
            for partial in dest.glob("download.*"):
                partial.unlink(missing_ok=True)

    downloads = info.get("requested_downloads") or []
    downloaded = Path(downloads[0]["filepath"]) if downloads else None
    if downloaded is None or not downloaded.exists():
        raise SourceError("YouTube download produced no audio file.")

    try:
        path = decode_to_wav(downloaded, dest / "source.wav")
    except AudioError as exc:
        raise SourceError(f"Could not decode the YouTube audio: {exc}") from exc
    return ResolvedSource(path=path, title=info.get("title"))


def verify_upload(data: bytes, source_key: str, dest: Path) -> ResolvedSource:
    """Check uploaded bytes against their content-addressed key and write
    them to ``dest``."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise SourceError("Uploaded file is larger than 25 MB.")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise SourceError("Uploaded file is not a WAV file.")
    expected = source_key.removeprefix("upload:")
    if sha256_hex(data) != expected:
        raise SourceError("Uploaded audio does not match its source key.")

    path = dest / "source.wav"
    path.write_bytes(data)
    return ResolvedSource(path=path)
