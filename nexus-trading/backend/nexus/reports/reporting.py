"""Performance metrics and automatic reports (computed only from recorded facts)."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from nexus.engine.portfolio import valuation
from nexus.models import Agent, ClosedTrade, EquitySnapshot, Experiment, Order, Report
from nexus.monitoring import emit


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def agent_metrics(db: Session, agent: Agent, since: datetime | None = None,
                  until: datetime | None = None) -> dict:
    v = valuation(db, agent)
    q_tr = select(ClosedTrade).where(ClosedTrade.agent_id == agent.id)
    q_or = select(Order).where(Order.agent_id == agent.id, Order.status == "filled")
    q_eq = select(EquitySnapshot).where(EquitySnapshot.agent_id == agent.id)
    if since:
        q_tr = q_tr.where(ClosedTrade.closed_at >= since)
        q_or = q_or.where(Order.filled_at >= since)
    if until:
        q_tr = q_tr.where(ClosedTrade.closed_at < until)
        q_or = q_or.where(Order.filled_at < until)
        q_eq = q_eq.where(EquitySnapshot.ts < until)
    trades = list(db.execute(q_tr).scalars())
    orders = list(db.execute(q_or).scalars())
    snaps = list(db.execute(q_eq.order_by(EquitySnapshot.ts)).scalars())
    all_rejected = db.execute(select(Order).where(Order.agent_id == agent.id,
                                                  Order.status.in_(["rejected", "expired"]))).scalars().all()

    pnls = [t.pnl_eur for t in trades]
    wins = [p for p in pnls if p > 0]
    equity_series = [s.equity for s in snaps] or [agent.initial_capital]
    peak, mdd = -math.inf, 0.0
    for e in [agent.initial_capital] + equity_series + [v["equity"]]:
        peak = max(peak, e)
        mdd = min(mdd, e / peak - 1 if peak > 0 else 0)
    vol = None
    if len(snaps) >= 3:
        s = pd.Series([x.equity for x in snaps], index=pd.to_datetime([_aware(x.ts) for x in snaps], utc=True))
        daily = s.resample("1D").last().dropna()
        if len(daily) >= 3:
            vol = float(daily.pct_change().dropna().std() * math.sqrt(252))
        else:
            hourly = s.resample("1h").last().dropna().pct_change().dropna()
            vol = float(hourly.std() * math.sqrt(252 * 6.5)) if len(hourly) >= 3 else None
    ret = v["equity"] / agent.initial_capital - 1
    return {
        "agent": agent.code, "profile": agent.profile,
        "initial_capital": round(agent.initial_capital, 2),
        "equity": round(v["equity"], 2), "cash": round(v["cash"], 2), "invested": round(v["invested"], 2),
        "reserve_pct": round(v["cash"] / v["equity"], 4) if v["equity"] else None,
        "realized_pnl": round(sum(pnls), 2), "unrealized_pnl": round(v["unrealized"], 2),
        "gross_loss": round(sum(p for p in pnls if p < 0), 2),
        "costs": round(sum(o.fees_eur or 0 for o in orders), 2),
        "orders_filled": len(orders), "orders_rejected_or_expired": len(all_rejected),
        "closed_trades": len(trades),
        "win_rate": round(len(wins) / len(trades), 4) if trades else None,
        "best_trade": round(max(pnls), 2) if pnls else None,
        "worst_trade": round(min(pnls), 2) if pnls else None,
        "max_drawdown": round(mdd, 4), "volatility_ann": None if vol is None or math.isnan(vol) else round(vol, 4),
        "return_pct": round(ret, 5),
        "return_over_drawdown": round(ret / abs(mdd), 3) if mdd < 0 else None,
        "open_positions": len(v["positions"]), "halted": agent.halted, "halt_reason": agent.halt_reason,
    }


def build_report(db: Session, exp: Experiment, kind: str, start: datetime, end: datetime) -> Report:
    agents = db.execute(select(Agent).where(Agent.experiment_id == exp.id).order_by(Agent.code)).scalars().all()
    per_agent = {a.code: {"cumulative": agent_metrics(db, a, until=end),
                          "period": agent_metrics(db, a, since=start, until=end)} for a in agents}
    ranking = sorted(per_agent, key=lambda c: per_agent[c]["cumulative"]["return_pct"], reverse=True)
    data = {
        "experiment": {"id": exp.id, "name": exp.name, "kind": exp.kind,
                       "started_at": _aware(exp.started_at).isoformat()},
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "agents": per_agent,
        "ranking_by_return": ranking,
        "total": {
            "initial_capital": round(sum(per_agent[c]["cumulative"]["initial_capital"] for c in per_agent), 2),
            "equity": round(sum(per_agent[c]["cumulative"]["equity"] for c in per_agent), 2),
        },
        "disclaimer": ("Paper trading results. Short samples (48h/7d) are statistically insufficient "
                       "to establish consistent profitability. Past simulated results do not "
                       "guarantee future results."),
    }
    r = Report(experiment_id=exp.id, kind=kind, period_start=start, period_end=end, data=data)
    db.add(r)
    db.flush()
    emit(db, "report", f"{kind.capitalize()} report #{r.id} generated for '{exp.name}'",
         data={"report_id": r.id})
    return r


def maybe_daily_report(db: Session, exp: Experiment, now: datetime) -> Report | None:
    last = db.execute(select(Report).where(Report.experiment_id == exp.id, Report.kind == "daily")
                      .order_by(Report.period_end.desc()).limit(1)).scalar_one_or_none()
    start = _aware(last.period_end) if last else _aware(exp.started_at)
    if now - start >= timedelta(hours=24):
        return build_report(db, exp, "daily", start, start + timedelta(hours=24))
    return None


def finalize_experiment(db: Session, exp: Experiment, now: datetime, reason: str) -> Report:
    r = build_report(db, exp, "final", _aware(exp.started_at), now)
    exp.status, exp.ended_at = "finished", now
    emit(db, "system", f"Experiment '{exp.name}' finished ({reason}). Final report #{r.id}.",
         data={"experiment_id": exp.id})
    return r
