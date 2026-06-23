#!/bin/sh
# Refresh yt-dlp on every container start. YouTube changes often and a stale
# yt-dlp is the most common cause of download failures, so we always pull the
# latest before launching the app. Non-fatal: if there's no network at boot,
# we log it and continue with the version baked into the image.
echo "[entrypoint] checking for yt-dlp updates..."
pip install --no-cache-dir --upgrade yt-dlp \
  || echo "[entrypoint] could not update yt-dlp (offline?), using installed version"

exec "$@"
