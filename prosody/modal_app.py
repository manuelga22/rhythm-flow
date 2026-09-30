"""Hosted worker on Modal: drain the queues on demand instead of polling.

A Postgres trigger (``supabase/migrations/*_worker_webhook.sql``) POSTs to
``wake`` whenever an analysis or attempt is queued. ``wake`` asks the
database how many workers the queue needs (one per two waiting jobs, up to
MAX_WORKERS; see prosody_worker/scaling.py) and spawns the missing ones.
Each worker is a drain: it claims one job at a time until the queue is
empty or its claim deadline passes, then exits and re-checks the pool.
``sweep`` re-checks both pools every few minutes as a safety net for lost
webhooks and claims left behind by a killed container. Nothing runs, and
nothing is billed, while the queues are empty.

Deploy from this directory:

    modal secret create prosody-worker SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=... WORKER_WEBHOOK_TOKEN=... \
        GEMINI_API_KEY=... ELEVENLABS_API_KEY=...
    modal deploy modal_app.py

Local development is unchanged: ``python -m prosody_worker`` still polls.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import threading
import time

import modal

from prosody_worker.config import CLAIM_DEADLINE_SECONDS, DRAIN_TIMEOUT_SECONDS, MAX_WORKERS


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
    # editable prompts (prosody_coach/prompts/*.md, prosody_worker/prompts/*.md).
    .add_local_python_source("prosody_coach", "prosody_worker", ignore=["**/__pycache__"])
)

with image.imports():
    from fastapi import HTTPException, Request

app = modal.App("prosody-worker", image=image)
secrets = [modal.Secret.from_name("prosody-worker")]


def _store():
    from prosody_worker.config import WorkerConfig
    from prosody_worker.store import SupabaseStore

    return SupabaseStore(WorkerConfig.from_env())


def drain(queue: str, worker_id: str) -> None:
    """Process pending jobs in ``queue`` one at a time until it is empty or
    the claim deadline passes, then give up this worker's place in the pool."""
    from prosody_worker.config import WorkerConfig
    from prosody_worker.main import poll, run_attempts_once, run_once
    from prosody_worker.scaling import scale

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    threading.current_thread().name = queue
    config = WorkerConfig.from_env()
    run = run_once if queue == "analyses" else run_attempts_once
    deadline = time.monotonic() + CLAIM_DEADLINE_SECONDS[queue]
    store = _store()
    try:
        poll(run, store, threading.Event(), config.poll_seconds, config.batch_size, once=True, deadline=deadline)
    finally:
        store.release_worker(worker_id)
        # Jobs left waiting when the deadline passed get a fresh worker now
        # rather than at the next sweep.
        scale(store, queue, DRAINS[queue].spawn)


# The timeout stays under CLAIM_TIMEOUT_SECONDS, so a claim never expires
# while its worker is still alive. max_containers matches the pool size
# reserve_workers() allows, one job per container.
@app.function(
    secrets=secrets, cpu=2, memory=2048,
    timeout=DRAIN_TIMEOUT_SECONDS["analyses"], max_containers=MAX_WORKERS["analyses"],
)
def drain_analyses(worker_id: str) -> None:
    drain("analyses", worker_id)


# Separate from analyses so a learner's take never waits behind a long
# reference analysis.
@app.function(
    secrets=secrets, cpu=2, memory=2048,
    timeout=DRAIN_TIMEOUT_SECONDS["attempts"], max_containers=MAX_WORKERS["attempts"],
)
def drain_attempts(worker_id: str) -> None:
    drain("attempts", worker_id)


DRAINS = {"analyses": drain_analyses, "attempts": drain_attempts}


@app.function(secrets=secrets)
@modal.fastapi_endpoint(method="POST")
async def wake(request: Request) -> dict[str, str | int]:
    """Called by the database trigger with ``{"queue": "analyses" | "attempts"}``."""
    from prosody_worker.scaling import scale

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
    # supabase-py is synchronous; keep it off the event loop.
    spawned = await asyncio.to_thread(scale, _store(), queue, DRAINS[queue].spawn)
    return {"queue": queue, "spawned": spawned}


@app.function(secrets=secrets, schedule=modal.Period(minutes=10))
def sweep() -> None:
    from prosody_worker.scaling import scale

    store = _store()
    for queue, fn in DRAINS.items():
        scale(store, queue, fn.spawn)
