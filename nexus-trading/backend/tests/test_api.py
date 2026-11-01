from fastapi.testclient import TestClient

from nexus import config
from nexus.api.auth import hash_password, verify_password


def client(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", hash_password("correct horse battery"))
    config.reset_settings()
    from nexus.api.main import app
    return TestClient(app)


def token(c):
    r = c.post("/api/auth/login", json={"username": "admin", "password": "correct horse battery"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_password_hashing():
    h = hash_password("abc123456789")
    assert verify_password("abc123456789", h) and not verify_password("wrong", h)
    assert not verify_password("x", None)


def test_health_is_public_and_reports_paper_only(monkeypatch):
    with client(monkeypatch) as c:
        r = c.get("/api/health")
        assert r.status_code == 200 and r.json()["paper_trading_only"] is True


def test_auth_required_and_bad_login(monkeypatch):
    with client(monkeypatch) as c:
        for path in ("/api/dashboard", "/api/market", "/api/settings", "/api/events", "/api/portfolio"):
            assert c.get(path).status_code == 401
        assert c.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401


def test_experiment_flow_and_protected_limits(monkeypatch):
    with client(monkeypatch) as c:
        h = token(c)
        assert c.post("/api/experiments", json={"kind": "48h", "capital_per_agent": 400}, headers=h).status_code == 400
        r = c.post("/api/experiments", json={"kind": "48h", "capital_per_agent": 400, "confirm": True}, headers=h)
        assert r.status_code == 200
        d = c.get("/api/dashboard", headers=h).json()
        assert d["totals"]["initial"] == 1200 and len(d["agents"]) == 3
        assert {a["agent"] for a in d["agents"]} == {"A", "B", "C"}
        s = c.get("/api/settings", headers=h).json()
        assert s["hard_limits"]["max_position_pct"] == 0.06
        # there is no endpoint able to change safety limits
        assert c.put("/api/settings", json={"hard_limits": {"max_position_pct": 1}}, headers=h).status_code in (404, 405)
        assert c.post("/api/experiments", json={"kind": "48h", "capital_per_agent": 5, "confirm": True},
                      headers=h).status_code == 422
        assert c.get("/api/audit/verify", headers=h).json()["ok"] is True
        assert c.get("/api/agents/B", headers=h).json()["summary"]["agent"] == "B"
        assert c.get("/api/market", headers=h).status_code == 200
        assert c.get("/api/intelligence", headers=h).status_code == 200
        assert c.get("/api/reports/live", headers=h).status_code == 200
        ev = c.get("/api/events", headers=h).json()["events"]
        assert any("Experiment" in e["message"] for e in ev)
