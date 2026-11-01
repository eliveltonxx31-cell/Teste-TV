"""NEXUS AI TRADING - HTTP API (FastAPI). Run: uvicorn nexus.api.main:app"""
from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from nexus.analysis import indicators
from nexus.api.auth import current_user, login
from nexus.config import get_settings
from nexus.db import init_db, session_scope
from nexus.engine import experiments
from nexus.engine.portfolio import position_value, positions, valuation
from nexus.market import calendar
from nexus.market.base import Bar
from nexus.market.universe import BY_SYMBOL, UNIVERSE
from nexus.models import (Agent, Candle, ClosedTrade, Decision, EquitySnapshot, Event, Experiment,
                          Incident, LatestQuote, NewsItem, Order, Report)
from nexus.monitoring import emit, exit_safe_mode, get_state, is_safe_mode, verify_chain
from nexus.reports.reporting import agent_metrics
from nexus.risk.limits import HARD, PROFILES


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="NEXUS AI TRADING", version="2.0.0", lifespan=lifespan,
              description="Autonomous AI PAPER trading platform. No real orders are ever sent.")
_origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])


def _iso(dt):
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


# ---------------------------------------------------------------- public
@app.get("/api/health")
def health():
    out = {"service": "nexus-api", "paper_trading_only": True, "time": datetime.now(timezone.utc).isoformat()}
    try:
        with session_scope() as db:
            db.execute(text("SELECT 1"))
            hb = get_state(db, "worker_heartbeat", {})
            age = None
            if hb.get("ts"):
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(hb["ts"])).total_seconds()
            safe, reason = is_safe_mode(db)
            out.update(database="ok", worker_heartbeat_age_s=age,
                       worker="ok" if age is not None and age < 3 * get_settings().closed_market_cycle_seconds else "stale",
                       safe_mode=safe, safe_mode_reason=reason)
    except Exception as exc:
        return JSONResponse({**out, "database": f"error: {exc.__class__.__name__}"}, status_code=503)
    return out


class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def do_login(body: LoginBody, request: Request):
    return {"token": login(body.username, body.password, request.client.host if request.client else "?")}


# ---------------------------------------------------------------- helpers
def _agent_summary(db, a: Agent) -> dict:
    m = agent_metrics(db, a)
    prof = PROFILES[a.code]
    m["strategy"] = {"A": "Trend + pullback, low volatility, quality filter",
                     "B": "Trend + MACD momentum with volume confirmation",
                     "C": "20-day breakout with volume surge"}[a.code]
    m["limits"] = prof.__dict__
    m["daily_change_pct"] = round(m["equity"] / a.day_start_equity - 1, 5) if a.day_start_equity else None
    m["drawdown_from_peak"] = round(m["equity"] / a.peak_equity - 1, 5) if a.peak_equity else None
    return m


def _require_exp(db) -> Experiment:
    exp = experiments.current(db) or experiments.latest(db)
    if exp is None:
        raise HTTPException(404, "no experiment yet - start one in Settings")
    return exp


def _bars(db, symbol: str, n: int = 260) -> list[Bar]:
    rows = db.execute(select(Candle).where(Candle.symbol == symbol).order_by(Candle.day)).scalars().all()
    return [Bar(r.day, r.open, r.high, r.low, r.close, r.volume) for r in rows][-n:]


