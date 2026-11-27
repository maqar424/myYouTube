FROM python:3.12-slim

# ffmpeg is required by yt-dlp to merge best-quality video + audio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime (with the yt-dlp-ejs package from
# requirements.txt) to solve YouTube's JS challenges. Deno is the recommended
# runtime; this copies just its binary from the official image.
COPY --from=denoland/deno:bin-2.9.8 /deno /usr/local/bin/deno

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY app ./app
COPY web ./web

EXPOSE 8000

# entrypoint.sh refreshes yt-dlp, then runs the CMD below.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
