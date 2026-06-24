"use strict";

// Gallery: browse finished downloads as a thumbnail grid, one tab per category.
// Video plays in a modal; music/podcasts play in the bottom-pinned audio bar.
// Shared helpers come from common.js.

const PLACEHOLDER = { video: "🎬", music: "🎵", podcast: "🎙️" };

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

let allVideos = [];
let currentCat = "video";

// --- element handles ---
const grid = document.getElementById("grid");
const audio = document.getElementById("audio");
const player = document.getElementById("player");
const toggleBtn = document.getElementById("player-toggle");
const seek = document.getElementById("player-seek");
const timeEl = document.getElementById("player-time");
const titleEl = document.getElementById("player-title");
const playerClose = document.getElementById("player-close");
const modal = document.getElementById("video-modal");
const video = document.getElementById("video");
const modalClose = document.getElementById("modal-close");
const modalBackdrop = document.getElementById("modal-backdrop");

function fmtClock(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  const h = Math.floor(s / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// --- gallery grid ---
function render() {
  const items = allVideos.filter(
    (v) => v.status === "done" && (v.category || "video") === currentCat
  );

  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = '<p class="empty">Nothing here yet.</p>';
    return;
  }

  for (const v of items) {
    const cat = v.category || "video";
    const card = document.createElement("div");
    card.className = "card";

    const thumb = v.thumbnail
      ? `<img class="thumb" src="${thumbUrl(v.id)}" loading="lazy" alt="" />`
      : `<div class="thumb placeholder">${PLACEHOLDER[cat] || "🎬"}</div>`;

    card.innerHTML = `
      <div class="thumb-wrap">
        ${thumb}
        <button class="card-del" type="button" title="Delete from server" aria-label="Delete from server">${ICON_TRASH}</button>
      </div>
      <div class="card-body">
        <div class="title clamp">${escapeHtml(v.title || v.url)}</div>
        <div class="meta">${fmtBytes(v.bytes)} · ${fmtDuration(v.duration)}</div>
      </div>
      <div class="actions"></div>`;

    card.querySelector(".card-del").onclick = async () => {
      if (!confirm("Delete this item from the server?")) return;
      try {
        await api(`/api/videos/${v.id}`, { method: "DELETE" });
        load();
      } catch (e) {
        alert("Failed: " + e.message);
      }
    };

    const actions = card.querySelector(".actions");

    const stream = document.createElement("button");
    stream.className = "btn stream";
    stream.type = "button";
    stream.textContent = "Stream";
    stream.onclick = () =>
      cat === "music" || cat === "podcast" ? playAudio(v) : openVideo(v);
    actions.appendChild(stream);

    const dl = document.createElement("a");
    dl.className = "btn dl";
    dl.textContent = "Download";
    dl.href = fileUrl(v.id);
    dl.setAttribute("download", "");
    actions.appendChild(dl);

    grid.appendChild(card);
  }
}

// --- video modal ---
function openVideo(v) {
  closeAudio();
  video.src = streamUrl(v.id);
  if (v.thumbnail) video.poster = thumbUrl(v.id);
  else video.removeAttribute("poster");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  video.play().catch(() => {});
}

function closeVideo() {
  video.pause();
  video.removeAttribute("src");
  video.load();
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

modalClose.onclick = closeVideo;
modalBackdrop.onclick = closeVideo;

// --- bottom audio player ---
function updatePlayIcon() {
  toggleBtn.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
}

function playAudio(v) {
  closeVideo();
  titleEl.textContent = v.title || v.url;
  audio.src = streamUrl(v.id);
  seek.value = "0";
  timeEl.textContent = "0:00";
  player.classList.remove("hidden");
  player.setAttribute("aria-hidden", "false");
  document.body.classList.add("player-open");
  audio.play().catch(() => {});
  updatePlayIcon();
}

function closeAudio() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  player.classList.add("hidden");
  player.setAttribute("aria-hidden", "true");
  document.body.classList.remove("player-open");
}

toggleBtn.onclick = () => (audio.paused ? audio.play() : audio.pause());
playerClose.onclick = closeAudio;

audio.addEventListener("play", updatePlayIcon);
audio.addEventListener("pause", updatePlayIcon);
audio.addEventListener("ended", updatePlayIcon);

let scrubbing = false;
seek.addEventListener("input", () => {
  scrubbing = true;
  if (audio.duration) {
    timeEl.textContent =
      `${fmtClock((seek.value / 1000) * audio.duration)} / ${fmtClock(audio.duration)}`;
  }
});
seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  scrubbing = false;
});
audio.addEventListener("timeupdate", () => {
  if (scrubbing || !audio.duration) return;
  seek.value = String((audio.currentTime / audio.duration) * 1000);
  timeEl.textContent = `${fmtClock(audio.currentTime)} / ${fmtClock(audio.duration)}`;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modal.classList.contains("hidden")) closeVideo();
  }
});

// --- data loading + tabs ---
async function load() {
  try {
    allVideos = await api("/api/videos");
    render();
  } catch (_) {
    /* transient — next tick retries */
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentCat = btn.dataset.cat;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t === btn)
  );
  render();
});

load();
setInterval(load, 4000);
