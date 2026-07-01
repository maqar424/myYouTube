"use strict";

// Gallery: browse finished downloads. Video plays in a modal; music/podcasts
// play in the bottom-pinned audio bar. The Music tab groups by artist (capped
// at 8 per artist, expandable) and has a playlist bar at the top.
// Shared helpers come from common.js.

const PLACEHOLDER = { video: "🎬", music: "🎵", podcast: "🎙️" };

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';

const ARTIST_LIMIT = 8;

let allVideos = [];
let playlists = [];
let currentCat = "video";
let musicView = "artists";   // "artists" | playlist id
let currentPlaylist = null;  // detail {id,name,source,video_ids} when a playlist is open
const expandedArtists = new Set();

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

function musicSongs() {
  return allVideos.filter((v) => v.status === "done" && (v.category || "video") === "music");
}

// Top 8 first by view count (desc), then most recent; songs without a view
// count fall back to recency.
function sortByViewsThenRecent(a, b) {
  const va = a.view_count == null ? -1 : a.view_count;
  const vb = b.view_count == null ? -1 : b.view_count;
  if (vb !== va) return vb - va;
  return (b.created_at || 0) - (a.created_at || 0);
}

// --- cards ---
function buildCard(v, opts = {}) {
  const cat = v.category || "video";
  const card = document.createElement("div");
  card.className = "card";

  const thumb = v.thumbnail
    ? `<img class="thumb" src="${thumbUrl(v.id)}" loading="lazy" alt="" />`
    : `<div class="thumb placeholder">${PLACEHOLDER[cat] || "🎬"}</div>`;

  const label = opts.playlistId ? "Remove from playlist" : "Delete from server";
  const icon = opts.playlistId ? ICON_MINUS : ICON_TRASH;

  card.innerHTML = `
    <div class="thumb-wrap">
      ${thumb}
      <button class="card-del" type="button" title="${label}" aria-label="${label}">${icon}</button>
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

function subGrid(videos, opts) {
  const sub = document.createElement("div");
  sub.className = "grid";
  for (const v of videos) sub.appendChild(buildCard(v, opts));
  return sub;
}

// --- top-level render ---
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
  grid.appendChild(buildPlaylistBar());
  if (musicView === "artists") renderArtistGroups();
  else renderPlaylistView();
}

function buildPlaylistBar() {
  const bar = document.createElement("div");
  bar.className = "pl-bar";

  bar.appendChild(plChip("Artists", musicView === "artists", () => {
    musicView = "artists";
    currentPlaylist = null;
    render();
  }));

  for (const p of playlists) {
    const label = p.count ? `${p.name} · ${p.count}` : p.name;
    bar.appendChild(plChip(label, musicView === p.id, () => selectPlaylist(p.id)));
  }

  const nw = plChip("+ New", false, createPlaylistFlow);
  nw.classList.add("pl-new");
  bar.appendChild(nw);
  return bar;
}

function plChip(label, active, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pl-chip" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function renderArtistGroups() {
  const items = musicSongs();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No songs yet.";
    grid.appendChild(p);
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
    const header = document.createElement("h2");
    header.className = "artist-header";
    header.textContent = name;
    grid.appendChild(header);

    const songs = groups.get(name).slice().sort(sortByViewsThenRecent);
    const expanded = expandedArtists.has(name);
    const shown = expanded ? songs : songs.slice(0, ARTIST_LIMIT);
    grid.appendChild(subGrid(shown));

    if (songs.length > ARTIST_LIMIT) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "artist-more";
      more.textContent = expanded ? "Show less" : `Show all ${songs.length}`;
      more.onclick = () => {
        expanded ? expandedArtists.delete(name) : expandedArtists.add(name);
        render();
      };
      grid.appendChild(more);
    }
  }
}

function renderPlaylistView() {
  const pl = currentPlaylist;
  if (!pl) {
    musicView = "artists";
    renderArtistGroups();
    return;
  }

  const head = document.createElement("div");
  head.className = "pl-head";
  head.innerHTML = `
    <div class="pl-head-title">${escapeHtml(pl.name)}</div>
    <div class="pl-head-actions">
      <button class="btn secondary pl-add" type="button">+ Add songs</button>
      <button class="btn del pl-delete" type="button">Delete</button>
    </div>`;
  head.querySelector(".pl-add").onclick = () => openAddSongs(pl.id);
  head.querySelector(".pl-delete").onclick = () => deletePlaylistFlow(pl.id, pl.name);
  grid.appendChild(head);

  const byId = new Map(allVideos.map((v) => [v.id, v]));
  const songs = (pl.video_ids || [])
    .map((id) => byId.get(id))
    .filter((v) => v && v.status === "done");

  if (!songs.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = 'No songs here yet. Use "+ Add songs".';
    grid.appendChild(p);
    return;
  }
  grid.appendChild(subGrid(songs, { playlistId: pl.id }));
}

// --- playlist actions ---
async function selectPlaylist(id) {
  musicView = id;
  await load();
}

async function createPlaylistFlow() {
  const name = prompt("New playlist name:");
  if (!name || !name.trim()) return;
  try {
    const pl = await api("/api/playlists", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    musicView = pl.id;
    await load();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

async function deletePlaylistFlow(id, name) {
  if (!confirm(`Delete playlist "${name}"? The songs stay in your library.`)) return;
  try {
    await api(`/api/playlists/${id}`, { method: "DELETE" });
    musicView = "artists";
    currentPlaylist = null;
    await load();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

// --- add-songs picker ---
async function openAddSongs(playlistId) {
  let members = new Set();
  try {
    const pl = await api(`/api/playlists/${playlistId}`);
    members = new Set(pl.video_ids || []);
    addTitle.textContent = `Add songs to ${pl.name}`;
  } catch (_) {
    return;
  }

  const songs = musicSongs().sort((a, b) =>
    (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })
  );

  addList.innerHTML = "";
  if (!songs.length) {
    addList.innerHTML = '<p class="empty">No songs available.</p>';
  }
  for (const v of songs) {
    const row = document.createElement("div");
    row.className = "add-row";
    const inList = members.has(v.id);
    row.innerHTML = `
      <div class="add-info">
        <div class="add-title">${escapeHtml(v.title || v.url)}</div>
        <div class="add-artist">${escapeHtml(v.artist || "Unknown artist")}</div>
      </div>
      <button class="btn add-toggle${inList ? " secondary" : ""}" type="button">${inList ? "Added" : "Add"}</button>`;
    const btn = row.querySelector(".add-toggle");
    btn.onclick = async () => {
      try {
        if (members.has(v.id)) {
          await api(`/api/playlists/${playlistId}/items/${v.id}`, { method: "DELETE" });
          members.delete(v.id);
          btn.textContent = "Add";
          btn.classList.remove("secondary");
        } else {
          await api(`/api/playlists/${playlistId}/items`, {
            method: "POST",
            body: JSON.stringify({ video_id: v.id }),
          });
          members.add(v.id);
          btn.textContent = "Added";
          btn.classList.add("secondary");
        }
      } catch (e) {
        alert("Failed: " + e.message);
      }
    };
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
    else if (!addModal.classList.contains("hidden")) closeAddSongs();
  }
});

// --- data loading + tabs ---
async function load() {
  try {
    const [videos, pls] = await Promise.all([
      api("/api/videos"),
      api("/api/playlists"),
    ]);
    allVideos = videos;
    playlists = pls;
    if (currentCat === "music" && musicView !== "artists") {
      try {
        currentPlaylist = await api(`/api/playlists/${musicView}`);
      } catch (_) {
        musicView = "artists";
        currentPlaylist = null;
      }
    }
    render();
  } catch (_) {
    /* transient — next tick retries */
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentCat = btn.dataset.cat;
  musicView = "artists";
  currentPlaylist = null;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t === btn)
  );
  render();
});

load();
setInterval(load, 4000);
