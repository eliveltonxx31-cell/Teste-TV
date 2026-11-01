"""Provider-agnostic market data contracts.

Every provider adapter converts its native payload into these structures so
the rest of the system never depends on a specific vendor.
"""
from __future__ import annotations

import abc
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from enum import Enum


class Feed(str, Enum):
    REALTIME = "realtime"      # plan entitles real-time AND quote is fresh
    DELAYED = "delayed"        # plan is delayed (typically 15 min)
    EOD = "eod"                # end-of-day / historical only
    STALE = "stale"            # should be real-time but timestamp is too old
    UNKNOWN = "unknown"        # provider gave no reliable timestamp


class ProviderError(RuntimeError):
    """Network failure, auth failure, rate limit or malformed payload."""


class NotEntitled(ProviderError):
    """The configured plan does not cover this instrument/market."""


@dataclass(frozen=True)
class Instrument:
    symbol: str          # internal id, e.g. "AAPL" or "SAP@XETR"
    ticker: str          # exchange ticker
    name: str
    exchange: str        # MIC: XNYS, XNAS, XETR, XPAR, XAMS
    currency: str
    market: str          # "US" | "EU"
    asset_type: str      # "stock" | "etf"
    sector: str

    @property
    def calendar(self) -> str:
        return {"XNAS": "XNYS", "ARCX": "XNYS"}.get(self.exchange, self.exchange)


@dataclass
class Quote:
    symbol: str
    name: str
    exchange: str
    currency: str
    price: float
    timestamp: datetime | None          # time of the last trade/quote, tz-aware UTC
    source: str
    feed: Feed
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    bid: float | None = None
    ask: float | None = None
    volume: float | None = None
    prev_close: float | None = None
    change_pct: float | None = None
    exchange_timezone: str | None = None

    @property
    def delay_seconds(self) -> float | None:
        if self.timestamp is None:
            return None
        return max(0.0, (self.received_at - self.timestamp).total_seconds())

    def to_dict(self) -> dict:
        d = asdict(self)
        d["feed"] = self.feed.value
        d["timestamp"] = self.timestamp.isoformat() if self.timestamp else None
        d["received_at"] = self.received_at.isoformat()
        d["delay_seconds"] = self.delay_seconds
        return d


@dataclass
class Bar:
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class News:
    id: str
    symbol: str | None
    headline: str
    summary: str | None
    source: str
    url: str | None
    published_at: datetime


@dataclass
class FxRate:
    pair: str            # e.g. "EURUSD" meaning USD per 1 EUR
    rate: float
    timestamp: datetime | None
    source: str
    kind: str            # "realtime" | "delayed" | "reference"


class MarketDataProvider(abc.ABC):
    name: str = "base"

    def __init__(self, api_key: str | None, entitlement: dict[str, str]):
        self.api_key = api_key
        self.entitlement = entitlement  # {"US": "realtime", "EU": "delayed"}

    def declared_feed(self, inst: Instrument) -> Feed:
        value = self.entitlement.get(inst.market, "none")
        if value == "none":
            raise NotEntitled(f"{self.name}: plan does not cover {inst.market} ({inst.symbol})")
        return Feed(value) if value in Feed._value2member_map_ else Feed.UNKNOWN

    def require_key(self) -> str:
        if not self.api_key:
            raise ProviderError(f"{self.name}: API key not configured")
        return self.api_key

    # --- capabilities (adapters override what they support) -------------
    def quote(self, inst: Instrument) -> Quote:
        raise NotEntitled(f"{self.name} does not provide quotes")

    def daily_bars(self, inst: Instrument, days: int = 300) -> list[Bar]:
        raise NotEntitled(f"{self.name} does not provide daily bars")

    def news(self, inst: Instrument | None, since: datetime) -> list[News]:
        raise NotEntitled(f"{self.name} does not provide news")

    def fundamentals(self, inst: Instrument) -> dict:
        raise NotEntitled(f"{self.name} does not provide fundamentals")

    def earnings_calendar(self, start: date, end: date) -> list[dict]:
        raise NotEntitled(f"{self.name} does not provide an earnings calendar")

    def fx_eur(self, currency: str) -> FxRate:
        raise NotEntitled(f"{self.name} does not provide FX")


def to_float(value) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
