"use strict";

// Landing page: submit downloads (with a category) and show live activity.
// Shared helpers (api, getToken, fmt*, escapeHtml, fileUrl) come from common.js.

function renderStatus(s) {
  const max = s.max_bytes || 1;
  const by = s.by_category || {};
  const widthFor = (b) => Math.min(100, ((b || 0) / max) * 100) + "%";

  document.getElementById("seg-video").style.width = widthFor(by.video);
  document.getElementById("seg-music").style.width = widthFor(by.music);
  document.getElementById("seg-podcast").style.width = widthFor(by.podcast);

  const used = (by.video || 0) + (by.music || 0) + (by.podcast || 0);
  document.getElementById("storage-text").textContent =
    `${fmtBytes(used)} / ${fmtBytes(s.max_bytes)}`;

  document.getElementById("storage-legend").innerHTML = [
    ["video", "Videos"],
    ["music", "Music"],
    ["podcast", "Podcasts"],
  ].map(([k, label]) =>
    `<span class="item"><span class="dot ${k}"></span>${label} ${fmtBytes(by[k] || 0)}</span>`
  ).join("");
}

function metaFor(v) {
  switch (v.status) {
    case "done": return `${fmtBytes(v.bytes)} · ${fmtDuration(v.duration)}`;
    case "downloading": return `Downloading… ${v.progress || 0}%`;
    case "queued": return "Queued…";
    case "error": return "Error: " + (v.error || "failed");
    default: return v.status;
  }
}

function renderVideos(videos) {
  const ul = document.getElementById("videos");
  ul.innerHTML = "";
  if (!videos.length) {
    ul.innerHTML = '<li class="empty">No downloads yet. Paste a URL above.</li>';
    return;
  }

  for (const v of videos) {
    const cat = v.category || "video";
    const li = document.createElement("li");
    li.className = "video " + v.status;
    const title = v.title || v.url;
    const progressBar =
      v.status === "downloading"
        ? `<div class="bar small"><div style="width:${v.progress || 0}%"></div></div>`
        : "";

    li.innerHTML = `
      <div class="info">
        <div class="title-row">
          <span class="badge ${cat}">${cat}</span>
          <span class="title">${escapeHtml(title)}</span>
        </div>
        <div class="meta">${escapeHtml(metaFor(v))}</div>
        ${progressBar}
      </div>
      <div class="actions"></div>`;

    const actions = li.querySelector(".actions");

    if (v.status === "done") {
      const a = document.createElement("a");
      a.className = "btn dl";
      a.textContent = "Save";
      a.href = fileUrl(v.id);
      a.setAttribute("download", "");
      actions.appendChild(a);
    }

    const del = document.createElement("button");
    del.className = "btn del";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm("Delete this download?")) return;
      try {
        await api(`/api/videos/${v.id}`, { method: "DELETE" });
        refresh();
      } catch (e) {
        alert("Failed: " + e.message);
      }
    };
    actions.appendChild(del);

    ul.appendChild(li);
  }
}

async function refresh() {
  try {
    const [status, videos] = await Promise.all([
      api("/api/status"),
      api("/api/videos"),
    ]);
    renderStatus(status);
    renderVideos(videos);
  } catch (_) {
    /* transient network error — next tick will retry */
  }
}

document.getElementById("dl-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("url");
  const url = input.value.trim();
  if (!url) return;
  const category =
    document.querySelector('input[name="category"]:checked')?.value || "video";
  try {
    await api("/api/download", {
      method: "POST",
      body: JSON.stringify({ url, category }),
    });
    input.value = "";
    refresh();
  } catch (err) {
    alert("Failed: " + err.message);
  }
});

refresh();
setInterval(refresh, 2000);
