"""Hosted worker on Modal: drain the queues on demand instead of polling.

A Postgres trigger (``supabase/migrations/*_worker_webhook.sql``) POSTs to
``wake`` whenever an analysis or attempt is queued, which spawns the
matching drain. ``sweep`` runs both drains every few minutes as a safety
net for lost webhooks and claims left behind by a killed container.
Nothing runs, and nothing is billed, while the queues are empty.

Deploy from this directory:

    modal secret create prosody-worker SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=... WORKER_WEBHOOK_TOKEN=...
    modal deploy modal_app.py

Local development is unchanged: ``python -m prosody_worker`` still polls.
"""

from __future__ import annotations

import hmac
import logging
import os
import threading

import modal


def download_model() -> None:
    """Bake the Whisper weights into the image so cold starts skip the
    500 MB download. Must match DEFAULT_MODEL_SIZE in prosody_worker/config.py
    and DEFAULT_COMPUTE in prosody_coach/transcribe.py."""
    from faster_whisper import WhisperModel

    WhisperModel("small", device="cpu", compute_type="int8")


image = (
    modal.Image.debian_slim(python_version="3.12")
    .add_local_file("requirements.txt", "/build/requirements.txt", copy=True)
    .add_local_file("requirements-worker.txt", "/build/requirements-worker.txt", copy=True)
    .run_commands("pip install -r /build/requirements-worker.txt")
    # yt-dlp solves YouTube's JavaScript challenge with Deno; the wheel puts
    # the executable on PATH.
    .pip_install("deno", "fastapi[standard]")
    .run_function(download_model)
    # The default ignore drops non-Python files, which would leave out the
    # editable feedback prompt (prosody_coach/prompts/*.md).
    .add_local_python_source("prosody_coach", "prosody_worker", ignore=["**/__pycache__"])
)

with image.imports():
    from fastapi import HTTPException, Request

app = modal.App("prosody-worker", image=image)
secrets = [modal.Secret.from_name("prosody-worker")]


def drain(queue: str) -> None:
    """Process everything pending in ``queue``, then return."""
    from prosody_worker.config import WorkerConfig
    from prosody_worker.main import poll, run_attempts_once, run_once
    from prosody_worker.store import SupabaseStore

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    threading.current_thread().name = queue
    config = WorkerConfig.from_env()
    run = run_once if queue == "analyses" else run_attempts_once
    poll(run, SupabaseStore(config), threading.Event(), config.poll_seconds, config.batch_size, once=True)


# Timeout stays under CLAIM_TIMEOUT_SECONDS so a killed run's row becomes
# claimable again soon after. One container per queue: overlapping wakes
# queue up behind it and find nothing left to do.
@app.function(secrets=secrets, cpu=2, memory=2048, timeout=14 * 60, max_containers=1)
def drain_analyses() -> None:
    drain("analyses")


# Separate from analyses so a learner's take never waits behind a long
# reference analysis.
@app.function(secrets=secrets, cpu=2, memory=2048, timeout=5 * 60, max_containers=1)
def drain_attempts() -> None:
    drain("attempts")


DRAINS = {"analyses": drain_analyses, "attempts": drain_attempts}


@app.function(secrets=secrets)
@modal.fastapi_endpoint(method="POST")
async def wake(request: Request) -> dict[str, str]:
    """Called by the database trigger with ``{"queue": "analyses" | "attempts"}``."""
    expected = f"Bearer {os.environ['WORKER_WEBHOOK_TOKEN']}"
    if not hmac.compare_digest(request.headers.get("authorization", ""), expected):
        raise HTTPException(status_code=401, detail="bad token")
    try:
        payload = await request.json()
    except ValueError:
        payload = None
    queue = payload.get("queue") if isinstance(payload, dict) else None
    if queue not in DRAINS:
        raise HTTPException(status_code=400, detail=f"queue must be one of {', '.join(DRAINS)}")
    await DRAINS[queue].spawn.aio()
    return {"queued": queue}


@app.function(secrets=secrets, schedule=modal.Period(minutes=10))
def sweep() -> None:
    for fn in DRAINS.values():
        fn.spawn()
