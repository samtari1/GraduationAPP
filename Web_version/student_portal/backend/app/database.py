from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("PORTAL_DATA_DIR", ROOT / "data"))
STORAGE_DIR = Path(os.getenv("PORTAL_STORAGE_DIR", ROOT / "storage"))
AUDIO_DIR = STORAGE_DIR / "audio"
for directory in (DATA_DIR, AUDIO_DIR):
    directory.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("PORTAL_DATABASE_URL", f"sqlite:///{DATA_DIR / 'portal.sqlite3'}")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


class Base(DeclarativeBase):
    pass


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
