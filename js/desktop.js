// desktop.js - app registry, desktop icons, taskbar + clock.
import { wm, onTap } from './window-manager.js';

const registry = new Map(); // id -> appCfg

export function registerApp(cfg) { registry.set(cfg.id, cfg); }
export function getApp(id) { return registry.get(id); }
export function openApp(id) {
  const app = registry.get(id);
  if (!app) { console.warn('no such app', id); return; }
  app.open();
}

/* ---- localStorage helpers (namespaced under cozyfiles.desktop.*) ---- */
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, val); } catch { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* noop */ } },
};

/* ---- session restore: remember which windows are open + their geometry ----
   Persisted as JSON under cozyfiles.desktop.session. On init we reopen those
   apps and place/size them; on mobile we still reopen but skip geometry (sheets
   are full-screen). Unknown/removed app ids are dropped. Writes are debounced
   and only fire on window change events, never in a loop. */
const SESSION_KEY = 'cozyfiles.desktop.session';
const SESSION_MAX = 12;            // cap stored windows so a bad state can't bloat
let restoringSession = false;      // suppress persistence while we reopen windows

function readSession() {
  const raw = LS.get(SESSION_KEY, null);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(e => e && typeof e.id === 'string').slice(0, SESSION_MAX);
  } catch { return []; }
}

// Turn the live wm snapshot into the minimal serializable session shape.
function snapshotToSession(snap) {
  return snap.slice(0, SESSION_MAX).map(w => ({
    id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minimized: !!w.minimized,
  }));
}

let saveTimer = null;
function saveSession(snap) {
  if (restoringSession) return;          // don't echo our own restore writes
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { LS.set(SESSION_KEY, JSON.stringify(snapshotToSession(snap))); }
    catch { /* private mode / quota */ }
  }, 250);
}

// Reopen the saved windows on boot. Each app self-loads its own params; we only
// open the window, then restore its placement/size/minimized state.
function restoreSession() {
  const entries = readSession();
  if (!entries.length) return;
  const mobile = touchLike();
  restoringSession = true;
  try {
    entries.forEach(e => {
      const app = registry.get(e.id);
      if (!app) return;                  // app removed/renamed: drop it silently
      app.open();                        // singleton-safe: re-open just focuses
      if (!mobile) {
        wm.setGeometry(e.id, { x: e.x, y: e.y, w: e.w, h: e.h, minimized: e.minimized });
      } else if (e.minimized && wm.get(e.id)) {
        wm.get(e.id).minimize();         // keep minimized state on mobile too
      }
    });
  } finally {
    restoringSession = false;
  }
}

/* ---- wallpaper switching (self-contained + namespaced) ----
   Order is: brand cubes (default) -> grid -> acid -> dots -> void -> back.
   Each non-default option maps to a [data-wallpaper] CSS rule in desktop.css.
   "cubes" intentionally has NO data attribute so the base .desktop rule wins. */
const WP_KEY = 'cozyfiles.desktop.wallpaper';
const WALLPAPERS = ['cubes', 'grid', 'acid', 'dots', 'void', 'sunset', 'synthwave', 'aurora', 'scan'];
const WP_LABEL = {
  cubes: 'cubes', grid: 'grid', acid: 'acid', dots: 'dots', void: 'void',
  sunset: 'sunset', synthwave: 'synthwave', aurora: 'aurora', scan: 'scan',
};

function applyWallpaper(name) {
  const desktop = document.getElementById('desktop');
  if (!desktop) return;
  if (name === 'cubes' || !WALLPAPERS.includes(name)) desktop.removeAttribute('data-wallpaper');
  else desktop.setAttribute('data-wallpaper', name);
}
function currentWallpaper() {
  const saved = LS.get(WP_KEY, 'cubes');
  return WALLPAPERS.includes(saved) ? saved : 'cubes';
}
function cycleWallpaper() {
  const i = WALLPAPERS.indexOf(currentWallpaper());
  const next = WALLPAPERS[(i + 1) % WALLPAPERS.length];
  LS.set(WP_KEY, next);
  applyWallpaper(next);
  return next;
}

/* Desktop icons are draggable to free positions, persisted per-app in
   localStorage under cozyfiles.desktop.icon.<id>. When any icon has a saved
   position the layer switches to "free" mode (absolute placement); "Arrange
   icons" clears all saved positions and snaps back to the tidy default column. */
