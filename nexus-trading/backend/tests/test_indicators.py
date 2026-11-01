from dataclasses import replace

import pandas as pd

from nexus.analysis import indicators as ind
from tests.conftest import make_bars


def test_rsi_extremes():
    up = pd.Series([float(i) for i in range(1, 60)])
    assert ind.rsi(up).iloc[-1] == 100.0
    down = pd.Series([float(i) for i in range(60, 1, -1)])
    assert ind.rsi(down).iloc[-1] < 1


def test_sma_and_bollinger():
    s = pd.Series([1.0, 2, 3, 4, 5])
    assert ind.sma(s, 5).iloc[-1] == 3.0
    lo, mid, hi = ind.bollinger(pd.Series([10.0] * 25))
    assert lo.iloc[-1] == mid.iloc[-1] == hi.iloc[-1] == 10.0


def test_macd_positive_in_uptrend():
    line, sig, hist = ind.macd(pd.Series([100 * 1.01 ** i for i in range(100)]))
    assert line.iloc[-1] > 0


def test_snapshot_requires_history():
    assert ind.snapshot(make_bars(30)) is None
    snap = ind.snapshot(make_bars(260))
    assert snap is not None and snap.sma200 is not None and 0 < snap.rsi14 < 100
    assert snap.volume_ratio > 1.5  # last bar has double volume


def test_no_lookahead_future_bars_do_not_change_past_snapshot():
    bars = make_bars(260)
    past = ind.snapshot(bars[:200])
    # append wildly different "future" bars; the snapshot of the first 200 must be identical
    future = bars[:200] + [replace(b, close=b.close * 3, high=b.high * 3) for b in bars[200:]]
    assert ind.snapshot(future[:200]) == past


def test_correlation_identical_series():
    bars = make_bars(120)
    assert ind.correlation(bars, bars) > 0.999
