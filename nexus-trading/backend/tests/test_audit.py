import pytest
from sqlalchemy import select, text

from nexus.db import AuditViolation, session_scope
from nexus.engine import experiments
from nexus.models import Decision, Event, Experiment
from nexus.monitoring import emit, verify_chain


def test_hash_chain_valid_then_tamper_detected():
    with session_scope() as db:
        for i in range(5):
            emit(db, "system", f"event {i}")
    with session_scope() as db:
        assert verify_chain(db) == {"ok": True, "checked": 5}
        # simulate an attacker editing the DB directly (bypassing the ORM guard)
        db.execute(text("UPDATE events SET message='edited' WHERE id=3"))
    with session_scope() as db:
        res = verify_chain(db)
        assert res["ok"] is False and res["broken_at"] == 3


def test_events_and_decisions_cannot_be_deleted_or_edited():
    with session_scope() as db:
        emit(db, "system", "keep me")
    with pytest.raises(AuditViolation):
        with session_scope() as db:
            db.delete(db.execute(select(Event)).scalars().first())
    with session_scope() as db:
        exp = experiments.start(db, "48h", 400)
        a = experiments.agents_of(db, exp)[0]
        db.add(Decision(agent_id=a.id, cycle_id="1", symbol="AAPL", action="rejected", score=0.1,
                        rationale={"x": 1}))
    with pytest.raises(AuditViolation):
        with session_scope() as db:
            d = db.execute(select(Decision)).scalars().first()
            d.action = "buy"
    with pytest.raises(AuditViolation):
        with session_scope() as db:
            db.delete(db.execute(select(Experiment)).scalars().first())


def test_new_experiment_preserves_previous_history():
    with session_scope() as db:
        e1 = experiments.start(db, "48h", 400)
        e2 = experiments.start(db, "7d", 500)
        assert e1.status == "finished" and e2.status == "running"
        assert len(db.execute(select(Experiment)).scalars().all()) == 2
        assert all(a.cash == 500 for a in experiments.agents_of(db, e2))
