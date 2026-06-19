// settings.js - SETTINGS control panel: CRT scanlines, reduced motion, accent
// palette + desktop wallpaper pickers, and a "boot again" control.
//
// On import this module immediately applies the saved look (theme, wallpaper,
// CRT, motion) so cozyOS renders correctly before any window is opened.
// Registering the app is the last thing it does.
//
// THEME model: a palette is applied by setting data-theme on the document
// element. The CSS for each palette lives in css/tokens.css as
// :root[data-theme="NAME"] override blocks. The default "lime" look sets NO
// attribute, so the origin tokens stay untouched. Persisted under
// cozyfiles.desktop.theme.
//
// WALLPAPER model: a wallpaper is applied by setting data-wallpaper on the
// #desktop element (the same attribute desktop.js cycles via right-click). The
// CSS lives in css/desktop.css as .desktop[data-wallpaper="NAME"] rules. The
// default "cubes" look sets NO attribute. Persisted under the SAME key
// desktop.js uses (cozyfiles.desktop.wallpaper) so the two controls stay in
// sync.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const LS = {
  theme: 'cozyfiles.desktop.theme',         // accent palette id
  wallpaper: 'cozyfiles.desktop.wallpaper', // desktop background id (shared w/ desktop.js)
  crt: 'cozyfiles.os.crt',                  // 'on' | 'off'
  motion: 'cozyfiles.os.motion',            // 'full' | 'reduced'
};

// Accent palettes. id 'lime' is the cozyOS default and applies NO data-theme
// attribute (origin tokens win). The other ids map 1:1 to the
// :root[data-theme="..."] blocks in css/tokens.css. accent/accent2 here are
// preview-swatch colors only - the real values live in CSS.
const THEMES = [
  { id: 'lime',  name: 'acid lime',   accent: '#b6ff3c', accent2: '#ff5e3a' },
  { id: 'amber', name: 'amber crt',   accent: '#ffb43c', accent2: '#ff6a3c' },
  { id: 'cyan',  name: 'ice cyan',    accent: '#3cf0ff', accent2: '#ff5ea8' },
  { id: 'mono',  name: 'mono',        accent: '#e8e6df', accent2: '#9a9890' },
  { id: 'vapor', name: 'vapor',       accent: '#ff5ed6', accent2: '#6af0ff' },
];

// Wallpapers. id 'cubes' is the default and applies NO data-wallpaper attribute
// (base .desktop rule wins). The rest map 1:1 to .desktop[data-wallpaper="..."]
// rules in css/desktop.css. The original set (grid/acid/dots/void) ships with
// the desktop; settings-look adds sunset/synthwave/aurora/scan. a/b are
// preview-swatch colors only.
const WALLPAPERS = [
  { id: 'cubes',     name: 'cubes',     a: '#1b1b1b', b: '#b6ff3c' },
  { id: 'grid',      name: 'grid',      a: '#141414', b: '#3a3a3a' },
  { id: 'acid',      name: 'acid',      a: '#0a0a0a', b: '#b6ff3c' },
  { id: 'dots',      name: 'dots',      a: '#0a0a0a', b: '#b6ff3c' },
  { id: 'void',      name: 'void',      a: '#141414', b: '#0a0a0a' },
  { id: 'sunset',    name: 'sunset',    a: '#ff6a3c', b: '#b6ff3c' },
  { id: 'synthwave', name: 'synthwave', a: '#b6ff3c', b: '#ff5e3a' },
  { id: 'aurora',    name: 'aurora',    a: '#3cf0ff', b: '#ff5ed6' },
  { id: 'scan',      name: 'scan',      a: '#0a0a0a', b: '#e8e6df' },
];

const THEME_DEFAULT = 'lime';
const WALLPAPER_DEFAULT = 'cubes';

// ---- storage helpers ---------------------------------------------------
function get(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
  catch { return fallback; }
}
function set(key, val) {
  try { localStorage.setItem(key, val); } catch { /* storage blocked */ }
}

function isTheme(id) { return THEMES.some((t) => t.id === id); }
function isWallpaper(id) { return WALLPAPERS.some((w) => w.id === id); }

function currentTheme() {
  const saved = get(LS.theme, THEME_DEFAULT);
  return isTheme(saved) ? saved : THEME_DEFAULT;
}
function currentWallpaper() {
  const saved = get(LS.wallpaper, WALLPAPER_DEFAULT);
  return isWallpaper(saved) ? saved : WALLPAPER_DEFAULT;
}

// ---- appliers (also called on import) ----------------------------------
// Palette: default 'lime' clears the attribute so origin tokens win.
function applyTheme(id) {
  const safe = isTheme(id) ? id : THEME_DEFAULT;
  const root = document.documentElement;
  if (safe === THEME_DEFAULT) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', safe);
  return safe;
}

// Wallpaper: default 'cubes' clears the attribute so the base .desktop rule
// wins. Setting data-wallpaper on #desktop is exactly what desktop.js does.
function applyWallpaper(id) {
  const safe = isWallpaper(id) ? id : WALLPAPER_DEFAULT;
  const desktop = document.getElementById('desktop');
  if (desktop) {
    if (safe === WALLPAPER_DEFAULT) desktop.removeAttribute('data-wallpaper');
    else desktop.setAttribute('data-wallpaper', safe);
  }
  return safe;
}

function applyCrt(on) {
  document.body.classList.toggle('no-crt', !on);
}

function applyMotion(reduced) {
  // A body class lets CSS opt into reduced motion regardless of the OS setting.
  document.body.classList.toggle('reduce-motion', reduced);
}

