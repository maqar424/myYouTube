"use strict";

// Gallery: browse finished downloads. Video plays in a modal; music/podcasts
// play in the bottom-pinned audio bar. The Music tab has two modes:
//   All Songs  -> grouped by artist (top 8 per artist, expandable)
//   Playlists  -> each playlist stacked (first 4 songs, expandable)

const PLACEHOLDER = { video: "🎬", music: "🎵", podcast: "🎙️" };

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

const ARTIST_LIMIT = 8;
const PLAYLIST_LIMIT = 4;

let allVideos = [];
let playlists = [];
let currentCat = "video";
let musicMode = "allsongs"; // "allsongs" | "playlists"
const expandedArtists = new Set();
const expandedPlaylists = new Set();

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
const addModal = document.getElementById("addsongs-modal");
const addList = document.getElementById("addsongs-list");
const addTitle = document.getElementById("addsongs-title");
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

// ---------- render ----------
function render() {
  grid.className = "grid";
  grid.innerHTML = "";

  if (currentCat === "music") {
    renderMusic();
    return;
  }
  const items = allVideos.filter(
    (v) => v.status === "done" && (v.category || "video") === currentCat
  );
  if (!items.length) {
    grid.innerHTML = '<p class="empty">Nothing here yet.</p>';
    return;
  }
  for (const v of items) grid.appendChild(buildCard(v));
}

function renderMusic() {
  grid.className = "grid grouped";
  grid.appendChild(buildMusicToggle());
  if (musicMode === "playlists") {
    renderPlaylists();
  } else {
    const items = allVideos.filter(
      (v) => v.status === "done" && (v.category || "video") === "music"
    );
    renderArtistGroups(items);
  }
}

function buildMusicToggle() {
  const wrap = document.createElement("div");
  wrap.className = "music-toggle";
  wrap.appendChild(segBtn("All Songs", musicMode === "allsongs", () => { musicMode = "allsongs"; render(); }));
  wrap.appendChild(segBtn("Playlists", musicMode === "playlists", () => { musicMode = "playlists"; render(); }));
  return wrap;
}
function segBtn(label, active, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "seg-btn" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// Higher view count first; songs without a view count fall back to recency.
function sortByViewsThenRecent(a, b) {
  const va = a.view_count == null ? -1 : a.view_count;
  const vb = b.view_count == null ? -1 : b.view_count;
  if (vb !== va) return vb - va;
  return (b.created_at || 0) - (a.created_at || 0);
}

function groupHeader(text) {
  const h = document.createElement("h2");
  h.className = "artist-header";
  h.textContent = text;
  return h;
}

// Render one group's songs capped at `limit`, plus a Show all / Show less toggle.
function renderGroup(songs, limit, expanded, onToggle, cardOpts) {
  const shown = expanded ? songs : songs.slice(0, limit);
  const sub = document.createElement("div");
  sub.className = "grid";
  for (const v of shown) sub.appendChild(buildCard(v, cardOpts));
  grid.appendChild(sub);

  if (songs.length > limit) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "artist-more";
    btn.textContent = expanded ? "Show less" : `Show all ${songs.length}`;
    btn.onclick = onToggle;
    grid.appendChild(btn);
  }
}

function renderArtistGroups(items) {
  if (!items.length) {
    grid.appendChild(emptyMsg("No songs yet."));
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
    const songs = groups.get(name).slice().sort(sortByViewsThenRecent);
    const expanded = expandedArtists.has(name);
    renderGroup(songs, ARTIST_LIMIT, expanded, () => {
      if (expanded) expandedArtists.delete(name);
      else expandedArtists.add(name);
      render();
    }, {});
  }
}

function renderPlaylists() {
  const newBtn = document.createElement("button");
  newBtn.className = "btn secondary new-playlist";
  newBtn.type = "button";
  newBtn.textContent = "+ New playlist";
  newBtn.onclick = createPlaylistFlow;
  grid.appendChild(newBtn);

  if (!playlists.length) {
    grid.appendChild(emptyMsg("No playlists yet. Create one, or download a YouTube playlist as Music."));
    return;
  }

  const byId = new Map(allVideos.map((v) => [v.id, v]));
  for (const pl of playlists) {
    const head = document.createElement("div");
    head.className = "pl-head";
    head.innerHTML = `
      <div class="pl-head-title">${escapeHtml(pl.name)}</div>
      <div class="pl-head-actions">
        <button class="pl-icon-btn pl-add" type="button" title="Add songs" aria-label="Add songs">${ICON_PLUS}</button>
        <button class="pl-icon-btn pl-del" type="button" title="Delete playlist" aria-label="Delete playlist">${ICON_TRASH}</button>
      </div>`;
    head.querySelector(".pl-add").onclick = () => openAddSongs(pl.id, pl.name);
    head.querySelector(".pl-del").onclick = () => deletePlaylistFlow(pl.id, pl.name);
    grid.appendChild(head);

    const songs = (pl.video_ids || [])
      .map((id) => byId.get(id))
      .filter((v) => v && v.status === "done");

    if (!songs.length) {
      grid.appendChild(emptyMsg("Empty — tap + to add songs.", "pl-empty"));
      continue;
    }
    const expanded = expandedPlaylists.has(pl.id);
    renderGroup(songs, PLAYLIST_LIMIT, expanded, () => {
      if (expanded) expandedPlaylists.delete(pl.id);
      else expandedPlaylists.add(pl.id);
      render();
    }, { playlistId: pl.id });
  }
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
    expandedPlaylists.delete(id);
    await load();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

// ---------- add-songs picker ----------
function openAddSongs(playlistId, name) {
  const pl = playlists.find((p) => p.id === playlistId);
  const memberIds = new Set(pl ? pl.video_ids : []);
  addTitle.textContent = `Add songs to ${name}`;

  const songs = allVideos
    .filter((v) => v.status === "done" && (v.category || "video") === "music")
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));

  addList.innerHTML = "";
  if (!songs.length) addList.appendChild(emptyMsg("No songs available."));

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
    setState(memberIds.has(v.id));
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (memberIds.has(v.id)) {
          await api(`/api/playlists/${playlistId}/items/${v.id}`, { method: "DELETE" });
          memberIds.delete(v.id);
        } else {
          await api(`/api/playlists/${playlistId}/items`, { method: "POST", body: JSON.stringify({ video_id: v.id }) });
          memberIds.add(v.id);
        }
        setState(memberIds.has(v.id));
      } catch (e) {
        alert("Failed: " + e.message);
      }
      btn.disabled = false;
    };
    row.appendChild(btn);
    addList.appendChild(row);
  }
  addModal.classList.remove("hidden");
}

function closeAddSongs() {
  addModal.classList.add("hidden");
  load(); // reflect membership changes in the playlist view
}
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

// ---------- data loading + tabs ----------
async function load() {
  try {
    const [videos, pls] = await Promise.all([api("/api/videos"), api("/api/playlists")]);
    allVideos = videos;
    playlists = pls;
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
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t === btn)
  );
  render();
});

load();
setInterval(load, 4000);
