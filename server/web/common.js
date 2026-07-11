"use strict";

// Shared helpers used by both the landing page (app.js) and the gallery
// (gallery.js). Loaded first so these globals are available to both.

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

// Append the token as a query param for URLs loaded by the browser directly
// (<img src>, download links) which can't set request headers.
function withToken(path) {
  const token = getToken();
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

function fileUrl(id) { return withToken(`/api/videos/${id}/file`); }
function thumbUrl(id) { return withToken(`/api/videos/${id}/thumbnail`); }
function streamUrl(id) { return withToken(`/api/videos/${id}/stream`); }

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

// ---- toast notifications (non-blocking replacement for alert()) ----
function toast(msg, type) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ---- dark / light theme (toggle present on both pages) ----
const THEME_KEY = "myyt_theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Keep Android's status/title bar in sync with the page background.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f4f4f6" : "#0f0f0f";
}

(function initTheme() {
  const sw = document.getElementById("theme-switch");
  const theme = document.documentElement.dataset.theme || localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(theme);
  if (!sw) return;
  sw.checked = theme === "dark"; // switch right = Dark
  sw.addEventListener("change", () => {
    const next = sw.checked ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });
})();

// ---- view router (single page: Download <-> Gallery) ----
// Both views live on one page so the audio player is never unloaded when
// switching. The hash (#gallery) is the source of truth; back button works.
(function initViews() {
  const toggle = document.getElementById("view-toggle");
  if (!toggle) return; // not the SPA page (e.g. the gallery.html redirect stub)

  function setView(view) {
    document.body.dataset.view = view;
    document.getElementById("page-title").textContent =
      view === "gallery" ? "Gallery" : "myYouTube";
    toggle.innerHTML = view === "gallery" ? "Download more" : "Gallery &rarr;";
    document.title = view === "gallery" ? "Gallery — myYouTube" : "myYouTube";
  }

  function applyHash() {
    setView(location.hash === "#gallery" ? "gallery" : "download");
  }

  toggle.addEventListener("click", () => {
    location.hash = document.body.dataset.view === "gallery" ? "#download" : "#gallery";
  });
  window.addEventListener("hashchange", applyHash);
  applyHash();
})();
