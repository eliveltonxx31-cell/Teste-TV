"""RISK GUARDIAN - independent veto authority over every order.

The Guardian recomputes everything from raw inputs; it never trusts sizes or
risk numbers computed by the strategy. It can only approve or reject; it
cannot be configured by, or receive instructions from, the AI layer.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from nexus.risk.limits import HARD, HardLimits, RiskProfile


@dataclass
class HoldingView:
    symbol: str
    sector: str
    value_eur: float
    unrealized_eur: float


@dataclass
class PortfolioView:
    equity_eur: float
    cash_eur: float
    holdings: list[HoldingView]
    day_start_equity: float
    peak_equity: float
    halted: bool = False
    halt_reason: str | None = None


@dataclass
class EntryProposal:
    symbol: str
    sector: str
    qty: float
    price_native: float
    eur_per_unit: float
    stop_price: float
    est_roundtrip_cost_eur: float
    annual_vol: float | None
    max_correlation: float | None
    quote_tradable: bool
    quote_issues: list[str]
    market_open: bool
    pending_order_exists: bool
    earnings_soon: bool = False


@dataclass
class Check:
    rule: str
    passed: bool
    value: float | str | None
    limit: float | str | None


@dataclass
class Verdict:
    approved: bool
    checks: list[Check] = field(default_factory=list)

    @property
    def reasons(self) -> list[str]:
        return [c.rule for c in self.checks if not c.passed]

    def to_dict(self) -> dict:
        return {"approved": self.approved, "rejected_by": self.reasons,
                "checks": [c.__dict__ for c in self.checks]}


class RiskGuardian:
    def __init__(self, profile: RiskProfile, hard: HardLimits = HARD):
        profile.assert_within(hard)
        self.p = profile
        self.h = hard

    # ------------------------------------------------------------ circuit breakers
    def breaker_status(self, pv: PortfolioView) -> list[Check]:
        daily = (pv.equity_eur / pv.day_start_equity - 1) if pv.day_start_equity > 0 else 0.0
        dd = (pv.equity_eur / pv.peak_equity - 1) if pv.peak_equity > 0 else 0.0
        return [
            Check("daily_loss_limit", daily > -self.p.max_daily_loss_pct, round(daily, 5), -self.p.max_daily_loss_pct),
            Check("max_drawdown", dd > -self.p.max_drawdown_pct, round(dd, 5), -self.p.max_drawdown_pct),
        ]

    # ------------------------------------------------------------ entries
    def evaluate_entry(self, pv: PortfolioView, e: EntryProposal, safe_mode: bool) -> Verdict:
        checks: list[Check] = []
        add = lambda rule, ok, v=None, lim=None: checks.append(Check(rule, bool(ok), v, lim))  # noqa: E731

        add("system_not_in_safe_mode", not safe_mode, "safe" if safe_mode else "normal", "normal")
        add("agent_not_halted", not pv.halted, pv.halt_reason or "ok", "ok")
        checks.extend(self.breaker_status(pv))
        add("market_open", e.market_open)
        add("data_integrity", e.quote_tradable, ",".join(e.quote_issues) or "ok", "ok")
        add("no_duplicate_order", not e.pending_order_exists)
        held = {h.symbol for h in pv.holdings}
        # adding to an existing line is disabled: prevents averaging down / martingale
        add("no_existing_position", e.symbol not in held)
        add("no_earnings_event_imminent", not e.earnings_soon)

        valid_numbers = e.qty > 0 and e.price_native > 0 and e.eur_per_unit > 0 and pv.equity_eur > 0
        add("valid_order_numbers", valid_numbers)
        if not valid_numbers:
            return Verdict(False, checks)

        notional = e.qty * e.price_native * e.eur_per_unit
        cash_after = pv.cash_eur - notional - e.est_roundtrip_cost_eur / 2
        pos_pct = notional / pv.equity_eur
        stop_dist = (e.price_native - e.stop_price) / e.price_native
        risk_eur = e.qty * max(0.0, e.price_native - e.stop_price) * e.eur_per_unit + e.est_roundtrip_cost_eur
        sector_now = sum(h.value_eur for h in pv.holdings if h.sector == e.sector)

        add("no_leverage_cash_positive", cash_after >= 0, round(cash_after, 2), 0)
        add("max_positions", len(pv.holdings) < self.p.max_positions, len(pv.holdings), self.p.max_positions)
        add("max_position_size", pos_pct <= self.p.max_position_pct + 1e-9, round(pos_pct, 4), self.p.max_position_pct)
        add("min_cash_reserve", cash_after / pv.equity_eur >= self.p.min_cash_reserve_pct - 1e-9,
            round(cash_after / pv.equity_eur, 4), self.p.min_cash_reserve_pct)
        add("stop_loss_defined", 0 < e.stop_price < e.price_native, e.stop_price, "< entry")
        add("stop_distance", 0 < stop_dist <= self.h.max_stop_distance_pct, round(stop_dist, 4), self.h.max_stop_distance_pct)
        add("risk_per_trade", risk_eur / pv.equity_eur <= self.p.risk_per_trade_pct + 1e-9,
            round(risk_eur / pv.equity_eur, 5), self.p.risk_per_trade_pct)
        add("sector_exposure", (sector_now + notional) / pv.equity_eur <= self.p.max_sector_pct + 1e-9,
            round((sector_now + notional) / pv.equity_eur, 4), self.p.max_sector_pct)
        add("transaction_costs", e.est_roundtrip_cost_eur / notional <= self.h.max_roundtrip_cost_pct,
            round(e.est_roundtrip_cost_eur / notional, 4), self.h.max_roundtrip_cost_pct)
        add("volatility", e.annual_vol is not None and e.annual_vol <= self.p.max_annual_vol,
            None if e.annual_vol is None else round(e.annual_vol, 4), self.p.max_annual_vol)
        add("correlation", e.max_correlation is None or e.max_correlation <= self.p.max_correlation,
            None if e.max_correlation is None else round(e.max_correlation, 3), self.p.max_correlation)
        return Verdict(all(c.passed for c in checks), checks)

    # ------------------------------------------------------------ exits
    @staticmethod
    def evaluate_exit(qty_held: float, qty_sell: float, pending_order_exists: bool,
                      quote_price_valid: bool, market_open: bool) -> Verdict:
        """Sells reduce risk, so they are allowed even in safe mode, but never
        short (qty <= held), never duplicated and never on an invalid price."""
        checks = [
            Check("no_short_selling", 0 < qty_sell <= qty_held + 1e-9, qty_sell, qty_held),
            Check("no_duplicate_order", not pending_order_exists, None, None),
            Check("valid_price", quote_price_valid, None, None),
            Check("market_open", market_open, None, None),
        ]
        return Verdict(all(c.passed for c in checks), checks)
