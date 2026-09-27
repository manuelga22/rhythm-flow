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
import threading
import time
import types
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prosody_coach.analysis import analyze
from prosody_coach.audio import encode_clip, load_audio
from prosody_coach.models import Feedback, PitchMovement, Prominence, Recording
from prosody_coach.transcribe import TimedWord, TranscriptionError
from prosody_worker.attempts import NO_SPEECH, process_attempt, reference_excerpt
from prosody_worker.importer import import_analysis, load_recording
from prosody_worker.jobs import process
from prosody_worker.main import poll
from prosody_worker.serialize import to_practice_view
from prosody_worker.sources import (
    ResolvedSource,
    SourceError,
    download_youtube_audio,
    parse_youtube_id,
    sha256_hex,
)

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
        self.references: dict[str, dict] = {}
        self.completed_attempts: dict[str, dict] = {}
        self.failed_attempts: dict[str, str] = {}
        self.completed: dict[str, dict] = {}
        self.failed: dict[str, str] = {}
        self.uploaded: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}
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

    def upload_audio(self, path, data, content_type="audio/wav", upsert=False):
        self.uploaded[path] = data
        self.content_types[path] = content_type

    def upsert_ready(self, fields):
        row = {"id": f"row-{len(self.upserted) + 1}", **fields, "status": "ready"}
        self.upserted.append(row)
        return row

    # AttemptStore
    def fetch_pending_attempts(self, analyzer_version, limit):
        return []

    def claim_attempt(self, row):
        return True

    def fetch_reference(self, analysis_id):
        return self.references.get(analysis_id)

    def download_attempt_audio(self, path):
        return self.download_audio(path)

    def download_clip(self, path):
        return self.download_audio(path)

    def complete_attempt(self, row_id, fields):
        self.completed_attempts[row_id] = fields

    def fail_attempt(self, row_id, message):
        self.failed_attempts[row_id] = message


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


def test_job_stores_a_listening_clip():
    path, _ = _reference_wav()
    data = path.read_bytes()
    row = _upload_row(data)
    store = FakeStore({row["audio_path"]: data})

    process(row, store, analyze=_fake_analyze)

    assert store.completed["row-1"]["clip_path"] == "clips/row-1.ogg"
    assert store.content_types["clips/row-1.ogg"] == "audio/ogg"
    assert store.uploaded["clips/row-1.ogg"][:4] == b"OggS"


def test_clip_failure_still_completes_the_analysis():
    path, _ = _reference_wav()
    data = path.read_bytes()
    row = _upload_row(data)
    store = FakeStore({row["audio_path"]: data})

    def broken_upload(*args, **kwargs):
        raise RuntimeError("storage down")

    store.upload_audio = broken_upload
    process(row, store, analyze=_fake_analyze)

    assert not store.failed
    assert store.completed["row-1"]["clip_path"] is None


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
# Attempts
# --------------------------------------------------------------------------


def _synth_analyzer(utterance: synth.SynthUtterance):
    """analyze_recording stand-in that knows the take's true word timings."""
    _, timings = utterance.render()

    def fake(path, label, options):
        words = [TimedWord(text, start, end) for (text, start, end) in timings]
        return analyze(load_audio(path), words, utterance.transcript, label)

    return fake


def _attempt(utterance: synth.SynthUtterance, phrase_id: int | None = None) -> tuple[dict, FakeStore]:
    ref_path, _ = _reference_wav()
    take_path = _TMP / "take.wav"
    utterance.write_wav(take_path)
    row = {
        "id": "attempt-1",
        "analysis_id": "analysis-1",
        "phrase_id": phrase_id,
        "audio_path": "attempts/00000000-0000-0000-0000-000000000000.wav",
        "model_size": "tiny",
    }
    store = FakeStore({row["audio_path"]: take_path.read_bytes()})
    store.references["analysis-1"] = {
        "recording": _fake_analyze(ref_path, "reference", None).to_dict(),
        "clip_path": None,
    }
    return row, store


