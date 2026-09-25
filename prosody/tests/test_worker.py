"""Tests for the Supabase analysis worker.

Supabase, yt-dlp and Whisper are all replaced with fakes, so these run
offline with only numpy installed:

    python -m pytest tests/test_worker.py -v
    python tests/test_worker.py          # no pytest required
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prosody_coach.analysis import analyze
from prosody_coach.audio import load_audio
from prosody_coach.models import PitchMovement, Prominence, Recording
from prosody_coach.transcribe import TimedWord, TranscriptionError
from prosody_worker.importer import import_analysis, load_recording
from prosody_worker.jobs import process
from prosody_worker.serialize import to_practice_view
from prosody_worker.sources import ResolvedSource, SourceError, parse_youtube_id, sha256_hex

from tests import synth


_TMP = Path(tempfile.mkdtemp(prefix="prosody_worker_test_"))


def _reference_wav() -> tuple[Path, list[tuple[str, float, float]]]:
    path = _TMP / "ref.wav"
    timings = synth.reference_utterance().write_wav(path)
    return path, timings


def _fake_analyze(path, label, options):
    """Stand-in for analyze_recording: synthetic timings instead of Whisper."""
    _, timings = _reference_wav()
    words = [TimedWord(text, start, end) for (text, start, end) in timings]
    return analyze(load_audio(path), words, synth.reference_utterance().transcript, label)


class FakeStore:
    def __init__(self, audio: dict[str, bytes] | None = None) -> None:
        self.audio = audio or {}
        self.completed: dict[str, dict] = {}
        self.failed: dict[str, str] = {}
        self.uploaded: dict[str, bytes] = {}
        self.upserted: list[dict] = []

    def fetch_pending(self, analyzer_version, limit):
        return []

    def claim(self, row):
        return True

    def download_audio(self, path):
        if path not in self.audio:
            raise FileNotFoundError(path)
        return self.audio[path]

    def complete(self, row_id, fields):
        self.completed[row_id] = fields

    def fail(self, row_id, message):
        self.failed[row_id] = message

    def upload_audio(self, path, data):
        self.uploaded[path] = data

    def upsert_ready(self, fields):
        row = {"id": f"row-{len(self.upserted) + 1}", **fields, "status": "ready"}
        self.upserted.append(row)
        return row


def _upload_row(data: bytes, key: str | None = None) -> dict:
    digest = sha256_hex(data)
    return {
        "id": "row-1",
        "source_type": "upload",
        "source_key": key or f"upload:{digest}",
        "audio_path": f"uploads/{digest}.wav",
        "title": "ref.wav",
        "model_size": "tiny",
    }


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


def test_parse_youtube_id_accepts_common_shapes():
    vid = "dQw4w9WgXcQ"
    for url in (
        f"https://www.youtube.com/watch?v={vid}",
        f"https://youtube.com/watch?v={vid}&t=42s",
        f"https://m.youtube.com/watch?feature=share&v={vid}",
        f"https://youtu.be/{vid}",
        f"https://youtu.be/{vid}?si=abc",
        f"https://www.youtube.com/shorts/{vid}",
        f"https://www.youtube.com/embed/{vid}",
        f"  https://youtu.be/{vid}  ",
    ):
        assert parse_youtube_id(url) == vid, url


def test_parse_youtube_id_rejects_other_urls():
    for url in (
        "",
        "not a url",
        "https://vimeo.com/123456",
        "https://www.youtube.com/watch?v=short",
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/channel/UC1234567890",
    ):
        assert parse_youtube_id(url) is None, url


# --------------------------------------------------------------------------
# View model
# --------------------------------------------------------------------------


def test_practice_view_structure_reproduces_phrase_text():
    path, _ = _reference_wav()
    recording = _fake_analyze(path, "reference", None)
    view = to_practice_view(recording, "Reference")

    assert view["title"] == "Reference"
    assert view["phrases"], "expected at least one phrase"
    assert [p["id"] for p in view["phrases"]] == list(range(1, len(view["phrases"]) + 1))
    for phrase in view["phrases"]:
        assert "".join(part["text"] for part in phrase["structure"]) == phrase["text"]
        assert phrase["durationSeconds"] > 0
        assert phrase["end"] >= phrase["start"]
    assert "pauseMs" not in view["phrases"][-1]


def test_practice_view_accents_only_on_moving_anchors():
    path, _ = _reference_wav()
    recording = _fake_analyze(path, "reference", None)
    view = to_practice_view(recording)

    accented = [
        part["text"].lower()
        for phrase in view["phrases"]
        for part in phrase["structure"]
        if "accent" in part
    ]
    expected = [
        word.text.strip().rstrip(".,").lower()
        for word in recording.words
        if word.prominence is Prominence.ANCHOR
        and word.pitch_movement in (PitchMovement.RISING, PitchMovement.FALLING)
    ]
    assert accented == expected
    assert all(not text.endswith((",", ".")) for text in accented)


# --------------------------------------------------------------------------
# Serialisation
# --------------------------------------------------------------------------


def test_to_dict_maps_nan_to_null():
    path, _ = _reference_wav()
    recording = _fake_analyze(path, "reference", None)
    recording.words[0].pitch_mean_hz = float("nan")
    recording.words[0].pitch_z = float("inf")

    data = recording.to_dict()

    assert data["words"][0]["pitch_mean_hz"] is None
    assert data["words"][0]["pitch_z"] is None
    json.dumps(data, allow_nan=False)  # strict JSON, as Postgres jsonb requires


def test_recording_round_trips_through_dict():
    path, _ = _reference_wav()
    recording = _fake_analyze(path, "reference", None)

    rebuilt = Recording.from_dict(json.loads(json.dumps(recording.to_dict())))

    assert rebuilt.to_dict() == recording.to_dict()
    assert to_practice_view(rebuilt, "t") == to_practice_view(recording, "t")


def test_recording_from_dict_tolerates_unknown_and_null_fields():
    path, _ = _reference_wav()
    data = _fake_analyze(path, "reference", None).to_dict()
    data["new_metric"] = 1.0
    data["words"][0]["new_word_metric"] = 2.0
    data["words"][0]["pitch_z"] = None

    rebuilt = Recording.from_dict(data)

    assert rebuilt.words[0].pitch_z == 0.0
    assert not math.isnan(rebuilt.speech_rate_wps)


# --------------------------------------------------------------------------
# Importer
# --------------------------------------------------------------------------


def _saved_analysis() -> tuple[Path, bytes]:
    path, _ = _reference_wav()
    recording = _fake_analyze(path, "reference", None)
    recording.path = str(_TMP / "private" / "ref.wav")
    json_path = _TMP / "ref.wav.json"
    json_path.write_text(json.dumps(recording.to_dict()), encoding="utf-8")
    return json_path, path.read_bytes()


def test_import_upload_keys_by_audio_hash():
    json_path, data = _saved_analysis()
    store = FakeStore()

    row = import_analysis(store, load_recording(json_path), audio=data, audio_name="ref.wav", title="Ref")

    digest = sha256_hex(data)
    assert row["source_type"] == "upload"
    assert row["source_key"] == f"upload:{digest}"
    assert row["audio_path"] == f"uploads/{digest}.wav"
    assert store.uploaded == {f"uploads/{digest}.wav": data}
    assert row["status"] == "ready"
    assert row["model_size"] == "small"
    assert row["view"]["title"] == "Ref"
    assert row["transcript"] and row["speech_rate_wps"] > 0
    assert row["recording"]["path"] == "ref.wav"
    assert "private" not in json.dumps(row)


def test_import_youtube_keys_by_video_id():
    json_path, _ = _saved_analysis()
    store = FakeStore()

    row = import_analysis(store, load_recording(json_path), youtube_url="https://youtu.be/dQw4w9WgXcQ")

    assert row["source_key"] == "youtube:dQw4w9WgXcQ"
    assert row["recording"]["path"] == "youtube:dQw4w9WgXcQ"
    assert not store.uploaded


def test_import_rejects_bad_youtube_url():
    json_path, _ = _saved_analysis()
    try:
        import_analysis(FakeStore(), load_recording(json_path), youtube_url="https://vimeo.com/1")
    except SourceError:
        pass
    else:
        raise AssertionError("expected SourceError")


# --------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------


def test_upload_job_completes_with_view():
    path, _ = _reference_wav()
    data = path.read_bytes()
    row = _upload_row(data)
    store = FakeStore({row["audio_path"]: data})

    process(row, store, analyze=_fake_analyze)

    assert not store.failed
    fields = store.completed["row-1"]
    assert fields["title"] == "ref.wav"
    assert fields["view"]["phrases"]
    assert fields["recording"]["words"]
    assert fields["duration_seconds"] > 0
    assert fields["transcript"]
    assert fields["speech_rate_wps"] > 0
    assert fields["recording"]["path"] == row["source_key"]
    for column in ("pitch_baseline_hz", "pitch_range_hz", "articulation_rate_wps", "total_pause_time"):
        assert column in fields, column


def test_upload_job_rejects_hash_mismatch():
    path, _ = _reference_wav()
    data = path.read_bytes()
    row = _upload_row(data, key="upload:" + "0" * 64)
    store = FakeStore({row["audio_path"]: data})

    process(row, store, analyze=_fake_analyze)

    assert "row-1" not in store.completed
    assert "does not match" in store.failed["row-1"]


def test_upload_job_rejects_non_wav():
    data = b"ID3" + b"\x00" * 64
    row = _upload_row(data)
    store = FakeStore({row["audio_path"]: data})

    process(row, store, analyze=_fake_analyze)

    assert "not a WAV" in store.failed["row-1"]


def test_missing_upload_marks_failed():
    row = _upload_row(b"RIFF....WAVE")
    store = FakeStore()

    process(row, store, analyze=_fake_analyze)

    assert "Could not read" in store.failed["row-1"]


def test_youtube_job_uses_video_id_and_fetched_title():
    path, _ = _reference_wav()
    seen = []

    def fetch(video_id, dest):
        seen.append(video_id)
        return ResolvedSource(path=path, title="Fetched title")

    row = {"id": "yt", "source_type": "youtube", "source_key": "youtube:dQw4w9WgXcQ", "model_size": "tiny"}
    store = FakeStore()
    process(row, store, analyze=_fake_analyze, fetch_youtube=fetch)

    assert seen == ["dQw4w9WgXcQ"]
    assert store.completed["yt"]["title"] == "Fetched title"
    assert store.completed["yt"]["view"]["title"] == "Fetched title"


def test_youtube_source_error_marks_failed():
    def fetch(video_id, dest):
        raise SourceError("Video is 45 min long")

    row = {"id": "yt", "source_type": "youtube", "source_key": "youtube:dQw4w9WgXcQ"}
    store = FakeStore()
    process(row, store, analyze=_fake_analyze, fetch_youtube=fetch)

    assert store.failed["yt"] == "Video is 45 min long"


def test_transcription_error_marks_failed():
    path, _ = _reference_wav()

    def broken(path, label, options):
        raise TranscriptionError("no speech detected")

    row = {"id": "yt", "source_type": "youtube", "source_key": "youtube:dQw4w9WgXcQ"}
    store = FakeStore()
    process(row, store, analyze=broken, fetch_youtube=lambda vid, dest: ResolvedSource(path=path))

    assert store.failed["yt"] == "no speech detected"


def test_unexpected_error_marks_failed_and_reraises():
    path, _ = _reference_wav()

    def boom(path, label, options):
        raise ValueError("bug")

    row = {"id": "yt", "source_type": "youtube", "source_key": "youtube:dQw4w9WgXcQ"}
    store = FakeStore()
    try:
        process(row, store, analyze=boom, fetch_youtube=lambda vid, dest: ResolvedSource(path=path))
    except ValueError:
        pass
    else:
        raise AssertionError("expected the ValueError to propagate")
    assert "Unexpected" in store.failed["yt"]


# --------------------------------------------------------------------------
# Standalone runner (no pytest required)
# --------------------------------------------------------------------------


def _run_all() -> int:
    tests = [
        (name, obj)
        for name, obj in sorted(globals().items())
        if name.startswith("test_") and callable(obj)
    ]

    passed, failed = 0, []
    for name, fn in tests:
        try:
            fn()
            passed += 1
            print(f"  PASS  {name}")
        except Exception as exc:  # noqa: BLE001
            failed.append((name, exc))
            print(f"  FAIL  {name}: {exc}")

    print(f"\n  {passed} passed, {len(failed)} failed, {len(tests)} total")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