# ---------------------------------------------------------------- dashboard
@app.get("/api/dashboard")
def dashboard(user: str = Depends(current_user)):
    with session_scope() as db:
        exp = experiments.current(db) or experiments.latest(db)
        safe, reason = is_safe_mode(db)
        sessions = {c: calendar.session_info(c) for c in sorted({i.calendar for i in UNIVERSE})}
        if exp is None:
            return {"experiment": None, "safe_mode": safe, "safe_mode_reason": reason, "markets": sessions}
        agents = experiments.agents_of(db, exp)
        summaries = [_agent_summary(db, a) for a in agents]
        curve = defaultdict(dict)
        for a in agents:
            for s in db.execute(select(EquitySnapshot).where(EquitySnapshot.agent_id == a.id)
                                .order_by(EquitySnapshot.ts)).scalars():
                curve[_iso(s.ts)[:16]][a.code] = round(s.equity, 2)
        total_init = sum(s["initial_capital"] for s in summaries)
        total_eq = sum(s["equity"] for s in summaries)
        total_cash = sum(s["cash"] for s in summaries)
        hb = get_state(db, "worker_heartbeat", {})
        return {
            "experiment": {"id": exp.id, "name": exp.name, "kind": exp.kind, "status": exp.status,
                           "started_at": _iso(exp.started_at), "ends_at": _iso(exp.ends_at)},
            "totals": {"initial": round(total_init, 2), "equity": round(total_eq, 2),
                       "pnl": round(total_eq - total_init, 2),
                       "pnl_pct": round(total_eq / total_init - 1, 5) if total_init else None,
                       "cash": round(total_cash, 2), "invested": round(total_eq - total_cash, 2),
                       "reserve_pct": round(total_cash / total_eq, 4) if total_eq else None},
            "agents": summaries,
            "equity_curve": [{"t": k, **v} for k, v in sorted(curve.items())][-2000:],
            "safe_mode": safe, "safe_mode_reason": reason, "markets": sessions,
            "worker_heartbeat": hb.get("ts"),
        }


# ---------------------------------------------------------------- market
@app.get("/api/market")
def market(user: str = Depends(current_user)):
    with session_scope() as db:
        quotes = {q.symbol: q.data for q in db.execute(select(LatestQuote)).scalars()}
        items = []
        for i in UNIVERSE:
            q = quotes.get(i.symbol)
            items.append({"symbol": i.symbol, "ticker": i.ticker, "name": i.name, "exchange": i.exchange,
                          "currency": i.currency, "market": i.market, "type": i.asset_type, "sector": i.sector,
                          "timezone": calendar.timezone_of(i.calendar),
                          "market_open": calendar.is_open(i.calendar), "quote": q})
        return {"instruments": items,
                "sessions": {c: calendar.session_info(c) for c in sorted({i.calendar for i in UNIVERSE})},
                "providers": get_state(db, "provider_health", {}),
                "config": {"quote": get_settings().quote_provider, "history": get_settings().history_provider,
                           "news": get_settings().news_provider, "fx": get_settings().fx_provider,
                           "max_quote_age_s": get_settings().max_quote_age_seconds,
                           "allow_delayed_trading": get_settings().allow_delayed_trading}}


@app.get("/api/market/{symbol}")
def market_symbol(symbol: str, user: str = Depends(current_user)):
    if symbol not in BY_SYMBOL:
        raise HTTPException(404, "unknown symbol")
    with session_scope() as db:
        bars = _bars(db, symbol)
        snap = indicators.snapshot(bars)
        series = []
        if bars:
            df = indicators.to_frame(bars)
            c = df["close"]
            sma50, sma200 = indicators.sma(c, 50), indicators.sma(c, 200)
            lo, mid, hi = indicators.bollinger(c)
            r = indicators.rsi(c)
            for idx, (d, row) in enumerate(df.tail(180).iterrows()):
                k = len(df) - min(180, len(df)) + idx
                f = lambda s: None if s.iloc[k] != s.iloc[k] else round(float(s.iloc[k]), 4)  # noqa: E731
                series.append({"d": d.isoformat(), "o": row.open, "h": row.high, "l": row.low, "c": row.close,
                               "v": row.volume, "sma50": f(sma50), "sma200": f(sma200), "bb_low": f(lo),
                               "bb_high": f(hi), "rsi": f(r)})
        news = db.execute(select(NewsItem).where(NewsItem.symbol == symbol)
                          .order_by(NewsItem.published_at.desc()).limit(20)).scalars().all()
        q = db.get(LatestQuote, symbol)
        return {"instrument": BY_SYMBOL[symbol].__dict__, "quote": q.data if q else None,
                "indicators": snap.to_dict() if snap else None, "series": series,
                "bars_source": "completed daily bars (history provider)",
                "news": [{"headline": n.headline, "source": n.source, "url": n.url,
                          "published_at": _iso(n.published_at), "sentiment": n.sentiment,
                          "method": n.sentiment_method} for n in news]}


