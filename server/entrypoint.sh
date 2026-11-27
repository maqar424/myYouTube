#!/bin/sh
# Refresh yt-dlp on every container start. YouTube changes often and a stale
# yt-dlp is the most common cause of download failures, so we always pull the
# latest before launching the app. [default] keeps yt-dlp-ejs (the YouTube
# JS-challenge solver) in step with yt-dlp. Non-fatal: if there's no network at
# boot, we log it and continue with the version baked into the image.
echo "[entrypoint] checking for yt-dlp updates..."
pip install --no-cache-dir --upgrade "yt-dlp[default]" \
  || echo "[entrypoint] could not update yt-dlp (offline?), using installed version"

# yt-dlp uses Deno to run yt-dlp-ejs; without it YouTube support is degraded.
if command -v deno >/dev/null 2>&1; then
  echo "[entrypoint] $(deno --version | head -1)"
else
  echo "[entrypoint] WARNING: deno not found, YouTube downloads may fail"
fi

exec "$@"
