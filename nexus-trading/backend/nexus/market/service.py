"""MarketDataService: routes each data role to a provider, validates, caches,
counts failures and triggers SAFE MODE when the data layer is unreliable."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.config import Settings, get_settings
from nexus.market import calendar
from nexus.market.base import (Bar, FxRate, Instrument, MarketDataProvider, NotEntitled,
                               ProviderError, Quote)
from nexus.market.providers import PROVIDERS
from nexus.market.validator import QuoteCheck, validate_quote
from nexus.models import Candle, LatestQuote, NewsItem
from nexus.monitoring import emit, enter_safe_mode, get_state, set_state

JUMP_CONFIRMATIONS = 3


@dataclass
class ValidatedQuote:
    quote: Quote
    check: QuoteCheck

    def to_dict(self) -> dict:
        return {**self.quote.to_dict(), **self.check.to_dict()}


def build_provider(name: str, settings: Settings) -> MarketDataProvider:
    cls = PROVIDERS[name]
    key = getattr(settings, f"{name}_api_key", None)
    return cls(key, settings.entitlement(name))


class MarketDataService:
    def __init__(self, settings: Settings | None = None,
                 providers: dict[str, MarketDataProvider] | None = None):
        self.settings = settings or get_settings()
        s = self.settings
        if providers is None:
            providers = {}
            for role, name in (("quote", s.quote_provider), ("history", s.history_provider),
                               ("news", s.news_provider), ("fx", s.fx_provider),
                               ("crosscheck", s.crosscheck_provider)):
                if name:
                    providers[role] = build_provider(name, s)
            providers.setdefault("fx_fallback", build_provider("ecb", s))
        self.providers = providers
        self._fx_cache: dict[str, FxRate] = {}

    # ------------------------------------------------------------------ health
    def _failure(self, db: Session, role: str, err: Exception) -> None:
        st = get_state(db, "provider_health", {})
        entry = st.get(role, {"failures": 0})
        entry["failures"] = entry.get("failures", 0) + 1
        entry["last_error"] = str(err)[:200]
        entry["last_error_at"] = datetime.now(timezone.utc).isoformat()
        st[role] = entry
        set_state(db, "provider_health", st)
        if role == "quote" and entry["failures"] >= self.settings.max_provider_failures:
            enter_safe_mode(db, "quote_provider_unreliable",
                            {"failures": entry["failures"], "last_error": entry["last_error"]})

    def _success(self, db: Session, role: str) -> None:
        st = get_state(db, "provider_health", {})
        entry = st.get(role, {})
        entry.update(failures=0, last_ok_at=datetime.now(timezone.utc).isoformat())
        st[role] = entry
        set_state(db, "provider_health", st)

    # ------------------------------------------------------------------ quotes
    def quote(self, db: Session, inst: Instrument, now: datetime | None = None) -> ValidatedQuote | None:
        provider = self.providers.get("quote")
        if provider is None:
            return None
        try:
            q = provider.quote(inst)
        except NotEntitled as exc:
            emit(db, "data", f"{inst.symbol}: not covered by quote plan ({exc})", level="warn",
                 data={"symbol": inst.symbol})
            return None
        except ProviderError as exc:
            self._failure(db, "quote", exc)
            emit(db, "data", f"{inst.symbol}: quote failed - {exc}", level="warn")
            return None
        self._success(db, "quote")
        q.exchange_timezone = calendar.timezone_of(inst.calendar)

        prev = db.get(LatestQuote, inst.symbol)
        # Jumps are measured against the last price that passed integrity checks,
        # so a single bad print cannot poison the reference for later quotes.
        pdata = prev.data if prev else {}
        last_price = pdata.get("last_good_price", pdata.get("price"))
        lt = pdata.get("last_good_ts", pdata.get("timestamp"))
        last_ts = datetime.fromisoformat(lt) if lt else None

        cross_price = None
        cross = self.providers.get("crosscheck")
        if cross is not None:
            try:
                cross_price = cross.quote(inst).price
            except (ProviderError, NotEntitled):
                cross_price = None

        check = validate_quote(
            q, market_open=calendar.is_open(inst.calendar, now),
            max_age_s=self.settings.max_quote_age_seconds,
            allow_delayed=self.settings.allow_delayed_trading,
            last_price=last_price, last_ts=last_ts, cross_price=cross_price, now=now)
        # A jump confirmed by CONFIRMATIONS consecutive quotes at a similar level is a
        # real move (e.g. a crash), not a bad print: accept it as the new reference.
        suspect = "price_jump_vs_last_quote" in check.issues
        streak = 0
        if suspect:
            sp = pdata.get("suspect_price")
            streak = pdata.get("suspect_streak", 0) + 1 if sp and abs(q.price / sp - 1) < 0.02 else 1
            if streak >= JUMP_CONFIRMATIONS:
                check = validate_quote(
                    q, market_open=calendar.is_open(inst.calendar, now),
                    max_age_s=self.settings.max_quote_age_seconds,
                    allow_delayed=self.settings.allow_delayed_trading, cross_price=cross_price, now=now)
                emit(db, "data", f"{inst.symbol}: price move confirmed by {streak} consecutive quotes",
                     level="warn")
                suspect, streak = False, 0
        vq = ValidatedQuote(q, check)
        payload = vq.to_dict()
        integrity_bad = {"invalid_price", "cross_source_mismatch", "gap_vs_prev_close_exceeds_25pct",
                         "crossed_or_invalid_book", "timestamp_in_future"} & set(check.issues) or suspect
        if integrity_bad or q.timestamp is None:
            payload["last_good_price"], payload["last_good_ts"] = last_price, lt
        else:
            payload["last_good_price"], payload["last_good_ts"] = q.price, q.timestamp.isoformat()
        payload["suspect_price"] = q.price if suspect else None
        payload["suspect_streak"] = streak
        if prev is None:
            db.add(LatestQuote(symbol=inst.symbol, data=payload, updated_at=q.received_at))
        else:
            prev.data, prev.updated_at = payload, q.received_at
        db.flush()
        return vq

    # ------------------------------------------------------------------ bars
    def daily_bars(self, db: Session, inst: Instrument, days: int = 260,
                   now: datetime | None = None) -> list[Bar]:
        """Completed daily bars only (strictly before the current session date):
        the bar of the day being traded is never visible to the strategy."""
        today = (now or datetime.now(timezone.utc)).date()
        rows = db.execute(select(Candle).where(Candle.symbol == inst.symbol)
                          .order_by(Candle.day)).scalars().all()
        newest = rows[-1].day if rows else None
        refreshed = get_state(db, "bars_refreshed", {}).get(inst.symbol)
        if (newest is None or len(rows) < min(days, 200)) or refreshed != today.isoformat():
            provider = self.providers.get("history")
            if provider is not None:
                try:
                    bars = provider.daily_bars(inst, days + 10)
                    self._success(db, "history")
                    existing = {r.day for r in rows}
                    for b in bars:
                        if b.day not in existing and b.day < today:
                            db.add(Candle(symbol=inst.symbol, day=b.day, open=b.open, high=b.high,
                                          low=b.low, close=b.close, volume=b.volume, source=provider.name))
                    st = get_state(db, "bars_refreshed", {})
                    st[inst.symbol] = today.isoformat()
                    set_state(db, "bars_refreshed", st)
                    db.flush()
                    rows = db.execute(select(Candle).where(Candle.symbol == inst.symbol)
                                      .order_by(Candle.day)).scalars().all()
                except (ProviderError, NotEntitled) as exc:
                    self._failure(db, "history", exc)
                    emit(db, "data", f"{inst.symbol}: history unavailable - {exc}", level="warn")
        bars = [Bar(r.day, r.open, r.high, r.low, r.close, r.volume) for r in rows if r.day < today]
        return bars[-days:]

    # ------------------------------------------------------------------ FX
    def eur_per_unit(self, db: Session, currency: str) -> tuple[float, FxRate] | None:
        """Return EUR value of 1 unit of `currency`, or None if unavailable."""
        if currency == "EUR":
            return 1.0, FxRate("EUREUR", 1.0, datetime.now(timezone.utc), "identity", "realtime")
        cached = self._fx_cache.get(currency)
        if cached and cached.timestamp and \
                datetime.now(timezone.utc) - cached.timestamp < timedelta(minutes=10) and cached.kind != "reference":
            return 1.0 / cached.rate, cached
        for role in ("fx", "fx_fallback"):
            p = self.providers.get(role)
            if p is None:
                continue
            try:
                fx = p.fx_eur(currency)
                if fx.rate <= 0:
                    raise ProviderError("non-positive FX")
                self._fx_cache[currency] = fx
                self._success(db, role)
                return 1.0 / fx.rate, fx
            except (ProviderError, NotEntitled) as exc:
                self._failure(db, role, exc)
        return None

    # ------------------------------------------------------------------ news
    def refresh_news(self, db: Session, inst: Instrument | None, since: datetime, scorer) -> int:
        p = self.providers.get("news")
        if p is None:
            return 0
        try:
            items = p.news(inst, since)
            self._success(db, "news")
        except (ProviderError, NotEntitled) as exc:
            self._failure(db, "news", exc)
            return 0
        added = 0
        for n in items:
            if db.get(NewsItem, n.id):
                continue
            score, method = scorer(n.headline, n.summary)
            db.add(NewsItem(id=n.id, symbol=n.symbol, headline=n.headline, summary=n.summary,
                            source=n.source, url=n.url, published_at=n.published_at,
                            sentiment=score, sentiment_method=method))
            added += 1
        db.flush()
        return added

    def earnings_within(self, days: int = 3) -> dict[str, str]:
        p = self.providers.get("news")
        if p is None:
            return {}
        try:
            cal = p.earnings_calendar(date.today(), date.today() + timedelta(days=days))
        except (ProviderError, NotEntitled):
            return {}
        return {e["symbol"]: e["date"] for e in cal if e.get("symbol")}