# ---------------------------------------------------------------- agents / portfolio
def _order_dict(o: Order) -> dict:
    return {"id": o.id, "symbol": o.symbol, "side": o.side, "type": o.type, "qty": o.qty, "purpose": o.purpose,
            "status": o.status, "reason": o.status_reason, "submitted_at": _iso(o.submitted_at),
            "filled_at": _iso(o.filled_at), "fill_price": o.fill_price, "fees_eur": o.fees_eur,
            "slippage_bps": o.slippage_bps, "quote_source": o.quote_source, "client_order_id": o.client_order_id}


def _position_dict(p) -> dict:
    value = position_value(p)
    return {"symbol": p.symbol, "exchange": p.exchange, "currency": p.currency, "sector": p.sector,
            "qty": p.qty, "avg_price": p.avg_price, "last_price": p.last_price, "value_eur": round(value, 2),
            "cost_eur": round(p.cost_eur, 2), "pnl_eur": round(value - p.cost_eur, 2),
            "pnl_pct": round(value / p.cost_eur - 1, 5) if p.cost_eur else None,
            "stop": p.stop_price, "take_profit": p.take_profit, "opened_at": _iso(p.opened_at)}


@app.get("/api/agents")
def agents_list(user: str = Depends(current_user)):
    with session_scope() as db:
        exp = _require_exp(db)
        return {"experiment_id": exp.id, "agents": [_agent_summary(db, a) for a in experiments.agents_of(db, exp)]}


@app.get("/api/agents/{code}")
def agent_detail(code: str, user: str = Depends(current_user)):
    with session_scope() as db:
        exp = _require_exp(db)
        a = next((x for x in experiments.agents_of(db, exp) if x.code == code.upper()), None)
        if a is None:
            raise HTTPException(404, "agent not found")
        orders = db.execute(select(Order).where(Order.agent_id == a.id).order_by(Order.id.desc()).limit(100)).scalars()
        trades = db.execute(select(ClosedTrade).where(ClosedTrade.agent_id == a.id)
                            .order_by(ClosedTrade.id.desc()).limit(100)).scalars()
        curve = db.execute(select(EquitySnapshot).where(EquitySnapshot.agent_id == a.id)
                           .order_by(EquitySnapshot.ts)).scalars()
        incidents = db.execute(select(Incident).where(Incident.agent_code == a.code)
                               .order_by(Incident.id.desc()).limit(20)).scalars()
        return {"summary": _agent_summary(db, a),
                "positions": [_position_dict(p) for p in positions(db, a)],
                "orders": [_order_dict(o) for o in orders],
                "trades": [{"symbol": t.symbol, "qty": t.qty, "entry": t.entry_price, "exit": t.exit_price,
                            "pnl_eur": round(t.pnl_eur, 2), "fees_eur": round(t.fees_eur, 2),
                            "reason": t.exit_reason, "opened_at": _iso(t.opened_at), "closed_at": _iso(t.closed_at)}
                           for t in trades],
                "equity_curve": [{"t": _iso(s.ts), "equity": round(s.equity, 2)} for s in curve][-2000:],
                "incidents": [{"ts": _iso(i.ts), "kind": i.kind, "severity": i.severity, "details": i.details}
                              for i in incidents]}


@app.get("/api/portfolio")
def portfolio(user: str = Depends(current_user)):
    with session_scope() as db:
        exp = _require_exp(db)
        out = []
        for a in experiments.agents_of(db, exp):
            v = valuation(db, a)
            pos = [_position_dict(p) for p in v["positions"]]
            sectors = defaultdict(float)
            for p in pos:
                sectors[p["sector"]] += p["value_eur"]
            out.append({"agent": a.code, "profile": a.profile, "equity": round(v["equity"], 2),
                        "cash": round(v["cash"], 2), "positions": pos,
                        "exposure_pct": round(v["invested"] / v["equity"], 4) if v["equity"] else 0,
                        "sectors": {k: round(val / v["equity"], 4) for k, val in sectors.items()},
                        "markets": {m: round(sum(p["value_eur"] for p in pos if BY_SYMBOL[p["symbol"]].market == m)
                                             / v["equity"], 4) for m in ("US", "EU")}})
        return {"agents": out}


