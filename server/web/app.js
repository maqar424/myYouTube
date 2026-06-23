"use strict";

const TOKEN_KEY = "myyt_token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const token = getToken();
  if (token) headers["X-API-Token"] = token;
  if (opts.body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, Object.assign({}, opts, { headers }));

  if (res.status === 401) {
    const entered = prompt("API token required:");
    if (entered) {
      setToken(entered);
      return api(path, opts); // retry once
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function fmtBytes(b) {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + units[i];
}

function fmtDuration(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderStatus(s) {
  const pct = s.max_bytes ? Math.min(100, (s.used_bytes / s.max_bytes) * 100) : 0;
  document.getElementById("bar-fill").style.width = pct + "%";
  document.getElementById("storage-text").textContent =
    `${fmtBytes(s.used_bytes)} / ${fmtBytes(s.max_bytes)}`;
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
    ul.innerHTML = '<li class="empty">No videos yet. Paste a URL above.</li>';
    return;
  }

  for (const v of videos) {
    const li = document.createElement("li");
    li.className = "video " + v.status;
    const title = v.title || v.url;
    const progressBar =
      v.status === "downloading"
        ? `<div class="bar small"><div style="width:${v.progress || 0}%"></div></div>`
        : "";

    li.innerHTML = `
      <div class="info">
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(metaFor(v))}</div>
        ${progressBar}
      </div>
      <div class="actions"></div>`;

    const actions = li.querySelector(".actions");

    if (v.status === "done") {
      const a = document.createElement("a");
      a.className = "btn dl";
      a.textContent = "Save";
      const token = getToken();
      a.href =
        `/api/videos/${v.id}/file` +
        (token ? `?token=${encodeURIComponent(token)}` : "");
      a.setAttribute("download", "");
      actions.appendChild(a);
    }

    const del = document.createElement("button");
    del.className = "btn del";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm("Delete this video?")) return;
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
  try {
    await api("/api/download", { method: "POST", body: JSON.stringify({ url }) });
    input.value = "";
    refresh();
  } catch (err) {
    alert("Failed: " + err.message);
  }
});

refresh();
setInterval(refresh, 2000);
