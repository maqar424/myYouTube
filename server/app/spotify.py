"""Spotify Web API client (client-credentials flow).

Spotify audio is DRM-protected and cannot be downloaded; we only read a
playlist's *metadata* (name + track/artist list). Each track is then matched
and downloaded from YouTube via a yt-dlp `ytsearch1:` job.
"""
import re
import time

import requests

from .config import settings

MAX_TRACKS = 500  # sanity cap for very large playlists

_token_cache = {"value": "", "expires": 0.0}


class SpotifyError(Exception):
    """User-facing problem with a Spotify import."""


def parse_playlist_id(url: str) -> str | None:
    """Extract the playlist id from open.spotify.com URLs (incl. intl-xx
    paths) and spotify:playlist: URIs."""
    m = re.search(r"playlist[/:]([A-Za-z0-9]+)", url)
    return m.group(1) if m else None


def _token() -> str:
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise SpotifyError(
            "Spotify import is not configured: set SPOTIFY_CLIENT_ID and "
            "SPOTIFY_CLIENT_SECRET in .env (see README)"
        )
    now = time.time()
    if _token_cache["value"] and now < _token_cache["expires"] - 60:
        return _token_cache["value"]
    try:
        resp = requests.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.spotify_client_id, settings.spotify_client_secret),
            timeout=15,
        )
    except requests.RequestException as exc:
        raise SpotifyError(f"Could not reach Spotify: {exc}") from exc
    if resp.status_code != 200:
        raise SpotifyError("Spotify auth failed — check SPOTIFY_CLIENT_ID/SECRET")
    data = resp.json()
    _token_cache["value"] = data["access_token"]
    _token_cache["expires"] = now + int(data.get("expires_in", 3600))
    return _token_cache["value"]


def _get(url: str, params: dict) -> dict:
    try:
        resp = requests.get(
            url, params=params,
            headers={"Authorization": f"Bearer {_token()}"},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise SpotifyError(f"Could not reach Spotify: {exc}") from exc
    if resp.status_code == 404:
        raise SpotifyError("Playlist not found — is it public?")
    if resp.status_code != 200:
        raise SpotifyError(f"Spotify API error ({resp.status_code})")
    return resp.json()


def fetch_playlist(url: str) -> dict:
    """Return {"name": str, "tracks": [{"artist": str, "title": str}, ...]}."""
    playlist_id = parse_playlist_id(url)
    if not playlist_id:
        raise SpotifyError("Not a Spotify playlist URL")

    base = f"https://api.spotify.com/v1/playlists/{playlist_id}"
    meta = _get(base, {"fields": "name"})

    tracks: list[dict] = []
    offset = 0
    while len(tracks) < MAX_TRACKS:
        page = _get(f"{base}/tracks", {
            "fields": "items(track(name,artists(name))),next",
            "limit": 100,
            "offset": offset,
        })
        items = page.get("items") or []
        for item in items:
            track = (item or {}).get("track") or {}
            title = track.get("name")
            if not title:
                continue  # removed/local tracks
            artists = [a.get("name") for a in (track.get("artists") or []) if a.get("name")]
            tracks.append({"artist": ", ".join(artists), "title": title})
        if not items or not page.get("next"):
            break
        offset += 100

    return {"name": (meta.get("name") or "Spotify playlist").strip() or "Spotify playlist",
            "tracks": tracks[:MAX_TRACKS]}
