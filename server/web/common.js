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
