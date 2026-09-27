"""Create a practice clip with AI: Gemini writes it, ElevenLabs voices it.

The script is an original monologue inspired by a scene from a well-known
movie, picked at random here because language models keep choosing the
same favourites. Gemini also picks the voice, from the ElevenLabs account's
own voices, to suit the speaker it wrote. The instructions live in
``prompts/generate_clip.md``; the reply format stays here, next to the
code that parses it.

Any failure raises ``SourceError`` with a message the UI can show; the real
reason goes to the log.
"""

from __future__ import annotations

import json
import logging
import os
import random
from dataclasses import dataclass
from pathlib import Path

from prosody_coach.listen import call_gemini
from prosody_worker.config import SCRIPT_MODEL, TTS_MODEL
from prosody_worker.sources import SourceError

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "generate_clip.md"

ELEVENLABS_URL = "https://api.elevenlabs.io"
TTS_TIMEOUT_SECONDS = 60.0
SCRIPT_TIMEOUT_SECONDS = 30.0

# About 30 to 60 seconds of speech, with some slack around the 90-140 asked for.
MIN_WORDS = 70
MAX_WORDS = 170

FAILED = "Couldn't create a clip right now. Try again."

MOVIES = (
    "Casablanca", "The Godfather", "Jaws", "Rocky", "Star Wars", "E.T. the Extra-Terrestrial",
    "Back to the Future", "The Breakfast Club", "Ghostbusters", "Top Gun", "Dead Poets Society",
    "When Harry Met Sally", "Field of Dreams", "Home Alone", "Jurassic Park", "Forrest Gump",
    "Apollo 13", "Toy Story", "Jerry Maguire", "Good Will Hunting", "Titanic", "The Truman Show",
    "The Matrix", "Erin Brockovich", "Gladiator", "Cast Away", "Legally Blonde", "Finding Nemo",
    "The Devil Wears Prada", "Ratatouille", "The Dark Knight", "Up", "The Social Network",
    "Moneyball", "The Martian", "La La Land", "Hidden Figures", "Remember the Titans",
    "The Pursuit of Happyness", "Mean Girls", "Interstellar", "Rudy",
)

REPLY_FORMAT = """\

## Reply format

Respond with a JSON object containing exactly these keys:
  "title"    - a short title for the clip, at most six words, without the movie's name
  "script"   - the monologue, plain text
  "voice_id" - the voice_id of the chosen voice, copied exactly from the list
"""


@dataclass
class GeneratedClip:
    path: Path
    # {movie, title, script, voice_id, voice_name}, stored on the analyses row.
    generation: dict


def generate_clip(dest: Path) -> GeneratedClip:
    """Write, voice and save a new clip under ``dest``."""
    movie = random.choice(MOVIES)
    try:
        voices = list_voices()
        script = write_script(movie, voices)
        path = synthesize(script["script"], script["voice_id"], dest / "generated.mp3")
    except SourceError:
        raise
    except Exception as exc:
        log.warning("clip generation failed (%s)", movie, exc_info=True)
        raise SourceError(FAILED) from exc

    voice_name = next(voice["name"] for voice in voices if voice["voice_id"] == script["voice_id"])
    log.info("generated a clip inspired by %s, voiced by %s", movie, voice_name)
    return GeneratedClip(path, {
        "movie": movie,
        "title": f"{script['title']} · Inspired by {movie}",
        "script": script["script"],
        "voice_id": script["voice_id"],
        "voice_name": voice_name,
    })


def list_voices() -> list[dict]:
    """The account's voices as ``{voice_id, name, gender, age, description}``,
    American-accented ones only when there are any."""
    import httpx

    response = httpx.get(
        f"{ELEVENLABS_URL}/v2/voices",
        params={"page_size": 100},
        headers={"xi-api-key": _elevenlabs_key()},
        timeout=SCRIPT_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(f"ElevenLabs voices returned HTTP {response.status_code}: {response.text[:300]}")

    voices = []
    for voice in response.json().get("voices") or []:
        labels = voice.get("labels") or {}
        if not voice.get("voice_id"):
            continue
        voices.append({
            "voice_id": voice["voice_id"],
            "name": voice.get("name") or voice["voice_id"],
            "gender": labels.get("gender"),
            "age": labels.get("age"),
            "accent": labels.get("accent"),
            "description": labels.get("description") or voice.get("description"),
        })
    if not voices:
        raise RuntimeError("the ElevenLabs account has no voices")

    american = [voice for voice in voices if "american" in (voice["accent"] or "").lower()]
    return american or voices


def write_script(movie: str, voices: list[dict], model: str = SCRIPT_MODEL) -> dict:
    """Ask Gemini for ``{title, script, voice_id}``; the voice is checked
    against ``voices`` and the length against MIN_WORDS..MAX_WORDS."""
    body = {
        "system_instruction": {"parts": [{"text": system_prompt()}]},
        "contents": [{"role": "user", "parts": [{"text": (
            f"Movie: {movie}\n\nVoices to choose from:\n\n{json.dumps(voices, indent=2)}"
        )}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 1.0},
    }
    data = call_gemini(body, model, timeout=SCRIPT_TIMEOUT_SECONDS)

    script = " ".join(str(data.get("script") or "").split())
    words = len(script.split())
    if not MIN_WORDS <= words <= MAX_WORDS:
        raise RuntimeError(f"the script has {words} words, outside {MIN_WORDS}-{MAX_WORDS}")

    ids = {voice["voice_id"] for voice in voices}
    voice_id = data.get("voice_id")
    if voice_id not in ids:
        log.info("Gemini picked an unknown voice %r; using %s", voice_id, voices[0]["name"])
        voice_id = voices[0]["voice_id"]

    title = " ".join(str(data.get("title") or "").split())[:80] or "A scene"
    return {"title": title, "script": script, "voice_id": voice_id}


def synthesize(text: str, voice_id: str, dest: Path, model: str = TTS_MODEL) -> Path:
    """Voice ``text`` with ElevenLabs and save the MP3 at ``dest``."""
    import httpx

    response = httpx.post(
        f"{ELEVENLABS_URL}/v1/text-to-speech/{voice_id}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": _elevenlabs_key()},
        json={"text": text, "model_id": model},
        timeout=TTS_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(f"ElevenLabs speech returned HTTP {response.status_code}: {response.text[:300]}")
    if not response.content:
        raise RuntimeError("ElevenLabs returned no audio")
    dest.write_bytes(response.content)
    return dest


def system_prompt() -> str:
    """The editable prompt followed by the fixed reply format."""
    try:
        text = PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"clip prompt is missing: {PROMPT_PATH}") from exc
    return text + "\n" + REPLY_FORMAT


def _elevenlabs_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    return key
