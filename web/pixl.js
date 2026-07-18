const Pixl = (() => {
  const API = "https://server.pixl.rsvp";
  const GAME = "/";

  const params = new URLSearchParams(location.search);
  let token = params.get("token") || "";
  if (token) {
    try { localStorage.setItem("pixl_token", token); } catch {}
    params.delete("token");
    params.delete("name");
    const qs = params.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } else {
    try { token = localStorage.getItem("pixl_token") || ""; } catch {}
  }

  function phase() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 5 || h >= 21) return "night";
    if (h < 7) return "dawn";
    if (h < 17) return "day";
    return "dusk";
  }
  document.documentElement.dataset.phase = phase();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function gate() {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="gate">
        <div class="gate-card panel">
          <div style="font-size:44px;margin-bottom:12px">🏘️</div>
          <h1>PIXL</h1>
          <p>This page is part of the Pixl world — hop into the game and walk up to the shop, an NPC or press the shortcut key to open it with your account.</p>
          <a class="btn" href="${GAME}">ENTER THE GAME</a>
        </div>
      </div>`);
  }

  async function api(path) {
    const url = API + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
    const res = await fetch(url);
    if (res.status === 401) {
      try { localStorage.removeItem("pixl_token"); } catch {}
      if (!document.querySelector(".gate")) gate();
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error("http_" + res.status);
    return res.json();
  }

  function apiUrl(path) {
    return API + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  }

  let toastSlot = null;
  function toast(text, bad = false) {
    if (!toastSlot) {
      toastSlot = document.createElement("div");
      toastSlot.className = "toast-slot";
      document.body.appendChild(toastSlot);
    }
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = text;
    toastSlot.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  const PAGES = [
    ["shop", "SHOP"],
    ["explore", "EXPLORE"],
    ["quests", "QUESTS"],
    ["hackatime", "HACKATIME"],
  ];

  function mountTopbar(active) {
    const nav = PAGES.map(([slug, label]) =>
      `<a href="/${slug}/" class="${slug === active ? "active" : ""}">${label}</a>`,
    ).join("");
    document.body.insertAdjacentHTML("afterbegin", `
      <header class="topbar">
        <a class="logo" href="${GAME}" title="Back to the game"><img src="/index.icon.png" alt="">PIXL</a>
        <nav class="nav">${nav}</nav>
        <div class="topbar-right">
          <div class="wallet-chip" id="pixl-wallet" title="Your pixels">
            <img src="/img/pixel.png" alt="px">
            <span class="px">—</span>
            <span class="lv"></span>
          </div>
          <a class="btn dark" href="${GAME}">BACK TO GAME</a>
        </div>
      </header>`);
  }

  async function loadWallet() {
    const el = document.getElementById("pixl-wallet");
    if (!el) return null;
    try {
      const w = await api("/api/profile/wallet");
      if (!w.ok) return null;
      el.querySelector(".px").textContent = Math.round(w.pixels).toLocaleString();
      el.querySelector(".lv").textContent = `LVL ${w.level} · ${w.pxPerHour} px/h`;
      return w;
    } catch {
      return null;
    }
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function countdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!isFinite(ms) || ms <= 0) return "gone!";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${m}m ${s}s left`;
  }

  function hours(seconds) {
    return (seconds / 3600).toFixed(1) + "h";
  }

  if (!token) {
    document.addEventListener("DOMContentLoaded", gate);
  }

  return { API, token, api, apiUrl, esc, toast, mountTopbar, loadWallet, timeAgo, countdown, hours, hasToken: !!token };
})();
