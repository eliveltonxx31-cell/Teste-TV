from datetime import timedelta

from nexus.market.base import Feed, Quote
from nexus.market.validator import validate_quote
from tests.conftest import MARKET_OPEN as NOW


def q(**kw):
    base = dict(symbol="AAPL", name="Apple", exchange="XNAS", currency="USD", price=100.0,
                timestamp=NOW - timedelta(seconds=5), source="t", feed=Feed.REALTIME, received_at=NOW,
                prev_close=99.0)
    base.update(kw)
    return Quote(**base)


def check(quote, **kw):
    args = dict(market_open=True, max_age_s=120, allow_delayed=False, now=NOW)
    args.update(kw)
    return validate_quote(quote, **args)


def test_fresh_realtime_quote_is_tradable():
    c = check(q())
    assert c.tradable and c.feed == Feed.REALTIME and c.issues == []


def test_stale_quote_blocked():
    c = check(q(timestamp=NOW - timedelta(seconds=600)))
    assert not c.tradable and c.feed == Feed.STALE


def test_delayed_feed_not_tradable_by_default_and_labelled():
    c = check(q(feed=Feed.DELAYED, timestamp=NOW - timedelta(minutes=15)))
    assert not c.tradable and c.feed == Feed.DELAYED
    assert check(q(feed=Feed.DELAYED, timestamp=NOW - timedelta(minutes=15)), allow_delayed=True).tradable


def test_missing_timestamp_is_unknown():
    c = check(q(timestamp=None))
    assert not c.tradable and c.feed == Feed.UNKNOWN


def test_future_timestamp_and_bad_prices():
    assert "timestamp_in_future" in check(q(timestamp=NOW + timedelta(minutes=5))).issues
    assert "invalid_price" in check(q(price=0.0)).issues
    assert "invalid_price" in check(q(price=float("nan"))).issues


def test_crossed_book_and_wide_spread():
    assert "crossed_or_invalid_book" in check(q(bid=101, ask=100)).issues
    assert "spread_too_wide" in check(q(bid=90, ask=110)).issues


def test_inconsistent_prices():
    assert "gap_vs_prev_close_exceeds_25pct" in check(q(price=150, prev_close=100)).issues
    assert "price_jump_vs_last_quote" in check(q(), last_price=80.0, last_ts=NOW - timedelta(minutes=2)).issues
    assert "cross_source_mismatch" in check(q(), cross_price=103.0).issues
    assert check(q(), cross_price=100.5).tradable


def test_market_closed_not_tradable():
    assert not check(q(), market_open=False).tradable
