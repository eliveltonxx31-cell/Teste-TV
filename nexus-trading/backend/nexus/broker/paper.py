"""Paper-trading executor. NO real broker connectivity exists in this codebase.

Realism rules:
  * an order is never filled with the quote that triggered it: it becomes
    eligible only after ORDER_LATENCY_SECONDS and is filled with a quote
    RECEIVED after that moment (no look-ahead, no instant fills);
  * buys fill at ask (or last + estimated half-spread) plus slippage, sells at bid
    minus slippage; stops fill at the next available price (gaps are realistic);
  * fees: fixed + % of notional + FX conversion fee for non-EUR instruments;
  * orders are rejected when market is closed, data is not tradable, cash is
    insufficient or the order is too large for the instrument's liquidity;
  * every order carries a unique client_order_id -> duplicates are impossible.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.config import get_settings
from nexus.market.base import Instrument
from nexus.models import Agent, ClosedTrade, Order, Position
from nexus.monitoring import emit

EST_HALF_SPREAD_BPS = {("US", "etf"): 1.0, ("US", "stock"): 2.0, ("EU", "etf"): 5.0, ("EU", "stock"): 4.0}
MAX_PARTICIPATION = 0.01  # order notional <= 1% of today's traded volume (when known)


@dataclass
class FillQuote:
    price: float
    bid: float | None
    ask: float | None
    volume: float | None
    received_at: datetime
    timestamp: datetime | None
    tradable: bool
    source: str
    vol20: float | None = None


def half_spread_bps(inst: Instrument, q: FillQuote) -> float:
    if q.bid and q.ask and q.ask >= q.bid > 0:
        return (q.ask - q.bid) / ((q.ask + q.bid) / 2) / 2 * 1e4
    return EST_HALF_SPREAD_BPS.get((inst.market, inst.asset_type), 5.0)


def slippage_bps(q: FillQuote) -> float:
    base = get_settings().base_slippage_bps
    vol_factor = 1.0 + (min(q.vol20, 1.0) if q.vol20 else 0.2)
    return base * vol_factor


def fees_eur(notional_eur: float, currency: str) -> float:
    s = get_settings()
    fx_fee = s.fx_fee_pct * notional_eur if currency != "EUR" else 0.0
    return round(s.fee_fixed_eur + s.fee_pct * notional_eur + fx_fee, 6)


def estimate_roundtrip_cost(inst: Instrument, notional_eur: float, q: FillQuote) -> float:
    spread = 2 * half_spread_bps(inst, q) / 1e4 * notional_eur
    slip = 2 * slippage_bps(q) / 1e4 * notional_eur
    return round(spread + slip + 2 * fees_eur(notional_eur, inst.currency), 6)


def has_pending(db: Session, agent_id: int, symbol: str) -> bool:
    return db.execute(select(Order.id).where(Order.agent_id == agent_id, Order.symbol == symbol,
                                             Order.status == "pending")).first() is not None


def submit(db: Session, agent: Agent, inst: Instrument, side: str, qty: float, *,
           client_order_id: str, order_type: str = "market", limit_price: float | None = None,
           stop_price: float | None = None, take_profit: float | None = None,
           purpose: str = "entry", decision_id: int | None = None,
           now: datetime | None = None) -> Order | None:
    now = now or datetime.now(timezone.utc)
    s = get_settings()
    if db.execute(select(Order.id).where(Order.client_order_id == client_order_id)).first():
        emit(db, "order", f"Duplicate order {client_order_id} ignored", level="warn", agent=agent.code)
        return None
    if has_pending(db, agent.id, inst.symbol):
        emit(db, "order", f"{inst.symbol}: pending order already exists, new {side} ignored",
             level="warn", agent=agent.code)
        return None
    if side not in ("buy", "sell") or qty <= 0 or order_type not in ("market", "limit"):
        raise ValueError("invalid order parameters")
    if order_type == "limit" and not limit_price:
        raise ValueError("limit order requires limit_price")
    order = Order(agent_id=agent.id, client_order_id=client_order_id, symbol=inst.symbol, side=side,
                  type=order_type, qty=qty, limit_price=limit_price, stop_price=stop_price,
                  take_profit=take_profit, purpose=purpose, status="pending", submitted_at=now,
                  eligible_at=now + timedelta(seconds=s.order_latency_seconds),
                  expires_at=now + timedelta(minutes=s.order_ttl_minutes), decision_id=decision_id)
    db.add(order)
    db.flush()
    emit(db, "order", f"Order submitted: {side.upper()} {qty:.4f} {inst.symbol} ({order_type}, {purpose})",
         agent=agent.code, data={"order_id": order.id, "client_order_id": client_order_id})
    return order


def _reject(db: Session, agent: Agent, order: Order, reason: str, status: str = "rejected") -> None:
    order.status, order.status_reason = status, reason
    emit(db, "order", f"Order {order.id} {status}: {order.side} {order.symbol} - {reason}",
         level="warn", agent=agent.code, data={"order_id": order.id, "reason": reason})


def process_order(db: Session, agent: Agent, order: Order, inst: Instrument, q: FillQuote | None,
                  eur_per_unit: float | None, market_open: bool, now: datetime | None = None) -> str:
    """Try to fill one pending order. Returns resulting status."""
    now = now or datetime.now(timezone.utc)
    if order.status != "pending":
        return order.status
    expires = order.expires_at.replace(tzinfo=timezone.utc) if order.expires_at and order.expires_at.tzinfo is None else order.expires_at
    eligible = order.eligible_at.replace(tzinfo=timezone.utc) if order.eligible_at.tzinfo is None else order.eligible_at
    if expires and now >= expires:
        _reject(db, agent, order, "time_in_force_expired", "expired")
        return order.status
    if not market_open:
        _reject(db, agent, order, "market_closed")
        return order.status
    if now < eligible or q is None or q.received_at < eligible:
        return "pending"  # simulated routing latency: wait for a later quote
    if not q.tradable or eur_per_unit is None:
        return "pending"  # data not trustworthy right now: do not fill, wait or expire

    hs = half_spread_bps(inst, q) / 1e4
    sl = slippage_bps(q) / 1e4
    if order.side == "buy":
        ref = q.ask if q.ask else q.price * (1 + hs)
        price = ref * (1 + sl)
        if order.type == "limit":
            if ref > order.limit_price:
                return "pending"
            price = min(price, order.limit_price)
    else:
        ref = q.bid if q.bid else q.price * (1 - hs)
        price = ref * (1 - sl)
        if order.type == "limit":
            if ref < order.limit_price:
                return "pending"
            price = max(price, order.limit_price)

    notional_native = order.qty * price
    if q.volume and q.volume * q.price > 0 and notional_native > MAX_PARTICIPATION * q.volume * q.price:
        _reject(db, agent, order, "insufficient_liquidity")
        return order.status
    notional_eur = notional_native * eur_per_unit
    fee = fees_eur(notional_eur, inst.currency)

    pos = db.execute(select(Position).where(Position.agent_id == agent.id,
                                            Position.symbol == inst.symbol)).scalar_one_or_none()
    if order.side == "buy":
        if not order.stop_price or not order.take_profit:
            _reject(db, agent, order, "missing_stop_loss_or_take_profit")
            return order.status
        if notional_eur + fee > agent.cash + 1e-9:
            _reject(db, agent, order, "insufficient_cash")
            return order.status
        if pos is not None:
            _reject(db, agent, order, "position_already_open")
            return order.status
        agent.cash = round(agent.cash - notional_eur - fee, 6)
        db.add(Position(agent_id=agent.id, symbol=inst.symbol, exchange=inst.exchange,
                        currency=inst.currency, sector=inst.sector, qty=order.qty, avg_price=price,
                        cost_eur=notional_eur + fee, entry_fx=eur_per_unit,
                        stop_price=order.stop_price, take_profit=order.take_profit, opened_at=now,
                        last_price=q.price, last_fx=eur_per_unit))
    else:
        if pos is None or order.qty > pos.qty + 1e-9:
            _reject(db, agent, order, "no_position_to_sell")
            return order.status
        proceeds = notional_eur - fee
        frac = order.qty / pos.qty
        cost_part = pos.cost_eur * frac
        agent.cash = round(agent.cash + proceeds, 6)
        opened = pos.opened_at if pos.opened_at.tzinfo else pos.opened_at.replace(tzinfo=timezone.utc)
        db.add(ClosedTrade(agent_id=agent.id, symbol=inst.symbol, qty=order.qty, entry_price=pos.avg_price,
                           exit_price=price, cost_eur=cost_part, proceeds_eur=proceeds,
                           fees_eur=fee + (pos.cost_eur - pos.qty * pos.avg_price * pos.entry_fx) * frac,
                           pnl_eur=proceeds - cost_part, exit_reason=order.purpose,
                           opened_at=opened, closed_at=now))
        if order.qty >= pos.qty - 1e-9:
            db.delete(pos)
        else:
            pos.qty -= order.qty
            pos.cost_eur -= cost_part

    order.status, order.filled_at, order.fill_price = "filled", now, price
    order.fill_fx, order.fees_eur = eur_per_unit, fee
    order.slippage_bps = round((hs + sl) * 1e4, 3)
    order.quote_ts, order.quote_source = q.timestamp, q.source
    db.flush()
    emit(db, "order", f"FILLED {order.side.upper()} {order.qty:.4f} {inst.symbol} @ {price:.4f} {inst.currency} "
                      f"(fee EUR {fee:.2f}, {order.purpose})", agent=agent.code,
         data={"order_id": order.id, "price": price, "fee_eur": fee, "fx": eur_per_unit})
    return "filled"
