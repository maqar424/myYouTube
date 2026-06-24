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

# Thumbnails are stored next to the media file with the same job-id prefix; we
# tell them apart from the actual media by extension.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def running_version() -> str:
    """The yt-dlp version currently loaded in this process."""
    try:
        return yt_dlp.version.__version__
    except AttributeError:
        return "unknown"


def enqueue(url: str, category: str = "video") -> str:
    """Register a new download and hand it to the worker."""
    job_id = uuid.uuid4().hex[:12]
    db.create_video(job_id, url, category)
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


def _build_opts(job_id: str, category: str) -> dict:
    """yt-dlp options for this category. Music/podcast -> audio-only; video ->
    full video. Always grab the thumbnail and normalise it to .jpg for the
    gallery."""
    opts = {
        "outtmpl": str(settings.media_dir / f"{job_id}.%(ext)s"),
        "noplaylist": True,
        "continuedl": True,
        "quiet": True,
        "no_warnings": True,
        "writethumbnail": True,
        "progress_hooks": [_progress_hook(job_id)],
        "postprocessors": [],
    }

    if category in ("music", "podcast"):
        opts["format"] = "bestaudio/best"
        opts["postprocessors"].append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": settings.audio_format,
            "preferredquality": "0",  # best VBR
        })
    else:
        opts["format"] = settings.ytdlp_format
        opts["merge_output_format"] = settings.merge_format

    # Convert whatever thumbnail YouTube serves (often .webp) to a .jpg.
    opts["postprocessors"].append({
        "key": "FFmpegThumbnailsConvertor",
        "format": "jpg",
    })
    return opts


def _run_job(job_id: str) -> None:
    video = db.get_video(job_id)
    if not video:
        return
    category = video.get("category") or "video"

    db.update_video(job_id, status="downloading", progress=0, error=None)
    settings.media_dir.mkdir(parents=True, exist_ok=True)

    with yt_dlp.YoutubeDL(_build_opts(job_id, category)) as ydl:
        info = ydl.extract_info(video["url"], download=True)

    filepath = _resolve_media(job_id)
    if not filepath:
        db.update_video(job_id, status="error", error="Download produced no file")
        return

    thumb = _resolve_thumbnail(job_id)
    size = filepath.stat().st_size
    db.update_video(
        job_id,
        status="done",
        progress=100,
        filename=filepath.name,
        thumbnail=thumb.name if thumb else None,
        bytes=size,
        title=info.get("title"),
        duration=int(info.get("duration") or 0),
        finished_at=time.time(),
    )

    # Enforce the cap (FIFO), but never evict the item we just downloaded.
    storage.evict_to_fit(protect_id=job_id)
    if storage.used_bytes() > settings.max_bytes:
        # The single item alone is larger than the whole budget -> reject it.
        storage.delete_file(filepath.name)
        if thumb:
            storage.delete_file(thumb.name)
        db.update_video(
            job_id,
            status="error",
            filename=None,
            thumbnail=None,
            bytes=0,
            error="File alone exceeds the storage limit",
        )


def _resolve_media(job_id: str) -> Path | None:
    """The final media file for this job (largest non-image, non-partial match)."""
    candidates = [
        p for p in settings.media_dir.glob(f"{job_id}.*")
        if not p.name.endswith(".part") and p.suffix.lower() not in IMAGE_EXTS
    ]
    return max(candidates, key=lambda p: p.stat().st_size) if candidates else None


def _resolve_thumbnail(job_id: str) -> Path | None:
    """The thumbnail image saved for this job, if any."""
    images = [
        p for p in settings.media_dir.glob(f"{job_id}.*")
        if p.suffix.lower() in IMAGE_EXTS
    ]
    return images[0] if images else None
