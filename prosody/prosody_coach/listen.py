"""Feedback written by a Gemini model that listens to the audio.

The model hears the native reference phrase and the learner's take, and
also gets the measured comparison (the same facts the templates use), so
what it says stays anchored to the acoustics instead of its impressions
alone. The coaching instructions live in ``prompts/listen_feedback.md`` so
they can be edited without touching code; the reply format stays here,
next to the parser that depends on it.

Any failure raises, and callers fall back to the template feedback.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from prosody_coach.feedback import _llm_payload, _parse_json_object
from prosody_coach.models import Comparison, Feedback

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "listen_feedback.md"

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_SECONDS = 30.0

OUTPUT_FORMAT = """\

## Reply format

Respond with a JSON object containing exactly these keys:
  "positive"        - one specific thing the learner did well, citing a real word
  "primary_issue"   - the most important correction, or null if none
  "secondary_issue" - a second correction, or null
  "next_attempt"    - one concrete instruction for the next take
"""

MIME_TYPES = {
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".flac": "audio/flac",
}


def system_prompt() -> str:
    """The editable coaching prompt followed by the fixed reply format.

    Read on every call: the file is tiny, and edits apply without a restart.
    """
    try:
        text = PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"feedback prompt is missing: {PROMPT_PATH}") from exc
    if not text:
        raise RuntimeError(f"feedback prompt is empty: {PROMPT_PATH}")
    return text + "\n" + OUTPUT_FORMAT


def build_request(comparison: Comparison, take: Path, reference: Path | None) -> dict:
    """The generateContent body: labelled audio parts, then the measurements."""
    parts: list[dict] = []
    if reference is not None:
        parts += [{"text": "Audio 1: the native reference phrase."}, _audio_part(reference)]
    else:
        parts.append({"text": "No reference audio is available for this clip; only the learner's take is attached."})
    parts += [
        {"text": "Audio 2: the learner's take."},
        _audio_part(take),
        {"text": "Measurements:\n\n" + json.dumps(_llm_payload(comparison), indent=2)},
    ]
    return {
        "system_instruction": {"parts": [{"text": system_prompt()}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json"},
    }


def listen_feedback(
    comparison: Comparison,
    take: Path,
    reference: Path | None,
    model: str,
    label: str | None = None,
) -> Feedback:
    """Ask ``model`` to listen to the take (and reference) and word the feedback.

    The template categories are kept: they are measured verdicts, not prose.
    """
    import httpx

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")

    response = httpx.post(
        GEMINI_URL.format(model=model),
        headers={"x-goog-api-key": api_key},
        json=build_request(comparison, take, reference),
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Gemini returned HTTP {response.status_code}: {response.text[:300]}")

    data = _parse_json_object(_response_text(response.json()))
    fallback = comparison.feedback
    return Feedback(
        positive=str(data.get("positive") or fallback.positive),
        primary_issue=data.get("primary_issue") or None,
        secondary_issue=data.get("secondary_issue") or None,
        next_attempt=str(data.get("next_attempt") or fallback.next_attempt),
        categories=fallback.categories,
        source="audio",
        model=label or model,
    )


def _audio_part(path: Path) -> dict:
    mime = MIME_TYPES.get(path.suffix.lower())
    if mime is None:
        raise RuntimeError(f"unsupported audio type for Gemini: {path.name}")
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(path.read_bytes()).decode("ascii")}}


def _response_text(body: dict) -> str:
    candidates = body.get("candidates") or []
    if not candidates:
        reason = (body.get("promptFeedback") or {}).get("blockReason", "no candidates")
        raise RuntimeError(f"Gemini returned no answer ({reason})")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise RuntimeError(f"Gemini returned an empty answer ({candidates[0].get('finishReason')})")
    return text
