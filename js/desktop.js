// desktop.js — app registry, desktop icons, taskbar + clock.
import { wm } from './window-manager.js';

const registry = new Map(); // id -> appCfg

export function registerApp(cfg) { registry.set(cfg.id, cfg); }
export function getApp(id) { return registry.get(id); }
export function openApp(id) {
  const app = registry.get(id);
  if (!app) { console.warn('no such app', id); return; }
  app.open();
}

export function initDesktop() {
  const iconsEl = document.getElementById('desktop-icons');
  const windowsEl = document.getElementById('windows');
  wm.mount(windowsEl);

  // desktop icons
  iconsEl.innerHTML = '';
  [...registry.values()].filter(a => a.desktop !== false && !a.hidden).forEach(app => {
    const btn = document.createElement('button');
    btn.className = 'icon';
    btn.type = 'button';
    btn.innerHTML = `<span class="icon__glyph" aria-hidden="true">${app.icon}</span><span class="icon__label">${app.name}</span>`;
    let last = 0;
    const activate = () => app.open();
    btn.addEventListener('dblclick', activate);
    btn.addEventListener('click', () => { // single tap on mobile, dbl on desktop
      const now = Date.now ? 0 : 0; // Date.now avoided; use simple flag
      last++;
      if (matchMedia('(max-width:640px)').matches) activate();
    });
    iconsEl.appendChild(btn);
  });

  // taskbar
  const startBtn = document.getElementById('start-btn');
  const itemsEl = document.getElementById('taskbar-items');
  startBtn.addEventListener('click', () => openApp('files'));

  wm.onChange((snap) => {
    itemsEl.innerHTML = '';
    snap.forEach(w => {
      const b = document.createElement('button');
      b.className = 'taskitem' + (w.focused && !w.minimized ? ' is-focused' : '') + (w.minimized ? ' is-min' : '');
      b.type = 'button';
      b.innerHTML = `<span aria-hidden="true">${typeof w.icon === 'string' && w.icon.includes('/') ? '🗔' : w.icon}</span> ${w.title}`;
      b.addEventListener('click', () => wm.toggleTaskItem(w.id));
      itemsEl.appendChild(b);
    });
  });

  startClock();
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