# ---------------------------------------------------------------- intelligence
@app.get("/api/intelligence")
def intelligence(action: str | None = None, agent: str | None = None, limit: int = Query(100, le=500),
                 user: str = Depends(current_user)):
    with session_scope() as db:
        exp = _require_exp(db)
        ids = {a.id: a.code for a in experiments.agents_of(db, exp)}
        q = select(Decision).where(Decision.agent_id.in_(ids)).order_by(Decision.id.desc()).limit(limit)
        if action:
            q = q.where(Decision.action == action)
        if agent:
            q = q.where(Decision.agent_id.in_([k for k, v in ids.items() if v == agent.upper()]))
        decisions = [{"id": d.id, "agent": ids[d.agent_id], "symbol": d.symbol, "action": d.action,
                      "score": d.score, "created_at": _iso(d.created_at), "rationale": d.rationale,
                      "guardian": d.guardian} for d in db.execute(q).scalars()]
        news = db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(40)).scalars()
        return {"decisions": decisions,
                "news": [{"symbol": n.symbol, "headline": n.headline, "source": n.source, "url": n.url,
                          "published_at": _iso(n.published_at), "sentiment": n.sentiment,
                          "method": n.sentiment_method} for n in news],
                "earnings_soon": get_state(db, "earnings_soon", {}).get("map", {}),
                "ai_policy": ("Decisions are produced by deterministic quantitative rules. Optional LLM "
                              "output is limited to a bounded news-sentiment score; the Risk Guardian "
                              "independently validates every order.")}


# ---------------------------------------------------------------- reports
@app.get("/api/reports")
def reports(user: str = Depends(current_user)):
    with session_scope() as db:
        rows = db.execute(select(Report).order_by(Report.id.desc()).limit(200)).scalars()
        exps = {e.id: e.name for e in db.execute(select(Experiment)).scalars()}
        return {"reports": [{"id": r.id, "kind": r.kind, "experiment": exps.get(r.experiment_id),
                             "period_start": _iso(r.period_start), "period_end": _iso(r.period_end),
                             "created_at": _iso(r.created_at)} for r in rows],
                "experiments": [{"id": e.id, "name": e.name, "kind": e.kind, "status": e.status,
                                 "started_at": _iso(e.started_at), "ends_at": _iso(e.ends_at),
                                 "ended_at": _iso(e.ended_at)}
                                for e in db.execute(select(Experiment).order_by(Experiment.id.desc())).scalars()]}


@app.get("/api/reports/live")
def report_live(user: str = Depends(current_user)):
    with session_scope() as db:
        exp = _require_exp(db)
        return {"experiment": exp.name, "generated_at": datetime.now(timezone.utc).isoformat(),
                "agents": [agent_metrics(db, a) for a in experiments.agents_of(db, exp)]}


@app.get("/api/reports/{rid}")
def report_get(rid: int, user: str = Depends(current_user)):
    with session_scope() as db:
        r = db.get(Report, rid)
        if r is None:
            raise HTTPException(404, "report not found")
        return {"id": r.id, "kind": r.kind, "data": r.data}


# ---------------------------------------------------------------- settings / control
class ExperimentBody(BaseModel):
    kind: str = Field(pattern="^(48h|7d|30d|open)$")
    capital_per_agent: float = Field(ge=50, le=1_000_000)
    confirm: bool = False


@app.get("/api/settings")
def settings_view(user: str = Depends(current_user)):
    s = get_settings()
    return {
        "hard_limits": HARD.__dict__,
        "profiles": {k: v.__dict__ for k, v in PROFILES.items()},
        "protected_note": "Hard limits and profiles are code constants: not editable via API, env or AI.",
        "editable": {"next_experiment_capital_per_agent": s.initial_capital_eur,
                     "experiment_kinds": ["48h", "7d", "30d", "open"]},
        "runtime": {"cycle_seconds": s.cycle_seconds, "closed_cycle_seconds": s.closed_market_cycle_seconds,
                    "fractional_shares": s.fractional_shares, "allow_delayed_trading": s.allow_delayed_trading,
                    "max_quote_age_seconds": s.max_quote_age_seconds},
        "costs": {"fee_fixed_eur": s.fee_fixed_eur, "fee_pct": s.fee_pct, "fx_fee_pct": s.fx_fee_pct,
                  "base_slippage_bps": s.base_slippage_bps, "order_latency_seconds": s.order_latency_seconds},
        "providers": {role: {"name": name, "key_configured": bool(getattr(s, f"{name}_api_key", None)) if name else False,
                             "entitlement": s.entitlement(name) if name else {}}
                      for role, name in (("quote", s.quote_provider), ("history", s.history_provider),
                                         ("news", s.news_provider), ("fx", s.fx_provider),
                                         ("crosscheck", s.crosscheck_provider))},
        "llm": {"enabled": s.llm_enabled and bool(s.anthropic_api_key), "model": s.llm_model,
                "scope": "news sentiment score only (bounded weight, cannot place or size orders)"},
    }


