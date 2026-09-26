"""Polling loop: claim pending analyses and process them one at a time.

Usage:

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m prosody_worker
    python -m prosody_worker --once      # drain the queue, then exit

TODO: replace polling with a Supabase Database Webhook on INSERT (or pgmq)
that wakes the worker, keeping the poll as a slow safety net.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import time

from prosody_worker.config import ANALYZER_VERSION, WorkerConfig
from prosody_worker.jobs import process
from prosody_worker.sources import JS_RUNTIMES
from prosody_worker.store import AnalysisStore, SupabaseStore

log = logging.getLogger("prosody_worker")


def run_once(store: AnalysisStore, batch_size: int = 1) -> int:
    """Process whatever is pending right now. Returns the number handled."""
    handled = 0
    for row in store.fetch_pending(ANALYZER_VERSION, batch_size):
        if not store.claim(row):
            continue
        log.info("claimed analysis %s (%s)", row["id"], row["source_key"])
        try:
            process(row, store)
        except Exception:
            log.exception("analysis %s crashed", row["id"])
        handled += 1
    return handled


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="prosody_worker")
    parser.add_argument("--once", action="store_true", help="Drain the queue and exit.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = WorkerConfig.from_env()
    store = SupabaseStore(config)
    log.info("worker started (analyzer %s)", ANALYZER_VERSION)
    if not any(shutil.which(name) for name in JS_RUNTIMES):
        log.warning(
            "no JavaScript runtime (%s) on PATH; YouTube downloads may fail with "
            "HTTP 403 until Node is installed",
            "/".join(JS_RUNTIMES),
        )

    try:
        while True:
            handled = run_once(store, config.batch_size)
            if args.once and handled == 0:
                return 0
            if handled == 0:
                time.sleep(config.poll_seconds)
    except KeyboardInterrupt:
        log.info("worker stopped")
        return 130