const ICON_POS_PREFIX = 'cozyfiles.desktop.icon.';
const touchLike = () =>
  matchMedia('(max-width: 640px)').matches ||
  matchMedia('(hover: none), (pointer: coarse)').matches;

function iconPosKey(id) { return ICON_POS_PREFIX + id; }
function loadIconPos(id) {
  const raw = LS.get(iconPosKey(id), null);
  if (!raw) return null;
  try { const p = JSON.parse(raw); return (typeof p.x === 'number' && typeof p.y === 'number') ? p : null; }
  catch { return null; }
}
function saveIconPos(id, x, y) { LS.set(iconPosKey(id), JSON.stringify({ x, y })); }

function applyIconPos(btn, pos) {
  if (pos) {
    btn.classList.add('is-placed');
    btn.style.left = pos.x + 'px';
    btn.style.top = pos.y + 'px';
  } else {
    btn.classList.remove('is-placed');
    btn.style.left = '';
    btn.style.top = '';
  }
}

// drag-to-move on a fine pointer; on touch we leave icons in the tidy flow so a
// tap reliably opens (no accidental drags). Returns true if a drag happened.
function enableIconDrag(btn, app, iconsEl) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return; // primary button only
    if (touchLike()) return;                        // touch keeps tap-to-open
    dragging = true; moved = false;
    const r = btn.getBoundingClientRect();
    const cr = iconsEl.getBoundingClientRect();
    ox = r.left - cr.left; oy = r.top - cr.top;     // current px within layer
    sx = e.clientX; sy = e.clientY;
    btn.setPointerCapture?.(e.pointerId);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!moved) { moved = true; btn.classList.add('is-dragging'); }
    const cr = iconsEl.getBoundingClientRect();
    let nx = ox + dx, ny = oy + dy;
    nx = Math.max(0, Math.min(nx, cr.width - btn.offsetWidth));
    ny = Math.max(0, Math.min(ny, cr.height - btn.offsetHeight));
    applyIconPos(btn, { x: nx, y: ny });
    iconsEl.classList.add('is-free');
    iconsEl.classList.remove('is-arranged');
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('is-dragging');
    if (moved) {
      saveIconPos(app.id, parseFloat(btn.style.left) || 0, parseFloat(btn.style.top) || 0);
      LS.del(ARRANGE_KEY);
    }
  };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  // suppress the click/open that would otherwise fire after a real drag
  btn.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); moved = false; } }, true);
}

function renderIcons(iconsEl) {
  iconsEl.innerHTML = '';
  let anyPlaced = false;
  [...registry.values()].filter(a => a.desktop !== false && !a.hidden).forEach(app => {
    const btn = document.createElement('button');
    btn.className = 'icon';
    btn.type = 'button';
    btn.innerHTML = `<span class="icon__glyph" aria-hidden="true">${app.icon}</span><span class="icon__label">${app.name}</span>`;
    const activate = () => app.open();
    // Desktop (mouse + fine pointer): double-click opens, single click just
    // selects/focuses the icon. Touch / small screens: a single tap opens.
    btn.addEventListener('dblclick', activate);
    onTap(btn, () => { if (touchLike()) activate(); else btn.focus(); });

    const pos = loadIconPos(app.id);
    if (pos) { applyIconPos(btn, pos); anyPlaced = true; }
    enableIconDrag(btn, app, iconsEl);

    iconsEl.appendChild(btn);
  });
  iconsEl.classList.toggle('is-free', anyPlaced);
}

// "Arrange icons": clear every saved free position and snap back to the tidy
// default column, with a brief visual nudge so the command always reads.
const ARRANGE_KEY = 'cozyfiles.desktop.arranged';
function clearIconPositions() {
  [...registry.values()].forEach(a => LS.del(iconPosKey(a.id)));
}
function arrangeIcons(iconsEl, persist = true) {
  clearIconPositions();
  renderIcons(iconsEl);              // re-renders with no placements -> tidy flow
  iconsEl.classList.remove('is-free');
  iconsEl.classList.add('is-arranged');
  if (persist) LS.set(ARRANGE_KEY, '1');
  // brief feedback so the reflow is unmistakable even when nothing had moved
  iconsEl.classList.remove('just-arranged');
  void iconsEl.offsetWidth;          // restart the animation
  iconsEl.classList.add('just-arranged');
  setTimeout(() => iconsEl.classList.remove('just-arranged'), 450);
}

