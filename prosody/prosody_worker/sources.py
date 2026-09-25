"""Resolve an analysis row's source to a local audio file.

Two kinds of source exist, matching ``analyses.source_type``:

    youtube   source_key = "youtube:<11-char video id>". The audio is pulled
              with yt-dlp. The URL is rebuilt from the id rather than using
              the pasted ``source_url``, so only YouTube is ever fetched.
    upload    source_key = "upload:<sha256>". The WAV was uploaded by the
              browser to Storage; its bytes are re-hashed here so a client
              cannot attach the wrong audio to someone else's cache key.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from prosody_worker.config import MAX_SOURCE_SECONDS, MAX_UPLOAD_BYTES


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


def download_youtube_audio(video_id: str, dest: Path) -> ResolvedSource:
    """Download a video's audio track as WAV into ``dest``."""
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise SourceError("yt-dlp is not installed; pip install -r requirements-worker.txt") from exc

    url = f"https://www.youtube.com/watch?v={video_id}"
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(dest / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = info.get("duration") or 0
            if duration > MAX_SOURCE_SECONDS:
                raise SourceError(
                    f"Video is {duration // 60} min long; clips must be under "
                    f"{MAX_SOURCE_SECONDS // 60} min."
                )
            ydl.download([url])
    except DownloadError as exc:
        raise SourceError(f"Could not download the YouTube audio: {exc}") from exc

    path = dest / "source.wav"
    if not path.exists():
        raise SourceError("YouTube download produced no WAV; is ffmpeg installed?")
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
