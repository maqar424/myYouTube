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
  background and shows live progress and your place in the queue.
- **Playlist downloads** — a playlist URL downloads every video as its own
  item; for a video inside a playlist you choose "just this video" or "entire
  playlist". Playlists downloaded as Music become a playlist in the gallery.
- **Categories** — file each link as **Video**, **Music**, or **Podcast**.
  Video is full video (`bestvideo + bestaudio`, merged to MP4); Music and
  Podcast are fetched **audio-only** and saved as MP3.
- **Gallery** — a thumbnail grid with one tab per category (red / green /
  blue) and search. YouTube thumbnails are downloaded for each item.
- **Stream in the browser** — videos play in a pop-up player; music and
  podcasts play in a bottom bar that keeps playing when you switch views.
- **Music library** — "All Songs" groups songs by artist (most-viewed first);
  "Playlists" lets you create, rename and fill your own playlists.
- **Player** — plays through the row you started from, with shuffle,
  next/previous, and an expandable "Up next" queue you can reorder by drag and
  drop; the **+** on a song card adds it to the queue.
- **25 GB cap, FIFO** — when the store is full, the oldest items are deleted
  automatically to make room.
- **Save to phone** — one tap downloads the file through the browser.
- **Light / dark mode** — toggle in the top bar, remembered per device.
- **No app store** — it's a PWA; "Add to Home screen" makes it feel native.
- **Private by default** — reachable only over your tailnet; optional token.
- **One-tap yt-dlp update** — an Update link in the header upgrades yt-dlp and
  restarts the app to apply it (hover shows the current version; yt-dlp also
  auto-updates on every container start).
- **Lock-screen playback controls** — the music player integrates with the
  phone's media notification (artwork, play/pause, next/previous, headset
  buttons).
- **Retry failed downloads** — a Retry button re-queues an errored download
  without re-pasting the URL.

## Layout

```
myYouTube/
├── docker-compose.yml      # one service; mounts ./media (25 GB) and ./state
├── .env.example            # copy to .env and edit
└── server/
    ├── Dockerfile          # python + ffmpeg + deno + yt-dlp
    ├── requirements.txt
    ├── app/                # FastAPI backend
    │   ├── main.py         # routes + serves the PWA
    │   ├── downloader.py   # yt-dlp worker + progress + thumbnails
    │   ├── storage.py      # size accounting + FIFO eviction
    │   ├── db.py           # SQLite metadata (category, thumbnail, ...)
    │   └── config.py
    └── web/                # the PWA (single page: Download + Gallery views)
        ├── index.html      # both views; the audio player survives switches
        ├── gallery.html    # redirect stub for old bookmarks -> /#gallery
        ├── common.js       # shared helpers + theme + view router
        ├── app.js          # download view logic
        ├── gallery.js      # gallery view logic
        ├── style.css
        ├── manifest.json   # app install metadata
        └── icon*.png/svg   # app icons (normal + Android "maskable")
```

## Run it on the Ubuntu VM

Requirements: Docker + Docker Compose, and Tailscale already up on the VM.

```bash
# 1. Get the code onto the VM
git clone git@github.com:maqar424/myYouTube.git
cd myYouTube

# 2. Configure (defaults are fine; PUBLISH_ADDR=127.0.0.1)
cp .env.example .env

# 3. Build and start
docker compose up -d --build

# 4. Give it an HTTPS address on your tailnet (see below)
sudo tailscale serve --bg 8000

# logs / stop
docker compose logs -f
docker compose down
```

### HTTPS with Tailscale Serve (recommended)

Chrome only lets you **install** the web app (own icon, no browser bar) when
it's served over HTTPS. Tailscale Serve gives the VM an HTTPS address with a
valid certificate, reachable only from your tailnet:

1. In the Tailscale admin console → **DNS**: turn on **MagicDNS**, and under
   **HTTPS Certificates** click **Enable HTTPS**. (Machine names then appear
   in public certificate logs.)
2. Keep `PUBLISH_ADDR=127.0.0.1` in `.env` — Serve can only forward to
   localhost, and this way the app isn't reachable any other way. After
   changing it, recreate the container with `docker compose up -d`.
3. On the VM: `sudo tailscale serve --bg 8000`. It prints the URL, e.g.
   `https://<vm-name>.<tailnet>.ts.net`. `--bg` keeps it running across
   reboots.
4. Check with `tailscale serve status`; undo with `tailscale serve reset`.

If another app on the same VM already uses Serve on port 443, give this one
its own port: `sudo tailscale serve --bg --https=8443 8000` →
`https://<vm-name>.<tailnet>.ts.net:8443`.

Prefer plain HTTP instead? Set `PUBLISH_ADDR` to the VM's Tailscale IP
(`tailscale ip -4`) and open `http://<that-ip>:8000` — it works in the
browser, but can't be installed as an app.

## Use it from your phone

1. Make sure Tailscale is connected on the phone.
2. Open `https://<vm-name>.<tailnet>.ts.net` (your Tailscale Serve address) in
   Chrome.
3. Chrome menu → **Add to Home screen** → **Install**. It then opens like an
   app, with its own icon and without the browser bar.
4. Pick a category (**Video / Music / Podcast**), paste a YouTube URL, and hit
   **Download**. Watch progress on the landing page.
5. Open **Gallery** (top-right link) to browse finished items by category with
   thumbnails. Tap **Stream** to play in the browser, or **Download** to pull
   the file onto your phone. Music keeps playing when you switch back to the
   download view.

## Configuration (`.env`)

| Variable       | Default                       | Meaning |
|----------------|-------------------------------|---------|
| `PUBLISH_ADDR` | `0.0.0.0`                     | Address the port is published on. Use `127.0.0.1` with Tailscale Serve (recommended). |
| `PORT`         | `8000`                        | Host port. |
| `MAX_BYTES`    | `25G`                         | Storage cap. Oldest videos auto-deleted (FIFO) past this. |
| `YTDLP_FORMAT` | `bestvideo*+bestaudio/best`   | yt-dlp format selector. |
| `MERGE_FORMAT` | `mp4`                         | Output container for video. Use `mkv` for exotic 4K codecs. |
| `AUDIO_FORMAT` | `mp3`                         | Codec for Music/Podcast (audio-only) downloads. |
| `API_TOKEN`    | *(empty)*                     | Optional shared secret. Empty = rely on Tailscale only. |

## Notes & limits

- **YouTube needs a JavaScript runtime.** yt-dlp solves YouTube's JavaScript
  challenges with the `yt-dlp-ejs` package and Deno; both ship in the image
  (`yt-dlp[default]` and `/usr/local/bin/deno`). The container log shows the
  Deno version on start.
- **"Sign in to confirm you're not a bot".** YouTube sometimes blocks
  downloads that don't come from a signed-in browser. Tap **Update** to get
  the latest yt-dlp, then **Retry**. Login cookies are not supported yet.
- **Large playlists and the cap.** Every playlist entry is its own download,
  so a big playlist can push older items out of the 25 GB budget.
- **Best quality eats space.** With `MAX_BYTES=25G`, a few 4K videos can fill
  the budget and trigger FIFO eviction of older ones. Lower `YTDLP_FORMAT`
  (e.g. `bestvideo[height<=1080]+bestaudio/best`) if you want more headroom.
- **Restart-safe.** Unfinished downloads are re-queued on startup; the SQLite
  db and videos live in host-mounted volumes, so they survive `compose down`.
- Only use this to download content you have the right to download.