export function initDesktop() {
  const iconsEl = document.getElementById('desktop-icons');
  const windowsEl = document.getElementById('windows');
  wm.mount(windowsEl);

  // restore persisted wallpaper before first paint
  applyWallpaper(currentWallpaper());

  // desktop icons
  renderIcons(iconsEl);
  if (LS.get(ARRANGE_KEY, '') === '1') iconsEl.classList.add('is-arranged');

  // taskbar. The cozyOS button now opens a real Start menu (built dynamically,
  // like the right-click menu) listing every launchable app plus a Show desktop
  // command (the old "minimize everything" behavior lives on that item).
  const startBtn = document.getElementById('start-btn');
  const itemsEl = document.getElementById('taskbar-items');
  initStartMenu(startBtn);

  wm.onChange((snap) => {
    itemsEl.innerHTML = '';
    snap.forEach(w => {
      const b = document.createElement('button');
      b.className = 'taskitem' + (w.focused && !w.minimized ? ' is-focused' : '') + (w.minimized ? ' is-min' : '');
      b.type = 'button';
      b.innerHTML = `<span aria-hidden="true">${typeof w.icon === 'string' && w.icon.includes('/') ? '🗔' : w.icon}</span> ${w.title}`;
      onTap(b, () => wm.toggleTaskItem(w.id));
      itemsEl.appendChild(b);
    });
  });

  // persist the open-window set (debounced, change-driven only)
  wm.onChange(saveSession);

  initContextMenu(iconsEl);

  // restore last session first, then honor any deep-link so the linked app
  // lands focused on top. Both are singleton-safe (re-open just focuses).
  restoreSession();
  initDeepLinking();

  startClock();
}

