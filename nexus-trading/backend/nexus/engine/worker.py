"""24/7 worker process: `python -m nexus.engine.worker`.

Runs independently from the web API (separate container). Survives provider
and database failures with exponential backoff; Docker restarts it if it dies.
All state is in PostgreSQL, so a restart resumes exactly where it stopped.
"""
from __future__ import annotations

import logging
import os
import signal
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import OperationalError, SQLAlchemyError

from nexus.config import get_settings
from nexus.db import init_db, session_scope
from nexus.engine import experiments
from nexus.engine.cycle import Engine
from nexus.market import calendar
from nexus.market.universe import UNIVERSE
from nexus.monitoring import emit, send_alert

log = logging.getLogger("nexus.worker")
_running = True


def _stop(*_):
    global _running
    _running = False


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    s = get_settings()
    backoff = 5
    while _running:
        try:
            init_db()
            break
        except OperationalError as exc:
            log.error("database unavailable (%s); retry in %ss", exc.__class__.__name__, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)

    engine = Engine()
    with session_scope() as db:
        emit(db, "system", "Worker started (paper trading only)", data={"pid": os.getpid()})
        for role, name in (("quote", s.quote_provider), ("history", s.history_provider),
                           ("news", s.news_provider), ("fx", s.fx_provider)):
            if name and name != "ecb" and not getattr(s, f"{name}_api_key", None):
                emit(db, "data", f"{role} provider '{name}' has no API key: no real data for this role, "
                                 f"trading stays blocked until it is configured", level="warn")
        auto = os.environ.get("AUTO_START_EXPERIMENT")
        if auto and experiments.latest(db) is None:
            experiments.start(db, auto, s.initial_capital_eur, by="worker-autostart")

    last_offhours = datetime.min.replace(tzinfo=timezone.utc)
    backoff = 5
    while _running:
        started = time.monotonic()
        now = datetime.now(timezone.utc)
        try:
            with session_scope() as db:
                result = engine.run_cycle(db, now)
            if now - last_offhours >= timedelta(seconds=s.closed_market_cycle_seconds):
                with session_scope() as db:
                    engine.run_offhours(db, now)
                last_offhours = now
            log.info("cycle done: %s", result)
            backoff = 5
        except SQLAlchemyError as exc:
            log.exception("database error in cycle")
            send_alert(f"NEXUS worker: database error {exc.__class__.__name__}; retrying in {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
            continue
        except Exception as exc:  # never let one bad cycle kill the 24/7 loop
            log.exception("cycle failed")
            try:
                with session_scope() as db:
                    emit(db, "system", f"Cycle failed: {exc.__class__.__name__}: {exc}", level="error")
            except Exception:
                send_alert(f"NEXUS worker: cycle failed and DB unreachable: {exc}")
        any_open = any(calendar.is_open(c) for c in {i.calendar for i in UNIVERSE})
        period = s.cycle_seconds if any_open else s.closed_market_cycle_seconds
        remaining = period - (time.monotonic() - started)
        while _running and remaining > 0:
            time.sleep(min(1.0, remaining))
            remaining -= 1.0
    with session_scope() as db:
        emit(db, "system", "Worker stopped (SIGTERM)", level="warn")


if __name__ == "__main__":
    main()
