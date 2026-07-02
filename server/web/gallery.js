"use strict";

// Gallery: browse finished downloads. Video plays in a modal; music/podcasts
// play in the bottom-pinned audio bar. The Music tab has two modes:
//   All Songs  -> grouped by artist, each a horizontal scrolling row
//   Playlists  -> each playlist a horizontal scrolling row of its songs
// A search box filters the current tab; the picker has its own search + rename.

const PLACEHOLDER = { video: "🎬", music: "🎵", podcast: "🎙️" };

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

let allVideos = [];
let playlists = [];
let currentCat = "video";
let musicMode = "allsongs"; // "allsongs" | "playlists"
let searchQuery = "";
let lastSig = ""; // last-rendered data signature (skip idle re-renders)

// picker state
let addPlaylistId = null;
let addMemberIds = new Set();

// --- element handles ---
const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const musicModes = document.getElementById("music-modes");
const modeAdd = document.getElementById("mode-add");
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
const addModal = document.getElementById("addsongs-modal");
const addList = document.getElementById("addsongs-list");
const addName = document.getElementById("addsongs-name");
const addSearch = document.getElementById("addsongs-search");
const addClose = document.getElementById("addsongs-close");
const addBackdrop = document.getElementById("addsongs-backdrop");

function fmtClock(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  const h = Math.floor(s / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

function emptyMsg(text, cls) {
  const p = document.createElement("p");
  p.className = cls || "empty";
  p.textContent = text;
  return p;
}

// title-only for videos/podcasts; title-or-artist for songs
function matchesItem(v, q) {
  return (v.title || "").toLowerCase().includes(q);
}
function matchesSong(v, q) {
  return (v.title || "").toLowerCase().includes(q) ||
         (v.artist || "").toLowerCase().includes(q);
}

// Higher view count first; songs without a view count fall back to recency.
function sortByViewsThenRecent(a, b) {
  const va = a.view_count == null ? -1 : a.view_count;
  const vb = b.view_count == null ? -1 : b.view_count;
  if (vb !== va) return vb - va;
  return (b.created_at || 0) - (a.created_at || 0);
}

// ---------- cards ----------
function buildCard(v, opts = {}) {
  const cat = v.category || "video";
  const card = document.createElement("div");
  card.className = "card";

  const thumb = v.thumbnail
    ? `<img class="thumb" src="${thumbUrl(v.id)}" loading="lazy" alt="" />`
    : `<div class="thumb placeholder">${PLACEHOLDER[cat] || "🎬"}</div>`;

  const cornerIcon = opts.playlistId ? ICON_MINUS : ICON_TRASH;
  const cornerLabel = opts.playlistId ? "Remove from playlist" : "Delete from server";

  card.innerHTML = `
    <div class="thumb-wrap">
      ${thumb}
      <button class="card-del" type="button" title="${cornerLabel}" aria-label="${cornerLabel}">${cornerIcon}</button>
    </div>
    <div class="card-body">
      <div class="title clamp">${escapeHtml(v.title || v.url)}</div>
      <div class="meta">${fmtBytes(v.bytes)} · ${fmtDuration(v.duration)}</div>
    </div>
    <div class="actions"></div>`;

  card.querySelector(".card-del").onclick = async () => {
    try {
      if (opts.playlistId) {
        await api(`/api/playlists/${opts.playlistId}/items/${v.id}`, { method: "DELETE" });
      } else {
        await api(`/api/videos/${v.id}`, { method: "DELETE" });
      }
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

  return card;
}

function groupHeader(text) {
  const h = document.createElement("h2");
  h.className = "artist-header";
  h.textContent = text;
  return h;
}

// A single horizontally scrolling row of cards.
function renderStrip(songs, cardOpts) {
  const strip = document.createElement("div");
  strip.className = "hscroll";
  for (const v of songs) strip.appendChild(buildCard(v, cardOpts));
  grid.appendChild(strip);
}

// ---------- render ----------
function render() {
  grid.className = "grid";
  grid.innerHTML = "";

  if (currentCat === "music") {
    renderMusic();
    return;
  }

  let items = allVideos.filter(
    (v) => v.status === "done" && (v.category || "video") === currentCat
  );
  if (searchQuery) items = items.filter((v) => matchesItem(v, searchQuery));

  if (!items.length) {
    grid.innerHTML = `<p class="empty">${searchQuery ? "No matches." : "Nothing here yet."}</p>`;
    return;
  }
  for (const v of items) grid.appendChild(buildCard(v));
}

function renderMusic() {
  grid.className = "grid grouped";
  if (musicMode === "playlists") {
    renderPlaylists();
  } else {
    let items = allVideos.filter(
      (v) => v.status === "done" && (v.category || "video") === "music"
    );
    if (searchQuery) items = items.filter((v) => matchesSong(v, searchQuery));
    renderArtistGroups(items);
  }
}

function renderArtistGroups(items) {
  if (!items.length) {
    grid.appendChild(emptyMsg(searchQuery ? "No songs match your search." : "No songs yet."));
    return;
  }
  const groups = new Map();
  for (const v of items) {
    const artist = (v.artist && v.artist.trim()) || "Unknown artist";
    if (!groups.has(artist)) groups.set(artist, []);
    groups.get(artist).push(v);
  }
  const names = [...groups.keys()].sort((a, b) => {
    if (a === "Unknown artist") return 1;
    if (b === "Unknown artist") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  for (const name of names) {
    grid.appendChild(groupHeader(name));
    renderStrip(groups.get(name).slice().sort(sortByViewsThenRecent), {});
  }
}

function renderPlaylists() {
  if (!playlists.length) {
    grid.appendChild(emptyMsg("No playlists yet. Create one, or download a YouTube playlist as Music."));
    return;
  }

  const byId = new Map(allVideos.map((v) => [v.id, v]));
  let anyShown = false;
  for (const pl of playlists) {
    let songs = (pl.video_ids || [])
      .map((id) => byId.get(id))
      .filter((v) => v && v.status === "done");
    if (searchQuery) songs = songs.filter((v) => matchesSong(v, searchQuery));
    if (searchQuery && !songs.length) continue; // skip non-matching playlists while searching
    anyShown = true;

    const head = document.createElement("div");
    head.className = "pl-head";
    head.innerHTML = `
      <div class="pl-head-title">${escapeHtml(pl.name)}</div>
      <div class="pl-head-actions">
        <button class="pl-icon-btn pl-add" type="button" title="Add / edit songs" aria-label="Add or edit songs">${ICON_PLUS}</button>
        <button class="pl-icon-btn pl-del" type="button" title="Delete playlist" aria-label="Delete playlist">${ICON_TRASH}</button>
      </div>`;
    head.querySelector(".pl-add").onclick = () => openAddSongs(pl.id, pl.name);
    head.querySelector(".pl-del").onclick = () => deletePlaylistFlow(pl.id, pl.name);
    grid.appendChild(head);

    if (!songs.length) {
      grid.appendChild(emptyMsg("Empty — tap + to add songs.", "pl-empty"));
      continue;
    }
    renderStrip(songs, { playlistId: pl.id });
  }
  if (searchQuery && !anyShown) grid.appendChild(emptyMsg("No songs match your search."));
}

// ---------- playlist actions ----------
async function createPlaylistFlow() {
  const name = prompt("New playlist name:");
  if (!name || !name.trim()) return;
  try {
    await api("/api/playlists", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    musicMode = "playlists";
    await load();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

async function deletePlaylistFlow(id, name) {
  if (!confirm(`Delete playlist “${name}”? Your songs stay in the library.`)) return;
  try {
    await api(`/api/playlists/${id}`, { method: "DELETE" });
    await load();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

// ---------- add-songs picker (with rename + search) ----------
function openAddSongs(playlistId, name) {
  addPlaylistId = playlistId;
  const pl = playlists.find((p) => p.id === playlistId);
  addMemberIds = new Set(pl ? pl.video_ids : []);
  addName.value = name;
  addSearch.value = "";
  renderAddList();
  addModal.classList.remove("hidden");
}

function renderAddList() {
  const q = addSearch.value.trim().toLowerCase();
  let songs = allVideos.filter(
    (v) => v.status === "done" && (v.category || "video") === "music"
  );
  if (q) songs = songs.filter((v) => matchesSong(v, q));
  songs.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));

  addList.innerHTML = "";
  if (!songs.length) {
    addList.appendChild(emptyMsg(q ? "No matches." : "No songs available."));
    return;
  }
  for (const v of songs) {
    const row = document.createElement("div");
    row.className = "add-row";
    row.innerHTML = `
      <div class="add-info">
        <div class="add-title">${escapeHtml(v.title || v.url)}</div>
        <div class="add-artist">${escapeHtml(v.artist || "Unknown artist")}</div>
      </div>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn add-toggle";
    const setState = (inList) => {
      btn.textContent = inList ? "Added" : "Add";
      btn.classList.toggle("secondary", inList);
    };
    setState(addMemberIds.has(v.id));
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (addMemberIds.has(v.id)) {
          await api(`/api/playlists/${addPlaylistId}/items/${v.id}`, { method: "DELETE" });
          addMemberIds.delete(v.id);
        } else {
          await api(`/api/playlists/${addPlaylistId}/items`, { method: "POST", body: JSON.stringify({ video_id: v.id }) });
          addMemberIds.add(v.id);
        }
        setState(addMemberIds.has(v.id));
      } catch (e) {
        alert("Failed: " + e.message);
      }
      btn.disabled = false;
    };
    row.appendChild(btn);
    addList.appendChild(row);
  }
}

async function commitRename() {
  const newName = addName.value.trim();
  const pl = playlists.find((p) => p.id === addPlaylistId);
  if (!addPlaylistId || !newName || (pl && pl.name === newName)) return;
  try {
    await api(`/api/playlists/${addPlaylistId}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
    if (pl) pl.name = newName;
  } catch (e) {
    alert("Rename failed: " + e.message);
  }
}

function closeAddSongs() {
  addModal.classList.add("hidden");
  load(); // reflect renames + membership changes
}

addSearch.addEventListener("input", renderAddList);
addName.addEventListener("change", commitRename);
addName.addEventListener("keydown", (e) => { if (e.key === "Enter") addName.blur(); });
addClose.onclick = closeAddSongs;
addBackdrop.onclick = closeAddSongs;

// ---------- video modal ----------
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

// ---------- bottom audio player ----------
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
  if (e.key !== "Escape") return;
  if (!modal.classList.contains("hidden")) closeVideo();
  else if (!addModal.classList.contains("hidden")) closeAddSongs();
});

// ---------- search + music modes ----------
function clearSearch() {
  searchQuery = "";
  searchInput.value = "";
}

function updateModeUI() {
  musicModes.querySelectorAll(".tab[data-mode]").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === musicMode)
  );
  modeAdd.classList.toggle("hidden", musicMode !== "playlists");
}

// Search only filters the active view (a tab, or a music mode).
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  render();
});

musicModes.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.id === "mode-add") return createPlaylistFlow();
  if (!btn.dataset.mode) return;
  musicMode = btn.dataset.mode;
  clearSearch();
  updateModeUI();
  render();
});

