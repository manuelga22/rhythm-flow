"""Worker loops: claim pending jobs and process them one at a time.

Two queues run side by side, each on its own thread with its own Supabase
client:

* ``analyses`` (main thread): reference clips. These can take minutes for
  a long YouTube video.
* ``attempts`` (dedicated thread): a learner's take compared against an
  analysed reference. A user is waiting on these, so they never queue
  behind a reference analysis.

Usage:

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m prosody_worker
    python -m prosody_worker --once      # drain both queues, then exit

Each claim takes one row atomically, so any number of workers can share a
queue. The hosted worker (modal_app.py) is woken by a database webhook
instead of polling and runs ``poll(..., once=True)`` per worker.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import threading
import time
from typing import Any, Callable

from prosody_worker.attempts import process_attempt
from prosody_worker.config import ANALYZER_VERSION, WorkerConfig
from prosody_worker.jobs import process
from prosody_worker.sources import JS_RUNTIMES
from prosody_worker.store import AnalysisStore, AttemptStore, SupabaseStore

log = logging.getLogger("prosody_worker")


def run_once(store: AnalysisStore, batch_size: int = 1) -> int:
    """Process whatever analyses are pending right now. Returns the number handled."""
    handled = 0
    for _ in range(batch_size):
        row = store.claim_next(ANALYZER_VERSION)
        if row is None:
            break
        log.info("claimed analysis %s (%s)", row["id"], row["source_key"])
        try:
            process(row, store)
        except Exception:
            log.exception("analysis %s crashed", row["id"])
        handled += 1
    return handled


def run_attempts_once(store: AttemptStore, batch_size: int = 1) -> int:
    """Process whatever attempts are pending right now. Returns the number handled."""
    handled = 0
    for _ in range(batch_size):
        row = store.claim_next_attempt(ANALYZER_VERSION)
        if row is None:
            break
        log.info("claimed attempt %s (analysis %s, phrase %s)", row["id"], row["analysis_id"], row.get("phrase_id") or "all")
        try:
            process_attempt(row, store)
        except Exception:
            log.exception("attempt %s crashed", row["id"])
        handled += 1
    return handled


def poll(
    run: Callable[[Any, int], int],
    store: Any,
    stop: threading.Event,
    poll_seconds: float,
    batch_size: int = 1,
    once: bool = False,
    deadline: float | None = None,
) -> None:
    """Call ``run`` until ``stop`` is set, or until the queue is empty when
    ``once``. No new job is claimed once ``deadline`` (a ``time.monotonic()``
    value) has passed."""
    while not stop.is_set():
        if deadline is not None and time.monotonic() >= deadline:
            return
        try:
            handled = run(store, batch_size)
        except Exception:
            # A dropped connection must not kill the loop for good.
            log.exception("polling failed")
            handled = 0
        if handled == 0:
            if once:
                return
            stop.wait(poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="prosody_worker")
    parser.add_argument("--once", action="store_true", help="Drain both queues and exit.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    threading.current_thread().name = "analyses"
    config = WorkerConfig.from_env()
    log.info("worker started (analyzer %s)", ANALYZER_VERSION)
    if not any(shutil.which(name) for name in JS_RUNTIMES):
        log.warning(
            "no JavaScript runtime (%s) on PATH; YouTube downloads may fail with "
            "HTTP 403 until Node is installed",
            "/".join(JS_RUNTIMES),
        )

    stop = threading.Event()
    # Each thread gets its own client: supabase-py's HTTP client is not
    # meant to be shared across threads.
    attempts = threading.Thread(
        target=poll,
        name="attempts",
        args=(run_attempts_once, SupabaseStore(config), stop, config.poll_seconds, config.batch_size, args.once),
        daemon=True,
    )
    attempts.start()

    try:
        poll(run_once, SupabaseStore(config), stop, config.poll_seconds, config.batch_size, args.once)
        if args.once:
            attempts.join()
            return 0
    except KeyboardInterrupt:
        log.info("worker stopping")
        stop.set()
        attempts.join(timeout=5)
        return 130
    return 0
