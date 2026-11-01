"""Deterministic, explainable strategies for agents A, B and C.

Each rule produces: setup_ok (hard pre-conditions), a 0..1 score with its
weighted components, and human-readable reasons. Every number used is
stored in the decision record so the rationale is verifiable afterwards.

News sentiment (lexicon or LLM) has a bounded weight (<= 0.15) and can veto
an entry when strongly negative, but can never create one on its own.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from nexus.analysis.indicators import Snapshot

SENTIMENT_VETO = -0.5


@dataclass
class Signal:
    setup_ok: bool
    score: float
    components: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _fund_score(f: dict | None, asset_type: str) -> tuple[float, str]:
    if asset_type == "etf":
        return 0.5, "ETF: fundamentals neutral"
    if not f:
        return 0.4, "fundamentals unavailable (penalised)"
    pts, notes = 0.0, []
    de = f.get("debt_to_equity")
    if de is not None:
        pts += 0.3 if de < 1.0 else (0.15 if de < 2.0 else 0.0)
        notes.append(f"D/E={de:.2f}")
    nm = f.get("net_margin")
    if nm is not None:
        pts += 0.25 if nm > 10 else (0.1 if nm > 0 else 0.0)
        notes.append(f"margin={nm:.1f}%")
    g = f.get("revenue_growth")
    if g is not None:
        pts += 0.25 if g > 5 else (0.1 if g > 0 else 0.0)
        notes.append(f"rev.growth={g:.1f}%")
    pe = f.get("pe")
    if pe is not None:
        pts += 0.2 if 0 < pe < 30 else (0.05 if 0 < pe < 60 else 0.0)
        notes.append(f"P/E={pe:.1f}")
    return _clip(pts), ", ".join(notes) or "no metrics"


def _sent(sentiment: float | None) -> float:
    return 0.5 if sentiment is None else _clip((sentiment + 1) / 2)


def entry_signal(code: str, s: Snapshot, live_price: float, sentiment: float | None,
                 fundamentals: dict | None, asset_type: str) -> Signal:
    if sentiment is not None and sentiment <= SENTIMENT_VETO:
        return Signal(False, 0.0, {}, [f"news sentiment {sentiment:+.2f} <= veto {SENTIMENT_VETO}"])
    fs, fnote = _fund_score(fundamentals, asset_type)
    reasons: list[str] = []
    comp: dict[str, float] = {}

    if code == "A":
        need = [
            (s.sma200 is not None and live_price > s.sma200, "price above SMA200"),
            (s.sma50 is not None and s.sma200 is not None and s.sma50 > s.sma200, "SMA50 above SMA200"),
            (s.rsi14 is not None and 40 <= s.rsi14 <= 60, f"RSI14 in 40-60 ({s.rsi14})"),
            (s.vol20 is not None and s.vol20 <= 0.30, f"20d vol <= 30% ({s.vol20})"),
        ]
        comp["trend"] = 0.30 * (1.0 if s.sma50 and live_price > s.sma50 else 0.3)
        dist = abs(live_price / s.sma50 - 1) if s.sma50 else 1
        comp["pullback"] = 0.20 * _clip(1 - dist / 0.05)
        comp["macd_turn"] = 0.15 * (1.0 if (s.macd_hist or 0) > (s.macd_hist_prev or 0) else 0.0)
        comp["momentum"] = 0.10 * _clip(((s.momentum_63 or 0) + 0.05) / 0.15)
        comp["sentiment"] = 0.10 * _sent(sentiment)
        comp["fundamentals"] = 0.15 * fs
    elif code == "B":
        need = [
            (s.sma50 is not None and live_price > s.sma50, "price above SMA50"),
            (s.sma50 is not None and s.sma200 is not None and s.sma50 > s.sma200, "SMA50 above SMA200"),
            (s.macd is not None and s.macd_signal is not None and s.macd > s.macd_signal, "MACD above signal"),
            (s.rsi14 is not None and 45 <= s.rsi14 <= 70, f"RSI14 in 45-70 ({s.rsi14})"),
        ]
        fresh_cross = (s.macd_hist or 0) > 0 and (s.macd_hist_prev or 0) <= 0
        comp["macd"] = 0.20 * (1.0 if fresh_cross else (0.6 if (s.macd_hist or 0) > (s.macd_hist_prev or 0) else 0.2))
        comp["momentum"] = 0.20 * _clip((s.momentum_63 or 0) / 0.15)
        comp["volume"] = 0.15 * _clip(((s.volume_ratio or 0) - 0.8) / 0.7)
        strength = (live_price / s.sma50 - 1) if s.sma50 else 0
        comp["trend"] = 0.20 * _clip(1 - abs(strength - 0.03) / 0.07)
        comp["sentiment"] = 0.12 * _sent(sentiment)
        comp["fundamentals"] = 0.13 * fs
    elif code == "C":
        need = [
            (s.high_20 is not None and live_price > s.high_20, f"breakout above 20d high ({s.high_20})"),
            (s.volume_ratio is not None and s.volume_ratio >= 1.3, f"volume >= 1.3x avg ({s.volume_ratio})"),
            (s.rsi14 is not None and s.rsi14 < 80, f"RSI14 < 80 ({s.rsi14})"),
        ]
        brk = (live_price / s.high_20 - 1) if s.high_20 else 0
        comp["breakout"] = 0.30 * _clip(brk / 0.03)
        comp["volume"] = 0.20 * _clip(((s.volume_ratio or 0) - 1.0) / 1.5)
        comp["momentum"] = 0.20 * _clip((s.momentum_63 or 0) / 0.25)
        comp["sentiment"] = 0.15 * _sent(sentiment)
        comp["fundamentals"] = 0.15 * fs
    else:
        raise ValueError(code)

    setup_ok = all(ok for ok, _ in need)
    reasons += [("OK " if ok else "FAIL ") + txt for ok, txt in need]
    reasons.append(f"fundamentals: {fnote}")
    if sentiment is not None:
        reasons.append(f"news sentiment {sentiment:+.2f}")
    score = round(sum(comp.values()), 4)
    return Signal(setup_ok, score, {k: round(v, 4) for k, v in comp.items()}, reasons)


def exit_signal(code: str, s: Snapshot, live_price: float) -> str | None:
    """Discretionary (signal-based) exit; stop-loss/take-profit are handled separately."""
    if code == "A" and s.sma50 and live_price < s.sma50 * 0.98:
        return "price fell 2% below SMA50 (trend broken)"
    if code == "B" and s.sma20 and (s.macd_hist or 0) < 0 and live_price < s.sma20:
        return "MACD histogram negative and price below SMA20"
    if code == "C" and s.sma20 and live_price < s.sma20:
        return "price below SMA20 (breakout failed)"
    return None