def test_matching_take_hits_every_beat():
    row, store = _attempt(synth.good_user_utterance())

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()))

    assert not store.failed_attempts, store.failed_attempts
    fields = store.completed_attempts["attempt-1"]
    result = fields["result"]
    assert result["beats"]["total"] > 0
    assert result["beats"]["matched"] == result["beats"]["total"]
    assert result["pace"]["rateRatio"] > 1  # the good take is 20% slower
    assert result["feedback"]["positive"]
    assert "".join(part["text"] for part in result["reference"]).startswith("I thought")
    assert fields["user_recording"]["words"]
    assert fields["user_recording"]["path"] == row["audio_path"]
    json.dumps(fields, allow_nan=False)  # must be storable as jsonb


def test_flat_take_is_flagged():
    row, store = _attempt(synth.flat_user_utterance())

    process_attempt(row, store, analyze=_synth_analyzer(synth.flat_user_utterance()))

    result = store.completed_attempts["attempt-1"]["result"]
    assert result["feedback"]["primary"]
    assert any(category["verdict"] == "Needs work" for category in result["categories"])
    flags = {word["flag"] for word in result["words"]}
    assert flags & {"extra_stress", "missing_stress"}, flags
    assert any("pauseAfter" in word for word in result["words"])


def test_reference_excerpt_keeps_one_phrase():
    ref_path, _ = _reference_wav()
    recording = Recording.from_dict(_fake_analyze(ref_path, "reference", None).to_dict())
    assert len(recording.phrases) >= 2, "synthetic reference should have a phrase break"
    first = recording.phrases[0]

    excerpt = reference_excerpt(recording, 1)

    assert [w.text for w in excerpt.words] == [w.text for w in first.words]
    assert len(excerpt.phrases) == 1
    assert excerpt.words[-1].pause_after == 0.0
    assert first.words[-1].pause_after > 0, "the source recording is left untouched"
    assert excerpt.articulation_rate_wps > 0
    assert excerpt.speech_rate_wps != recording.speech_rate_wps
    assert reference_excerpt(recording, None) is recording


def test_phrase_attempt_compares_against_that_phrase_only():
    row, store = _attempt(synth.good_user_utterance(), phrase_id=1)

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()))

    result = store.completed_attempts["attempt-1"]["result"]
    reference_text = "".join(part["text"] for part in result["reference"])
    assert "expected" not in reference_text


def test_out_of_range_phrase_fails_cleanly():
    row, store = _attempt(synth.good_user_utterance(), phrase_id=99)

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()))

    assert "no longer part of this clip" in store.failed_attempts["attempt-1"]
    assert not store.completed_attempts


def test_missing_reference_fails_cleanly():
    row, store = _attempt(synth.good_user_utterance())
    store.references.clear()

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()))

    assert "no longer available" in store.failed_attempts["attempt-1"]


def test_silent_take_fails_with_friendly_message():
    row, store = _attempt(synth.good_user_utterance())

    def silent(path, label, options):
        raise TranscriptionError("No speech detected in take.wav.")

    process_attempt(row, store, analyze=silent)

    assert store.failed_attempts["attempt-1"] == NO_SPEECH


def test_unexpected_attempt_error_marks_failed_and_reraises():
    row, store = _attempt(synth.good_user_utterance())

    def boom(path, label, options):
        raise ValueError("bug")

    try:
        process_attempt(row, store, analyze=boom)
    except ValueError:
        pass
    else:
        raise AssertionError("expected the ValueError to propagate")
    assert "Unexpected" in store.failed_attempts["attempt-1"]


GEMINI_CHOICE = {"provider": "gemini", "model": "gemini-3.1-flash-lite", "label": "Gemini Flash-Lite"}


def _listening_attempt(clip: bool = True) -> tuple[dict, FakeStore]:
    row, store = _attempt(synth.good_user_utterance())
    row["feedback_model"] = "gemini-flash-lite"
    row["feedback_models"] = dict(GEMINI_CHOICE)
    if clip:
        ref_path, _ = _reference_wav()
        store.audio["clips/analysis-1.ogg"] = encode_clip(ref_path, _TMP / "ref_clip.ogg").read_bytes()
        store.references["analysis-1"]["clip_path"] = "clips/analysis-1.ogg"
    return row, store


