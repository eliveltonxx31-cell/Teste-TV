"""Operator CLI: python -m nexus.cli <command>

  hash-password            create ADMIN_PASSWORD_HASH for .env
  probe                    smoke-test configured REAL data providers (needs API keys)
  start <kind> [capital]   start an experiment (48h | 7d | 30d | open)
  cycle                    run a single engine cycle now
  verify-chain             verify the tamper-evident event log
"""
from __future__ import annotations

import getpass
import json
import sys
from datetime import datetime, timedelta, timezone

from nexus.config import get_settings


def _probe() -> int:
    from nexus.market.base import NotEntitled, ProviderError
    from nexus.market.service import build_provider
    from nexus.market.universe import BY_SYMBOL

    s = get_settings()
    samples = [BY_SYMBOL["AAPL"], BY_SYMBOL["SPY"], BY_SYMBOL["SAP@XETR"]]
    failures = 0
    roles = {"quote": s.quote_provider, "history": s.history_provider, "news": s.news_provider,
             "fx": s.fx_provider, "crosscheck": s.crosscheck_provider}
    for role, name in roles.items():
        if not name:
            continue
        p = build_provider(name, s)
        print(f"\n== {role}: {name}  (key configured: {bool(p.api_key)}, entitlement: {p.entitlement})")
        for inst in samples:
            try:
                if role in ("quote", "crosscheck"):
                    q = p.quote(inst)
                    print(f"  {inst.symbol:10s} {q.price:>10.4f} {q.currency} ts={q.timestamp} "
                          f"delay={q.delay_seconds}s feed={q.feed.value} src={q.source}")
                elif role == "history":
                    bars = p.daily_bars(inst, 30)
                    print(f"  {inst.symbol:10s} {len(bars)} bars, last {bars[-1].day} close={bars[-1].close}")
                elif role == "news":
                    items = p.news(inst, datetime.now(timezone.utc) - timedelta(days=3))
                    print(f"  {inst.symbol:10s} {len(items)} news items")
            except (ProviderError, NotEntitled) as exc:
                failures += 1
                print(f"  {inst.symbol:10s} FAILED: {exc}")
        if role == "fx":
            try:
                fx = p.fx_eur("USD")
                print(f"  EURUSD {fx.rate} ts={fx.timestamp} kind={fx.kind}")
            except (ProviderError, NotEntitled) as exc:
                failures += 1
                print(f"  EURUSD FAILED: {exc}")
    print(f"\nprobe finished with {failures} failure(s)")
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd = argv[0]
    if cmd == "hash-password":
        from nexus.api.auth import hash_password
        pw = getpass.getpass("New admin password: ")
        if len(pw) < 12:
            print("use at least 12 characters")
            return 1
        print(hash_password(pw))
        return 0
    if cmd == "probe":
        return _probe()
    from nexus.db import init_db, session_scope
    init_db()
    if cmd == "start":
        from nexus.engine import experiments
        kind = argv[1] if len(argv) > 1 else "48h"
        capital = float(argv[2]) if len(argv) > 2 else get_settings().initial_capital_eur
        with session_scope() as db:
            exp = experiments.start(db, kind, capital, by="cli")
            print(f"started experiment {exp.id}: {exp.name}")
        return 0
    if cmd == "cycle":
        from nexus.engine.cycle import Engine
        with session_scope() as db:
            print(json.dumps(Engine().run_cycle(db), default=str))
        return 0
    if cmd == "verify-chain":
        from nexus.monitoring import verify_chain
        with session_scope() as db:
            res = verify_chain(db)
            print(json.dumps(res))
            return 0 if res["ok"] else 2
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