// Vertical wheel scrolls the horizontal song rows. Take smaller steps and
// briefly disable scroll-snap while wheeling so it glides instead of jumping a
// whole card per notch; snap is restored the moment wheeling stops. Touch is
// untouched (it never fires wheel, and snap stays on for it in steady state).
const WHEEL_STEP = 0.5;
const snapTimers = new WeakMap();
document.addEventListener("wheel", (e) => {
  const strip = e.target.closest && e.target.closest(".hscroll");
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  const atStart = strip.scrollLeft <= 0 && e.deltaY < 0;
  const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1 && e.deltaY > 0;
  if (atStart || atEnd) return;
  e.preventDefault();

  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;                     // lines -> px (e.g. Firefox)
  else if (e.deltaMode === 2) dy *= strip.clientWidth; // pages -> px

  strip.style.scrollSnapType = "none";
  strip.scrollLeft += dy * WHEEL_STEP;
  clearTimeout(snapTimers.get(strip));
  snapTimers.set(strip, setTimeout(() => strip.style.removeProperty("scroll-snap-type"), 400));
}, { passive: false });

// ---------- data loading + tabs ----------
function dataSignature() {
  const v = allVideos.map((x) => `${x.id}:${x.status}:${x.view_count || 0}`).join(",");
  const p = playlists.map((x) => `${x.id}:${x.name}:${(x.video_ids || []).join("|")}`).join(";");
  return v + "##" + p;
}

async function load() {
  try {
    const [videos, pls] = await Promise.all([api("/api/videos"), api("/api/playlists")]);
    allVideos = videos;
    playlists = pls;
    const sig = dataSignature();
    if (sig === lastSig) return; // unchanged — don't disturb scroll / search / mode
    lastSig = sig;
    render();
  } catch (_) {
    /* transient — next tick retries */
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentCat = btn.dataset.cat;
  musicMode = "allsongs";
  clearSearch();
  document.querySelectorAll("#tabs .tab").forEach((t) =>
    t.classList.toggle("active", t === btn)
  );
  musicModes.classList.toggle("hidden", currentCat !== "music");
  updateModeUI();
  render();
});

load();
setInterval(load, 4000);
