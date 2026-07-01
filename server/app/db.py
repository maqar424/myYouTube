"""Tiny SQLite layer for video + playlist metadata."""
import sqlite3
import time
import uuid
from contextlib import contextmanager

from .config import settings

VALID_CATEGORIES = ("video", "music", "podcast")

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT,
  filename    TEXT,
  thumbnail   TEXT,
  artist      TEXT,
  view_count  INTEGER,
  category    TEXT NOT NULL DEFAULT 'video', -- video | music | podcast
  bytes       INTEGER NOT NULL DEFAULT 0,
  duration    INTEGER,
  status      TEXT NOT NULL,           -- queued | downloading | done | error
  progress    REAL NOT NULL DEFAULT 0, -- 0..100
  error       TEXT,
  created_at  REAL NOT NULL,
  finished_at REAL
);

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'user', -- user | youtube
  created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, video_id)
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


def _migrate(c) -> None:
    """Add columns introduced after the first release, so existing dbs upgrade
    in place without losing prior downloads."""
    existing = {row["name"] for row in c.execute("PRAGMA table_info(videos)").fetchall()}
    if "category" not in existing:
        c.execute("ALTER TABLE videos ADD COLUMN category TEXT NOT NULL DEFAULT 'video'")
    if "thumbnail" not in existing:
        c.execute("ALTER TABLE videos ADD COLUMN thumbnail TEXT")
    if "artist" not in existing:
        c.execute("ALTER TABLE videos ADD COLUMN artist TEXT")
    if "view_count" not in existing:
        c.execute("ALTER TABLE videos ADD COLUMN view_count INTEGER")


def init_db() -> None:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL;")
        c.executescript(SCHEMA)
        _migrate(c)


# ---- videos ----

def create_video(video_id: str, url: str, category: str = "video") -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO videos (id, url, category, status, created_at) "
            "VALUES (?, ?, ?, 'queued', ?)",
            (video_id, url, category, time.time()),
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
        c.execute("DELETE FROM playlist_items WHERE video_id=?", (video_id,))
        c.execute("DELETE FROM videos WHERE id=?", (video_id,))


# ---- playlists ----

def create_playlist(name: str, source: str = "user") -> dict:
    playlist_id = uuid.uuid4().hex[:12]
    with connect() as c:
        c.execute(
            "INSERT INTO playlists (id, name, source, created_at) VALUES (?, ?, ?, ?)",
            (playlist_id, name, source, time.time()),
        )
    return {"id": playlist_id, "name": name, "source": source}


def list_playlists():
    with connect() as c:
        rows = c.execute(
            """SELECT p.id, p.name, p.source, p.created_at,
                      COUNT(i.video_id) AS count
               FROM playlists p
               LEFT JOIN playlist_items i ON i.playlist_id = p.id
               GROUP BY p.id
               ORDER BY p.created_at ASC"""
        ).fetchall()
    return [dict(r) for r in rows]


def get_playlist(playlist_id: str):
    with connect() as c:
        row = c.execute("SELECT * FROM playlists WHERE id=?", (playlist_id,)).fetchone()
    return dict(row) if row else None


def delete_playlist(playlist_id: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM playlist_items WHERE playlist_id=?", (playlist_id,))
        c.execute("DELETE FROM playlists WHERE id=?", (playlist_id,))


def add_playlist_item(playlist_id: str, video_id: str) -> None:
    with connect() as c:
        row = c.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id=?",
            (playlist_id,),
        ).fetchone()
        c.execute(
            "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position) "
            "VALUES (?, ?, ?)",
            (playlist_id, video_id, row["pos"]),
        )


def remove_playlist_item(playlist_id: str, video_id: str) -> None:
    with connect() as c:
        c.execute(
            "DELETE FROM playlist_items WHERE playlist_id=? AND video_id=?",
            (playlist_id, video_id),
        )


def playlist_video_ids(playlist_id: str):
    with connect() as c:
        rows = c.execute(
            "SELECT video_id FROM playlist_items WHERE playlist_id=? ORDER BY position ASC",
            (playlist_id,),
        ).fetchall()
    return [r["video_id"] for r in rows]
