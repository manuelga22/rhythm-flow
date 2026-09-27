"""Tests for AI-generated clips (prosody_worker/generate.py).

Gemini and ElevenLabs are replaced with a fake httpx, so these run offline:

    python -m pytest tests/test_generate.py -v
    python tests/test_generate.py          # no pytest required
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prosody_worker import generate
from prosody_worker.sources import SourceError

_TMP = Path(tempfile.mkdtemp(prefix="prosody_generate_test_"))

VOICES = [
    {"voice_id": "v-brit", "name": "Oliver", "labels": {"accent": "british", "gender": "male", "age": "old"}},
    {"voice_id": "v-us-f", "name": "Sarah", "labels": {"accent": "American", "gender": "female", "age": "young"}},
    {"voice_id": "v-us-m", "name": "Brian", "labels": {"accent": "american (southern)", "gender": "male", "age": "middle aged"}},
]
SCRIPT = " ".join(["word"] * 110)
MP3 = b"ID3fake-mp3-bytes"


class _Response:
    def __init__(self, status_code: int, body: dict | None = None, content: bytes = b"") -> None:
        self.status_code = status_code
        self._body = body or {}
        self.content = content
        self.text = json.dumps(self._body)

    def json(self) -> dict:
        return self._body


@contextmanager
def _apis(voices=None, reply=None, tts_status=200, keys=("GEMINI_API_KEY", "ELEVENLABS_API_KEY")):
    """Fake httpx for both APIs; yields the captured calls."""
    import httpx

    calls: list[dict] = []
    answer = {"title": "Last Train Out", "script": SCRIPT, "voice_id": "v-us-m", **(reply or {})}

    def fake_get(url, **kwargs):
        calls.append({"method": "GET", "url": url, **kwargs})
        return _Response(200, {"voices": VOICES if voices is None else voices})

    def fake_post(url, **kwargs):
        calls.append({"method": "POST", "url": url, **kwargs})
        if "generativelanguage" in url:
            return _Response(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})
        return _Response(tts_status, {"detail": "quota"} if tts_status != 200 else None, MP3 if tts_status == 200 else b"")

    saved = (httpx.get, httpx.post, {name: os.environ.pop(name, None) for name in ("GEMINI_API_KEY", "ELEVENLABS_API_KEY")})
    httpx.get, httpx.post = fake_get, fake_post
    for name in keys:
        os.environ[name] = "test-key"
    try:
        yield calls
    finally:
        httpx.get, httpx.post = saved[0], saved[1]
        for name, value in saved[2].items():
            os.environ.pop(name, None)
            if value is not None:
                os.environ[name] = value


def test_only_american_voices_are_offered():
    with _apis():
        voices = generate.list_voices()

    assert [voice["name"] for voice in voices] == ["Sarah", "Brian"]


def test_all_voices_are_offered_when_none_are_american():
    with _apis(voices=[VOICES[0]]):
        voices = generate.list_voices()

    assert [voice["voice_id"] for voice in voices] == ["v-brit"]


def test_generate_clip_writes_voices_and_saves():
    with _apis() as calls:
        clip = generate.generate_clip(_TMP)

    assert clip.path.read_bytes() == MP3
    assert clip.generation["movie"] in generate.MOVIES
    assert clip.generation["title"] == f"Last Train Out · Inspired by {clip.generation['movie']}"
    assert clip.generation["voice_name"] == "Brian"
    assert clip.generation["script"] == SCRIPT

    gemini = next(call for call in calls if "generativelanguage" in call["url"])
    prompt = gemini["json"]["system_instruction"]["parts"][0]["text"]
    assert '"voice_id"' in prompt and "inspired by" in prompt.lower()
    user_text = gemini["json"]["contents"][0]["parts"][0]["text"]
    assert clip.generation["movie"] in user_text and "v-brit" not in user_text

    tts = next(call for call in calls if "text-to-speech" in call["url"])
    assert tts["url"].endswith("/v1/text-to-speech/v-us-m")
    assert tts["params"]["output_format"].startswith("mp3")
    assert tts["json"]["text"] == SCRIPT
    assert tts["headers"]["xi-api-key"] == "test-key"


def test_unknown_voice_falls_back_to_the_first_offered():
    with _apis(reply={"voice_id": "made-up"}):
        clip = generate.generate_clip(_TMP)

    assert clip.generation["voice_id"] == "v-us-f"


def test_failures_raise_a_readable_source_error():
    cases = (
        {"reply": {"script": "far too short"}},
        {"tts_status": 429},
        {"keys": ("GEMINI_API_KEY",)},
        {"keys": ("ELEVENLABS_API_KEY",)},
        {"voices": []},
    )
    for kwargs in cases:
        with _apis(**kwargs):
            try:
                generate.generate_clip(_TMP)
            except SourceError as exc:
                assert str(exc) == generate.FAILED
                continue
        raise AssertionError(f"expected SourceError for {kwargs}")


# --------------------------------------------------------------------------
# Standalone runner (no pytest required)
# --------------------------------------------------------------------------


def _run_all() -> int:
    tests = [(name, obj) for name, obj in sorted(globals().items()) if name.startswith("test_") and callable(obj)]
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