// Apply everything saved. Safe to call at import time. Theme + CRT + motion act
// on :root / body which exist immediately; wallpaper acts on #desktop which is
// also present in the static markup, so this is safe pre-boot too. desktop.js
// re-applies the same saved wallpaper on init, which is harmless (same value).
function applySaved() {
  applyTheme(currentTheme());
  applyWallpaper(currentWallpaper());
  applyCrt(get(LS.crt, 'on') !== 'off');
  applyMotion(get(LS.motion, 'full') === 'reduced');
}
applySaved();

// ---- window content ----------------------------------------------------
function render(el) {
  const curTheme = currentTheme();
  const curWall = currentWallpaper();
  const crtOn = get(LS.crt, 'on') !== 'off';
  const reducedOn = get(LS.motion, 'full') === 'reduced';

  el.innerHTML = `
    <div class="settings">
      <section class="settings__group">
        <h2 class="settings__h">display</h2>
        <label class="settings__row">
          <span class="settings__label">CRT scanlines</span>
          <button class="settings__toggle" data-act="crt" type="button"
                  role="switch" aria-checked="${crtOn}">
            <span class="settings__toggle-track"><span class="settings__toggle-knob"></span></span>
            <span class="settings__toggle-state">${crtOn ? 'ON' : 'OFF'}</span>
          </button>
        </label>
        <label class="settings__row">
          <span class="settings__label">reduce motion</span>
          <button class="settings__toggle" data-act="motion" type="button"
                  role="switch" aria-checked="${reducedOn}">
            <span class="settings__toggle-track"><span class="settings__toggle-knob"></span></span>
            <span class="settings__toggle-state">${reducedOn ? 'ON' : 'OFF'}</span>
          </button>
        </label>
      </section>

      <section class="settings__group">
        <h2 class="settings__h">accent theme</h2>
        <div class="settings__swatches" role="radiogroup" aria-label="accent theme">
          ${THEMES.map((t) => `
            <button class="settings__swatch${t.id === curTheme ? ' is-active' : ''}"
                    data-theme="${t.id}" type="button" role="radio"
                    aria-checked="${t.id === curTheme}" title="${t.name}">
              <span class="settings__dot" style="--a:${t.accent};--b:${t.accent2}"></span>
              <span class="settings__swatch-name">${t.name}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="settings__group">
        <h2 class="settings__h">wallpaper</h2>
        <div class="settings__swatches" role="radiogroup" aria-label="desktop wallpaper">
          ${WALLPAPERS.map((w) => `
            <button class="settings__swatch${w.id === curWall ? ' is-active' : ''}"
                    data-wallpaper="${w.id}" type="button" role="radio"
                    aria-checked="${w.id === curWall}" title="${w.name}">
              <span class="settings__dot" style="--a:${w.a};--b:${w.b}"></span>
              <span class="settings__swatch-name">${w.name}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="settings__group">
        <h2 class="settings__h">session</h2>
        <button class="settings__action" data-act="reboot" type="button">boot again</button>
        <p class="settings__note">reloads cozyOS and replays the boot sequence.</p>
      </section>
    </div>
  `;

  // CRT toggle. Read the live DOM class so it never drifts from reality.
  const crtBtn = el.querySelector('[data-act="crt"]');
  onTap(crtBtn, () => {
    const newOn = document.body.classList.contains('no-crt'); // currently off -> turning on
    applyCrt(newOn);
    set(LS.crt, newOn ? 'on' : 'off');
    crtBtn.setAttribute('aria-checked', String(newOn));
    crtBtn.querySelector('.settings__toggle-state').textContent = newOn ? 'ON' : 'OFF';
  });

  // Reduce-motion toggle.
  const motionBtn = el.querySelector('[data-act="motion"]');
  onTap(motionBtn, () => {
    const isOn = document.body.classList.contains('reduce-motion');
    const newOn = !isOn;
    applyMotion(newOn);
    set(LS.motion, newOn ? 'reduced' : 'full');
    motionBtn.setAttribute('aria-checked', String(newOn));
    motionBtn.querySelector('.settings__toggle-state').textContent = newOn ? 'ON' : 'OFF';
  });

  // Accent palette swatches.
  el.querySelectorAll('[data-theme]').forEach((sw) => {
    onTap(sw, () => {
      const id = applyTheme(sw.dataset.theme);
      set(LS.theme, id);
      el.querySelectorAll('[data-theme]').forEach((o) => {
        const active = o.dataset.theme === id;
        o.classList.toggle('is-active', active);
        o.setAttribute('aria-checked', String(active));
      });
    });
  });

  // Wallpaper swatches.
  el.querySelectorAll('[data-wallpaper]').forEach((sw) => {
    onTap(sw, () => {
      const id = applyWallpaper(sw.dataset.wallpaper);
      set(LS.wallpaper, id);
      el.querySelectorAll('[data-wallpaper]').forEach((o) => {
        const active = o.dataset.wallpaper === id;
        o.classList.toggle('is-active', active);
        o.setAttribute('aria-checked', String(active));
      });
    });
  });

  // Boot again.
  onTap(el.querySelector('[data-act="reboot"]'), () => {
    try { location.reload(); } catch { /* ignore */ }
  });
}

registerApp({
  id: 'settings', name: 'settings', icon: '⚙', desktop: true,
  open: () => wm.open({
    id: 'settings', title: 'settings', icon: '⚙',
    width: 360, height: 520, className: 'app-settings',
    render,
  }),
});
