"""Hash-chained event log, system state and alerting.

Every operational step (quotes received, analysis, decision, guardian verdict,
order lifecycle) is written here. These are verifiable operational facts,
not private model reasoning.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.config import get_settings
from nexus.models import Event, Incident, SystemState

log = logging.getLogger("nexus")
GENESIS = "0" * 64


def _digest(prev_hash: str, ts: datetime, level: str, category: str,
            agent: str | None, message: str, data: Any) -> str:
    payload = json.dumps(
        [prev_hash, ts.isoformat(), level, category, agent, message, data],
        sort_keys=True, default=str, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def emit(db: Session, category: str, message: str, *, level: str = "info",
         agent: str | None = None, data: dict | None = None) -> Event:
    last = db.execute(select(Event).order_by(Event.id.desc()).limit(1)).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    ts = datetime.now(timezone.utc)
    clean = json.loads(json.dumps(data, default=str)) if data is not None else None
    ev = Event(ts=ts, level=level, category=category, agent_code=agent, message=message,
               data=clean, prev_hash=prev,
               hash=_digest(prev, ts, level, category, agent, message, clean))
    db.add(ev)
    db.flush()
    getattr(log, "warning" if level == "warn" else ("error" if level in ("error", "critical") else "info"))(
        "[%s]%s %s", category, f"[{agent}]" if agent else "", message)
    if level in ("error", "critical"):
        send_alert(f"NEXUS {level.upper()}: {message}")
    return ev


def verify_chain(db: Session) -> dict:
    prev = GENESIS
    count = 0
    for ev in db.execute(select(Event).order_by(Event.id)).scalars():
        ts = ev.ts if ev.ts.tzinfo else ev.ts.replace(tzinfo=timezone.utc)
        expected = _digest(prev, ts, ev.level, ev.category, ev.agent_code, ev.message, ev.data)
        if ev.prev_hash != prev or ev.hash != expected:
            return {"ok": False, "broken_at": ev.id, "checked": count}
        prev = ev.hash
        count += 1
    return {"ok": True, "checked": count}


def get_state(db: Session, key: str, default: dict | None = None) -> dict:
    row = db.get(SystemState, key)
    return dict(row.value) if row else dict(default or {})


def set_state(db: Session, key: str, value: dict) -> None:
    row = db.get(SystemState, key)
    if row is None:
        db.add(SystemState(key=key, value=value))
    else:
        row.value = value
    db.flush()


def is_safe_mode(db: Session) -> tuple[bool, str | None]:
    s = get_state(db, "safe_mode", {"active": False})
    return bool(s.get("active")), s.get("reason")


def enter_safe_mode(db: Session, reason: str, details: dict | None = None) -> None:
    active, current = is_safe_mode(db)
    if active and current == reason:
        return
    set_state(db, "safe_mode", {"active": True, "reason": reason,
                                "since": datetime.now(timezone.utc).isoformat()})
    open_incident(db, "safe_mode", "critical", {"reason": reason, **(details or {})})
    emit(db, "risk", f"SAFE MODE activated: {reason}. New buys blocked.", level="critical",
         data=details)


def exit_safe_mode(db: Session, by: str) -> None:
    active, reason = is_safe_mode(db)
    if not active:
        return
    set_state(db, "safe_mode", {"active": False, "reason": None})
    emit(db, "risk", f"Safe mode cleared by {by} (was: {reason}).", level="warn")


def open_incident(db: Session, kind: str, severity: str, details: dict,
                  agent: str | None = None) -> Incident:
    inc = Incident(kind=kind, severity=severity, details=json.loads(json.dumps(details, default=str)),
                   agent_code=agent)
    db.add(inc)
    db.flush()
    return inc


def send_alert(text: str) -> None:
    """Best-effort webhook alert (ntfy, Slack, Discord, Telegram bridge...)."""
    url = get_settings().alert_webhook_url
    if not url:
        return
    try:
        httpx.post(url, json={"text": text, "content": text}, timeout=5)
    except Exception as exc:  # alerting must never break the engine
        log.warning("alert webhook failed: %s", exc)
