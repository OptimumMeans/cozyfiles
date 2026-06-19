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

  // Last-known VISIBLE rect. A minimized window is hidden and reports
  // offset* === 0, so we cache geometry whenever the window is visible and
  // reuse the cache while it is minimized. Without this, session restore would
  // save 0,0,0,0 for any minimized window and bring it back tiny in the corner.
  _liveRect(w) {
    if (!w.el.hidden && w.el.offsetWidth > 0) {
      w._rect = {
        x: Math.round(w.el.offsetLeft), y: Math.round(w.el.offsetTop),
        w: Math.round(w.el.offsetWidth), h: Math.round(w.el.offsetHeight),
      };
    }
    return w._rect || { x: 0, y: 0, w: 0, h: 0 };
  }

  // Geometry snapshot for one window: rounded pixel rect + minimized flag.
  // Used by session restore (desktop.js). Returns null for an unknown id.
  geometry(id) {
    const w = this.windows.get(id);
    if (!w) return null;
    const r = this._liveRect(w);
    return { x: r.x, y: r.y, w: r.w, h: r.h, minimized: !!w.minimized };
  }

  // Apply a saved geometry to an open window (no-op on mobile sheets, where
  // windows are fixed full-screen). Safe to call with partial/odd values.
  setGeometry(id, g) {
    const w = this.windows.get(id);
    if (!w || !g) return;
    if (MOBILE()) { if (g.minimized) this._minimize(w); return; }
    if (Number.isFinite(g.x)) w.el.style.left = Math.max(0, g.x) + 'px';
    if (Number.isFinite(g.y)) w.el.style.top = Math.max(0, g.y) + 'px';
    if (Number.isFinite(g.w)) w.el.style.width = Math.max(240, g.w) + 'px';
    if (Number.isFinite(g.h)) w.el.style.height = Math.max(160, g.h) + 'px';
    this._clamp(w);
    if (g.minimized) this._minimize(w);
  }

  _emit() {
    const snap = [...this.windows.values()].map(w => {
      const r = this._liveRect(w);
      return {
        id: w.id, title: w._title, icon: w.icon, minimized: w.minimized,
        focused: w.el.style.zIndex == this.zTop,
        x: r.x, y: r.y, w: r.w, h: r.h,
      };
    });
    // On mobile, an open (non-minimized) window is a full-screen sheet that
    // should fully cover the desktop icons. Flag it on the desktop so CSS can
    // hide the icon layer. Harmless on desktop (the class only does work in the
    // mobile media query).
    const anyOpen = [...this.windows.values()].some(w => !w.minimized);
    const desktop = this.root && this.root.closest('.desktop');
    if (desktop) desktop.classList.toggle('has-open-window', anyOpen);
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
      Object.assign(el.style, {
        left: '0px', top: '0px', width: '100%',
        height: 'calc(100% - var(--taskbar-h) - env(safe-area-inset-bottom, 0px))',
      });
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

    // wiring (pointer-event based so taps work reliably on touch devices)
    onTap(el.querySelector('.win__close'), () => handle.close());
    onTap(el.querySelector('.win__min'), () => handle.minimize());
    el.addEventListener('pointerdown', () => handle.focus(), true);
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

  // "home": minimize every open window so the desktop is revealed.
  showDesktop() { this.windows.forEach(w => { if (!w.minimized) this._minimize(w); }); }

  toggleTaskItem(id) {
    const w = this.windows.get(id); if (!w) return;
    if (w.minimized) this._restore(w);
    else if (+w.el.style.zIndex === this.zTop) this._minimize(w);
    else w.focus();
  }

  _enableDrag(w) {
    const bar = w.el.querySelector('[data-drag]');
    let sx, sy, ox, oy, dragging = false;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win__btn')) return; // let button taps through
      if (MOBILE()) return;                       // sheets don't drag on mobile
      dragging = true;
      sx = e.clientX; sy = e.clientY; ox = w.el.offsetLeft; oy = w.el.offsetTop;
      bar.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      w.el.style.left = (ox + e.clientX - sx) + 'px';
      w.el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    const end = () => { if (dragging) { dragging = false; this._clamp(w); } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  _enableResize(w) {
    const grip = w.el.querySelector('[data-resize]'); if (!grip) return;
    let sx, sy, ow, oh, sizing = false;
    grip.addEventListener('pointerdown', (e) => {
      sizing = true; sx = e.clientX; sy = e.clientY; ow = w.el.offsetWidth; oh = w.el.offsetHeight;
      grip.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!sizing) return;
      w.el.style.width = Math.max(240, ow + e.clientX - sx) + 'px';
      w.el.style.height = Math.max(160, oh + e.clientY - sy) + 'px';
    });
    const end = () => { sizing = false; };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
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

// Reliable tap for mouse + touch + keyboard. On touch we act on pointerup and
// swallow the ghost click that follows; mouse and keyboard go through click.
// This avoids the dropped/delayed synthetic clicks that plague chrome buttons
// on mobile when ancestors carry non-passive touch handlers.
export function onTap(el, fn) {
  let downX = 0, downY = 0, moved = false, justTouched = false;
  el.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; moved = false; });
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) moved = true;
  });
  el.addEventListener('pointerup', (e) => {
    if (moved) return;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      justTouched = true;
      e.preventDefault();
      fn(e);
      setTimeout(() => { justTouched = false; }, 500);
    }
  });
  el.addEventListener('click', (e) => {
    if (justTouched) { justTouched = false; return; } // ignore ghost click
    fn(e);
  });
}

export const wm = new WindowManager();
