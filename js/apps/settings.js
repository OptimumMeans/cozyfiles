// settings.js - SETTINGS control panel: CRT scanlines, accent theme presets,
// reduced motion, and a "boot again" control. Persisted under cozyfiles.os.*
//
// On import this module immediately applies the saved theme + toggles so the
// look is correct before any window is ever opened. Registering the app is the
// last thing it does.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const LS = {
  theme: 'cozyfiles.os.theme',        // accent preset id
  crt: 'cozyfiles.os.crt',            // 'on' | 'off'
  motion: 'cozyfiles.os.motion',      // 'full' | 'reduced'
};

// Accent presets. Each sets --accent (primary acid) + --accent-2 (warm/contrast)
// at runtime on :root. Acid lime is the cozyOS default.
const THEMES = [
  { id: 'lime',  name: 'acid lime',   accent: '#b6ff3c', accent2: '#ff5e3a' },
  { id: 'cyan',  name: 'ice cyan',    accent: '#3cf0ff', accent2: '#ff5ea8' },
  { id: 'amber', name: 'amber crt',   accent: '#ffb43c', accent2: '#3cff9e' },
  { id: 'magenta', name: 'hot magenta', accent: '#ff5ed6', accent2: '#b6ff3c' },
];

// ---- storage helpers ---------------------------------------------------
function get(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function set(key, val) {
  try { localStorage.setItem(key, val); } catch { /* storage blocked */ }
}

function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---- appliers (also called on import) ----------------------------------
function applyTheme(id) {
  const t = themeById(id);
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-2', t.accent2);
  return t.id;
}

function applyCrt(on) {
  document.body.classList.toggle('no-crt', !on);
}

function applyMotion(reduced) {
  // A body class lets CSS opt into reduced motion regardless of the OS setting.
  document.body.classList.toggle('reduce-motion', reduced);
}

// Apply everything saved. Safe to call at import time.
function applySaved() {
  applyTheme(get(LS.theme, 'lime'));
  applyCrt(get(LS.crt, 'on') !== 'off');
  applyMotion(get(LS.motion, 'full') === 'reduced');
}
applySaved();

// ---- window content ----------------------------------------------------
function render(el) {
  const curTheme = get(LS.theme, 'lime');
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

  // Accent swatches.
  el.querySelectorAll('.settings__swatch').forEach((sw) => {
    onTap(sw, () => {
      const id = applyTheme(sw.dataset.theme);
      set(LS.theme, id);
      el.querySelectorAll('.settings__swatch').forEach((o) => {
        const active = o.dataset.theme === id;
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
    width: 360, height: 420, className: 'app-settings',
    render,
  }),
});
