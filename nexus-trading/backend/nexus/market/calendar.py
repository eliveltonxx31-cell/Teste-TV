"""Exchange trading calendars (holidays, early closes) via exchange_calendars."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

import exchange_calendars as xc
import pandas as pd


@lru_cache(maxsize=16)
def _cal(code: str):
    return xc.get_calendar(code)


def is_open(calendar_code: str, at: datetime | None = None) -> bool:
    at = at or datetime.now(timezone.utc)
    ts = pd.Timestamp(at).tz_convert("UTC").floor("min")
    cal = _cal(calendar_code)
    try:
        return bool(cal.is_open_on_minute(ts))
    except ValueError:  # outside calendar bounds
        return False


def session_info(calendar_code: str, at: datetime | None = None) -> dict:
    at = at or datetime.now(timezone.utc)
    cal = _cal(calendar_code)
    ts = pd.Timestamp(at).tz_convert("UTC").floor("min")
    open_now = is_open(calendar_code, at)
    try:
        nxt_open = cal.next_open(ts)
        nxt_close = cal.next_close(ts)
    except ValueError:
        nxt_open = nxt_close = None
    return {
        "calendar": calendar_code,
        "timezone": str(cal.tz),
        "open": open_now,
        "next_open": nxt_open.isoformat() if nxt_open is not None else None,
        "next_close": nxt_close.isoformat() if nxt_close is not None else None,
        "local_time": pd.Timestamp(at).tz_convert(cal.tz).strftime("%Y-%m-%d %H:%M %Z"),
    }


def minutes_to_close(calendar_code: str, at: datetime | None = None) -> float | None:
    at = at or datetime.now(timezone.utc)
    if not is_open(calendar_code, at):
        return None
    ts = pd.Timestamp(at).tz_convert("UTC").floor("min")
    return (_cal(calendar_code).next_close(ts) - ts).total_seconds() / 60.0


def timezone_of(calendar_code: str) -> str:
    return str(_cal(calendar_code).tz)
