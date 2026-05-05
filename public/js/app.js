// Shared client-side helpers — auth, fetch wrapper, toast, navigation guards

const TOKEN_KEY = "habibi_jwt";

export const api = {
  base: "",
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t) => localStorage.setItem(TOKEN_KEY, t),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),

  async request(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const token = api.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${api.base}${path}`, { ...opts, headers });
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await r.json() : await r.text();
    if (!r.ok) {
      const msg = body?.message || (typeof body === "string" ? body : `HTTP ${r.status}`);
      throw new Error(msg);
    }
    return body;
  },

  async post(path, data) {
    return api.request(path, { method: "POST", body: JSON.stringify(data) });
  },
  async get(path) {
    return api.request(path);
  },
};

export const toast = (msg, type = "info", ms = 3000) => {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, ms);
};

export const requireLogin = () => {
  if (!api.getToken()) {
    location.href = "/login.html";
    return false;
  }
  return true;
};

export const redirectIfLoggedIn = () => {
  if (api.getToken()) {
    location.href = "/dashboard.html";
  }
};

export const fmtTime = (ts) => {
  if (!ts) return "-";
  const d = new Date(Number(ts));
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
};

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied!", "success", 1500);
  } catch {
    toast("Copy failed", "error");
  }
};

window.api = api;
window.toast = toast;
window.copyToClipboard = copyToClipboard;
window.fmtTime = fmtTime;
