/* ============================================================
   UnityWall — interactive mobile site
   Path-based router with role gates, vanilla JS, localStorage.

   Sitemap (per platform spec):
     /                       Home hub
     /join                   Manual code entry
     /join/:CODE             Wall fast-path (QR scan drops here)
       /join/:CODE/email     Email gate
       /join/:CODE/verify    6-digit code
       /join/:CODE/welcome   Onboarding
       /join/:CODE/upload    Upload
       /join/:CODE/wall      The Wall
     /request                Venue application
     /request/sent           Submitted
     /dashboard              Host (login-gated)
       /dashboard/slideshow  Projector view
       /dashboard/card       Table card
     /admin                  Admin (login + role-gated)
============================================================ */

const STORE = {
  key: "unitywall.v1",
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch { return {}; }
  },
  save(patch) {
    const next = Object.assign({}, this.load(), patch);
    localStorage.setItem(this.key, JSON.stringify(next));
    return next;
  }
};

/* ============================================================
   Demo events — keyed by join code
============================================================ */
const EVENTS = {
  "MAYA-DANIEL": {
    couple: "Maya & Daniel",
    coupleHtml: 'Maya <em>&amp;</em> Daniel',
    when: "You're invited · 14 June 2026"
  },
  "ELENA-MARCUS": {
    couple: "Elena & Marcus",
    coupleHtml: 'Elena <em>&amp;</em> Marcus',
    when: "You're invited · 5 July 2026"
  }
};
function eventFor(code) {
  return EVENTS[code] || {
    couple: "the couple",
    coupleHtml: 'The couple',
    when: "You're invited"
  };
}

/* ============================================================
   Router — path-based with simple pattern matching
============================================================ */
const ROUTES = [
  { pat: /^\/$/,                                        view: "t-home"       },
  { pat: /^\/join\/?$/,                                 view: "t-join-manual"},
  { pat: /^\/join\/([A-Z0-9-]+)\/?$/,                   view: "t-join",       params: ["code"] },
  { pat: /^\/join\/([A-Z0-9-]+)\/email\/?$/,            view: "t-email",      params: ["code"] },
  { pat: /^\/join\/([A-Z0-9-]+)\/verify\/?$/,           view: "t-verify",     params: ["code"] },
  { pat: /^\/join\/([A-Z0-9-]+)\/welcome\/?$/,          view: "t-onboarding", params: ["code"] },
  { pat: /^\/join\/([A-Z0-9-]+)\/upload\/?$/,           view: "t-upload",     params: ["code"] },
  { pat: /^\/join\/([A-Z0-9-]+)\/wall\/?$/,             view: "t-wall",       params: ["code"] },
  { pat: /^\/request\/?$/,                              view: "t-apply"      },
  { pat: /^\/request\/sent\/?$/,                        view: "t-submitted"  },
  { pat: /^\/dashboard\/?$/,                            view: "t-host",       gate: "host"  },
  { pat: /^\/dashboard\/slideshow\/?$/,                 view: "t-slideshow",  gate: "host"  },
  { pat: /^\/dashboard\/card\/?$/,                      view: "t-card",       gate: "host"  },
  { pat: /^\/admin\/?$/,                                view: "t-admin",      gate: "admin" }
];

function matchRoute(path) {
  // Normalize uppercased code
  const norm = path.replace(/\/join\/([^/]+)/i, (_, c) => "/join/" + c.toUpperCase());
  for (const r of ROUTES) {
    const m = norm.match(r.pat);
    if (m) {
      const params = {};
      (r.params || []).forEach((name, i) => { params[name] = m[i + 1]; });
      return { route: r, params, path: norm };
    }
  }
  return null;
}

function navigate(path, opts = {}) {
  if (path === location.pathname + location.search) { render(); return; }
  history.pushState({}, "", path);
  render();
}

const WIDE_BP = 900; // px — switch to desktop layouts above this width
const DESKTOP_ROUTES = {
  "t-admin": "t-admin-desktop",
  "t-host":  "t-host-desktop"
};