@app.post("/api/experiments")
def experiment_start(body: ExperimentBody, user: str = Depends(current_user)):
    if not body.confirm:
        raise HTTPException(400, "set confirm=true: the running experiment (if any) will be finalized")
    with session_scope() as db:
        exp = experiments.start(db, body.kind, body.capital_per_agent, by=user)
        return {"id": exp.id, "name": exp.name}


@app.post("/api/safe-mode/clear")
def safe_mode_clear(user: str = Depends(current_user)):
    with session_scope() as db:
        exit_safe_mode(db, by=user)
        return {"safe_mode": False}


@app.post("/api/agents/{code}/resume")
def agent_resume(code: str, user: str = Depends(current_user)):
    """Operator may resume ONLY if the breaker condition no longer holds."""
    from nexus.engine.portfolio import portfolio_view
    from nexus.risk.guardian import RiskGuardian
    with session_scope() as db:
        exp = _require_exp(db)
        a = next((x for x in experiments.agents_of(db, exp) if x.code == code.upper()), None)
        if a is None or not a.halted:
            raise HTTPException(400, "agent not halted")
        failing = [c.rule for c in RiskGuardian(PROFILES[a.code]).breaker_status(portfolio_view(db, a)) if not c.passed]
        if failing:
            raise HTTPException(409, f"cannot resume: {failing} still breached (start a new experiment instead)")
        a.halted, a.halt_reason = False, None
        emit(db, "risk", f"Agent resumed manually by {user}", agent=a.code, level="warn")
        return {"resumed": a.code}


# ---------------------------------------------------------------- live monitoring
def _event_dict(e: Event) -> dict:
    return {"id": e.id, "ts": _iso(e.ts), "level": e.level, "category": e.category, "agent": e.agent_code,
            "message": e.message, "data": e.data}


@app.get("/api/events")
def events(after_id: int = 0, limit: int = Query(200, le=1000), user: str = Depends(current_user)):
    with session_scope() as db:
        q = select(Event).order_by(Event.id.desc()).limit(limit) if after_id == 0 else \
            select(Event).where(Event.id > after_id).order_by(Event.id).limit(limit)
        rows = [_event_dict(e) for e in db.execute(q).scalars()]
        return {"events": sorted(rows, key=lambda r: r["id"])}


@app.get("/api/events/stream")
async def events_stream(request: Request, after_id: int = 0, user: str = Depends(current_user)):
    async def gen():
        last = after_id
        while not await request.is_disconnected():
            with session_scope() as db:
                rows = db.execute(select(Event).where(Event.id > last).order_by(Event.id).limit(200)).scalars().all()
                payload = [_event_dict(e) for e in rows]
            for ev in payload:
                last = ev["id"]
                yield f"id: {ev['id']}\ndata: {json.dumps(ev, default=str)}\n\n"
            yield ": keep-alive\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/audit/verify")
def audit_verify(user: str = Depends(current_user)):
    with session_scope() as db:
        return verify_chain(db)


# ---------------------------------------------------------------- frontend (built PWA)
_DIST = Path(os.environ.get("FRONTEND_DIST") or Path(__file__).resolve().parents[3] / "frontend" / "dist")
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (_DIST / path).resolve()
        if path and target.is_file() and _DIST in target.parents:
            return FileResponse(target)
        return FileResponse(_DIST / "index.html")
