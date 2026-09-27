"""Tests for the prosody coach.

These run entirely on synthetic audio with known ground truth, so they need
no recordings and no transcription model. Run with:

    python -m pytest tests/ -v
    python tests/test_prosody.py        # no pytest required
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prosody_coach.analysis import _syllable_estimate, analyze
from prosody_coach import listen
from prosody_coach.audio import encode_clip, extract_features, load_audio, semitones
from prosody_coach.compare import align_words, compare
from prosody_coach.feedback import generate
from prosody_coach.models import IssueType, PitchMovement, Prominence
from prosody_coach.pipeline import build_comparison
from prosody_coach.render import Glyphs, Style, render_beats, render_report
from prosody_coach.transcribe import TimedWord

from tests import synth


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

_TMP = Path(tempfile.mkdtemp(prefix="prosody_test_"))


def build(utterance: synth.SynthUtterance, label: str):
    """Synthesise, write, load and analyse one utterance."""
    path = _TMP / f"{label}.wav"
    timings = utterance.write_wav(path)
    signal = load_audio(path)
    words = [TimedWord(text, start, end) for (text, start, end) in timings]
    return analyze(signal, words, utterance.transcript, label)


def reference():
    return build(synth.reference_utterance(), "ref")


def flat_user():
    return build(synth.flat_user_utterance(), "flat")


def good_user():
    return build(synth.good_user_utterance(), "good")


# --------------------------------------------------------------------------
# Audio layer
# --------------------------------------------------------------------------


def test_pitch_tracker_recovers_known_f0():
    """The autocorrelation tracker should recover a synthesised F0."""
    for target in (90.0, 120.0, 180.0, 240.0):
        utterance = synth.SynthUtterance(words=[
            synth.SynthWord("tone", duration=0.5, f0_start=target, amplitude=0.4)
        ])
        path = _TMP / f"tone_{int(target)}.wav"
        utterance.write_wav(path)
        track = extract_features(load_audio(path))
        measured = float(np.median(track.voiced_f0))
        error = abs(measured - target) / target
        assert error < 0.03, f"F0 {target} Hz measured as {measured:.1f} Hz"


def test_unvoiced_frames_are_excluded():
    """Silence must not be recorded as 0 Hz and drag the mean down."""
    utterance = synth.SynthUtterance(words=[
        synth.SynthWord("a", duration=0.3, f0_start=150, amplitude=0.4, pause_after=0.4),
        synth.SynthWord("b", duration=0.3, f0_start=150, amplitude=0.4),
    ])
    path = _TMP / "gap.wav"
    utterance.write_wav(path)
    track = extract_features(load_audio(path))
    voiced = track.voiced_f0
    assert len(voiced) > 0
    assert voiced.min() > 100.0, "silence leaked into the pitch track"


def test_semitones_are_speaker_relative():
    """The same relative rise is the same semitone distance at any base."""
    low = semitones(120.0, 100.0)
    high = semitones(240.0, 200.0)
    assert math.isclose(float(low), float(high), abs_tol=1e-9)


def test_resampling_preserves_duration():
    from prosody_coach.audio import _resample

    data = np.zeros(16000, dtype=np.float32)
    out = _resample(data, 16000, 8000)
    assert abs(len(out) - 8000) <= 1


def _write_compressed_tone(path: Path, codec: str, hz: float = 200.0, seconds: float = 1.0) -> None:
    """Encode a stereo 44.1 kHz tone with PyAV, standing in for a YouTube download."""
    import av

    rate = 44100
    t = np.arange(int(rate * seconds)) / rate
    tone = (0.5 * np.sin(2 * np.pi * hz * t)).astype(np.float32)
    with av.open(str(path), mode="w") as container:
        stream = container.add_stream(codec, rate=rate, layout="stereo")
        # Planar float, one row per channel, fed in 1024-sample frames.
        planar = np.stack([tone, tone])
        for start in range(0, planar.shape[1], 1024):
            frame = av.AudioFrame.from_ndarray(
                np.ascontiguousarray(planar[:, start:start + 1024]), format="fltp", layout="stereo"
            )
            frame.sample_rate = rate
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)


def test_compressed_audio_is_decoded_without_ffmpeg():
    """m4a/AAC (YouTube's usual audio) decodes in-process to 16 kHz mono."""
    from prosody_coach.audio import decode_to_wav

    source = _TMP / "tone.m4a"
    _write_compressed_tone(source, "aac")

    signal = load_audio(source)
    assert signal.sample_rate == 16000
    assert signal.samples.ndim == 1
    # AAC adds encoder padding, so allow a little slack on duration.
    assert abs(signal.duration - 1.0) < 0.1
    assert float(np.max(np.abs(signal.samples))) > 0.3

    wav = decode_to_wav(source, _TMP / "tone_decoded.wav")
    track = extract_features(load_audio(wav))
    assert abs(float(np.median(track.voiced_f0)) - 200.0) < 5.0


# --------------------------------------------------------------------------
# Analysis layer
# --------------------------------------------------------------------------


def test_reference_anchors_match_the_spec_example():
    """THOUGHT -> QUICK -> LONGER are the three beats."""
    recording = reference()
    anchors = [w.normalized for w in recording.anchors]
    assert anchors == ["thought", "quick", "longer"], anchors


def test_reference_bridges_are_the_function_word_runs():
    recording = reference()
    bridges = [
        " ".join(w.normalized for w in run)
        for phrase in recording.phrases
        for run in phrase.bridges
    ]
    assert "it'd be" in bridges, bridges


def test_phrase_segmentation_splits_at_the_pause():
    recording = reference()
    assert len(recording.phrases) == 2, [p.text for p in recording.phrases]
    assert "quick" in recording.phrases[0].text.lower()


def test_pause_is_detected_with_correct_duration():
    recording = reference()
    paused = [w for w in recording.words if w.pause_after > 0]
    assert len(paused) == 1
    assert paused[0].normalized == "quick"
    assert 0.24 < paused[0].pause_after < 0.33, paused[0].pause_after


def test_every_recording_gets_at_least_one_anchor():
    """A completely flat utterance still needs a beat assigned."""
    utterance = synth.SynthUtterance(words=[
        synth.SynthWord(w, duration=0.2, f0_start=130, amplitude=0.3)
        for w in ("one", "two", "three", "four")
    ])
    recording = build(utterance, "monotone")
    assert len(recording.anchors) >= 1


def test_speaker_normalisation_is_pitch_independent():
    """A higher voice with the same rhythm yields the same anchors."""
    ref_anchors = [w.normalized for w in reference().anchors]
    user_anchors = [w.normalized for w in good_user().anchors]
    assert ref_anchors == user_anchors


def test_pitch_spike_alone_does_not_create_a_beat():
    """A short function word with a tall pitch spike is a boundary reset.

    Real speakers reset their pitch upward when starting a new thought
    group. Scoring that as prominence produced spurious anchors on words
    like "it" at phrase starts, so the model requires duration to
    corroborate a pitch cue.
    """
    utterance = synth.SynthUtterance(words=[
        synth.SynthWord("keep",  duration=0.34, f0_start=150, amplitude=0.42,
                        pause_after=0.30),
        # Short, quiet, but pitched far above everything else.
        synth.SynthWord("it",    duration=0.08, f0_start=260, amplitude=0.16),
        synth.SynthWord("going", duration=0.32, f0_start=150, amplitude=0.42),
    ])
    recording = build(utterance, "reset")
    spike = next(w for w in recording.words if w.normalized == "it")

    assert spike.pitch_z > 1.0, "fixture should produce a tall pitch spike"
    assert spike.prominence is not Prominence.ANCHOR, (
        f"pitch spike alone became a beat (score {spike.prominence_score:.2f})"
    )


def test_long_and_high_words_still_become_beats():
    """The damping must not suppress genuine prominence."""
    recording = reference()
    for beat in ("thought", "quick", "longer"):
        word = next(w for w in recording.words if w.normalized == beat)
        assert word.prominence is Prominence.ANCHOR, beat


def test_syllable_estimate():
    cases = {
        "the": 1, "be": 1, "quick": 1, "longer": 2,
        "expected": 3, "rhythm": 2, "I": 1, "prosody": 3,
    }
    for word, expected in cases.items():
        assert _syllable_estimate(word) == expected, f"{word} -> {_syllable_estimate(word)}"


def test_function_word_detection():
    from prosody_coach.models import Word

    assert Word("the", 0, 1).is_function_word
    assert Word("it'd", 0, 1).is_function_word
    assert not Word("quick", 0, 1).is_function_word
    assert not Word("expected", 0, 1).is_function_word


def test_pitch_movement_direction():
    """A falling glide should be classified as falling."""
    utterance = synth.SynthUtterance(words=[
        synth.SynthWord("fall", duration=0.4, f0_start=200, f0_end=120, amplitude=0.4),
    ])
    recording = build(utterance, "fall")
    assert recording.words[0].pitch_movement is PitchMovement.FALLING

    utterance = synth.SynthUtterance(words=[
        synth.SynthWord("rise", duration=0.4, f0_start=120, f0_end=200, amplitude=0.4),
    ])
    recording = build(utterance, "rise")
    assert recording.words[0].pitch_movement is PitchMovement.RISING


# --------------------------------------------------------------------------
# Alignment and comparison
# --------------------------------------------------------------------------


def test_alignment_pairs_identical_transcripts():
    ref, user = reference(), good_user()
    pairs = align_words(ref, user)
    assert len(pairs) == len(ref.words)
    for pair in pairs:
        assert pair.reference is not None and pair.user is not None
        assert pair.reference.normalized == pair.user.normalized


def test_alignment_handles_differing_words():
    """The flat user says "it would be" where the reference says "it'd be"."""
    ref, user = reference(), flat_user()
    pairs = align_words(ref, user)
    matched = [p for p in pairs if p.reference and p.user]
    assert len(matched) >= 10
    # Anchor words must still line up despite the insertion.
    texts = {p.reference.normalized for p in matched}
    assert {"thought", "quick", "longer"} <= texts


def test_rate_ratio_detects_a_slower_speaker():
    comparison = compare(reference(), good_user())
    # The good user is synthesised 20 percent slower.
    assert 1.1 < comparison.rate_ratio < 1.35, comparison.rate_ratio


def test_good_user_is_not_penalised_for_being_slower():
    """Rate normalisation must not turn slowness into a rhythm error."""
    comparison = compare(reference(), good_user())
    rhythm = [i for i in comparison.issues if i.type is IssueType.RHYTHM_MISMATCH]
    bridges = [i for i in comparison.issues if i.type is IssueType.BRIDGE_TOO_LONG]
    assert not rhythm, [i.detail for i in rhythm]
    assert not bridges, [i.detail for i in bridges]


def test_flat_user_triggers_a_rhythm_issue():
    comparison = compare(reference(), flat_user())
    rhythm = [i for i in comparison.issues if i.type is IssueType.RHYTHM_MISMATCH]
    assert rhythm, "flat delivery was not detected"
    assert rhythm[0].severity > 0.3


def test_flat_user_bridges_are_flagged_as_too_long():
    comparison = compare(reference(), flat_user())
    bridges = [i for i in comparison.issues if i.type is IssueType.BRIDGE_TOO_LONG]
    assert bridges, "stretched bridges were not detected"
    assert all(i.detail["user_relative_duration"] > 1.4 for i in bridges)


def test_inserted_pauses_are_detected():
    comparison = compare(reference(), flat_user())
    inserted = [i for i in comparison.issues if i.type is IssueType.PAUSE_INSERTED]
    assert inserted, "inserted pauses were not detected"
    after = {i.detail["after_word"] for i in inserted}
    assert after & {"it", "but"}, after


def test_issues_are_ranked_by_spec_priority():
    comparison = compare(reference(), flat_user())
    priorities = [i.priority for i in comparison.issues]
    assert priorities == sorted(priorities), priorities
    assert comparison.issues[0].type is IssueType.RHYTHM_MISMATCH


# --------------------------------------------------------------------------
# Feedback layer
# --------------------------------------------------------------------------


def test_feedback_reports_at_most_two_issues():
    comparison = build_comparison(reference(), flat_user())
    feedback = comparison.feedback
    reported = [x for x in (feedback.primary_issue, feedback.secondary_issue) if x]
    assert len(reported) <= 2


def test_feedback_always_has_a_positive_and_an_instruction():
    for user in (flat_user(), good_user()):
        comparison = build_comparison(reference(), user)
        assert comparison.feedback.positive.strip()
        assert comparison.feedback.next_attempt.strip()


def test_feedback_avoids_bare_generic_praise():
    """The spec rejects "Nice!" style feedback with no observation."""
    banned = {"nice", "great", "good job", "sounds good", "well done"}
    for user in (flat_user(), good_user()):
        comparison = build_comparison(reference(), user)
        positive = comparison.feedback.positive.strip().lower().rstrip("!.")
        assert positive not in banned, positive
        assert len(positive.split()) > 3, positive


def test_feedback_never_repeats_the_same_sentence():
    """Two slots must carry two different corrections.

    A word occurring twice in one sentence produced two issues with
    identical wording, which wasted one of the two correction slots the
    spec allows.
    """
    for user in (flat_user(), good_user()):
        feedback = build_comparison(reference(), user).feedback
        if feedback.primary_issue and feedback.secondary_issue:
            assert feedback.primary_issue.strip().lower() != (
                feedback.secondary_issue.strip().lower()
            ), feedback.primary_issue


def test_repeated_words_are_disambiguated_by_context():
    """A repeated word should be quoted with a neighbour."""
    from prosody_coach.feedback import _context_phrase

    comparison = build_comparison(reference(), flat_user())
    indices = [
        i for i, p in enumerate(comparison.pairs)
        if p.user is not None and p.user.normalized == "it"
    ]
    assert len(indices) >= 2, "fixture should repeat 'it'"

    phrases = {_context_phrase(comparison, "it", i) for i in indices}
    phrases.discard(None)
    assert len(phrases) >= 2, f"context did not disambiguate: {phrases}"
    assert all(len(p.split()) >= 2 for p in phrases), phrases


def test_feedback_does_not_contradict_itself():
    """Praise must not cite the same thing the correction criticises."""
    comparison = build_comparison(reference(), flat_user())
    feedback = comparison.feedback
    if feedback.primary_issue and "same weight" in feedback.primary_issue:
        assert "matched the reference" not in feedback.positive


def test_good_user_gets_anchor_praise():
    comparison = build_comparison(reference(), good_user())
    positive = comparison.feedback.positive.upper()
    assert any(beat in positive for beat in ("THOUGHT", "QUICK", "LONGER")), positive


def test_category_verdicts_cover_four_dimensions():
    comparison = build_comparison(reference(), flat_user())
    names = [c.name for c in comparison.feedback.categories]
    assert names == ["Rhythm", "Reduction", "Pausing", "Intonation"]


def test_template_feedback_is_deterministic():
    ref, user = reference(), flat_user()
    first = generate(compare(ref, user), use_llm=False)
    second = generate(compare(ref, user), use_llm=False)
    assert first.positive == second.positive
    assert first.primary_issue == second.primary_issue
    assert first.next_attempt == second.next_attempt


# --------------------------------------------------------------------------
# Rendering and serialisation
# --------------------------------------------------------------------------


def test_report_renders_without_ansi_or_unicode():
    comparison = build_comparison(reference(), flat_user())
    style = Style(enabled=False, glyphs=Glyphs(unicode_ok=False))
    report = render_report(comparison, style, verbose=True)
    assert "\033[" not in report
    report.encode("ascii")   # must not raise


def test_report_includes_the_feedback_sections():
    comparison = build_comparison(reference(), flat_user())
    style = Style(enabled=False, glyphs=Glyphs(unicode_ok=False))
    report = render_report(comparison, style)
    for heading in ("REFERENCE", "YOU", "RHYTHM", "FEEDBACK", "Good:", "Try next:"):
        assert heading in report, heading


def test_beat_rendering_shows_anchors_in_caps():
    style = Style(enabled=False, glyphs=Glyphs(unicode_ok=False))
    beats = render_beats(reference(), style)
    assert "THOUGHT" in beats and "QUICK" in beats and "LONGER" in beats


def test_comparison_serialises_to_json():
    import json

    comparison = build_comparison(reference(), flat_user())
    payload = json.loads(comparison.to_json())
    assert payload["reference"]["transcript"]
    assert payload["feedback"]["positive"]
    assert isinstance(payload["issues"], list)
    # Enums must be plain strings, not Python repr.
    assert payload["reference"]["words"][0]["prominence"] in {"anchor", "mid", "bridge"}


def test_llm_falls_back_to_templates_without_a_key(monkeypatch=None):
    import os

    saved = os.environ.pop("ANTHROPIC_API_KEY", None)
    try:
        comparison = compare(reference(), flat_user())
        feedback = generate(comparison, use_llm=True)
        assert feedback.source == "template"
        assert feedback.positive.strip()
    finally:
        if saved is not None:
            os.environ["ANTHROPIC_API_KEY"] = saved


# --------------------------------------------------------------------------
# Listening feedback (Gemini)
# --------------------------------------------------------------------------


def _clips() -> tuple[Path, Path]:
    ref_wav, take_wav = _TMP / "listen_ref.wav", _TMP / "listen_take.wav"
    synth.reference_utterance().write_wav(ref_wav)
    synth.flat_user_utterance().write_wav(take_wav)
    return encode_clip(ref_wav, _TMP / "listen_ref.ogg"), encode_clip(take_wav, _TMP / "listen_take.ogg")


class _FakeResponse:
    def __init__(self, status_code: int, body: dict) -> None:
        self.status_code = status_code
        self._body = body
        self.text = json.dumps(body)

    def json(self) -> dict:
        return self._body


@contextmanager
def _gemini(status_code: int = 200, body: dict | None = None, key: str | None = "test-key"):
    """Stub httpx.post and GEMINI_API_KEY; yields the captured requests."""
    import httpx

    calls: list[dict] = []
    reply = {
        "positive": "You landed THOUGHT.",
        "primary_issue": "You gave IT a beat.",
        "secondary_issue": None,
        "next_attempt": "Lean into QUICK.",
    }
    body = body if body is not None else {"candidates": [{"content": {"parts": [{"text": json.dumps(reply)}]}}]}

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _FakeResponse(status_code, body)

    saved_post, saved_key = httpx.post, os.environ.pop("GEMINI_API_KEY", None)
    httpx.post = fake_post
    if key:
        os.environ["GEMINI_API_KEY"] = key
    try:
        yield calls
    finally:
        httpx.post = saved_post
        os.environ.pop("GEMINI_API_KEY", None)
        if saved_key is not None:
            os.environ["GEMINI_API_KEY"] = saved_key


def test_encode_clip_slices_and_compresses():
    wav = _TMP / "clip_src.wav"
    synth.reference_utterance().write_wav(wav)

    whole = encode_clip(wav, _TMP / "clip_whole.ogg")
    part = encode_clip(wav, _TMP / "clip_part.ogg", start=0.5, end=1.5)

    assert whole.read_bytes()[:4] == b"OggS"
    assert whole.stat().st_size < wav.stat().st_size / 3
    assert abs(load_audio(whole).duration - load_audio(wav).duration) < 0.05
    assert abs(load_audio(part).duration - 1.0) < 0.05


def test_listen_prompt_is_the_markdown_file_plus_reply_format():
    prompt = listen.system_prompt()

    assert prompt.startswith(listen.PROMPT_PATH.read_text(encoding="utf-8").strip())
    assert prompt.rstrip().endswith(listen.OUTPUT_FORMAT.rstrip())
    for key in ("positive", "primary_issue", "secondary_issue", "next_attempt"):
        assert f'"{key}"' in prompt


def test_listen_sends_both_clips_and_the_measurements():
    ref, take = _clips()
    comparison = build_comparison(reference(), flat_user())

    with _gemini() as calls:
        feedback = listen.listen_feedback(comparison, take, ref, "gemini-3.1-flash-lite", label="Gemini Flash-Lite")

    request = calls[0]
    assert request["url"].endswith("/models/gemini-3.1-flash-lite:generateContent")
    assert request["headers"]["x-goog-api-key"] == "test-key"
    body = request["json"]
    parts = body["contents"][0]["parts"]
    audio = [part["inline_data"] for part in parts if "inline_data" in part]
    assert [clip["mime_type"] for clip in audio] == ["audio/ogg", "audio/ogg"]
    assert "Audio 1" in parts[0]["text"]
    assert "reference_beats" in parts[-1]["text"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert "prosody coach" in body["system_instruction"]["parts"][0]["text"]

    assert feedback.source == "audio"
    assert feedback.model == "Gemini Flash-Lite"
    assert feedback.positive == "You landed THOUGHT."
    assert feedback.secondary_issue is None
    assert feedback.categories == comparison.feedback.categories


def test_listen_without_reference_says_so():
    _, take = _clips()
    comparison = build_comparison(reference(), flat_user())

    with _gemini() as calls:
        listen.listen_feedback(comparison, take, None, "gemini-3.1-flash-lite")

    parts = calls[0]["json"]["contents"][0]["parts"]
    assert sum("inline_data" in part for part in parts) == 1
    assert "No reference audio" in parts[0]["text"]


def test_listen_raises_on_http_error_and_missing_key():
    _, take = _clips()
    comparison = build_comparison(reference(), flat_user())

    for kwargs in ({"status_code": 429, "body": {"error": "quota"}}, {"key": None}, {"body": {"candidates": []}}):
        with _gemini(**kwargs):
            try:
                listen.listen_feedback(comparison, take, None, "gemini-3.1-flash-lite")
            except RuntimeError:
                continue
            raise AssertionError(f"expected RuntimeError for {kwargs}")


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