function isWide() {
  return window.matchMedia(`(min-width: ${WIDE_BP}px)`).matches;
}

function render() {
  const path = location.pathname || "/";
  const match = matchRoute(path);
  const app = document.getElementById("app");
  app.innerHTML = "";

  // Update visible URL even if browser auto-changed it
  if (match && match.path !== path) history.replaceState({}, "", match.path);

  // 404
  if (!match) {
    document.body.dataset.frame = "phone";
    app.appendChild(document.getElementById("t-404").content.cloneNode(true));
    setTitle("Not found");
    highlightNav(path);
    return;
  }

  // Role gates → swap to login template
  let viewId = match.route.view;
  let isGate = false;
  if (match.route.gate === "host" && !STORE.load().host_session) {
    viewId = "t-login-host"; isGate = true;
  }
  if (match.route.gate === "admin" && !STORE.load().admin_session) {
    viewId = "t-login-admin"; isGate = true;
  }

  // Desktop template swap for admin/dashboard at wide widths
  const wide = isWide();
  if (!isGate && wide && DESKTOP_ROUTES[viewId]) {
    viewId = DESKTOP_ROUTES[viewId];
  }
  document.body.dataset.frame =
    (viewId === "t-admin-desktop" || viewId === "t-host-desktop") ? "desktop" : "phone";

  const tpl = document.getElementById(viewId);
  app.appendChild(tpl.content.cloneNode(true));

  setTitle(viewId);
  highlightNav(path);
  expandJoinPlaceholders(app, match.params.code);
  rewriteJoinLinks(app, match.params.code);

  // Wire per-view behavior
  const wire = WIRES[viewId];
  if (wire) wire(app, match.params);

  // Global delegators
  app.addEventListener("click", e => {
    // Internal links → pushState navigation
    const a = e.target.closest("a[href]");
    if (a) {
      const href = a.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();
        navigate(href);
        return;
      }
    }
    // [data-action="goto"] → navigate
    const t = e.target.closest("[data-action='goto']");
    if (t) {
      e.preventDefault();
      navigate(t.dataset.target);
    }
  });

  window.scrollTo(0, 0);
}

function setTitle(viewId) {
  const titles = {
    "t-home":        "UnityWall",
    "t-join-manual": "Join a wall",
    "t-join":        "You're invited",
    "t-email":       "Sign the guestbook",
    "t-verify":      "Enter your code",
    "t-onboarding":  "Welcome to the wall",
    "t-upload":      "Add your photos",
    "t-wall":        "The Wall",
    "t-apply":       "Apply to host",
    "t-submitted":   "Application received",
    "t-login-host":  "Host login",
    "t-host":        "Host dashboard",
    "t-login-admin": "Staff sign-in",
    "t-admin":       "Admin · Control room",
    "t-slideshow":   "Live wall",
    "t-card":        "Table card"
  };
  document.title = (titles[viewId] || "UnityWall") + " · UnityWall";
}

function highlightNav(path) {
  document.querySelectorAll(".devnav a").forEach(a => {
    a.classList.toggle("is-active", a.getAttribute("href") === path
      || (a.getAttribute("href") === "/join/MAYA-DANIEL" && /^\/join\/[^/]+(\/|$)/.test(path) && path !== "/join")
    );
  });
}

/** Replace `__JOIN__` placeholders in template attrs/content with `/join/CODE`. */
function expandJoinPlaceholders(root, code) {
  const c = code || "MAYA-DANIEL";
  const prefix = "/join/" + c;
  root.querySelectorAll("[data-target]").forEach(el => {
    el.dataset.target = el.dataset.target.replace(/__JOIN__/g, prefix);
  });
  root.querySelectorAll("a[href]").forEach(el => {
    const href = el.getAttribute("href");
    if (href && href.indexOf("__JOIN__") !== -1) {
      el.setAttribute("href", href.replace(/__JOIN__/g, prefix));
    }
  });
}

