// window-manager.js - the singleton WindowManager. Apps build against wm.open().
// Owns dragging, resizing, focus/z-stacking, minimize, close, cascade, clamping,
// and taskbar sync. Apps NEVER touch z-index, position, or the taskbar.

const Z_BASE = 100;
const MOBILE = () => window.matchMedia('(max-width: 640px)').matches;

class WindowManager {
  constructor() {
    this.root = null;            // #windows
    this.windows = new Map();    // id -> handle
    this.zTop = Z_BASE;
    this.cascade = 0;
    this._listeners = new Set(); // taskbar subscribers: (snapshot) => void
  }

  mount(rootEl) {
    this.root = rootEl;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const top = this._topmost();
        if (top) top.close();
      }
    });
    window.addEventListener('resize', () => this._clampAll());
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() {
    const snap = [...this.windows.values()].map(w => ({
      id: w.id, title: w._title, icon: w.icon, minimized: w.minimized,
      focused: w.el.style.zIndex == this.zTop,
    }));
    this._listeners.forEach(fn => fn(snap));
  }

  open(cfg) {
    if (cfg.singleton !== false && this.windows.has(cfg.id)) {
      const w = this.windows.get(cfg.id);
      w.minimized && this._restore(w);
      w.focus();
      return w;
    }
    return this._create(cfg);
  }

  get(id) { return this.windows.get(id); }

  _create(cfg) {
    const {
      id, title = id, icon = '🗔', render,
      width = 520, height = 380, x, y,
      resizable = true, className = '',
    } = cfg;

    const el = document.createElement('section');
    el.className = `win ${className}`.trim();
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.tabIndex = -1;

    el.innerHTML = `
      <header class="win__bar" data-drag>
        <span class="win__icon" aria-hidden="true"></span>
        <span class="win__title"></span>
        <span class="win__controls">
          <button class="win__btn win__min" title="minimize" aria-label="minimize">_</button>
          <button class="win__btn win__close" title="close" aria-label="close">×</button>
        </span>
      </header>
      <div class="win__body"></div>
      ${resizable ? '<div class="win__resize" data-resize aria-hidden="true"></div>' : ''}
    `;
    el.querySelector('.win__icon').textContent = this._iconGlyph(icon);
    el.querySelector('.win__title').textContent = title;
    const contentEl = el.querySelector('.win__body');

    // position
    if (MOBILE()) {
      Object.assign(el.style, { left: '0px', top: '0px', width: '100%', height: `calc(100% - var(--taskbar-h))` });
    } else {
      const px = x ?? (40 + this.cascade * 26);
      const py = y ?? (40 + this.cascade * 26);
      this.cascade = (this.cascade + 1) % 8;
      Object.assign(el.style, { left: px + 'px', top: py + 'px', width: width + 'px', height: height + 'px' });
    }

    this.root.appendChild(el);

    const handle = {
      id, icon, el, contentEl, minimized: false, _title: title,
      focus: () => this._focus(handle),
      close: () => this._close(handle),
      minimize: () => this._minimize(handle),
      setTitle: (s) => { handle._title = s; el.querySelector('.win__title').textContent = s; this._emit(); },
    };
    this.windows.set(id, handle);

    // wiring
    el.querySelector('.win__close').addEventListener('click', (e) => { e.stopPropagation(); handle.close(); });
    el.querySelector('.win__min').addEventListener('click', (e) => { e.stopPropagation(); handle.minimize(); });
    el.addEventListener('mousedown', () => handle.focus(), true);
    el.addEventListener('touchstart', () => handle.focus(), { capture: true, passive: true });
    this._enableDrag(handle);
    if (resizable) this._enableResize(handle);

    // paint app content
    try { render && render(contentEl, handle); }
    catch (err) { contentEl.innerHTML = `<pre class="win__error">app crashed:\n${String(err)}</pre>`; }

    handle.focus();
    this._emit();
    return handle;
  }

  _iconGlyph(icon) {
    // emoji stays as text; a path renders as a tiny img-less placeholder glyph here
    return (typeof icon === 'string' && icon.includes('/')) ? '🗔' : icon;
  }

  _focus(w) {
    this.zTop += 1;
    w.el.style.zIndex = this.zTop;
    [...this.windows.values()].forEach(o => o.el.classList.toggle('is-focused', o === w));
    w.el.focus({ preventScroll: true });
    this._emit();
  }
  _topmost() {
    let top = null, z = -1;
    this.windows.forEach(w => { if (!w.minimized && +w.el.style.zIndex > z) { z = +w.el.style.zIndex; top = w; } });
    return top;
  }
  _close(w) {
    w.el.classList.add('is-closing');
    const done = () => { w.el.remove(); this.windows.delete(w.id); this._emit(); };
    w.el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 260); // fallback if no animation
  }
  _minimize(w) { w.minimized = true; w.el.hidden = true; this._emit(); }
  _restore(w) { w.minimized = false; w.el.hidden = false; w.focus(); }

  toggleTaskItem(id) {
    const w = this.windows.get(id); if (!w) return;
    if (w.minimized) this._restore(w);
    else if (+w.el.style.zIndex === this.zTop) this._minimize(w);
    else w.focus();
  }

  _enableDrag(w) {
    const bar = w.el.querySelector('[data-drag]');
    let sx, sy, ox, oy, dragging = false;
    const down = (e) => {
      if (e.target.closest('.win__btn')) return;
      if (MOBILE()) return; // sheets don't drag on mobile
      dragging = true;
      const p = pt(e);
      sx = p.x; sy = p.y; ox = w.el.offsetLeft; oy = w.el.offsetTop;
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = pt(e);
      w.el.style.left = (ox + p.x - sx) + 'px';
      w.el.style.top = Math.max(0, oy + p.y - sy) + 'px';
      if (e.cancelable) e.preventDefault();
    };
    const up = () => {
      dragging = false; this._clamp(w);
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
    };
    bar.addEventListener('mousedown', down);
    bar.addEventListener('touchstart', down, { passive: false });
  }

  _enableResize(w) {
    const grip = w.el.querySelector('[data-resize]'); if (!grip) return;
    let sx, sy, ow, oh, sizing = false;
    const down = (e) => {
      sizing = true; const p = pt(e);
      sx = p.x; sy = p.y; ow = w.el.offsetWidth; oh = w.el.offsetHeight;
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
      e.preventDefault(); e.stopPropagation();
    };
    const move = (e) => {
      if (!sizing) return; const p = pt(e);
      w.el.style.width = Math.max(240, ow + p.x - sx) + 'px';
      w.el.style.height = Math.max(160, oh + p.y - sy) + 'px';
      if (e.cancelable) e.preventDefault();
    };
    const up = () => {
      sizing = false;
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
    };
    grip.addEventListener('mousedown', down);
    grip.addEventListener('touchstart', down, { passive: false });
  }

  _clamp(w) {
    if (MOBILE()) return;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 80;
    w.el.style.left = Math.min(Math.max(0, w.el.offsetLeft), maxX) + 'px';
    w.el.style.top = Math.min(Math.max(0, w.el.offsetTop), maxY) + 'px';
  }
  _clampAll() { this.windows.forEach(w => this._clamp(w)); }
}

function pt(e) {
  const t = e.touches?.[0] || e.changedTouches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : { x: e.clientX, y: e.clientY };
}

export const wm = new WindowManager();
