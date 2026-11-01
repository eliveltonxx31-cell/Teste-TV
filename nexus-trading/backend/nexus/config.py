"""Runtime configuration, loaded exclusively from environment variables.

Secrets (API keys, passwords, JWT secret) are never hard-coded.
Hard safety limits do NOT live here: they are constants in
``nexus.risk.limits`` so they cannot be changed through env, API or AI.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _env_int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _env_bool(name: str, default: bool) -> bool:
    return str(_env(name, "1" if default else "0")).lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "sqlite:///./nexus.db"))

    # --- Market data providers (role -> provider name) -------------------
    quote_provider: str = field(default_factory=lambda: _env("QUOTE_PROVIDER", "finnhub"))
    history_provider: str = field(default_factory=lambda: _env("HISTORY_PROVIDER", "twelvedata"))
    news_provider: str = field(default_factory=lambda: _env("NEWS_PROVIDER", "finnhub"))
    fx_provider: str = field(default_factory=lambda: _env("FX_PROVIDER", "twelvedata"))
    # Optional second quote source used to cross-check prices.
    crosscheck_provider: str | None = field(default_factory=lambda: _env("CROSSCHECK_PROVIDER"))

    finnhub_api_key: str | None = field(default_factory=lambda: _env("FINNHUB_API_KEY"))
    twelvedata_api_key: str | None = field(default_factory=lambda: _env("TWELVEDATA_API_KEY"))
    alphavantage_api_key: str | None = field(default_factory=lambda: _env("ALPHAVANTAGE_API_KEY"))
    massive_api_key: str | None = field(default_factory=lambda: _env("MASSIVE_API_KEY"))

    # Declared entitlement of each provider plan, per market ("US"/"EU").
    # The provider APIs do not reliably state whether a quote is real-time,
    # so the operator must declare what the contracted plan delivers.
    # Format: "US:realtime,EU:delayed"
    finnhub_entitlement: str = field(default_factory=lambda: _env("FINNHUB_ENTITLEMENT", "US:realtime,EU:none"))
    twelvedata_entitlement: str = field(default_factory=lambda: _env("TWELVEDATA_ENTITLEMENT", "US:realtime,EU:none"))
    alphavantage_entitlement: str = field(default_factory=lambda: _env("ALPHAVANTAGE_ENTITLEMENT", "US:delayed,EU:eod"))
    massive_entitlement: str = field(default_factory=lambda: _env("MASSIVE_ENTITLEMENT", "US:delayed,EU:none"))

    # --- Data integrity --------------------------------------------------
    max_quote_age_seconds: int = field(default_factory=lambda: _env_int("MAX_QUOTE_AGE_SECONDS", 120))
    # Trading on delayed quotes is OFF by default: fills would be unrealistic.
    allow_delayed_trading: bool = field(default_factory=lambda: _env_bool("ALLOW_DELAYED_TRADING", False))
    max_provider_failures: int = field(default_factory=lambda: _env_int("MAX_PROVIDER_FAILURES", 5))

    # --- Engine ----------------------------------------------------------
    cycle_seconds: int = field(default_factory=lambda: _env_int("CYCLE_SECONDS", 120))
    closed_market_cycle_seconds: int = field(default_factory=lambda: _env_int("CLOSED_CYCLE_SECONDS", 900))
    initial_capital_eur: float = field(default_factory=lambda: _env_float("INITIAL_CAPITAL_EUR", 400.0))
    fractional_shares: bool = field(default_factory=lambda: _env_bool("FRACTIONAL_SHARES", True))

    # --- Paper broker cost model ----------------------------------------
    fee_fixed_eur: float = field(default_factory=lambda: _env_float("FEE_FIXED_EUR", 0.0))
    fee_pct: float = field(default_factory=lambda: _env_float("FEE_PCT", 0.0005))
    fx_fee_pct: float = field(default_factory=lambda: _env_float("FX_FEE_PCT", 0.0025))
    base_slippage_bps: float = field(default_factory=lambda: _env_float("BASE_SLIPPAGE_BPS", 5.0))
    order_latency_seconds: int = field(default_factory=lambda: _env_int("ORDER_LATENCY_SECONDS", 2))
    order_ttl_minutes: int = field(default_factory=lambda: _env_int("ORDER_TTL_MINUTES", 60))

    # --- Optional LLM advisory (news sentiment only, bounded influence) --
    anthropic_api_key: str | None = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "claude-opus-5-5"))
    llm_enabled: bool = field(default_factory=lambda: _env_bool("LLM_ENABLED", False))

    # --- Security / ops --------------------------------------------------
    admin_user: str = field(default_factory=lambda: _env("ADMIN_USER", "admin"))
    admin_password_hash: str | None = field(default_factory=lambda: _env("ADMIN_PASSWORD_HASH"))
    jwt_secret: str | None = field(default_factory=lambda: _env("JWT_SECRET"))
    jwt_ttl_hours: int = field(default_factory=lambda: _env_int("JWT_TTL_HOURS", 12))
    alert_webhook_url: str | None = field(default_factory=lambda: _env("ALERT_WEBHOOK_URL"))
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", ""))

    def entitlement(self, provider: str) -> dict[str, str]:
        raw = getattr(self, f"{provider}_entitlement", "") or ""
        out: dict[str, str] = {}
        for part in raw.split(","):
            if ":" in part:
                k, v = part.split(":", 1)
                out[k.strip().upper()] = v.strip().lower()
        return out


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    global _settings
    _settings = None
