"""Portfolio valuation helpers (EUR)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.models import Agent, Position
from nexus.risk.guardian import HoldingView, PortfolioView


def positions(db: Session, agent: Agent) -> list[Position]:
    return list(db.execute(select(Position).where(Position.agent_id == agent.id)
                           .order_by(Position.symbol)).scalars())


def position_value(p: Position) -> float:
    price = p.last_price if p.last_price else p.avg_price
    fx = p.last_fx if p.last_fx else p.entry_fx
    return p.qty * price * fx


def valuation(db: Session, agent: Agent) -> dict:
    pos = positions(db, agent)
    invested = sum(position_value(p) for p in pos)
    cost = sum(p.cost_eur for p in pos)
    equity = agent.cash + invested
    return {"equity": round(equity, 6), "cash": round(agent.cash, 6), "invested": round(invested, 6),
            "unrealized": round(invested - cost, 6), "positions": pos}


def portfolio_view(db: Session, agent: Agent) -> PortfolioView:
    v = valuation(db, agent)
    holdings = [HoldingView(p.symbol, p.sector, position_value(p), position_value(p) - p.cost_eur)
                for p in v["positions"]]
    return PortfolioView(equity_eur=v["equity"], cash_eur=agent.cash, holdings=holdings,
                         day_start_equity=agent.day_start_equity, peak_equity=agent.peak_equity,
                         halted=agent.halted, halt_reason=agent.halt_reason)
