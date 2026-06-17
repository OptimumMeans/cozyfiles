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

/* ---- wallpaper switching (self-contained + namespaced) ----
   Order is: brand cubes (default) -> grid -> acid -> dots -> void -> back.
   Each non-default option maps to a [data-wallpaper] CSS rule in desktop.css.
   "cubes" intentionally has NO data attribute so the base .desktop rule wins. */
const WP_KEY = 'cozyfiles.desktop.wallpaper';
const WALLPAPERS = ['cubes', 'grid', 'acid', 'dots', 'void'];
const WP_LABEL = { cubes: 'cubes', grid: 'grid', acid: 'acid', dots: 'dots', void: 'void' };

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

function renderIcons(iconsEl) {
  iconsEl.innerHTML = '';
  [...registry.values()].filter(a => a.desktop !== false && !a.hidden).forEach(app => {
    const btn = document.createElement('button');
    btn.className = 'icon';
    btn.type = 'button';
    btn.innerHTML = `<span class="icon__glyph" aria-hidden="true">${app.icon}</span><span class="icon__label">${app.name}</span>`;
    const activate = () => app.open();
    // Desktop (mouse + fine pointer): double-click opens, single click just
    // selects/focuses the icon. Touch / small screens: a single tap opens.
    const touchLike = () =>
      matchMedia('(max-width: 640px)').matches ||
      matchMedia('(hover: none), (pointer: coarse)').matches;
    btn.addEventListener('dblclick', activate);
    onTap(btn, () => { if (touchLike()) activate(); else btn.focus(); });
    iconsEl.appendChild(btn);
  });
}

// "Arrange icons": re-render into the default tidy grid and persist the choice.
const ARRANGE_KEY = 'cozyfiles.desktop.arranged';
function arrangeIcons(iconsEl, persist = true) {
  renderIcons(iconsEl);
  iconsEl.classList.add('is-arranged');
  if (persist) LS.set(ARRANGE_KEY, '1');
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

  // taskbar. The cozyOS button is a "home" button: it minimizes all open
  // windows to reveal the desktop (works the same on mobile and desktop).
  const startBtn = document.getElementById('start-btn');
  const itemsEl = document.getElementById('taskbar-items');
  onTap(startBtn, () => wm.showDesktop());

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

  initContextMenu(iconsEl);
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

/* ---- deep-linking: ?app=<id> (and #app=<id>) opens a registered app ---- */
function appIdFromLocation() {
  let id = null;
  try { id = new URLSearchParams(window.location.search).get('app'); } catch { /* noop */ }
  if (!id && window.location.hash) {
    const h = window.location.hash.replace(/^#/, '');
    const m = /(?:^|[?&])app=([^&]+)/.exec(h);
    if (m) id = decodeURIComponent(m[1]);
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
