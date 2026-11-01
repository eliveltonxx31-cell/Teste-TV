"""Technical indicators computed on COMPLETED daily bars only (no look-ahead)."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from nexus.market.base import Bar

MIN_BARS = 60


def to_frame(bars: list[Bar]) -> pd.DataFrame:
    df = pd.DataFrame([asdict(b) for b in bars])
    if df.empty:
        return df
    return df.set_index("day").sort_index()


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return line, sig, line - sig


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return mid - k * sd, mid, mid + k * sd


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()],
                   axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def annualized_vol(close: pd.Series, n: int = 20) -> pd.Series:
    return np.log(close).diff().rolling(n, min_periods=n).std() * np.sqrt(252)


def support_resistance(df: pd.DataFrame, lookback: int = 60) -> tuple[float, float]:
    window = df.tail(lookback)
    return float(window["low"].min()), float(window["high"].max())


@dataclass
class Snapshot:
    close: float
    sma20: float | None
    sma50: float | None
    sma200: float | None
    rsi14: float | None
    macd: float | None
    macd_signal: float | None
    macd_hist: float | None
    macd_hist_prev: float | None
    bb_low: float | None
    bb_mid: float | None
    bb_high: float | None
    atr14: float | None
    vol20: float | None
    momentum_63: float | None
    volume_ratio: float | None
    high_20: float | None
    support: float | None
    resistance: float | None
    bars: int

    def to_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def _last(s: pd.Series, offset: int = 1) -> float | None:
    if len(s) < offset:
        return None
    v = s.iloc[-offset]
    return None if pd.isna(v) else float(v)


def snapshot(bars: list[Bar]) -> Snapshot | None:
    if len(bars) < MIN_BARS:
        return None
    df = to_frame(bars)
    c = df["close"]
    line, sig, hist = macd(c)
    lo, mid, hi = bollinger(c)
    sup, res = support_resistance(df)
    vol_avg = df["volume"].rolling(20, min_periods=20).mean()
    vr = None
    if _last(vol_avg) and _last(vol_avg) > 0:
        vr = float(df["volume"].iloc[-1] / _last(vol_avg))
    mom = float(c.iloc[-1] / c.iloc[-64] - 1) if len(c) > 64 else None
    # 20-day high of PREVIOUS bars (breakout reference excludes the last bar itself)
    high20 = float(df["high"].iloc[-21:-1].max()) if len(df) > 21 else None
    return Snapshot(
        close=float(c.iloc[-1]), sma20=_last(sma(c, 20)), sma50=_last(sma(c, 50)),
        sma200=_last(sma(c, 200)), rsi14=_last(rsi(c)), macd=_last(line), macd_signal=_last(sig),
        macd_hist=_last(hist), macd_hist_prev=_last(hist, 2), bb_low=_last(lo), bb_mid=_last(mid),
        bb_high=_last(hi), atr14=_last(atr(df)), vol20=_last(annualized_vol(c)), momentum_63=mom,
        volume_ratio=vr, high_20=high20, support=sup, resistance=res, bars=len(df))


def returns_series(bars: list[Bar], n: int = 60) -> pd.Series:
    df = to_frame(bars)
    if df.empty:
        return pd.Series(dtype=float)
    return np.log(df["close"]).diff().dropna().tail(n)


def correlation(a: list[Bar], b: list[Bar], n: int = 60) -> float | None:
    ra, rb = returns_series(a, n + 5), returns_series(b, n + 5)
    joined = pd.concat([ra, rb], axis=1, join="inner").dropna().tail(n)
    if len(joined) < 20:
        return None
    v = joined.iloc[:, 0].corr(joined.iloc[:, 1])
    return None if pd.isna(v) else float(v)
