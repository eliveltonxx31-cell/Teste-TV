"""Database engine, session handling and audit-table protection."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from nexus.config import get_settings


class Base(DeclarativeBase):
    pass


class AuditViolation(RuntimeError):
    """Raised when code tries to delete/alter immutable audit history."""


_engine = None
_SessionLocal: sessionmaker | None = None

# Tables whose rows can never be deleted. Rows in APPEND_ONLY can't be updated either.
NO_DELETE_TABLES = {
    "events", "decisions", "orders", "closed_trades", "equity_snapshots",
    "reports", "incidents", "experiments", "agents",
}
APPEND_ONLY_TABLES = {"events", "decisions", "closed_trades", "reports", "equity_snapshots"}

POSTGRES_GUARD_SQL = """
CREATE OR REPLACE FUNCTION nexus_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'NEXUS audit: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
"""


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().database_url
        kwargs = {"pool_pre_ping": True, "future": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        _engine = create_engine(url, **kwargs)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def init_db() -> None:
    from nexus import models  # noqa: F401  (register tables)

    engine = get_engine()
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        # Database-level enforcement, independent of application code.
        with engine.begin() as conn:
            conn.execute(text(POSTGRES_GUARD_SQL))
            for table in NO_DELETE_TABLES:
                ops = "UPDATE OR DELETE" if table in APPEND_ONLY_TABLES else "DELETE"
                conn.execute(text(f"DROP TRIGGER IF EXISTS nexus_guard_{table} ON {table}"))
                conn.execute(text(
                    f"CREATE TRIGGER nexus_guard_{table} BEFORE {ops} ON {table} "
                    f"FOR EACH ROW EXECUTE FUNCTION nexus_block_change()"
                ))


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@event.listens_for(Session, "before_flush")
def _guard_audit_tables(session: Session, flush_context, instances) -> None:
    """Application-level enforcement (also covers SQLite in dev/tests)."""
    for obj in session.deleted:
        table = getattr(obj, "__tablename__", None)
        if table in NO_DELETE_TABLES:
            raise AuditViolation(f"Deleting from '{table}' is forbidden (audit history).")
    for obj in session.dirty:
        table = getattr(obj, "__tablename__", None)
        if table in APPEND_ONLY_TABLES and session.is_modified(obj, include_collections=False):
            raise AuditViolation(f"Updating '{table}' is forbidden (append-only).")
