from datetime import timedelta

from sqlalchemy import select

from nexus.broker import paper
from nexus.db import session_scope
from nexus.engine import experiments
from nexus.market.universe import BY_SYMBOL
from nexus.models import ClosedTrade, Order, Position
from tests.conftest import MARKET_OPEN as T0

AAPL = BY_SYMBOL["AAPL"]
SAP = BY_SYMBOL["SAP@XETR"]


def fq(price=100.0, at=T0, tradable=True, bid=None, ask=None, volume=1e7):
    return paper.FillQuote(price=price, bid=bid, ask=ask, volume=volume, received_at=at,
                           timestamp=at - timedelta(seconds=3), tradable=tradable, source="test")


def setup_agent(db):
    exp = experiments.start(db, "48h", 400.0, now=T0)
    return exp, experiments.agents_of(db, exp)[1]  # agent B


def test_order_not_filled_with_triggering_quote_and_fills_later():
    with session_scope() as db:
        _, a = setup_agent(db)
        o = paper.submit(db, a, AAPL, "buy", 0.2, client_order_id="x1", stop_price=95, take_profit=110, now=T0)
        # same instant / same quote -> must not fill (no instant execution)
        assert paper.process_order(db, a, o, AAPL, fq(at=T0), 0.925, True, now=T0) == "pending"
        later = T0 + timedelta(seconds=120)
        assert paper.process_order(db, a, o, AAPL, fq(at=later, bid=99.98, ask=100.02), 0.925, True, now=later) == "filled"
        assert o.fill_price > 100.02  # ask + slippage
        pos = db.execute(select(Position)).scalar_one()
        assert pos.qty == 0.2 and pos.stop_price == 95
        expected_cash = 400 - o.qty * o.fill_price * 0.925 - o.fees_eur
        assert abs(a.cash - expected_cash) < 1e-6
        assert o.fees_eur > 0  # FX fee on a USD instrument


def test_duplicate_client_order_id_and_pending_symbol_rejected():
    with session_scope() as db:
        _, a = setup_agent(db)
        assert paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="dup", now=T0) is not None
        assert paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="dup", now=T0) is None
        assert paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="other", now=T0) is None
        assert db.execute(select(Order)).scalars().all().__len__() == 1


def test_rejections_market_closed_cash_liquidity_expiry_and_no_short():
    with session_scope() as db:
        _, a = setup_agent(db)
        later = T0 + timedelta(seconds=60)
        o = paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="c1", now=T0)
        assert paper.process_order(db, a, o, AAPL, fq(at=later), 0.925, False, now=later) == "rejected"
        assert o.status_reason == "market_closed"
        o = paper.submit(db, a, AAPL, "buy", 100.0, client_order_id="c2", stop_price=1, take_profit=200, now=T0)
        assert paper.process_order(db, a, o, AAPL, fq(at=later), 0.925, True, now=later) == "rejected"
        assert o.status_reason == "insufficient_cash"
        o = paper.submit(db, a, AAPL, "buy", 1.0, client_order_id="c3", now=T0)
        assert paper.process_order(db, a, o, AAPL, fq(at=later, volume=50), 0.925, True, now=later) == "rejected"
        assert o.status_reason == "insufficient_liquidity"
        o = paper.submit(db, a, AAPL, "sell", 1.0, client_order_id="c4", now=T0)
        assert paper.process_order(db, a, o, AAPL, fq(at=later), 0.925, True, now=later) == "rejected"
        assert o.status_reason == "no_position_to_sell"
        o = paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="c5", now=T0)
        late = T0 + timedelta(hours=2)
        assert paper.process_order(db, a, o, AAPL, fq(at=late), 0.925, True, now=late) == "expired"


def test_buy_without_stop_loss_rejected():
    with session_scope() as db:
        _, a = setup_agent(db)
        o = paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="ns", now=T0)
        later = T0 + timedelta(seconds=60)
        assert paper.process_order(db, a, o, AAPL, fq(at=later), 0.925, True, now=later) == "rejected"
        assert o.status_reason == "missing_stop_loss_or_take_profit"


def test_untrusted_data_keeps_order_pending():
    with session_scope() as db:
        _, a = setup_agent(db)
        o = paper.submit(db, a, AAPL, "buy", 0.1, client_order_id="u1", now=T0)
        later = T0 + timedelta(seconds=60)
        assert paper.process_order(db, a, o, AAPL, fq(at=later, tradable=False), 0.925, True, now=later) == "pending"
        assert paper.process_order(db, a, o, AAPL, fq(at=later), None, True, now=later) == "pending"  # no FX


def test_limit_order_only_fills_at_or_better():
    with session_scope() as db:
        _, a = setup_agent(db)
        o = paper.submit(db, a, SAP, "buy", 0.1, client_order_id="l1", order_type="limit",
                         limit_price=99.0, stop_price=95, take_profit=110, now=T0)
        later = T0 + timedelta(seconds=60)
        assert paper.process_order(db, a, o, SAP, fq(price=100, at=later), 1.0, True, now=later) == "pending"
        assert paper.process_order(db, a, o, SAP, fq(price=98, at=later), 1.0, True, now=later) == "filled"
        assert o.fill_price <= 99.0


def test_round_trip_realized_pnl_and_costs():
    with session_scope() as db:
        _, a = setup_agent(db)
        t1 = T0 + timedelta(seconds=60)
        b = paper.submit(db, a, SAP, "buy", 0.2, client_order_id="r1", stop_price=90, take_profit=120, now=T0)
        paper.process_order(db, a, b, SAP, fq(price=100, at=t1), 1.0, True, now=t1)
        s = paper.submit(db, a, SAP, "sell", 0.2, client_order_id="r2", purpose="take_profit", now=t1)
        t2 = t1 + timedelta(seconds=60)
        assert paper.process_order(db, a, s, SAP, fq(price=110, at=t2), 1.0, True, now=t2) == "filled"
        trade = db.execute(select(ClosedTrade)).scalar_one()
        assert trade.exit_reason == "take_profit"
        assert abs(trade.pnl_eur - (trade.proceeds_eur - trade.cost_eur)) < 1e-9
        assert 1.5 < trade.pnl_eur < 2.0  # +10% on 20 EUR minus spread/slippage
        assert db.execute(select(Position)).first() is None
        assert abs(a.cash - (400 + trade.pnl_eur)) < 1e-6
