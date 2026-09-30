"""Size the hosted worker pool to the backlog.

Each hosted worker handles one job at a time. ``reserve_workers()`` in
Postgres counts the waiting rows and the workers already running or
starting, and reserves the ones the queue is short of; ``scale`` starts one
worker per reservation. It runs whenever a job is queued, when a worker
exits, and on the periodic sweep (see modal_app.py), so the pool grows with
the backlog and shrinks back to zero as workers find nothing left to do.
"""

from __future__ import annotations

import logging
from typing import Callable

from prosody_worker.config import ANALYZER_VERSION
from prosody_worker.store import WorkerPool

log = logging.getLogger(__name__)


def scale(pool: WorkerPool, queue: str, spawn: Callable[[str], object]) -> int:
    """Start the workers ``queue`` is short of. Returns how many started.

    A reservation whose worker could not be started is released at once,
    so it does not hold a place in the pool until it expires.
    """
    started = 0
    for worker_id in pool.reserve_workers(queue, ANALYZER_VERSION):
        try:
            spawn(worker_id)
        except Exception:
            log.exception("could not start a %s worker", queue)
            pool.release_worker(worker_id)
            continue
        started += 1
    if started:
        log.info("started %d %s worker(s)", started, queue)
    return started
