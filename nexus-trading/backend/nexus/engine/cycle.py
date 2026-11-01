"""One engine cycle: data -> analysis -> decisions -> Risk Guardian -> paper broker.

The cycle is idempotent and restart-safe: all state lives in the database,
order ids are derived from (experiment, agent, symbol, side, cycle bucket), so
re-running a cycle after a crash cannot create duplicate orders.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from nexus.analysis import indicators
from nexus.analysis.sentiment import score_news
from nexus.broker import paper
from nexus.config import get_settings
from nexus.engine import experiments
from nexus.engine.portfolio import portfolio_view, positions, valuation
from nexus.market import calendar
from nexus.market.base import Instrument
from nexus.market.service import MarketDataService, ValidatedQuote
from nexus.market.universe import BY_SYMBOL, UNIVERSE
from nexus.models import Agent, Decision, EquitySnapshot, Experiment, NewsItem, Order
from nexus.monitoring import emit, get_state, is_safe_mode, open_incident, set_state
from nexus.reports.reporting import finalize_experiment, maybe_daily_report
from nexus.risk.guardian import EntryProposal, RiskGuardian
from nexus.risk.limits import PROFILES
from nexus.strategy.rules import entry_signal, exit_signal

MIN_NOTIONAL_EUR = 5.0
MAX_NEW_ENTRIES_PER_CYCLE = 2
SNAPSHOT_EVERY = timedelta(minutes=5)


@dataclass
class CycleContext:
    now: datetime
    cycle_id: str
    quotes: dict[str, ValidatedQuote] = field(default_factory=dict)
    fx: dict[str, float] = field(default_factory=dict)
    fx_meta: dict[str, dict] = field(default_factory=dict)
    snapshots: dict[str, indicators.Snapshot | None] = field(default_factory=dict)
    bars: dict[str, list] = field(default_factory=dict)
    open_markets: dict[str, bool] = field(default_factory=dict)
    earnings: dict[str, str] = field(default_factory=dict)


def _fill_quote(vq: ValidatedQuote, snap: indicators.Snapshot | None) -> paper.FillQuote:
    q = vq.quote
    return paper.FillQuote(price=q.price, bid=q.bid, ask=q.ask, volume=q.volume, received_at=q.received_at,
                           timestamp=q.timestamp, tradable=vq.check.tradable, source=q.source,
                           vol20=snap.vol20 if snap else None)


class Engine:
    def __init__(self, md: MarketDataService | None = None):
        self.settings = get_settings()
        self.md = md or MarketDataService()

    # ------------------------------------------------------------------ data
    def _gather(self, db: Session, ctx: CycleContext, exp: Experiment) -> None:
        held = set()
        for a in experiments.agents_of(db, exp):
            held |= {p.symbol for p in positions(db, a)}
        cals = {i.calendar for i in UNIVERSE}
        ctx.open_markets = {c: calendar.is_open(c, ctx.now) for c in cals}
        pending = {o.symbol for o in db.execute(select(Order).where(Order.status == "pending")).scalars()}
        targets = [i for i in UNIVERSE if ctx.open_markets[i.calendar] or i.symbol in held | pending]
        if targets:
            emit(db, "data", f"Receiving quotes for {len(targets)} instruments "
                             f"(open markets: {', '.join(c for c, o in ctx.open_markets.items() if o) or 'none'})")
        for inst in targets:
            if not ctx.open_markets[inst.calendar] and inst.symbol not in held:
                continue
            vq = self.md.quote(db, inst, now=ctx.now)
            if vq is not None:
                ctx.quotes[inst.symbol] = vq
        for cur in {i.currency for i in UNIVERSE if i.currency != "EUR"}:
            res = self.md.eur_per_unit(db, cur)
            if res is not None:
                ctx.fx[cur], meta = res[0], res[1]
                ctx.fx_meta[cur] = {"rate": meta.rate, "source": meta.source, "kind": meta.kind,
                                    "timestamp": meta.timestamp.isoformat() if meta.timestamp else None}
        ctx.fx["EUR"] = 1.0
        if ctx.quotes:
            ok = sum(1 for v in ctx.quotes.values() if v.check.tradable)
            emit(db, "data", f"Quotes received: {len(ctx.quotes)} ({ok} tradable)",
                 data={s: {"price": v.quote.price, "feed": v.check.feed.value, "issues": v.check.issues,
                           "delay_s": v.quote.delay_seconds} for s, v in ctx.quotes.items()})

    def _snapshot(self, db: Session, ctx: CycleContext, inst: Instrument):
        if inst.symbol not in ctx.snapshots:
            bars = self.md.daily_bars(db, inst, now=ctx.now)
            ctx.bars[inst.symbol] = bars
            ctx.snapshots[inst.symbol] = indicators.snapshot(bars)
        return ctx.snapshots[inst.symbol]

    def _sentiment(self, db: Session, symbol: str, now: datetime) -> float | None:
        rows = db.execute(select(NewsItem.sentiment).where(
            NewsItem.symbol == symbol, NewsItem.published_at >= now - timedelta(hours=72))).scalars().all()
        return round(statistics.fmean(rows), 3) if rows else None

    def _fundamentals(self, db: Session, inst: Instrument) -> dict | None:
        if inst.asset_type == "etf":
            return None
        cache = get_state(db, "fundamentals", {})
        entry = cache.get(inst.symbol)
        today = datetime.now(timezone.utc).date().isoformat()
        if entry and entry.get("day") == today:
            return entry.get("data")
        p = self.md.providers.get("news")
        data = None
        if p is not None:
            try:
                data = p.fundamentals(inst)
            except Exception:  # unavailable fundamentals are penalised in the score, never invented
                data = None
        cache[inst.symbol] = {"day": today, "data": data}
        set_state(db, "fundamentals", cache)
        return data

    # ------------------------------------------------------------------ agent
    def _update_agent_state(self, db: Session, ctx: CycleContext, agent: Agent, guardian: RiskGuardian) -> None:
        for p in positions(db, agent):
            vq = ctx.quotes.get(p.symbol)
            if vq and "invalid_price" not in vq.check.issues and "price_jump_vs_last_quote" not in vq.check.issues:
                p.last_price = vq.quote.price
            if p.currency in ctx.fx:
                p.last_fx = ctx.fx[p.currency]
        db.flush()
        v = valuation(db, agent)
        today = ctx.now.date().isoformat()
        if agent.day_date != today:
            agent.day_date, agent.day_start_equity = today, v["equity"]
            if agent.halted and (agent.halt_reason or "").startswith("daily_loss_limit"):
                agent.halted, agent.halt_reason = False, None
                emit(db, "risk", "New trading day: daily-loss halt lifted", agent=agent.code, level="warn")
        agent.peak_equity = max(agent.peak_equity, v["equity"])
        pv = portfolio_view(db, agent)
        for c in guardian.breaker_status(pv):
            if not c.passed and not agent.halted:
                agent.halted, agent.halt_reason = True, f"{c.rule}: {c.value} (limit {c.limit})"
                open_incident(db, c.rule, "critical", {"value": c.value, "limit": c.limit,
                                                       "equity": v["equity"]}, agent=agent.code)
                emit(db, "risk", f"CIRCUIT BREAKER {c.rule}: {c.value:.2%} vs limit {c.limit:.2%}. "
                                 f"New buys blocked.", level="critical", agent=agent.code)
        last = db.execute(select(EquitySnapshot).where(EquitySnapshot.agent_id == agent.id)
                          .order_by(EquitySnapshot.ts.desc()).limit(1)).scalar_one_or_none()
        last_ts = last.ts.replace(tzinfo=timezone.utc) if last and last.ts.tzinfo is None else (last.ts if last else None)
        if last is None or ctx.now - last_ts >= SNAPSHOT_EVERY:
            db.add(EquitySnapshot(agent_id=agent.id, ts=ctx.now, equity=v["equity"], cash=v["cash"],
                                  invested=v["invested"], unrealized=v["unrealized"]))
        db.flush()

    def _process_pending(self, db: Session, ctx: CycleContext, agent: Agent) -> None:
        for o in db.execute(select(Order).where(Order.agent_id == agent.id, Order.status == "pending")).scalars().all():
            inst = BY_SYMBOL[o.symbol]
            vq = ctx.quotes.get(o.symbol)
            fq = _fill_quote(vq, ctx.snapshots.get(o.symbol)) if vq else None
            paper.process_order(db, agent, o, inst, fq, ctx.fx.get(inst.currency),
                                ctx.open_markets.get(inst.calendar, False), now=ctx.now)

    def _exits(self, db: Session, ctx: CycleContext, exp: Experiment, agent: Agent, guardian: RiskGuardian) -> None:
        for p in positions(db, agent):
            vq = ctx.quotes.get(p.symbol)
            if vq is None:
                continue
            inst = BY_SYMBOL[p.symbol]
            price = vq.quote.price
            reason, purpose = None, None
            if price <= p.stop_price:
                reason, purpose = f"stop-loss hit ({price:.4f} <= {p.stop_price:.4f})", "stop_loss"
            elif price >= p.take_profit:
                reason, purpose = f"take-profit hit ({price:.4f} >= {p.take_profit:.4f})", "take_profit"
            else:
                snap = self._snapshot(db, ctx, inst)
                if snap is not None:
                    r = exit_signal(agent.code, snap, price)
                    if r:
                        reason, purpose = r, "exit"
            if not reason:
                continue
            verdict = guardian.evaluate_exit(p.qty, p.qty, paper.has_pending(db, agent.id, p.symbol),
                                             vq.check.tradable, ctx.open_markets.get(inst.calendar, False))
            dec = Decision(agent_id=agent.id, cycle_id=ctx.cycle_id, symbol=p.symbol,
                           action="sell" if verdict.approved else "rejected", score=0.0,
                           rationale={"type": "exit", "reason": reason, "price": price,
                                      "quote": vq.to_dict()}, guardian=verdict.to_dict(), created_at=ctx.now)
            db.add(dec)
            db.flush()
            if verdict.approved:
                emit(db, "decision", f"{p.symbol}: SELL decided - {reason}", agent=agent.code,
                     data={"decision_id": dec.id})
                paper.submit(db, agent, inst, "sell", p.qty, purpose=purpose, decision_id=dec.id, now=ctx.now,
                             client_order_id=f"E{exp.id}-{agent.code}-{p.symbol}-sell-{ctx.cycle_id}")
            elif "no_duplicate_order" in verdict.reasons:
                continue
            else:
                emit(db, "risk", f"{p.symbol}: exit pending ({reason}) - blocked by {verdict.reasons}",
                     agent=agent.code, level="warn")

    def _entries(self, db: Session, ctx: CycleContext, exp: Experiment, agent: Agent,
                 guardian: RiskGuardian, safe_mode: bool) -> None:
        prof = PROFILES[agent.code]
        pv = portfolio_view(db, agent)
        if agent.halted or safe_mode:
            return
        candidates = []
        held = {h.symbol for h in pv.holdings}
        for sym, vq in ctx.quotes.items():
            inst = BY_SYMBOL[sym]
            if sym in held or not ctx.open_markets.get(inst.calendar) or paper.has_pending(db, agent.id, sym):
                continue
            snap = self._snapshot(db, ctx, inst)
            if snap is None or snap.atr14 is None:
                continue
            sig = entry_signal(agent.code, snap, vq.quote.price, self._sentiment(db, sym, ctx.now),
                               self._fundamentals(db, inst),
                               inst.asset_type)
            if sig.setup_ok and sig.score >= prof.min_score:
                candidates.append((sig.score, inst, vq, snap, sig))
        if not candidates:
            return
        emit(db, "analysis", f"{len(candidates)} opportunity(ies) identified", agent=agent.code,
             data={c[1].symbol: c[0] for c in candidates})
        candidates.sort(key=lambda c: c[0], reverse=True)
        # idempotency across restarts: entries already sent in this cycle bucket count toward the cap
        new_entries = db.execute(select(func.count()).select_from(Order).where(
            Order.agent_id == agent.id,
            Order.client_order_id.like(f"E{exp.id}-{agent.code}-%-buy-{ctx.cycle_id}"))).scalar() or 0
        for score, inst, vq, snap, sig in candidates:
            if new_entries >= MAX_NEW_ENTRIES_PER_CYCLE:
                break
            pv = portfolio_view(db, agent)
            fx = ctx.fx.get(inst.currency)
            price = vq.quote.price
            stop = price - prof.stop_atr_mult * snap.atr14
            tp = price + prof.take_profit_atr_mult * snap.atr14
            fq = _fill_quote(vq, snap)
            qty = 0.0
            if fx and stop > 0:
                price_eur = price * fx
                q_size = pv.equity_eur * prof.max_position_pct / price_eur
                est_cost = paper.estimate_roundtrip_cost(inst, q_size * price_eur, fq)
                q_risk = max(0.0, pv.equity_eur * prof.risk_per_trade_pct - est_cost) / ((price - stop) * fx)
                q_res = max(0.0, pv.cash_eur - pv.equity_eur * prof.min_cash_reserve_pct) / price_eur
                qty = min(q_size, q_risk, q_res) * 0.97  # buffer for spread/slippage at fill
                qty = math.floor(qty * 1e4) / 1e4 if self.settings.fractional_shares else float(math.floor(qty))
            notional = qty * price * (fx or 0)
            correlations = []
            for h in pv.holdings:
                self._snapshot(db, ctx, BY_SYMBOL[h.symbol])
                correlations.append(indicators.correlation(ctx.bars.get(inst.symbol, []),
                                                           ctx.bars.get(h.symbol, [])))
            correlations = [c for c in correlations if c is not None]
            est_cost = paper.estimate_roundtrip_cost(inst, notional, fq) if notional > 0 else 0.0
            proposal = EntryProposal(
                symbol=inst.symbol, sector=inst.sector, qty=qty, price_native=price, eur_per_unit=fx or 0.0,
                stop_price=stop, est_roundtrip_cost_eur=est_cost, annual_vol=snap.vol20,
                max_correlation=max(correlations) if correlations else None,
                quote_tradable=vq.check.tradable, quote_issues=vq.check.issues,
                market_open=ctx.open_markets.get(inst.calendar, False),
                pending_order_exists=paper.has_pending(db, agent.id, inst.symbol),
                earnings_soon=inst.ticker in ctx.earnings and inst.market == "US")
            verdict = guardian.evaluate_entry(pv, proposal, safe_mode)
            too_small = notional < MIN_NOTIONAL_EUR
            approved = verdict.approved and not too_small
            rationale = {"type": "entry", "strategy": prof.name, "score": score, "min_score": prof.min_score,
                         "components": sig.components, "reasons": sig.reasons, "indicators": snap.to_dict(),
                         "quote": vq.to_dict(), "fx_eur_per_unit": fx, "fx": ctx.fx_meta.get(inst.currency),
                         "sizing": {"qty": qty, "notional_eur": round(notional, 2), "stop": round(stop, 4),
                                    "take_profit": round(tp, 4), "est_roundtrip_cost_eur": round(est_cost, 4)}}
            if too_small:
                rationale["note"] = f"position below minimum notional EUR {MIN_NOTIONAL_EUR}"
            dec = Decision(agent_id=agent.id, cycle_id=ctx.cycle_id, symbol=inst.symbol,
                           action="buy" if approved else "rejected", score=score, rationale=rationale,
                           guardian=verdict.to_dict(), created_at=ctx.now)
            db.add(dec)
            db.flush()
            emit(db, "risk", f"{inst.symbol}: evaluating exposure (size {notional:.2f} EUR, score {score:.2f})",
                 agent=agent.code)
            if not approved:
                why = verdict.reasons + (["below_min_notional"] if too_small else [])
                emit(db, "decision", f"{inst.symbol}: operation REJECTED - {', '.join(why)}",
                     agent=agent.code, level="warn", data={"decision_id": dec.id})
                continue
            emit(db, "decision", f"{inst.symbol}: BUY approved by Risk Guardian (score {score:.2f})",
                 agent=agent.code, data={"decision_id": dec.id})
            paper.submit(db, agent, inst, "buy", qty, stop_price=stop, take_profit=tp, purpose="entry",
                         decision_id=dec.id, now=ctx.now,
                         client_order_id=f"E{exp.id}-{agent.code}-{inst.symbol}-buy-{ctx.cycle_id}")
            new_entries += 1

    # ------------------------------------------------------------------ cycle
    def run_cycle(self, db: Session, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        bucket = int(now.timestamp()) // max(30, self.settings.cycle_seconds)
        ctx = CycleContext(now=now, cycle_id=f"{bucket}")
        set_state(db, "worker_heartbeat", {"ts": now.isoformat(), "cycle_id": ctx.cycle_id})
        exp = experiments.current(db)
        if exp is None:
            return {"status": "no_running_experiment"}
        ends = exp.ends_at.replace(tzinfo=timezone.utc) if exp.ends_at and exp.ends_at.tzinfo is None else exp.ends_at
        if ends and now >= ends:
            finalize_experiment(db, exp, now=now, reason="scheduled end reached")
            return {"status": "experiment_finished"}

        self._gather(db, ctx, exp)
        ctx.earnings = get_state(db, "earnings_soon", {}).get("map", {})
        safe_mode, reason = is_safe_mode(db)
        if safe_mode:
            emit(db, "risk", f"Safe mode active ({reason}): only risk-reducing sells permitted", level="warn")
        for agent in experiments.agents_of(db, exp):
            guardian = RiskGuardian(PROFILES[agent.code])
            if any(ctx.open_markets.values()):
                emit(db, "analysis", "Analysing assets", agent=agent.code)
            self._update_agent_state(db, ctx, agent, guardian)
            self._process_pending(db, ctx, agent)
            self._exits(db, ctx, exp, agent, guardian)
            self._entries(db, ctx, exp, agent, guardian, safe_mode)
        maybe_daily_report(db, exp, now)
        return {"status": "ok", "quotes": len(ctx.quotes),
                "open_markets": [c for c, o in ctx.open_markets.items() if o]}

    def run_offhours(self, db: Session, now: datetime | None = None) -> None:
        """Work done regardless of market hours: news, calendars, history, reports."""
        now = now or datetime.now(timezone.utc)
        since = now - timedelta(days=3)
        added = self.md.refresh_news(db, None, since, score_news)
        st = get_state(db, "news_refresh", {})
        for inst in UNIVERSE:
            if inst.market != "US":
                continue  # company news coverage for EU tickers depends on the plan
            last = st.get(inst.symbol)
            if last and now - datetime.fromisoformat(last) < timedelta(hours=3):
                continue
            added += self.md.refresh_news(db, inst, since, score_news)
            st[inst.symbol] = now.isoformat()
        set_state(db, "news_refresh", st)
        es = get_state(db, "earnings_soon", {})
        if es.get("day") != now.date().isoformat():
            set_state(db, "earnings_soon", {"day": now.date().isoformat(), "map": self.md.earnings_within(3)})
        if added:
            emit(db, "data", f"News updated: {added} new item(s) scored")
