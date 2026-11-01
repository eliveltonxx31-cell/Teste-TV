"""News sentiment.

Default: transparent financial lexicon (deterministic, auditable).
Optional: Claude classification (LLM_ENABLED=1 + ANTHROPIC_API_KEY). The LLM
only returns a bounded score in [-1, 1] for a headline. It never sees the
portfolio, never proposes orders and its output is clipped and down-weighted
by the quantitative engine.
"""
from __future__ import annotations

import logging
import re
from typing import Literal

from nexus.config import get_settings

log = logging.getLogger("nexus.sentiment")

POSITIVE = {
    "beat", "beats", "surge", "surges", "record", "upgrade", "upgraded", "outperform", "raises",
    "raised", "growth", "profit", "profits", "strong", "rally", "rallies", "gain", "gains",
    "buyback", "dividend", "approval", "approved", "expands", "tops", "exceeds", "bullish",
    "rebound", "soars", "jump", "jumps", "optimism", "upbeat",
}
NEGATIVE = {
    "miss", "misses", "plunge", "plunges", "downgrade", "downgraded", "underperform", "cuts",
    "cut", "loss", "losses", "weak", "lawsuit", "probe", "investigation", "recall", "fraud",
    "bankruptcy", "layoffs", "decline", "declines", "falls", "fall", "slump", "warning", "warns",
    "bearish", "sanctions", "tariff", "tariffs", "default", "halt", "crash", "fine", "fined",
    "recession", "inflation",
}
_WORD = re.compile(r"[a-zA-Z']+")


def lexicon_score(text: str) -> float:
    words = [w.lower() for w in _WORD.findall(text or "")]
    pos = sum(w in POSITIVE for w in words)
    neg = sum(w in NEGATIVE for w in words)
    if pos + neg == 0:
        return 0.0
    return round((pos - neg) / (pos + neg), 3)


def _llm_score(headline: str, summary: str | None) -> float | None:
    s = get_settings()
    if not (s.llm_enabled and s.anthropic_api_key):
        return None
    try:
        import anthropic
        from pydantic import BaseModel, Field

        class Sentiment(BaseModel):
            label: Literal["positive", "negative", "neutral"]
            score: float = Field(description="-1 very negative .. 1 very positive")

        client = anthropic.Anthropic(api_key=s.anthropic_api_key, timeout=30, max_retries=1)
        resp = client.beta.messages.parse(
            model=s.llm_model,
            max_tokens=1024,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low"},
            system=("You classify the market sentiment of a single financial news item for the "
                    "company it mentions. Reply with the label and a score in [-1, 1]. "
                    "Judge only the text provided."),
            messages=[{"role": "user", "content": f"Headline: {headline}\nSummary: {summary or '-'}"}],
            output_format=Sentiment,
        )
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            return None
        return max(-1.0, min(1.0, float(resp.parsed_output.score)))
    except Exception as exc:  # LLM is advisory; any failure falls back to lexicon
        log.warning("LLM sentiment unavailable: %s", exc)
        return None


def score_news(headline: str, summary: str | None) -> tuple[float, str]:
    llm = _llm_score(headline, summary)
    if llm is not None:
        return round(llm, 3), "llm"
    return lexicon_score(f"{headline} {summary or ''}"), "lexicon"
