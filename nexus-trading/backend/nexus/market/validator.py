"""Data-integrity checks. A quote that fails any check is NOT tradable."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from nexus.market.base import Feed, Quote

MAX_FUTURE_SKEW_S = 60
MAX_SPREAD_PCT = 0.05
MAX_GAP_VS_PREV_CLOSE = 0.25
MAX_JUMP_VS_LAST = 0.10
MAX_CROSS_SOURCE_DIFF = 0.015
DELAYED_ALLOWANCE_S = 15 * 60


@dataclass
class QuoteCheck:
    feed: Feed
    tradable: bool
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"feed": self.feed.value, "tradable": self.tradable, "issues": self.issues}


def validate_quote(q: Quote, *, market_open: bool, max_age_s: int, allow_delayed: bool,
                   last_price: float | None = None, last_ts: datetime | None = None,
                   cross_price: float | None = None, now: datetime | None = None) -> QuoteCheck:
    now = now or datetime.now(timezone.utc)
    issues: list[str] = []
    feed = q.feed

    if q.price is None or not math.isfinite(q.price) or q.price <= 0:
        issues.append("invalid_price")
    if q.timestamp is None:
        issues.append("missing_timestamp")
        feed = Feed.UNKNOWN
    else:
        if q.timestamp > now + timedelta(seconds=MAX_FUTURE_SKEW_S):
            issues.append("timestamp_in_future")
        age = (now - q.timestamp).total_seconds()
        if market_open:
            if feed == Feed.REALTIME and age > max_age_s:
                feed = Feed.STALE
                issues.append(f"stale_quote_{int(age)}s")
            elif feed == Feed.DELAYED and age > max_age_s + DELAYED_ALLOWANCE_S:
                feed = Feed.STALE
                issues.append(f"stale_delayed_quote_{int(age)}s")
    if q.bid is not None and q.ask is not None:
        if q.bid <= 0 or q.ask <= 0 or q.ask < q.bid:
            issues.append("crossed_or_invalid_book")
        elif (q.ask - q.bid) / ((q.ask + q.bid) / 2) > MAX_SPREAD_PCT:
            issues.append("spread_too_wide")
    if q.prev_close and q.price and abs(q.price / q.prev_close - 1) > MAX_GAP_VS_PREV_CLOSE:
        issues.append("gap_vs_prev_close_exceeds_25pct")
    if last_price and q.price and last_ts and q.timestamp and \
            (q.timestamp - last_ts) < timedelta(minutes=30) and abs(q.price / last_price - 1) > MAX_JUMP_VS_LAST:
        issues.append("price_jump_vs_last_quote")
    if cross_price and q.price and abs(q.price / cross_price - 1) > MAX_CROSS_SOURCE_DIFF:
        issues.append("cross_source_mismatch")

    feed_ok = feed == Feed.REALTIME or (feed == Feed.DELAYED and allow_delayed)
    if not feed_ok and feed not in (Feed.STALE,) and "missing_timestamp" not in issues:
        issues.append(f"feed_{feed.value}_not_tradable")
    if not market_open:
        issues.append("market_closed")
    return QuoteCheck(feed=feed, tradable=market_open and feed_ok and not issues, issues=issues)
