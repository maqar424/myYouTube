"""Background download worker built on yt-dlp."""
import queue
import threading
import time
import uuid
from pathlib import Path

import yt_dlp

from .config import settings
from . import db, storage

_job_queue: "queue.Queue[str]" = queue.Queue()
_started = False
_start_lock = threading.Lock()


def enqueue(url: str) -> str:
    """Register a new download and hand it to the worker."""
    job_id = uuid.uuid4().hex[:12]
    db.create_video(job_id, url)
    _job_queue.put(job_id)
    return job_id


def start_worker() -> None:
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_worker_loop, name="downloader", daemon=True).start()


def requeue_pending() -> None:
    """After a restart, re-queue anything that wasn't finished."""
    for video in db.list_videos():
        if video["status"] in ("queued", "downloading"):
            db.update_video(video["id"], status="queued", progress=0, error=None)
            _job_queue.put(video["id"])


def _worker_loop() -> None:
    while True:
        job_id = _job_queue.get()
        try:
            _run_job(job_id)
        except Exception as exc:  # noqa: BLE001 - surface any yt-dlp failure to the UI
            db.update_video(job_id, status="error", error=str(exc))
        finally:
            _job_queue.task_done()


def _progress_hook(job_id: str):
    last = {"at": 0.0}

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = (done / total * 100) if total else 0
            now = time.time()
            if now - last["at"] >= 1.0:  # throttle db writes to ~1/s
                last["at"] = now
                db.update_video(job_id, status="downloading", progress=round(pct, 1))
        elif d.get("status") == "finished":
            db.update_video(job_id, progress=100)

    return hook


def _run_job(job_id: str) -> None:
    video = db.get_video(job_id)
    if not video:
        return

    db.update_video(job_id, status="downloading", progress=0, error=None)
    settings.media_dir.mkdir(parents=True, exist_ok=True)

    ydl_opts = {
        "outtmpl": str(settings.media_dir / f"{job_id}.%(ext)s"),
        "format": settings.ytdlp_format,
        "merge_output_format": settings.merge_format,
        "noplaylist": True,
        "continuedl": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [_progress_hook(job_id)],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video["url"], download=True)

    filepath = _resolve_filepath(job_id, info)
    if not filepath or not filepath.exists():
        db.update_video(job_id, status="error", error="Download produced no file")
        return

    size = filepath.stat().st_size
    db.update_video(
        job_id,
        status="done",
        progress=100,
        filename=filepath.name,
        bytes=size,
        title=info.get("title"),
        duration=int(info.get("duration") or 0),
        finished_at=time.time(),
    )

    # Enforce the cap (FIFO), but never evict the video we just downloaded.
    storage.evict_to_fit(protect_id=job_id)
    if storage.used_bytes() > settings.max_bytes:
        # The single video alone is larger than the whole budget -> reject it.
        storage.delete_file(filepath.name)
        db.update_video(
            job_id,
            status="error",
            filename=None,
            bytes=0,
            error="Video alone exceeds the storage limit",
        )


def _resolve_filepath(job_id: str, info: dict) -> Path | None:
    """Find the final merged file produced for this job."""
    requested = info.get("requested_downloads") or []
    if requested and requested[0].get("filepath"):
        return Path(requested[0]["filepath"])
    # Fallback: match by our job-id prefix, ignoring partial files.
    matches = [
        p for p in settings.media_dir.glob(f"{job_id}.*")
        if not p.name.endswith(".part")
    ]
    return matches[0] if matches else None