/** Set couple-name placeholders based on resolved event. */
function rewriteJoinLinks(root, code) {
  const ev = eventFor(code || "MAYA-DANIEL");
  root.querySelectorAll("[id='join-who']").forEach(el => el.innerHTML = ev.coupleHtml);
  root.querySelectorAll("[id='join-when']").forEach(el => el.textContent = ev.when);
  root.querySelectorAll("[id='join-couple']").forEach(el => el.textContent = ev.couple);
  root.querySelectorAll("[id='email-couple']").forEach(el => el.textContent = ev.couple);
  root.querySelectorAll("[id='wall-couple-kicker']").forEach(el => el.textContent = ev.couple);
}

window.addEventListener("popstate", render);

// Re-render on resize crossing the desktop breakpoint
let _wasWide = isWide();
window.addEventListener("resize", () => {
  const w = isWide();
  if (w !== _wasWide) { _wasWide = w; render(); }
});

/* ============================================================
   QR generator (decorative, matches the design's algo)
============================================================ */
function buildQRMatrix(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m[y][x] = rnd() > 0.52 ? 1 : 0;
  const clear = (ox, oy) => {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      const yy = oy + y, xx = ox + x;
      if (yy >= 0 && yy < n && xx >= 0 && xx < n) m[yy][xx] = 0;
    }
  };
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      m[oy + y][ox + x] = (edge || core) ? 1 : 0;
    }
  };
  clear(0, 0);       finder(0, 0);
  clear(n - 7, 0);   finder(n - 7, 0);
  clear(0, n - 7);   finder(0, n - 7);
  return m;
}
function renderQR(el, n, seed, fg = "#1A1613") {
  if (!el) return;
  const m = buildQRMatrix(n, seed);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `-2 -2 ${n + 4} ${n + 4}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("shape-rendering", "crispEdges");
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!m[y][x]) continue;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", "1.05"); r.setAttribute("height", "1.05");
    r.setAttribute("fill", fg);
    svg.appendChild(r);
  }
  el.innerHTML = "";
  el.appendChild(svg);
}

/* ============================================================
   Helpers
============================================================ */
function showToast(text) {
  const tpl = document.getElementById("t-toast");
  const node = tpl.content.cloneNode(true);
  const wrap = document.createElement("div");
  wrap.appendChild(node);
  const toast = wrap.firstElementChild;
  toast.querySelector("span:last-child").textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity .3s ease, transform .3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-8px)";
    setTimeout(() => toast.remove(), 320);
  }, 2400);
}

/* ============================================================
   Wires (per template view-id)
============================================================ */
const WIRES = {};

/* ---------- t-home ---------- */
WIRES["t-home"] = () => {};

/* ---------- t-join-manual ---------- */
WIRES["t-join-manual"] = (root) => {
  const form = root.querySelector("#code-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    let code = form.code.value.trim().toUpperCase().replace(/\s+/g, "-");
    if (!code) { form.code.focus(); return; }
    navigate("/join/" + encodeURIComponent(code));
  });
};

/* ---------- t-join ---------- */
WIRES["t-join"] = (root, params) => {
  // Persist current event context so later steps know which wall
  STORE.save({ current_code: params.code });
};

/* ---------- t-email ---------- */
WIRES["t-email"] = (root, params) => {
  const form = root.querySelector("#email-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { form.email.focus(); return; }
    STORE.save({
      email,
      marketing_opt_in: form.optin.checked,
      consent_timestamp: form.optin.checked ? new Date().toISOString() : null,
      consent_text_version: "v1.0"
    });
    navigate("/join/" + params.code + "/verify");
  });
};

/* ---------- t-verify ---------- */
WIRES["t-verify"] = (root, params) => {
  const s = STORE.load();
  root.querySelector("#verify-email").textContent = s.email || "your@email.com";

  const cells = Array.from(root.querySelectorAll(".otp__cell"));
  cells.forEach((cell, i) => {
    cell.addEventListener("input", () => {
      cell.value = cell.value.replace(/\D/g, "").slice(0, 1);
      if (cell.value && cells[i + 1]) cells[i + 1].focus();
      const code = cells.map(c => c.value).join("");
      if (code.length === 6) setTimeout(() => navigate("/join/" + params.code + "/welcome"), 300);
    });
    cell.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !cell.value && cells[i - 1]) cells[i - 1].focus();
    });
    cell.addEventListener("paste", e => {
      const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
      if (text.length >= 6) {
        e.preventDefault();
        cells.forEach((c, j) => c.value = text[j] || "");
        cells[5].focus();
        setTimeout(() => navigate("/join/" + params.code + "/welcome"), 300);
      }
    });
  });

  let t = 24;
  const out = root.querySelector("#resend-timer");
  const tick = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(tick); out.textContent = "now"; }
    else out.textContent = "0:" + String(t).padStart(2, "0");
  }, 1000);
  window.addEventListener("popstate", () => clearInterval(tick), { once: true });
  cells[0] && cells[0].focus();
};

/* ---------- t-onboarding ---------- */
WIRES["t-onboarding"] = (root) => {
  const about = root.querySelector('[data-section="about"]');
  const reach = root.querySelector('[data-section="reach_out"]');
  let warmTimer = null;

  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target === about) {
        if (entry.isIntersecting && !STORE.load().lead_warm) {
          warmTimer = setTimeout(() => {
            STORE.save({ lead_warm: true, warm_at: new Date().toISOString(), furthest_section: "about" });
          }, 1500);
        } else if (!entry.isIntersecting && warmTimer) {
          clearTimeout(warmTimer); warmTimer = null;
        }
      }
      if (entry.target === reach && entry.isIntersecting) STORE.save({ furthest_section: "reach_out" });
    });
  }, { threshold: 0.4, root: root.querySelector(".screen--scroll") || null });

  if (about) obs.observe(about);
  if (reach) obs.observe(reach);

  const reachForm = root.querySelector("#reach-form");
  if (reachForm) {
    reachForm.addEventListener("submit", e => {
      e.preventDefault();
      const email = reachForm.lead_email.value.trim();
      const msg   = reachForm.lead_msg.value.trim();
      if (!email || !msg) return;
      STORE.save({
        lead_hot: true, hot_at: new Date().toISOString(),
        lead_email: email, lead_message: msg,
        furthest_section: "reach_out", requested_contact: true
      });
      showToast("Sent — we'll reply within the hour.");
      reachForm.reset();
    });
  }
};

/* ---------- t-upload ---------- */
WIRES["t-upload"] = (root, params) => {
  const input = root.querySelector("#file-input");
  const list  = root.querySelector("#upload-list");
  const count = root.querySelector("#upload-count");
  const stateLbl = root.querySelector("#upload-state");
  const bar   = root.querySelector("#upload-bar-fill");

  const prior = STORE.load();
  let items = prior.uploads || [];
  let nextId = (prior.upload_seq || 0);

  if (items.length === 0) {
    items = demoUploads();
    nextId = items.length;
    STORE.save({ uploads: items, upload_seq: nextId });
    setTimeout(() => advanceDemoUploads(), 1500);
  }
  paint();

  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    files.forEach(file => {
      const id = ++nextId;
      const reader = new FileReader();
      reader.onload = e => {
        const url = e.target.result;
        items.push({ id, name: file.name, size: file.size,
          status: "uploading", progress: 0, thumb: url, art: null });
        STORE.save({ uploads: items, upload_seq: nextId });
        paint();
        simulateUpload(id);
      };
      reader.readAsDataURL(file);
    });
    input.value = "";
  });

  function paint() {
    list.innerHTML = "";
    const done  = items.filter(i => i.status === "done").length;
    const total = items.length;
    count.textContent = `${done} of ${total} added to the wall`;
    stateLbl.textContent = total === 0 ? "Idle" : done === total ? "Done" : "Uploading";
    bar.style.width = total ? `${(done / total) * 100}%` : "0%";

    items.forEach((it, idx) => {
      const li = document.createElement("li");
      li.className = "uprow";
      if (it.status === "queued") li.classList.add("uprow--queued");
      li.style.animationDelay = (idx * 60) + "ms";

      const thumb = document.createElement("div");
      thumb.className = "uprow__thumb";
      if (it.thumb) thumb.style.backgroundImage = `url(${it.thumb})`;
      else if (it.art) thumb.classList.add(it.art);

      const body = document.createElement("div");
      body.className = "uprow__body";
      body.innerHTML = `<div class="uprow__name"></div><div class="uprow__meta"></div>`;
      body.querySelector(".uprow__name").textContent = it.name;
      body.querySelector(".uprow__meta").textContent = metaFor(it);

      const ind = document.createElement("span");
      if (it.status === "done") { ind.className = "uprow__state uprow__state--done"; ind.textContent = "✓"; }
      else if (it.status === "uploading") { ind.className = "uprow__state uprow__state--spin"; }

      li.append(thumb, body);
      if (it.status !== "queued") li.append(ind);
      list.appendChild(li);
    });
  }
  function metaFor(it) {
    const mb = it.size ? (it.size / (1024 * 1024)).toFixed(1) + " MB" : "";
    if (it.status === "queued")    return "queued";
    if (it.status === "uploading") return `uploading · ${Math.round(it.progress || 0)}%`;
    return (mb ? mb + " · " : "") + "on the wall";
  }
  function simulateUpload(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const step = () => {
      item.progress = Math.min(100, (item.progress || 0) + 20 + Math.random() * 15);
      if (item.progress >= 100) {
        item.status = "done"; item.progress = 100;
        STORE.save({ uploads: items });
        paint();
        addPhotoToWall(item);
      } else {
        STORE.save({ uploads: items });
        paint();
        setTimeout(step, 450 + Math.random() * 300);
      }
    };
    setTimeout(step, 300);
  }
  function advanceDemoUploads() {
    const up = items.find(i => i.status === "uploading");
    if (up) simulateUpload(up.id);
    const q = items.find(i => i.status === "queued");
    if (q) setTimeout(() => { q.status = "uploading"; STORE.save({ uploads: items }); paint(); simulateUpload(q.id); }, 1800);
  }
  function demoUploads() {
    return [
      { id: 1, name: "IMG_4821.heic", size: 2.4e6, status: "done",      art: "art-01" },
      { id: 2, name: "IMG_4822.heic", size: 1.9e6, status: "done",      art: "art-02" },
      { id: 3, name: "IMG_4823.heic", size: 3.1e6, status: "done",      art: "art-03" },
      { id: 4, name: "IMG_4824.heic", size: 2.7e6, status: "uploading", progress: 62, art: "art-04" },
      { id: 5, name: "IMG_4825.heic", size: 2.1e6, status: "queued",    art: "art-05" }
    ];
  }
};

function addPhotoToWall(item) {
  const s = STORE.load();
  const wall = s.wall_photos || seedWallPhotos();
  wall.unshift({
    id: item.id, art: item.art || pickArt(),
    caption: pickCaption(),
    by: s.email ? s.email.split("@")[0] : "you",
    when: hhmm()
  });
  STORE.save({ wall_photos: wall.slice(0, 60) });
}
function pickArt() {
  const arts = ["art-01","art-02","art-03","art-04","art-05","art-06","art-07","art-08","art-09","art-10","art-11","art-12"];
  return arts[Math.floor(Math.random() * arts.length)];
}
function pickCaption() {
  const c = ["The toast, just before","Candlelight","First dance","Sparklers","The garden","Quiet corner","Vows","After hours","The send-off"];
  return c[Math.floor(Math.random() * c.length)];
}
function hhmm() {
  const d = new Date();
  return d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
}
function seedWallPhotos() {
  return [
    { id:"p1",  art:"art-01", caption:"The toast, just before", by:"Priya",  h:210 },
    { id:"p2",  art:"art-02", caption:"Quiet corner",           by:"Daniel", h:140 },
    { id:"p3",  art:"art-03", caption:"Candlelight",            by:"Anaïs",  h:172 },
    { id:"p4",  art:"art-04", caption:"Soft afternoon",         by:"Mira",   h:120 },
    { id:"p5",  art:"art-05", caption:"First dance",            by:"Tomás",  h:196 },
    { id:"p6",  art:"art-06", caption:"The garden",             by:"Sara",   h:150 },
    { id:"p7",  art:"art-07", caption:"Glasses up",             by:"Maya",   h:128 },
    { id:"p8",  art:"art-08", caption:"After hours",            by:"Eli",    h:184 },
    { id:"p9",  art:"art-09", caption:"Vows",                   by:"Daniel", h:118 },
    { id:"p10", art:"art-10", caption:"The send-off",           by:"Priya",  h:160 },
    { id:"p11", art:"art-11", caption:"Side stage",             by:"Anaïs",  h:178 },
    { id:"p12", art:"art-12", caption:"The room",               by:"Tomás",  h:200 }
  ];
}

/* ---------- t-wall ---------- */
WIRES["t-wall"] = (root) => {
  const grid = root.querySelector("#wall-grid");
  const photos = STORE.load().wall_photos || seedWallPhotos();

  function renderGrid(layout) {
    grid.className = "wall__grid wall__grid--" + layout;
    grid.dataset.layout = layout;
    grid.innerHTML = "";

    if (layout === "feature") {
      photos.slice(0, 8).forEach((p, i) => {
        const fig = document.createElement("figure");
        fig.classList.add("wall__tile", "wall__tile--feature");
        fig.style.animationDelay = (i * 60) + "ms";
        fig.innerHTML = `
          <div class="wall__photo ${p.art}" style="height:${260 + (i % 2 ? 0 : 40)}px;border-radius:2px;border:1px solid var(--hair-2);"></div>
          <figcaption class="wall__cap">
            <span class="wall__cap-title"></span>
            <span class="wall__cap-meta"></span>
          </figcaption>`;
        fig.querySelector(".wall__cap-title").textContent = p.caption;
        fig.querySelector(".wall__cap-meta").textContent = `${p.by} · ${p.when || "9:41"}`;
        grid.appendChild(fig);
      });
    } else if (layout === "grid") {
      photos.slice(0, 14).forEach((p, i) => {
        const cell = document.createElement("div");
        cell.className = `wall__tile wall__tile--photo ${p.art}`;
        if (i === 0 || i === 6) cell.classList.add("wall__tile--big");
        cell.style.animationDelay = (i * 50) + "ms";
        cell.title = `— ${p.by}`;
        grid.appendChild(cell);
      });
    } else {
      photos.forEach((p, i) => {
        const tile = document.createElement("div");
        tile.className = `wall__tile wall__tile--photo ${p.art}`;
        tile.style.height = (p.h || (120 + ((i * 37) % 110))) + "px";
        tile.style.animationDelay = (i * 50) + "ms";
        if (i % 4 === 0) {
          const credit = document.createElement("span");
          credit.className = "wall__credit";
          credit.textContent = `— ${p.by}`;
          tile.appendChild(credit);
        }
        let pressTimer = null;
        tile.addEventListener("touchstart", () => {
          pressTimer = setTimeout(() => {
            const c = document.createElement("span");
            c.className = "wall__credit";
            c.textContent = `— ${p.by} · ${p.caption}`;
            tile.appendChild(c);
            setTimeout(() => c.remove(), 2200);
          }, 350);
        }, { passive: true });
        tile.addEventListener("touchend",   () => pressTimer && clearTimeout(pressTimer));
        tile.addEventListener("touchcancel",() => pressTimer && clearTimeout(pressTimer));
        grid.appendChild(tile);
      });
    }
  }
  renderGrid(STORE.load().wall_layout || "mosaic");

  root.querySelectorAll(".layout").forEach(btn => {
    btn.addEventListener("click", () => {
      const l = btn.dataset.layout;
      root.querySelectorAll(".layout").forEach(b => {
        b.classList.toggle("layout--on", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      STORE.save({ wall_layout: l });
      renderGrid(l);
    });
  });

  const here = root.querySelector("#here-count");
  let n = parseInt(here.textContent, 10) || 8;
  const drift = setInterval(() => {
    n = Math.max(3, Math.min(14, n + (Math.random() > .5 ? 1 : -1)));
    here.textContent = n;
  }, 4200);
  window.addEventListener("popstate", () => clearInterval(drift), { once: true });
};

/* ---------- t-apply (/request) ---------- */
WIRES["t-apply"] = (root) => {
  const form = root.querySelector("#apply-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.venue || !data.contact || !data.email || !data.tos) { form.reportValidity(); return; }
    STORE.save({
      apply: data,
      apply_status: "pending_approval",
      apply_at: new Date().toISOString(),
      lead_hot: true, lead_person_type: "venue_host"
    });
    navigate("/request/sent");
  });
};

/* ---------- t-submitted ---------- */
WIRES["t-submitted"] = (root) => {
  const a = STORE.load().apply;
  if (a && a.email) root.querySelector("#apply-email").textContent = a.email;
};

/* ---------- t-login-host ---------- */
WIRES["t-login-host"] = (root) => {
  const form = root.querySelector("#host-login");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) return;
    // Demo: skip magic link, set host session
    STORE.save({ host_session: { email, signed_at: new Date().toISOString() } });
    showToast("Signed in as " + email);
    navigate("/dashboard");
  });
};

/* ---------- t-host ---------- */
WIRES["t-host"] = (root) => {
  renderQR(root.querySelector("#host-qr"), 23, 41);
  root.querySelectorAll(".toggle").forEach(t => {
    t.addEventListener("click", () => {
      const on = t.dataset.on !== "true";
      t.dataset.on = on ? "true" : "false";
      t.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });
  root.querySelectorAll(".lp").forEach(lp => {
    lp.addEventListener("click", () => {
      root.querySelectorAll(".lp").forEach(l => l.classList.toggle("lp--on", l === lp));
      STORE.save({ wall_layout: lp.dataset.l });
    });
  });
};

/* ---------- t-login-admin ---------- */
WIRES["t-login-admin"] = (root) => {
  const form = root.querySelector("#admin-login");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) return;
    STORE.save({ admin_session: { email, signed_at: new Date().toISOString(), is_admin: true } });
    showToast("Admin session opened");
    navigate("/admin");
  });
};

/* ---------- t-card ---------- */
WIRES["t-card"] = (root) => {
  renderQR(root.querySelector("#card-qr"), 25, 7);
};

/* ---------- t-admin-desktop ---------- */
WIRES["t-admin-desktop"] = (root) => {
  const s = STORE.load();
  const user = (s.admin_session && s.admin_session.email) || "staff@unitywall.co";
  const el = root.querySelector("#dadmin-user");
  if (el) el.textContent = user;

  const signout = root.querySelector("[data-action='signout-admin']");
  if (signout) signout.addEventListener("click", () => {
    STORE.save({ admin_session: null });
    navigate("/admin");
  });
};

/* ---------- t-host-desktop ---------- */
WIRES["t-host-desktop"] = (root) => {
  renderQR(root.querySelector("#dhost-qr"), 25, 41);
  root.querySelectorAll(".toggle").forEach(t => {
    t.addEventListener("click", () => {
      const on = t.dataset.on !== "true";
      t.dataset.on = on ? "true" : "false";
      t.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });
  root.querySelectorAll(".lp").forEach(lp => {
    lp.addEventListener("click", () => {
      root.querySelectorAll(".lp").forEach(l => l.classList.toggle("lp--on", l === lp));
      STORE.save({ wall_layout: lp.dataset.l });
    });
  });
};

/* ============================================================
   Boot
============================================================ */
// Default to home if loaded with no path (file://)
if (!location.pathname || location.pathname === "") {
  history.replaceState({}, "", "/");
}
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
