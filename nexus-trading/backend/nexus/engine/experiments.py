"""Experiment lifecycle: three agents start with identical capital and rules."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.models import Agent, Experiment
from nexus.monitoring import emit
from nexus.risk.limits import PROFILES

DURATIONS = {"48h": timedelta(hours=48), "7d": timedelta(days=7), "30d": timedelta(days=30), "open": None}


def current(db: Session) -> Experiment | None:
    return db.execute(select(Experiment).where(Experiment.status == "running")
                      .order_by(Experiment.id.desc()).limit(1)).scalar_one_or_none()


def latest(db: Session) -> Experiment | None:
    return db.execute(select(Experiment).order_by(Experiment.id.desc()).limit(1)).scalar_one_or_none()


def agents_of(db: Session, exp: Experiment) -> list[Agent]:
    return list(db.execute(select(Agent).where(Agent.experiment_id == exp.id)
                           .order_by(Agent.code)).scalars())


def start(db: Session, kind: str, capital_per_agent: float, *, by: str = "system",
          now: datetime | None = None) -> Experiment:
    if kind not in DURATIONS:
        raise ValueError(f"kind must be one of {list(DURATIONS)}")
    if not (50 <= capital_per_agent <= 1_000_000):
        raise ValueError("capital per agent must be between 50 and 1,000,000 EUR")
    now = now or datetime.now(timezone.utc)
    running = current(db)
    if running is not None:
        from nexus.reports.reporting import finalize_experiment
        finalize_experiment(db, running, now=now, reason=f"superseded by new {kind} experiment ({by})")
    dur = DURATIONS[kind]
    exp = Experiment(name=f"{kind.upper()} {now:%Y-%m-%d %H:%M}", kind=kind, status="running",
                     initial_capital=capital_per_agent, started_at=now,
                     ends_at=(now + dur) if dur else None)
    db.add(exp)
    db.flush()
    for code, prof in PROFILES.items():
        db.add(Agent(experiment_id=exp.id, code=code, profile=prof.name, initial_capital=capital_per_agent,
                     cash=capital_per_agent, peak_equity=capital_per_agent,
                     day_start_equity=capital_per_agent, day_date=now.date().isoformat()))
    db.flush()
    emit(db, "system", f"Experiment '{exp.name}' started: 3 agents x EUR {capital_per_agent:.2f}",
         data={"experiment_id": exp.id, "kind": kind, "by": by})
    return exp
