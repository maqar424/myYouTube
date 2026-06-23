"""Environment-driven settings."""
import os
from pathlib import Path


def _parse_size(value: str) -> int:
    """Parse a human size like '25G' / '500M' / '1048576' into bytes."""
    value = str(value).strip().upper()
    if not value:
        return 0
    units = {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}
    if value[-1] in units:
        return int(float(value[:-1]) * units[value[-1]])
    if value.endswith("B"):
        value = value[:-1]
    return int(value)


class Settings:
    def __init__(self) -> None:
        self.media_dir = Path(os.getenv("MEDIA_DIR", "/data/media"))
        self.db_path = Path(os.getenv("DB_PATH", "/data/state/app.db"))
        self.max_bytes = _parse_size(os.getenv("MAX_BYTES", "25G"))
        self.api_token = os.getenv("API_TOKEN", "").strip()
        self.ytdlp_format = os.getenv("YTDLP_FORMAT", "bestvideo*+bestaudio/best")
        self.merge_format = os.getenv("MERGE_FORMAT", "mp4")
        # Audio codec for music/podcast (audio-only) downloads.
        self.audio_format = os.getenv("AUDIO_FORMAT", "mp3")


settings = Settings()
