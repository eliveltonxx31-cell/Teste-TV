"""IMMUTABLE safety limits.

These constants are the ceiling for every agent. They are not read from
env, database, API or any AI component. Agent profiles may only be STRICTER;
this is asserted at import time, so a misconfigured profile crashes the
process instead of trading.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class HardLimits:
    max_position_pct: float = 0.06        # max size of a NEW position, % of equity
    max_positions: int = 10
    min_cash_reserve_pct: float = 0.30    # cash that must remain after any buy
    max_risk_per_trade_pct: float = 0.01  # (entry - stop) * qty, % of equity
    max_stop_distance_pct: float = 0.10
    max_daily_loss_pct: float = 0.05
    max_drawdown_pct: float = 0.20
    max_sector_pct: float = 0.30
    max_roundtrip_cost_pct: float = 0.015  # estimated fees+spread+FX of a round trip
    leverage_allowed: bool = False
    short_selling_allowed: bool = False
    averaging_down_allowed: bool = False


HARD = HardLimits()


@dataclass(frozen=True)
class RiskProfile:
    code: str
    name: str
    max_position_pct: float
    max_positions: int
    min_cash_reserve_pct: float
    risk_per_trade_pct: float
    max_daily_loss_pct: float
    max_drawdown_pct: float
    max_sector_pct: float
    max_correlation: float
    max_annual_vol: float
    min_score: float
    stop_atr_mult: float
    take_profit_atr_mult: float

    def assert_within(self, hard: HardLimits = HARD) -> None:
        checks = {
            "max_position_pct": self.max_position_pct <= hard.max_position_pct,
            "max_positions": self.max_positions <= hard.max_positions,
            "min_cash_reserve_pct": self.min_cash_reserve_pct >= hard.min_cash_reserve_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct <= hard.max_risk_per_trade_pct,
            "max_daily_loss_pct": self.max_daily_loss_pct <= hard.max_daily_loss_pct,
            "max_drawdown_pct": self.max_drawdown_pct <= hard.max_drawdown_pct,
            "max_sector_pct": self.max_sector_pct <= hard.max_sector_pct,
        }
        bad = [k for k, ok in checks.items() if not ok]
        if bad:
            raise AssertionError(f"Profile {self.code} exceeds hard limits: {bad}")


PROFILES = MappingProxyType({
    "A": RiskProfile("A", "Conservador", max_position_pct=0.05, max_positions=8,
                     min_cash_reserve_pct=0.40, risk_per_trade_pct=0.004, max_daily_loss_pct=0.02,
                     max_drawdown_pct=0.08, max_sector_pct=0.20, max_correlation=0.70,
                     max_annual_vol=0.30, min_score=0.60, stop_atr_mult=2.0, take_profit_atr_mult=3.0),
    "B": RiskProfile("B", "Moderado", max_position_pct=0.06, max_positions=10,
                     min_cash_reserve_pct=0.30, risk_per_trade_pct=0.006, max_daily_loss_pct=0.03,
                     max_drawdown_pct=0.12, max_sector_pct=0.25, max_correlation=0.80,
                     max_annual_vol=0.45, min_score=0.55, stop_atr_mult=2.5, take_profit_atr_mult=4.0),
    "C": RiskProfile("C", "Agressivo", max_position_pct=0.06, max_positions=10,
                     min_cash_reserve_pct=0.30, risk_per_trade_pct=0.008, max_daily_loss_pct=0.04,
                     max_drawdown_pct=0.15, max_sector_pct=0.30, max_correlation=0.85,
                     max_annual_vol=0.70, min_score=0.50, stop_atr_mult=1.5, take_profit_atr_mult=3.0),
})

for _p in PROFILES.values():
    _p.assert_within()
