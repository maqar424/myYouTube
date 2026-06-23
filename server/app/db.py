"""Tiny SQLite layer for video metadata."""
import sqlite3
import time
from contextlib import contextmanager

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT,
  filename    TEXT,
  bytes       INTEGER NOT NULL DEFAULT 0,
  duration    INTEGER,
  status      TEXT NOT NULL,           -- queued | downloading | done | error
  progress    REAL NOT NULL DEFAULT 0, -- 0..100
  error       TEXT,
  created_at  REAL NOT NULL,
  finished_at REAL
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(settings.db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL;")
        c.executescript(SCHEMA)


def create_video(video_id: str, url: str) -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO videos (id, url, status, created_at) VALUES (?, ?, 'queued', ?)",
            (video_id, url, time.time()),
        )


def update_video(video_id: str, **fields) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    values = list(fields.values()) + [video_id]
    with connect() as c:
        c.execute(f"UPDATE videos SET {cols} WHERE id=?", values)


def get_video(video_id: str):
    with connect() as c:
        row = c.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
    return dict(row) if row else None


def list_videos():
    with connect() as c:
        rows = c.execute("SELECT * FROM videos ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def delete_video_row(video_id: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM videos WHERE id=?", (video_id,))