def _spy_listener(calls: list[dict]):
    def listen(comparison, take, reference, model, label=None):
        calls.append({
            "take": take.read_bytes()[:4],
            "reference": None if reference is None else load_audio(reference).duration,
            "model": model,
        })
        return Feedback(
            positive="You landed THOUGHT.", primary_issue="Rush less.", secondary_issue=None,
            next_attempt="Lean into QUICK.", primary_example="REF: QUICK / YOU: quick",
            details="- Keep IT light.", categories=comparison.feedback.categories,
            source="audio", model=label,
        )
    return listen


def test_listening_model_hears_take_and_reference_phrase():
    row, store = _listening_attempt()
    calls: list[dict] = []

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()), listen=_spy_listener(calls))

    assert calls and calls[0]["model"] == "gemini-3.1-flash-lite"
    assert calls[0]["take"] == b"OggS"
    ref_duration = load_audio(_reference_wav()[0]).duration
    assert 0 < calls[0]["reference"] <= ref_duration + 0.1
    feedback = store.completed_attempts["attempt-1"]["result"]["feedback"]
    assert feedback["source"] == "audio"
    assert feedback["model"] == "Gemini Flash-Lite"
    assert feedback["positive"] == "You landed THOUGHT."
    assert feedback["primaryExample"] == "REF: QUICK / YOU: quick"
    assert feedback["secondaryExample"] is None
    assert feedback["details"] == "- Keep IT light."


def test_reference_without_clip_sends_the_take_only():
    row, store = _listening_attempt(clip=False)
    calls: list[dict] = []

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()), listen=_spy_listener(calls))

    assert calls[0]["reference"] is None
    assert store.completed_attempts["attempt-1"]["result"]["feedback"]["source"] == "audio"


def test_listener_failure_keeps_template_feedback():
    row, store = _listening_attempt()

    def broken(*args, **kwargs):
        raise RuntimeError("Gemini returned HTTP 429")

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()), listen=broken)

    result = store.completed_attempts["attempt-1"]["result"]
    assert result["feedback"]["source"] == "template"
    assert result["feedback"]["model"] is None
    assert result["feedback"]["positive"]
    assert result["feedback"]["primaryExample"] is None
    assert result["feedback"]["details"] is None
    assert not any("429" in category["comment"] for category in result["categories"])


def test_standard_model_does_not_listen():
    row, store = _listening_attempt()
    row["feedback_models"] = {"provider": "template", "model": None, "label": "Standard"}
    calls: list[dict] = []

    process_attempt(row, store, analyze=_synth_analyzer(synth.good_user_utterance()), listen=_spy_listener(calls))

    assert not calls
    assert store.completed_attempts["attempt-1"]["result"]["feedback"]["source"] == "template"


def test_take_keeps_its_extension_for_decoding():
    row, store = _attempt(synth.good_user_utterance())
    seen: list[Path] = []
    analyzer = _synth_analyzer(synth.good_user_utterance())

    def spy(path, label, options):
        seen.append(Path(path))
        return analyzer(path, label, options)

    process_attempt(row, store, analyze=spy)

    assert seen[0].suffix == ".wav"


# --------------------------------------------------------------------------
# Worker threads
# --------------------------------------------------------------------------


def test_attempts_are_not_blocked_by_a_long_analysis():
    stop = threading.Event()
    analysis_started = threading.Event()
    release_analysis = threading.Event()
    attempt_done = threading.Event()
    pending_attempts = ["attempt-1"]

    def slow_analysis(store, batch_size):
        analysis_started.set()
        release_analysis.wait(5)
        return 0

    def attempts(store, batch_size):
        if not pending_attempts:
            return 0
        pending_attempts.pop()
        attempt_done.set()
        return 1

    analyses_thread = threading.Thread(target=poll, args=(slow_analysis, None, stop, 0.01))
    attempts_thread = threading.Thread(target=poll, args=(attempts, None, stop, 0.01))
    analyses_thread.start()
    try:
        assert analysis_started.wait(2)
        attempts_thread.start()
        assert attempt_done.wait(2), "the attempt waited behind the analysis"
        assert analyses_thread.is_alive(), "the analysis should still be running"
    finally:
        release_analysis.set()
        stop.set()
        started = time.monotonic()
        analyses_thread.join(2)
        if attempts_thread.is_alive() or attempts_thread.ident:
            attempts_thread.join(2)
    assert not analyses_thread.is_alive() and not attempts_thread.is_alive()
    assert time.monotonic() - started < 2, "loops should stop promptly"


