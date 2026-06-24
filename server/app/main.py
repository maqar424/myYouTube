"""myYouTube backend: a small FastAPI app + the PWA it serves."""
import mimetypes
import os
import signal
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from . import db, downloader, storage

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    storage.cleanup_orphans()
    downloader.start_worker()
    downloader.requeue_pending()
    yield


app = FastAPI(title="myYouTube", lifespan=lifespan)


def require_token(request: Request) -> None:
    """Optional shared-secret check. No-op when API_TOKEN is unset.

    Accepts the token via the X-API-Token header (used by fetch calls) or a
    `token` query param (used by the file-download link, which can't set
    headers).
    """
    if not settings.api_token:
        return
    provided = request.headers.get("X-API-Token") or request.query_params.get("token")
    if provided != settings.api_token:
        raise HTTPException(status_code=401, detail="Invalid or missing API token")


class DownloadRequest(BaseModel):
    url: str
    category: str = "video"


@app.get("/api/status", dependencies=[Depends(require_token)])
def get_status():
    return {
        "used_bytes": storage.used_bytes(),
        "by_category": storage.used_by_category(),
        "max_bytes": settings.max_bytes,
        "ytdlp_version": downloader.running_version(),
        "auth_required": bool(settings.api_token),
    }


@app.get("/api/videos", dependencies=[Depends(require_token)])
def get_videos():
    return db.list_videos()


@app.post("/api/download", dependencies=[Depends(require_token)])
def post_download(req: DownloadRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    category = req.category if req.category in db.VALID_CATEGORIES else "video"
    job_id = downloader.enqueue(url, category)
    return {"id": job_id, "status": "queued", "category": category}


@app.delete("/api/videos/{video_id}", dependencies=[Depends(require_token)])
def delete_video(video_id: str):
    video = db.get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Not found")
    storage.delete_file(video.get("filename"))
    storage.delete_file(video.get("thumbnail"))
    db.delete_video_row(video_id)
    return {"ok": True}


@app.get("/api/videos/{video_id}/file", dependencies=[Depends(require_token)])
def download_file(video_id: str):
    video = db.get_video(video_id)
    if not video or video["status"] != "done" or not video.get("filename"):
        raise HTTPException(status_code=404, detail="File not available")
    path = settings.media_dir / video["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    title = video.get("title") or video_id
    safe = "".join(ch for ch in title if ch.isalnum() or ch in " ._-").strip()
    download_name = f"{safe or video_id}{path.suffix}"
    return FileResponse(
        path, media_type="application/octet-stream", filename=download_name
    )


@app.get("/api/videos/{video_id}/thumbnail", dependencies=[Depends(require_token)])
def get_thumbnail(video_id: str):
    video = db.get_video(video_id)
    if not video or not video.get("thumbnail"):
        raise HTTPException(status_code=404, detail="No thumbnail")
    path = settings.media_dir / video["thumbnail"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail missing on disk")
    return FileResponse(path, media_type="image/jpeg")


_MEDIA_TYPES = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".opus": "audio/ogg",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav",
    ".flac": "audio/flac", ".aac": "audio/aac",
}


def _media_type_for(path: Path) -> str:
    ext = path.suffix.lower()
    return _MEDIA_TYPES.get(ext) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


@app.get("/api/videos/{video_id}/stream", dependencies=[Depends(require_token)])
def stream_file(video_id: str):
    """Serve the media file inline (correct MIME, no attachment header) so the
    browser can play it in <video>/<audio>. FileResponse handles HTTP range
    requests, so seeking works."""
    video = db.get_video(video_id)
    if not video or video["status"] != "done" or not video.get("filename"):
        raise HTTPException(status_code=404, detail="Not available")
    path = settings.media_dir / video["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(path, media_type=_media_type_for(path))


def _restart_soon(delay: float = 1.5) -> None:
    """Stop this process shortly after responding. Docker's
    `restart: unless-stopped` brings the container back up, and the entrypoint
    re-launches the app with the freshly installed yt-dlp loaded."""
    def _stop() -> None:
        time.sleep(delay)
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=_stop, daemon=True).start()


@app.post("/api/update-ytdlp", dependencies=[Depends(require_token)])
def update_ytdlp():
    old = downloader.running_version()
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "--no-cache-dir", "yt-dlp"],
            capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="pip timed out")
    if proc.returncode != 0:
        last = (proc.stderr or proc.stdout).strip().splitlines()
        raise HTTPException(status_code=500, detail=(last[-1] if last else "pip failed")[:300])

    # Query the freshly installed version in a clean interpreter (the version
    # imported in *this* process is still the old one until we restart).
    new = old
    try:
        out = subprocess.run(
            [sys.executable, "-c", "import yt_dlp,sys; sys.stdout.write(yt_dlp.version.__version__)"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0 and out.stdout.strip():
            new = out.stdout.strip()
    except subprocess.SubprocessError:
        pass

    changed = new != old
    if changed:
        _restart_soon()  # apply the update by reloading the process
    return {"old": old, "new": new, "changed": changed, "restarting": changed}


# Serve the PWA. Mounted LAST so the /api/* routes above take precedence.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
