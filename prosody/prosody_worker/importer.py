"""Save an analysis written by the CLI into the ``analyses`` table.

Usage:

    python -m prosody_coach analyze clip.wav --json analyses/clip.wav.json
    python -m prosody_worker.importer analyses/clip.wav.json --audio clip.wav
    python -m prosody_worker.importer analyses/<id>.json --youtube <url>

The row is keyed exactly as the browser would key the same source
(``upload:<sha256>`` or ``youtube:<video id>``), so requesting that source in
the app finds this analysis instead of queueing a new one. Needs
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, like the worker.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from prosody_coach.models import Recording
from prosody_worker.config import ANALYZER_VERSION, DEFAULT_MODEL_SIZE, MAX_UPLOAD_BYTES, WorkerConfig
from prosody_worker.serialize import summary_fields, to_practice_view
from prosody_worker.sources import SourceError, parse_youtube_id, sha256_hex
from prosody_worker.store import AnalysisStore, Row, SupabaseStore

log = logging.getLogger("prosody_worker.importer")


def load_recording(json_path: Path) -> Recording:
    # Files written before NaN was mapped to null still contain bare NaN,
    # which json.loads accepts; to_dict() turns it back into null.
    return Recording.from_dict(json.loads(json_path.read_text(encoding="utf-8")))


def import_analysis(
    store: AnalysisStore,
    recording: Recording,
    *,
    audio: bytes | None = None,
    audio_name: str | None = None,
    youtube_url: str | None = None,
    title: str | None = None,
    model_size: str = DEFAULT_MODEL_SIZE,
) -> Row:
    """Upsert ``recording`` as a ready analysis. Pass either ``audio`` (the
    WAV it was made from) or ``youtube_url``."""
    if (audio is None) == (youtube_url is None):
        raise SourceError("Pass exactly one of an audio file or a YouTube URL.")

    fields: dict[str, Any]
    if audio is not None:
        if len(audio) > MAX_UPLOAD_BYTES:
            raise SourceError("Audio is larger than the 25 MB upload limit.")
        digest = sha256_hex(audio)
        audio_path = f"uploads/{digest}.wav"
        store.upload_audio(audio_path, audio)
        fields = {
            "source_type": "upload",
            "source_key": f"upload:{digest}",
            "audio_path": audio_path,
        }
        # Keep the local directory (and username) out of a world-readable row.
        recording.path = audio_name or Path(recording.path).name
    else:
        video_id = parse_youtube_id(youtube_url or "")
        if not video_id:
            raise SourceError(f"Not a YouTube video link: {youtube_url}")
        fields = {
            "source_type": "youtube",
            "source_key": f"youtube:{video_id}",
            "source_url": youtube_url,
        }
        recording.path = fields["source_key"]

    return store.upsert_ready({
        **fields,
        **summary_fields(recording),
        "title": title,
        "model_size": model_size,
        "analyzer_version": ANALYZER_VERSION,
        "recording": recording.to_dict(),
        "view": to_practice_view(recording, title),
    })


def _default_title(json_path: Path) -> str:
    stem = json_path.name.removesuffix(".json").removesuffix(".wav")
    return stem.replace("_", " ")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="prosody_worker.importer", description=__doc__.split("\n\n")[0])
    parser.add_argument("json_path", type=Path, help="Output of `prosody_coach analyze --json`.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--audio", type=Path, help="The WAV the analysis was made from.")
    source.add_argument("--youtube", metavar="URL", help="The YouTube video the analysis was made from.")
    parser.add_argument("--title", help="Display title (default: from the JSON file name).")
    parser.add_argument(
        "--model", default=DEFAULT_MODEL_SIZE,
        help=f"Whisper model the analysis used (default: {DEFAULT_MODEL_SIZE}).",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    recording = load_recording(args.json_path)
    store = SupabaseStore(WorkerConfig.from_env())
    row = import_analysis(
        store,
        recording,
        audio=args.audio.read_bytes() if args.audio else None,
        audio_name=args.audio.name if args.audio else None,
        youtube_url=args.youtube,
        title=args.title or _default_title(args.json_path),
        model_size=args.model,
    )
    log.info("saved analysis %s (%s, %d words)", row["id"], row["source_key"], len(recording.words))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