def test_poll_survives_errors_and_once_stops_when_empty():
    results = iter([RuntimeError("connection reset"), 1, 1, 0])
    calls = 0

    def run(store, batch_size):
        nonlocal calls
        calls += 1
        result = next(results)
        if isinstance(result, Exception):
            raise result
        return result

    # A failed poll counts as empty, which ends a --once run...
    poll(run, None, threading.Event(), 0.01, once=True)
    assert calls == 1
    # ...and the next run drains the rest and stops on the empty poll.
    poll(run, None, threading.Event(), 0.01, once=True)
    assert calls == 4


# --------------------------------------------------------------------------
# YouTube download retries (yt-dlp faked in sys.modules)
# --------------------------------------------------------------------------


class _FakeDownloadError(Exception):
    pass


@contextmanager
def _fake_yt_dlp(failures: list[str]):
    """Install a fake yt_dlp whose downloads raise ``failures`` in order,
    then succeed by writing a WAV. Yields the list of options each attempt saw."""
    attempts: list[dict] = []
    ref_path, _ = _reference_wav()

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options
            attempts.append(options)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=False):
            return {"title": "Fake video", "duration": 5}

        def process_ie_result(self, info, download=True):
            out = Path(self.options["outtmpl"].replace("%(ext)s", "wav"))
            out.write_bytes(b"partial")
            if failures:
                raise _FakeDownloadError(failures.pop(0))
            out.write_bytes(ref_path.read_bytes())
            return {**info, "requested_downloads": [{"filepath": str(out)}]}

    yt_dlp = types.ModuleType("yt_dlp")
    yt_dlp.YoutubeDL = FakeYoutubeDL
    utils = types.ModuleType("yt_dlp.utils")
    utils.DownloadError = _FakeDownloadError
    saved = {name: sys.modules.get(name) for name in ("yt_dlp", "yt_dlp.utils")}
    sys.modules["yt_dlp"], sys.modules["yt_dlp.utils"] = yt_dlp, utils
    try:
        yield attempts
    finally:
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


_FORBIDDEN = "ERROR: unable to download video data: HTTP Error 403: Forbidden"


def test_youtube_403_is_retried_until_it_succeeds():
    dest = Path(tempfile.mkdtemp(dir=_TMP))
    with _fake_yt_dlp([_FORBIDDEN, _FORBIDDEN]) as attempts:
        source = download_youtube_audio("dQw4w9WgXcQ", dest)

    assert len(attempts) == 3
    assert source.title == "Fake video"
    assert load_audio(source.path).duration > 0
    # yt-dlp must be allowed to use Node, not only its default Deno.
    assert "node" in attempts[0]["js_runtimes"]
    assert attempts[0]["color"] == {"stdout": "no_color", "stderr": "no_color"}


def test_youtube_403_gives_up_with_a_readable_message():
    dest = Path(tempfile.mkdtemp(dir=_TMP))
    with _fake_yt_dlp([_FORBIDDEN] * 3) as attempts:
        try:
            download_youtube_audio("dQw4w9WgXcQ", dest)
        except SourceError as exc:
            message = str(exc)
        else:
            raise AssertionError("expected a SourceError")

    assert len(attempts) == 3
    assert "HTTP 403" in message
    assert "\x1b" not in message


def test_youtube_other_download_errors_are_not_retried():
    dest = Path(tempfile.mkdtemp(dir=_TMP))
    with _fake_yt_dlp(["ERROR: Video unavailable"]) as attempts:
        try:
            download_youtube_audio("dQw4w9WgXcQ", dest)
        except SourceError as exc:
            assert "Video unavailable" in str(exc)
        else:
            raise AssertionError("expected a SourceError")

    assert len(attempts) == 1


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
