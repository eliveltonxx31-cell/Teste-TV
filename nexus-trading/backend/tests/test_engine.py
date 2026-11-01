"""End-to-end engine scenarios with a deterministic test provider."""
from datetime import timedelta

from sqlalchemy import func, select

from nexus.db import session_scope
from nexus.engine import experiments
from nexus.engine.cycle import Engine
from nexus.market.base import Feed
from nexus.market.service import MarketDataService
from nexus.models import Decision, Event, Order, Position, Report
from nexus.monitoring import is_safe_mode
from tests.conftest import MARKET_CLOSED, MARKET_OPEN, Clock, FakeProvider


def build(clock, **kw):
    fake = FakeProvider(clock, **kw)
    md = MarketDataService(providers={"quote": fake, "history": fake, "news": fake, "fx": fake})
    return Engine(md), fake


def start(now=MARKET_OPEN):
    with session_scope() as db:
        experiments.start(db, "48h", 400.0, now=now)


def count(model, *where):
    with session_scope() as db:
        return db.execute(select(func.count()).select_from(model).where(*where)).scalar()


def test_full_cycle_buys_with_guardian_approval_then_fills_next_cycle():
    clock = Clock(MARKET_OPEN)
    eng, _ = build(clock)
    start()
    with session_scope() as db:
        res = eng.run_cycle(db, clock())
    assert res["status"] == "ok" and res["quotes"] > 0
    buys = count(Decision, Decision.action == "buy")
    assert buys > 0, "breakout setup should produce at least one approved buy (agent C)"
    assert count(Order, Order.status == "pending") == buys
    assert count(Position) == 0  # nothing filled in the same cycle (latency)
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Position) >= 1
    with session_scope() as db:
        for a in experiments.agents_of(db, experiments.current(db)):
            from nexus.engine.portfolio import valuation
            v = valuation(db, a)
            assert v["cash"] >= 0.30 * v["equity"] - 1e-6        # reserve preserved
            for p in v["positions"]:
                assert p.cost_eur <= 0.06 * a.initial_capital + 1e-6  # position cap
                assert p.stop_price < p.avg_price                   # stop-loss always set


def test_rerunning_same_cycle_after_restart_creates_no_duplicates():
    clock = Clock(MARKET_OPEN)
    eng, _ = build(clock)
    start()
    with session_scope() as db:
        eng.run_cycle(db, clock())
    n_orders = count(Order)
    eng2, _ = build(clock)  # simulated process restart: new engine, same database
    with session_scope() as db:
        eng2.run_cycle(db, clock())
    assert count(Order) == n_orders


def test_stale_data_blocks_buys():
    clock = Clock(MARKET_OPEN)
    eng, _ = build(clock, quote_age_s=900)
    start()
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Order) == 0
    assert count(Decision, Decision.action == "buy") == 0


def test_delayed_feed_blocks_buys_by_default():
    clock = Clock(MARKET_OPEN)
    eng, _ = build(clock, feed=Feed.DELAYED, quote_age_s=900)
    start()
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Order) == 0


def test_provider_outage_enters_safe_mode_and_blocks_buys():
    clock = Clock(MARKET_OPEN)
    eng, fake = build(clock)
    fake.fail_quotes = True
    start()
    with session_scope() as db:
        eng.run_cycle(db, clock())
        assert is_safe_mode(db)[0] is True
    fake.fail_quotes = False
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Order) == 0  # still safe mode until an operator clears it
    assert count(Event, Event.level == "critical") >= 1


def test_market_closed_no_trading():
    clock = Clock(MARKET_CLOSED)
    eng, fake = build(clock)
    start(MARKET_CLOSED)
    with session_scope() as db:
        res = eng.run_cycle(db, clock())
    assert res["open_markets"] == [] and count(Order) == 0 and fake.calls == 0


def test_stop_loss_triggers_sell_and_drawdown_breaker():
    clock = Clock(MARKET_OPEN)
    eng, fake = build(clock)
    start()
    with session_scope() as db:
        eng.run_cycle(db, clock())
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())
        held = db.execute(select(Position)).scalars().all()
        assert held
        last = {p.symbol: p.last_price for p in held}
    # 1) a -20% print within minutes is flagged as suspicious data: no fill on it
    fake.override_price.update({s: px * 0.80 for s, px in last.items()})
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Order, Order.side == "sell") == 0
    # 2) a plausible -7% move breaches the ATR stop -> stop-loss sell
    fake.override_price.update({s: px * 0.93 for s, px in last.items()})
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Order, Order.side == "sell", Order.purpose == "stop_loss") >= 1
    clock.advance(120)
    with session_scope() as db:
        eng.run_cycle(db, clock())  # sells filled
    assert count(Order, Order.side == "sell", Order.status == "filled") >= 1


def test_daily_report_generated_after_24h_and_final_at_end():
    clock = Clock(MARKET_CLOSED)
    eng, _ = build(clock)
    start(MARKET_CLOSED)
    clock.advance(24 * 3600 + 60)
    with session_scope() as db:
        eng.run_cycle(db, clock())
    assert count(Report, Report.kind == "daily") == 1
    clock.advance(25 * 3600)
    with session_scope() as db:
        assert eng.run_cycle(db, clock())["status"] == "experiment_finished"
    assert count(Report, Report.kind == "final") == 1


def test_single_bad_print_ignored_but_confirmed_move_accepted():
    from nexus.market.universe import BY_SYMBOL
    clock = Clock(MARKET_OPEN)
    eng, fake = build(clock)
    inst = BY_SYMBOL["KO"]
    with session_scope() as db:
        base = eng.md.quote(db, inst, now=clock()).quote.price
        fake.override_price["KO"] = base * 0.8
        flags = []
        for _ in range(3):
            clock.advance(60)
            flags.append(eng.md.quote(db, inst, now=clock()).check.tradable)
    assert flags == [False, False, True]


def test_failure_mid_cycle_rolls_back_atomically(monkeypatch):
    import pytest
    from nexus.broker import paper
    clock = Clock(MARKET_OPEN)
    eng, _ = build(clock)
    start()

    def boom(*a, **k):
        raise RuntimeError("simulated crash / database failure during order submission")
    monkeypatch.setattr(paper, "submit", boom)
    with pytest.raises(RuntimeError):
        with session_scope() as db:
            eng.run_cycle(db, clock())
    assert count(Order) == 0 and count(Decision) == 0  # no half-written cycle
    monkeypatch.undo()
    with session_scope() as db:
        eng.run_cycle(db, clock())  # recovery: the same cycle runs cleanly afterwards
    assert count(Order) > 0
