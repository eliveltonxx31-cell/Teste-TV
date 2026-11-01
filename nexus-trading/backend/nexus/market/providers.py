"""Adapters for real market-data vendors.

Endpoints follow each vendor's public REST documentation. Every adapter:
  * raises ProviderError on HTTP/auth/rate-limit/malformed payloads,
  * never fabricates a value (missing fields stay None),
  * attaches the declared feed type from the operator's plan entitlement.

NOTE: the endpoint shapes were written against vendor documentation and must
be smoke-tested with real keys (``python -m nexus.cli probe``) before an
experiment starts; vendors change payloads and plan entitlements over time.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone

import httpx

from nexus.market.base import (Bar, Feed, FxRate, Instrument, MarketDataProvider, News,
                               NotEntitled, ProviderError, Quote, to_float)

TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _get(url: str, params: dict, provider: str) -> dict | list:
    try:
        r = httpx.get(url, params=params, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise ProviderError(f"{provider}: connection error: {exc.__class__.__name__}") from exc
    if r.status_code in (401, 403):
        raise ProviderError(f"{provider}: unauthorized/forbidden (HTTP {r.status_code}) - check key/plan")
    if r.status_code == 429:
        raise ProviderError(f"{provider}: rate limit exceeded (HTTP 429)")
    if r.status_code >= 400:
        raise ProviderError(f"{provider}: HTTP {r.status_code}")
    try:
        return r.json()
    except ValueError as exc:
        raise ProviderError(f"{provider}: non-JSON response") from exc


# ---------------------------------------------------------------------------
# Finnhub  (https://finnhub.io/docs/api)
# ---------------------------------------------------------------------------
class FinnhubProvider(MarketDataProvider):
    name = "finnhub"
    BASE = "https://finnhub.io/api/v1"
    SUFFIX = {"XETR": ".DE", "XPAR": ".PA", "XAMS": ".AS"}

    def _sym(self, inst: Instrument) -> str:
        return inst.ticker + self.SUFFIX.get(inst.exchange, "")

    def _call(self, path: str, **params):
        params["token"] = self.require_key()
        data = _get(f"{self.BASE}{path}", params, self.name)
        if isinstance(data, dict) and data.get("error"):
            raise ProviderError(f"finnhub: {data['error']}")
        return data

    def quote(self, inst: Instrument) -> Quote:
        feed = self.declared_feed(inst)
        d = self._call("/quote", symbol=self._sym(inst))
        price, ts = to_float(d.get("c")), d.get("t")
        if not price or not ts:
            raise ProviderError(f"finnhub: empty quote for {inst.symbol} (not covered by plan?)")
        return Quote(symbol=inst.symbol, name=inst.name, exchange=inst.exchange,
                     currency=inst.currency, price=price,
                     timestamp=datetime.fromtimestamp(int(ts), tz=timezone.utc),
                     source=self.name, feed=feed, prev_close=to_float(d.get("pc")),
                     change_pct=to_float(d.get("dp")))

    def news(self, inst: Instrument | None, since: datetime) -> list[News]:
        if inst is None:
            raw = self._call("/news", category="general")
        else:
            raw = self._call("/company-news", symbol=self._sym(inst),
                             **{"from": since.date().isoformat(), "to": date.today().isoformat()})
        out = []
        for n in raw if isinstance(raw, list) else []:
            ts = datetime.fromtimestamp(int(n.get("datetime", 0)), tz=timezone.utc)
            if ts < since or not n.get("headline"):
                continue
            uid = hashlib.sha256(f"finnhub:{n.get('id')}:{n.get('url')}".encode()).hexdigest()
            out.append(News(id=uid, symbol=inst.symbol if inst else None, headline=n["headline"],
                            summary=n.get("summary"), source=n.get("source", "finnhub"),
                            url=n.get("url"), published_at=ts))
        return out

    def fundamentals(self, inst: Instrument) -> dict:
        d = self._call("/stock/metric", symbol=self._sym(inst), metric="all")
        m = d.get("metric") or {}
        if not m:
            raise NotEntitled(f"finnhub: no fundamentals for {inst.symbol}")
        return {
            "pe": to_float(m.get("peBasicExclExtraTTM")),
            "debt_to_equity": to_float(m.get("totalDebt/totalEquityQuarterly")),
            "revenue_growth": to_float(m.get("revenueGrowthTTMYoy")),
            "eps_growth": to_float(m.get("epsGrowthTTMYoy")),
            "net_margin": to_float(m.get("netProfitMarginTTM")),
            "roe": to_float(m.get("roeTTM")),
            "beta": to_float(m.get("beta")),
            "source": self.name,
        }

    def earnings_calendar(self, start: date, end: date) -> list[dict]:
        d = self._call("/calendar/earnings", **{"from": start.isoformat(), "to": end.isoformat()})
        return [{"symbol": e.get("symbol"), "date": e.get("date"), "hour": e.get("hour"),
                 "eps_estimate": e.get("epsEstimate"), "source": self.name}
                for e in (d.get("earningsCalendar") or [])]


# ---------------------------------------------------------------------------
# Twelve Data  (https://twelvedata.com/docs)
# ---------------------------------------------------------------------------
class TwelveDataProvider(MarketDataProvider):
    name = "twelvedata"
    BASE = "https://api.twelvedata.com"

    def _call(self, path: str, **params):
        params["apikey"] = self.require_key()
        d = _get(f"{self.BASE}{path}", params, self.name)
        if isinstance(d, dict) and d.get("status") == "error":
            code = d.get("code")
            msg = d.get("message", "error")
            if code in (403, 404):
                raise NotEntitled(f"twelvedata: {msg}")
            raise ProviderError(f"twelvedata: {code} {msg}")
        return d

    def _sym_params(self, inst: Instrument) -> dict:
        p = {"symbol": inst.ticker}
        if inst.market != "US":
            p["mic_code"] = inst.exchange
        return p

    def quote(self, inst: Instrument) -> Quote:
        feed = self.declared_feed(inst)
        d = self._call("/quote", **self._sym_params(inst))
        price = to_float(d.get("close"))
        ts = d.get("last_quote_at") or d.get("timestamp")
        if not price or not ts:
            raise ProviderError(f"twelvedata: incomplete quote for {inst.symbol}")
        if d.get("currency") and d["currency"].upper() != inst.currency:
            raise ProviderError(f"twelvedata: currency mismatch {d['currency']} != {inst.currency}")
        return Quote(symbol=inst.symbol, name=d.get("name") or inst.name, exchange=inst.exchange,
                     currency=inst.currency, price=price,
                     timestamp=datetime.fromtimestamp(int(ts), tz=timezone.utc),
                     source=self.name, feed=feed, volume=to_float(d.get("volume")),
                     prev_close=to_float(d.get("previous_close")),
                     change_pct=to_float(d.get("percent_change")))

    def daily_bars(self, inst: Instrument, days: int = 300) -> list[Bar]:
        d = self._call("/time_series", interval="1day", outputsize=min(days, 5000),
                       order="ASC", **self._sym_params(inst))
        bars = []
        for v in d.get("values") or []:
            o, h, l, c = (to_float(v.get(k)) for k in ("open", "high", "low", "close"))
            if None in (o, h, l, c):
                continue
            bars.append(Bar(day=date.fromisoformat(v["datetime"][:10]), open=o, high=h, low=l,
                            close=c, volume=to_float(v.get("volume")) or 0.0))
        if not bars:
            raise ProviderError(f"twelvedata: no bars for {inst.symbol}")
        return sorted(bars, key=lambda b: b.day)

    def fx_eur(self, currency: str) -> FxRate:
        d = self._call("/exchange_rate", symbol=f"EUR/{currency}")
        rate = to_float(d.get("rate"))
        if not rate:
            raise ProviderError("twelvedata: empty FX rate")
        ts = d.get("timestamp")
        return FxRate(pair=f"EUR{currency}", rate=rate, source=self.name, kind="realtime",
                      timestamp=datetime.fromtimestamp(int(ts), tz=timezone.utc) if ts else None)


# ---------------------------------------------------------------------------
# Alpha Vantage  (https://www.alphavantage.co/documentation/)
# ---------------------------------------------------------------------------
class AlphaVantageProvider(MarketDataProvider):
    name = "alphavantage"
    BASE = "https://www.alphavantage.co/query"
    SUFFIX = {"XETR": ".DEX", "XPAR": ".PAR", "XAMS": ".AMS"}

    def _call(self, **params):
        params["apikey"] = self.require_key()
        d = _get(self.BASE, params, self.name)
        for key in ("Note", "Information", "Error Message"):
            if isinstance(d, dict) and key in d:
                raise ProviderError(f"alphavantage: {d[key][:120]}")
        return d

    def quote(self, inst: Instrument) -> Quote:
        feed = self.declared_feed(inst)
        d = (self._call(function="GLOBAL_QUOTE", symbol=inst.ticker + self.SUFFIX.get(inst.exchange, ""))
             .get("Global Quote") or {})
        price = to_float(d.get("05. price"))
        if not price:
            raise ProviderError(f"alphavantage: empty quote for {inst.symbol}")
        # GLOBAL_QUOTE only returns the trading *day*, not the time of the last
        # trade. Without an exact timestamp the quote is UNKNOWN -> not tradable.
        return Quote(symbol=inst.symbol, name=inst.name, exchange=inst.exchange,
                     currency=inst.currency, price=price, timestamp=None, source=self.name,
                     feed=Feed.UNKNOWN if feed == Feed.REALTIME else feed,
                     volume=to_float(d.get("06. volume")),
                     prev_close=to_float(d.get("08. previous close")),
                     change_pct=to_float(str(d.get("10. change percent", "")).rstrip("%")))

    def daily_bars(self, inst: Instrument, days: int = 300) -> list[Bar]:
        d = self._call(function="TIME_SERIES_DAILY",
                       symbol=inst.ticker + self.SUFFIX.get(inst.exchange, ""),
                       outputsize="full" if days > 100 else "compact")
        series = d.get("Time Series (Daily)") or {}
        bars = [Bar(day=date.fromisoformat(k), open=float(v["1. open"]), high=float(v["2. high"]),
                    low=float(v["3. low"]), close=float(v["4. close"]), volume=float(v["5. volume"]))
                for k, v in series.items()]
        if not bars:
            raise ProviderError(f"alphavantage: no bars for {inst.symbol}")
        return sorted(bars, key=lambda b: b.day)[-days:]

    def fx_eur(self, currency: str) -> FxRate:
        d = self._call(function="CURRENCY_EXCHANGE_RATE", from_currency="EUR", to_currency=currency)
        r = d.get("Realtime Currency Exchange Rate") or {}
        rate = to_float(r.get("5. Exchange Rate"))
        if not rate:
            raise ProviderError("alphavantage: empty FX")
        ts = r.get("6. Last Refreshed")
        parsed = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc) if ts else None
        return FxRate(pair=f"EUR{currency}", rate=rate, timestamp=parsed, source=self.name, kind="delayed")


# ---------------------------------------------------------------------------
# Massive, formerly Polygon.io  (https://massive.com/docs) - US only
# ---------------------------------------------------------------------------
class MassiveProvider(MarketDataProvider):
    name = "massive"
    BASE = "https://api.polygon.io"  # legacy host kept working after the rebrand

    def _call(self, path: str, **params):
        params["apiKey"] = self.require_key()
        d = _get(f"{self.BASE}{path}", params, self.name)
        if isinstance(d, dict) and d.get("status") in ("ERROR", "NOT_AUTHORIZED"):
            raise NotEntitled(f"massive: {d.get('message') or d.get('error')}")
        return d

    def quote(self, inst: Instrument) -> Quote:
        if inst.market != "US":
            raise NotEntitled("massive: US equities only")
        feed = self.declared_feed(inst)
        d = self._call(f"/v2/snapshot/locale/us/markets/stocks/tickers/{inst.ticker}")
        t = d.get("ticker") or {}
        last = t.get("lastTrade") or {}
        q = t.get("lastQuote") or {}
        price = to_float(last.get("p"))
        ts_ns = last.get("t") or t.get("updated")
        if not price or not ts_ns:
            raise ProviderError(f"massive: empty snapshot for {inst.symbol}")
        return Quote(symbol=inst.symbol, name=inst.name, exchange=inst.exchange,
                     currency=inst.currency, price=price,
                     timestamp=datetime.fromtimestamp(int(ts_ns) / 1e9, tz=timezone.utc),
                     source=self.name, feed=feed, bid=to_float(q.get("p")), ask=to_float(q.get("P")),
                     volume=to_float((t.get("day") or {}).get("v")),
                     prev_close=to_float((t.get("prevDay") or {}).get("c")),
                     change_pct=to_float(t.get("todaysChangePerc")))

    def daily_bars(self, inst: Instrument, days: int = 300) -> list[Bar]:
        if inst.market != "US":
            raise NotEntitled("massive: US equities only")
        end = date.today()
        start = end - timedelta(days=int(days * 1.5) + 10)
        d = self._call(f"/v2/aggs/ticker/{inst.ticker}/range/1/day/{start}/{end}",
                       adjusted="true", sort="asc", limit=50000)
        bars = [Bar(day=datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc).date(), open=r["o"],
                    high=r["h"], low=r["l"], close=r["c"], volume=r.get("v", 0.0))
                for r in d.get("results") or []]
        if not bars:
            raise ProviderError(f"massive: no bars for {inst.symbol}")
        return bars[-days:]


# ---------------------------------------------------------------------------
# European Central Bank reference rates - free, official, DAILY (not intraday)
# ---------------------------------------------------------------------------
class ECBProvider(MarketDataProvider):
    name = "ecb"
    URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{cur}.EUR.SP00.A"

    def fx_eur(self, currency: str) -> FxRate:
        d = _get(self.URL.format(cur=currency), {"lastNObservations": 1, "format": "jsondata"}, self.name)
        try:
            series = next(iter(d["dataSets"][0]["series"].values()))
            obs = next(iter(series["observations"].values()))
            rate = float(obs[0])
            day = d["structure"]["dimensions"]["observation"][0]["values"][-1]["id"]
        except (KeyError, IndexError, StopIteration, TypeError, ValueError) as exc:
            raise ProviderError("ecb: unexpected payload") from exc
        ts = datetime.fromisoformat(day).replace(hour=14, minute=15, tzinfo=timezone.utc)
        return FxRate(pair=f"EUR{currency}", rate=rate, timestamp=ts, source=self.name, kind="reference")


PROVIDERS = {
    "finnhub": FinnhubProvider,
    "twelvedata": TwelveDataProvider,
    "alphavantage": AlphaVantageProvider,
    "massive": MassiveProvider,
    "ecb": ECBProvider,
}