/* ---- desktop right-click context menu ---- */
function initContextMenu(iconsEl) {
  const desktop = document.getElementById('desktop');
  if (!desktop) return;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  desktop.appendChild(menu);

  const items = () => [
    { glyph: '🖼️', label: `Change wallpaper (${WP_LABEL[currentWallpaper()]})`, run: () => cycleWallpaper() },
    { glyph: '🧹', label: 'Arrange icons', run: () => arrangeIcons(iconsEl) },
    { sep: true },
    { glyph: 'ℹ️', label: 'About cozyOS', run: () => openApp('about') },
  ];

  function buildMenu() {
    menu.innerHTML = '';
    items().forEach(it => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-menu__sep'; menu.appendChild(s); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-menu__item';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="ctx-menu__glyph" aria-hidden="true">${it.glyph}</span><span>${it.label}</span>`;
      onTap(b, () => { closeMenu(); it.run(); });
      menu.appendChild(b);
    });
  }

  function openMenu(clientX, clientY) {
    buildMenu();
    menu.hidden = false;
    // clamp within the desktop so the menu never spills off-screen
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const maxX = window.innerWidth - mw - 4;
    const maxY = window.innerHeight - mh - 4;
    menu.style.left = Math.max(4, Math.min(clientX, maxX)) + 'px';
    menu.style.top = Math.max(4, Math.min(clientY, maxY)) + 'px';
    const first = menu.querySelector('.ctx-menu__item');
    first && first.focus({ preventScroll: true });
  }
  function closeMenu() { menu.hidden = true; }

  // Only hijack the native menu over the desktop background / icon layer,
  // never over an open window.
  function overDesktopBg(target) {
    if (menu.contains(target)) return false;
    if (target.closest('.win')) return false;
    if (target.closest('.taskbar')) return false;
    return !!target.closest('.desktop');
  }

  desktop.addEventListener('contextmenu', (e) => {
    if (!overDesktopBg(e.target)) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });

  // Mobile / touch: long-press opens the menu (no native contextmenu reliably).
  let pressTimer = null, startX = 0, startY = 0;
  const coarse = () => matchMedia('(hover: none), (pointer: coarse)').matches || matchMedia('(max-width: 640px)').matches;
  desktop.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !coarse()) return;
    if (!overDesktopBg(e.target)) return;
    startX = e.clientX; startY = e.clientY;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => openMenu(startX, startY), 480);
  });
  const cancelPress = (e) => {
    if (e && e.type === 'pointermove' &&
        Math.abs(e.clientX - startX) < 12 && Math.abs(e.clientY - startY) < 12) return;
    clearTimeout(pressTimer);
  };
  desktop.addEventListener('pointermove', cancelPress);
  desktop.addEventListener('pointerup', () => clearTimeout(pressTimer));
  desktop.addEventListener('pointercancel', () => clearTimeout(pressTimer));

  // dismiss on outside interaction / Escape / scroll-ish events
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); } });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
}

/* ---- Start menu (anchored above the cozyOS button) ----
   Built dynamically in JS, exactly like the right-click .ctx-menu. Lists every
   launchable app from the registry, plus a separator + Show desktop. */
function initStartMenu(startBtn) {
  const desktop = document.getElementById('desktop');
  if (!desktop || !startBtn) return;

  const menu = document.createElement('div');
  menu.className = 'start-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Start menu');
  menu.hidden = true;
  desktop.appendChild(menu);

  function buildMenu() {
    menu.innerHTML = '';
    // banner strip across the top, win98 launcher vibe
    const head = document.createElement('div');
    head.className = 'start-menu__brand';
    head.textContent = 'cozyOS';
    menu.appendChild(head);

    const apps = [...registry.values()].filter(a => a.desktop !== false && !a.hidden);
    apps.forEach(app => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'start-menu__item';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="start-menu__glyph" aria-hidden="true">${app.icon}</span><span class="start-menu__label">${app.name}</span>`;
      onTap(b, () => { closeMenu(); app.open(); });
      menu.appendChild(b);
    });

    const sep = document.createElement('div');
    sep.className = 'start-menu__sep';
    menu.appendChild(sep);

    const sd = document.createElement('button');
    sd.type = 'button';
    sd.className = 'start-menu__item';
    sd.setAttribute('role', 'menuitem');
    sd.innerHTML = `<span class="start-menu__glyph" aria-hidden="true">🖥️</span><span class="start-menu__label">Show desktop</span>`;
    onTap(sd, () => { closeMenu(); wm.showDesktop(); });
    menu.appendChild(sd);
  }

  function positionMenu() {
    // anchor the menu's bottom-left to the cozyOS button's top-left, clamped.
    const r = startBtn.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.left;
    left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
    let top = r.top - mh - 2;
    if (top < 4) top = r.bottom + 2; // fall below if it would clip the top
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function openMenu() {
    buildMenu();
    menu.hidden = false;
    startBtn.setAttribute('aria-expanded', 'true');
    positionMenu();
    const first = menu.querySelector('.start-menu__item');
    first && first.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    startBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() { menu.hidden ? openMenu() : closeMenu(); }

  startBtn.setAttribute('aria-haspopup', 'true');
  startBtn.setAttribute('aria-expanded', 'false');
  onTap(startBtn, toggleMenu);

  // close on outside interaction, Escape, blur, resize
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || startBtn.contains(e.target)) return;
    closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', () => { if (!menu.hidden) positionMenu(); });
}

/* ---- deep-linking ---------------------------------------------------------
   ?app=<id> (and #app=<id>) opens a registered app by id.
   ?beat=<code> opens the STUDIO SESSION app; ?file=<slug> opens FILES.
   The studio-session and files apps self-load their own param off open(); here
   we only ensure the right app is launched. Unknown ids are ignored. Singleton
   apps keep this idempotent, so the hashchange re-run never double-opens. */
function appIdFromLocation() {
  let id = null;
  try {
    const q = new URLSearchParams(window.location.search);
    id = q.get('app');
    // route param-specific deep links to their owning app
    if (!id && q.has('beat')) id = 'studio-session';
    if (!id && q.has('file')) id = 'files';
  } catch { /* noop */ }
  if (!id && window.location.hash) {
    const h = window.location.hash.replace(/^#/, '');
    let m = /(?:^|[?&])app=([^&]+)/.exec(h);
    if (m) id = decodeURIComponent(m[1]);
    else if (/(?:^|[?&])beat=/.test(h)) id = 'studio-session';
    else if (/(?:^|[?&])file=/.test(h)) id = 'files';
    else if (registry.has(h)) id = h; // bare #studio also works
  }
  return id;
}
function openFromLocation() {
  const id = appIdFromLocation();
  if (id && registry.has(id)) openApp(id); // unknown ids are ignored silently
}
function initDeepLinking() {
  openFromLocation();
  // allow navigating to an app by changing the hash later (e.g. #app=player)
  window.addEventListener('hashchange', openFromLocation);
}

function startClock() {
  const el = document.getElementById('taskbar-clock');
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  tick();
  setInterval(tick, 15000);
}
