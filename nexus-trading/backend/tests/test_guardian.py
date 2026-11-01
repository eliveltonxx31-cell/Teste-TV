import dataclasses

import pytest

from nexus.risk.guardian import EntryProposal, HoldingView, PortfolioView, RiskGuardian
from nexus.risk.limits import HARD, PROFILES, RiskProfile


def pv(**kw):
    base = dict(equity_eur=400.0, cash_eur=400.0, holdings=[], day_start_equity=400.0, peak_equity=400.0)
    base.update(kw)
    return PortfolioView(**base)


def prop(**kw):
    # 0.2 shares * 100 USD * 0.925 EUR = 18.5 EUR (4.6% of 400)
    base = dict(symbol="AAPL", sector="Technology", qty=0.2, price_native=100.0, eur_per_unit=0.925,
                stop_price=97.0, est_roundtrip_cost_eur=0.12, annual_vol=0.2, max_correlation=None,
                quote_tradable=True, quote_issues=[], market_open=True, pending_order_exists=False)
    base.update(kw)
    return EntryProposal(**base)


G = RiskGuardian(PROFILES["B"])


def test_valid_entry_approved():
    v = G.evaluate_entry(pv(), prop(), safe_mode=False)
    assert v.approved, v.reasons


@pytest.mark.parametrize("kw,rule", [
    (dict(qty=0.3), "max_position_size"),                         # 27.75 EUR > 6%
    (dict(stop_price=80.0), "stop_distance"),                     # 20% stop
    (dict(stop_price=101.0), "stop_loss_defined"),
    (dict(quote_tradable=False, quote_issues=["stale_quote_600s"]), "data_integrity"),
    (dict(market_open=False), "market_open"),
    (dict(pending_order_exists=True), "no_duplicate_order"),
    (dict(est_roundtrip_cost_eur=1.0), "transaction_costs"),       # 5.4% costs
    (dict(annual_vol=0.9), "volatility"),
    (dict(annual_vol=None), "volatility"),
    (dict(max_correlation=0.95), "correlation"),
    (dict(earnings_soon=True), "no_earnings_event_imminent"),
    (dict(qty=0.0), "valid_order_numbers"),
])
def test_entry_rejections(kw, rule):
    v = G.evaluate_entry(pv(), prop(**kw), safe_mode=False)
    assert not v.approved and rule in v.reasons


def test_safe_mode_and_halt_block_buys():
    assert "system_not_in_safe_mode" in G.evaluate_entry(pv(), prop(), safe_mode=True).reasons
    assert "agent_not_halted" in G.evaluate_entry(pv(halted=True), prop(), safe_mode=False).reasons


def test_cash_reserve_and_leverage():
    v = G.evaluate_entry(pv(cash_eur=130.0), prop(), safe_mode=False)  # 111.5/400 < 30%
    assert "min_cash_reserve" in v.reasons
    v = G.evaluate_entry(pv(cash_eur=10.0), prop(), safe_mode=False)
    assert "no_leverage_cash_positive" in v.reasons


def test_max_positions_sector_and_no_averaging_down():
    holdings = [HoldingView(f"S{i}", f"Sec{i}", 10.0, 0.0) for i in range(10)]
    assert "max_positions" in G.evaluate_entry(pv(holdings=holdings), prop(), False).reasons
    tech = [HoldingView("MSFT", "Technology", 90.0, 0.0)]
    assert "sector_exposure" in G.evaluate_entry(pv(holdings=tech), prop(), False).reasons
    held = [HoldingView("AAPL", "Technology", 10.0, -3.0)]
    assert "no_existing_position" in G.evaluate_entry(pv(holdings=held), prop(), False).reasons


def test_circuit_breakers():
    v = G.evaluate_entry(pv(equity_eur=385.0, cash_eur=385.0), prop(), False)  # -3.75% today
    assert "daily_loss_limit" in v.reasons
    v = G.evaluate_entry(pv(equity_eur=340.0, cash_eur=340.0, day_start_equity=340.0, peak_equity=400.0),
                         prop(), False)  # -15% from peak
    assert "max_drawdown" in v.reasons


def test_exit_rules_no_short_no_duplicate():
    assert G.evaluate_exit(1.0, 1.0, False, True, True).approved
    assert "no_short_selling" in G.evaluate_exit(1.0, 2.0, False, True, True).reasons
    assert "no_duplicate_order" in G.evaluate_exit(1.0, 1.0, True, True, True).reasons
    assert "valid_price" in G.evaluate_exit(1.0, 1.0, False, False, True).reasons


def test_hard_limits_are_immutable_and_profiles_cannot_exceed_them():
    with pytest.raises(dataclasses.FrozenInstanceError):
        HARD.max_position_pct = 0.5  # type: ignore[misc]
    with pytest.raises(TypeError):
        PROFILES["Z"] = PROFILES["A"]  # type: ignore[index]
    loose = dataclasses.replace(PROFILES["C"], max_position_pct=0.10)
    with pytest.raises(AssertionError):
        RiskGuardian(loose)
    for p in PROFILES.values():
        assert p.max_position_pct <= 0.06 and p.max_positions <= 10 and p.min_cash_reserve_pct >= 0.30
    assert HARD.leverage_allowed is False and HARD.short_selling_allowed is False
    assert isinstance(PROFILES["A"], RiskProfile)
