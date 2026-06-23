"use strict";

// Gallery: browse finished downloads as a thumbnail grid, one tab per category.
// Shared helpers come from common.js.

const PLACEHOLDER = { video: "🎬", music: "🎵", podcast: "🎙️" };

let allVideos = [];
let currentCat = "video";

function render() {
  const grid = document.getElementById("grid");
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
      ${thumb}
      <div class="card-body">
        <div class="title clamp">${escapeHtml(v.title || v.url)}</div>
        <div class="meta">${fmtBytes(v.bytes)} · ${fmtDuration(v.duration)}</div>
      </div>
      <div class="actions"></div>`;

    const actions = card.querySelector(".actions");

    const save = document.createElement("a");
    save.className = "btn dl";
    save.textContent = "Save";
    save.href = fileUrl(v.id);
    save.setAttribute("download", "");
    actions.appendChild(save);

    const del = document.createElement("button");
    del.className = "btn del";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm("Delete this item?")) return;
      try {
        await api(`/api/videos/${v.id}`, { method: "DELETE" });
        load();
      } catch (e) {
        alert("Failed: " + e.message);
      }
    };
    actions.appendChild(del);

    grid.appendChild(card);
  }
}

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
