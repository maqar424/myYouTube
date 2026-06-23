# myYouTube

A tiny self-hosted YouTube downloader. Paste a video URL on your phone, your
home Ubuntu VM downloads it with [yt-dlp](https://github.com/yt-dlp/yt-dlp),
and you can save the result back to your phone — all over your private
[Tailscale](https://tailscale.com) network.

```
┌─────────────────┐        Tailscale         ┌──────────────────────────┐
│  Phone (PWA)    │ ─── HTTP (tailnet) ───▶   │  Ubuntu VM (Docker)      │
│                 │                           │                          │
│ • paste URL     │   POST /api/download      │ • FastAPI                │
│ • see the list  │   GET  /api/videos        │ • yt-dlp + ffmpeg        │
│ • save to phone │   GET  /api/videos/{id}/  │ • SQLite metadata        │
│ • watch storage │        file               │ • 25 GB FIFO store       │
└─────────────────┘   DELETE /api/videos/{id} └──────────────────────────┘
```

## Features

- **Paste & download** — submit a YouTube URL; the VM downloads it in the
  background and shows live progress.
- **Categories** — file each link as **Video**, **Music**, or **Podcast**.
  Video is full video (`bestvideo + bestaudio`, merged to MP4); Music and
  Podcast are fetched **audio-only** and saved as MP3.
- **Gallery** — a second page with a thumbnail grid, one tab per category.
  YouTube thumbnails are downloaded and shown for each item.
- **25 GB cap, FIFO** — when the store is full, the oldest items are deleted
  automatically to make room.
- **Save to phone** — one tap downloads the file through the browser.
- **No app store** — it's a PWA; "Add to Home screen" makes it feel native.
- **Private by default** — reachable only over your tailnet; optional token.

## Layout

```
myYouTube/
├── docker-compose.yml      # one service; mounts ./media (25 GB) and ./state
├── .env.example            # copy to .env and edit
└── server/
    ├── Dockerfile          # python + ffmpeg + yt-dlp
    ├── requirements.txt
    ├── app/                # FastAPI backend
    │   ├── main.py         # routes + serves the PWA
    │   ├── downloader.py   # yt-dlp worker + progress + thumbnails
    │   ├── storage.py      # size accounting + FIFO eviction
    │   ├── db.py           # SQLite metadata (category, thumbnail, ...)
    │   └── config.py
    └── web/                # the PWA
        ├── index.html      # download page (URL + category picker)
        ├── gallery.html    # gallery grid, one tab per category
        ├── common.js       # shared JS helpers
        ├── app.js          # landing page logic
        ├── gallery.js      # gallery logic
        ├── style.css
        └── manifest.json
```

## Run it on the Ubuntu VM

Requirements: Docker + Docker Compose, and Tailscale already up on the VM.

```bash
# 1. Get the code onto the VM
git clone git@github.com:maqar424/myYouTube.git
cd myYouTube

# 2. Configure
cp .env.example .env
tailscale ip -4            # note the VM's tailnet IP, e.g. 100.x.y.z
nano .env                  # set PUBLISH_ADDR to that IP (see below)

# 3. Build and start
docker compose up -d --build

# logs / stop
docker compose logs -f
docker compose down
```

### Binding to Tailscale (recommended)

Set `PUBLISH_ADDR` in `.env` to the VM's Tailscale IP so the service is **only**
reachable from devices on your tailnet:

```env
PUBLISH_ADDR=100.x.y.z      # from `tailscale ip -4`
PORT=8000
```

Leaving `PUBLISH_ADDR=0.0.0.0` exposes the port on every interface — only do
that behind a firewall you trust.

## Use it from your phone

1. Make sure Tailscale is connected on the phone.
2. Open `http://<vm-tailscale-ip>:8000` (or `http://<vm-name>:8000` if you use
   MagicDNS) in Chrome.
3. Chrome menu → **Add to Home screen** to install the PWA.
4. Pick a category (**Video / Music / Podcast**), paste a YouTube URL, and hit
   **Download**. Watch progress on the landing page.
5. Open **Gallery** (top-right link) to browse finished items by category with
   thumbnails, and tap **Save** to pull a file onto your phone.

## Configuration (`.env`)

| Variable       | Default                       | Meaning |
|----------------|-------------------------------|---------|
| `PUBLISH_ADDR` | `0.0.0.0`                     | Address the port is published on. Set to the Tailscale IP. |
| `PORT`         | `8000`                        | Host port. |
| `MAX_BYTES`    | `25G`                         | Storage cap. Oldest videos auto-deleted (FIFO) past this. |
| `YTDLP_FORMAT` | `bestvideo*+bestaudio/best`   | yt-dlp format selector. |
| `MERGE_FORMAT` | `mp4`                         | Output container for video. Use `mkv` for exotic 4K codecs. |
| `AUDIO_FORMAT` | `mp3`                         | Codec for Music/Podcast (audio-only) downloads. |
| `API_TOKEN`    | *(empty)*                     | Optional shared secret. Empty = rely on Tailscale only. |

## Notes & limits

- **One video per URL.** Playlists are not expanded (`noplaylist`); only the
  referenced video is fetched.
- **Best quality eats space.** With `MAX_BYTES=25G`, a few 4K videos can fill
  the budget and trigger FIFO eviction of older ones. Lower `YTDLP_FORMAT`
  (e.g. `bestvideo[height<=1080]+bestaudio/best`) if you want more headroom.
- **Restart-safe.** Unfinished downloads are re-queued on startup; the SQLite
  db and videos live in host-mounted volumes, so they survive `compose down`.
- Only use this to download content you have the right to download.
