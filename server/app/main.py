"""myYouTube backend: a small FastAPI app + the PWA it serves."""
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


# Serve the PWA. Mounted LAST so the /api/* routes above take precedence.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
