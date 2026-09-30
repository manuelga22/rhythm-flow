"""Worker configuration, read from the environment.

Values also load from the repo-root ``.env`` (shared with the Vite app;
only its ``VITE_`` entries reach the browser). Variables already set in
the shell take precedence over the file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

try:
    from dotenv import load_dotenv
except ImportError:  # optional: tests and CLI-only installs run without it
    pass
else:
    load_dotenv(ENV_FILE, override=False)


# Must match analysis_settings() in supabase/migrations. Rows created under a
# different version are left for a worker running that version.
ANALYZER_VERSION = os.environ.get("PROSODY_ANALYZER_VERSION", "1")

# Whisper model that analysis_settings() asks for. Imported rows must carry
# the same value or find_analysis() will not return them.
DEFAULT_MODEL_SIZE = "small"

AUDIO_BUCKET = "reference-audio"
ATTEMPT_BUCKET = "attempt-audio"

# Context kept around a phrase in the reference clips the models hear.
CLIP_PAD_SECONDS = 0.25

# Guard rails for what a single job may pull down and analyse.
MAX_SOURCE_SECONDS = 10 * 60
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_ATTEMPT_BYTES = 10 * 1024 * 1024

# Generated clips: Gemini writes the script, ElevenLabs (ELEVENLABS_API_KEY)
# voices it. See prosody_worker/generate.py.
SCRIPT_MODEL = os.environ.get("PROSODY_SCRIPT_MODEL", "gemini-3.1-flash-lite")
TTS_MODEL = os.environ.get("PROSODY_TTS_MODEL", "eleven_multilingual_v2")

# A claimed row that has not finished within this window is assumed to
# belong to a crashed worker and becomes claimable again. The live value is
# job_settings.claim_timeout (supabase/migrations/*_job_watchdog.sql); this
# is the fallback for a database without that table.
CLAIM_TIMEOUT_SECONDS = 15 * 60
MAX_ATTEMPTS = 3


@dataclass
class WorkerConfig:
    supabase_url: str
    service_role_key: str
    poll_seconds: float = 3.0
    batch_size: int = 1

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run the worker."
            )
        return cls(
            supabase_url=url,
            service_role_key=key,
            poll_seconds=float(os.environ.get("PROSODY_WORKER_POLL_SECONDS", "3")),
        )
