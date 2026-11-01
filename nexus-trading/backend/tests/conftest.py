"""Test fixtures.

IMPORTANT: FakeProvider exists ONLY in the test suite to exercise the engine
deterministically. It is never importable from the application package and
never used at runtime.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

import pytest

from nexus import config, db as dbmod
from nexus.market.base import (Bar, Feed, FxRate, Instrument, MarketDataProvider, NotEntitled,
                               ProviderError, Quote)

# Tuesday 3 Nov 2026 15:00 UTC: NYSE (10:00 EST) and Xetra/Euronext (16:00 CET) open.
MARKET_OPEN = datetime(2026, 11, 3, 15, 0, tzinfo=timezone.utc)
MARKET_CLOSED = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)  # Saturday


@pytest.fixture(autouse=True)
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("JWT_SECRET", "x" * 40)
    monkeypatch.setenv("FEE_FIXED_EUR", "0")
    for k in ("FINNHUB_API_KEY", "TWELVEDATA_API_KEY", "ANTHROPIC_API_KEY", "ALERT_WEBHOOK_URL"):
        monkeypatch.delenv(k, raising=False)
    config.reset_settings()
    dbmod.reset_engine()
    dbmod.init_db()
    yield
    dbmod.reset_engine()
    config.reset_settings()


def make_bars(n: int = 260, start: float = 100.0, end_day: date = date(2026, 11, 2),
              last_volume_mult: float = 2.0) -> list[Bar]:
    bars, price = [], start
    for i in range(n):
        day = end_day - timedelta(days=n - 1 - i)
        step = 0.012 if i % 2 == 0 else -0.007
        o = price
        price = price * (1 + step)
        bars.append(Bar(day=day, open=o, high=max(o, price) * 1.003, low=min(o, price) * 0.997,
                        close=price, volume=1_000_000 * (last_volume_mult if i == n - 1 else 1)))
    return bars


class FakeProvider(MarketDataProvider):
    name = "fake"

    def __init__(self, clock, bars: dict[str, list[Bar]] | None = None, price_mult: float = 1.03,
                 feed: Feed = Feed.REALTIME, quote_age_s: float = 5.0):
        super().__init__("k", {"US": feed.value, "EU": feed.value})
        self.clock = clock
        self.bars = bars or {}
        self.price_mult = price_mult
        self.quote_age_s = quote_age_s
        self.fail_quotes = False
        self.override_price: dict[str, float] = {}
        self.calls = 0

    def _bars(self, inst):
        return self.bars.get(inst.symbol) or make_bars()

    def quote(self, inst: Instrument) -> Quote:
        self.calls += 1
        if self.fail_quotes:
            raise ProviderError("fake: connection refused")
        last = self._bars(inst)[-1].close
        price = self.override_price.get(inst.symbol, last * self.price_mult)
        now = self.clock()
        return Quote(symbol=inst.symbol, name=inst.name, exchange=inst.exchange, currency=inst.currency,
                     price=price, timestamp=now - timedelta(seconds=self.quote_age_s), source=self.name,
                     feed=self.declared_feed(inst), received_at=now, volume=5_000_000, prev_close=last)

    def daily_bars(self, inst, days=300):
        return self._bars(inst)[-days:]

    def fundamentals(self, inst):
        return {"pe": 20, "debt_to_equity": 0.5, "revenue_growth": 8, "net_margin": 15}

    def news(self, inst, since):
        return []

    def earnings_calendar(self, start, end):
        return []

    def fx_eur(self, currency):
        if currency != "USD":
            raise NotEntitled("fake fx")
        return FxRate("EURUSD", 1.08, self.clock(), "fake", "realtime")


class Clock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t = self.t + timedelta(seconds=seconds)


def isclose(a, b, tol=1e-6):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)
