"""Storage accounting and FIFO eviction to keep the media dir under the cap."""
from .config import settings
from . import db


def used_bytes() -> int:
    """Total bytes of completed media (what counts against the cap).

    Thumbnails are tiny and intentionally excluded from the budget.
    """
    with db.connect() as c:
        row = c.execute(
            "SELECT COALESCE(SUM(bytes), 0) AS total FROM videos WHERE status='done'"
        ).fetchone()
    return int(row["total"])


def delete_file(filename) -> None:
    if not filename:
        return
    path = settings.media_dir / filename
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def evict_to_fit(protect_id: str | None = None) -> list[str]:
    """Delete oldest completed items (FIFO) until usage <= cap.

    Never deletes ``protect_id`` (the item that triggered the check), so the
    newest download survives. Returns the ids that were evicted.
    """
    evicted: list[str] = []
    while used_bytes() > settings.max_bytes:
        with db.connect() as c:
            query = "SELECT id, filename, thumbnail FROM videos WHERE status='done'"
            params: list = []
            if protect_id:
                query += " AND id<>?"
                params.append(protect_id)
            query += " ORDER BY created_at ASC LIMIT 1"
            row = c.execute(query, params).fetchone()
        if row is None:
            break  # nothing left to evict
        delete_file(row["filename"])
        delete_file(row["thumbnail"])
        db.delete_video_row(row["id"])
        evicted.append(row["id"])
    return evicted


def cleanup_orphans() -> None:
    """Remove files on disk not referenced by any row (e.g. leftover .part
    files from a download interrupted by a restart)."""
    if not settings.media_dir.exists():
        return
    with db.connect() as c:
        rows = c.execute(
            "SELECT filename, thumbnail FROM videos WHERE status='done'"
        ).fetchall()
    referenced = set()
    for r in rows:
        if r["filename"]:
            referenced.add(r["filename"])
        if r["thumbnail"]:
            referenced.add(r["thumbnail"])
    for entry in settings.media_dir.iterdir():
        if entry.is_file() and entry.name not in referenced:
            try:
                entry.unlink()
            except OSError:
                pass
