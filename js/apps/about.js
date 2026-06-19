// about.js - ABOUT.TXT (manifesto). A text-document feel: studio story + ethos.
// Cryptic but readable. Copy here is tasteful placeholder; owner swaps it later.
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// PLACEHOLDER manifesto. Each entry is one paragraph. Keep it evocative.
const PARAGRAPHS = [
  'cozyfiles is a small room with the lights left on.',
  'we are a studio, a collective, a habit. a few people who keep showing up to make things that did not exist that morning. some of it is for clients. some of it is for the drawer. the difference matters less than you would think.',
  'we like the work that is a little unfinished on purpose. the seam left showing. the cursor still blinking. a thing made by hands that were happy to be busy.',
  'nothing here is permanent. files get renamed. folders get moved. that is the point. come back later and the furniture will be somewhere new.',
];

// A short "we make:" list.
const WE_MAKE = [
  'objects, images, and sounds',
  'rooms you can click around in',
  'small machines that do one strange thing well',
  'the occasional secret',
];

// A faint, in-fiction "last modified" line. Static placeholder.
const LAST_MODIFIED = 'last modified 06.16.2026 // somewhere quiet';

// localStorage helpers, namespaced cozyfiles.about.*
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem('cozyfiles.about.' + key); return v === null ? fallback : v; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('cozyfiles.about.' + key, val); } catch { /* ignore */ }
  },
};

// Plain-text version of the document, for Copy / Select All status messaging.
function docText() {
  const lines = [
    'cozyfiles.txt',
    '============================',
    '',
    ...PARAGRAPHS,
    '',
    'we make:',
    ...WE_MAKE.map(item => '> ' + item),
    '',
    '// the rest is under construction, and always will be.',
    '',
    LAST_MODIFIED,
  ];
  return lines.join('\n');
}

function render(el, handle) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Menu definition: each top-level item owns a small dropdown of actions.
  const MENUS = [
    { id: 'file', label: 'File', items: [
      { id: 'close', label: 'Close' },
    ]},
    { id: 'edit', label: 'Edit', items: [
      { id: 'selectall', label: 'Select All' },
      { id: 'copy', label: 'Copy' },
    ]},
    { id: 'format', label: 'Format', items: [
      { id: 'wordwrap', label: 'Word Wrap', toggle: true },
      { id: 'font', label: 'System Font', toggle: true },
    ]},
    { id: 'view', label: 'View', items: [
      { id: 'crt', label: 'Green CRT Tint', toggle: true },
      { id: 'zoomin', label: 'Zoom In' },
      { id: 'zoomout', label: 'Zoom Out' },
      { id: 'zoomreset', label: 'Reset Zoom' },
    ]},
  ];

  const menuHTML = MENUS.map(m => `
    <div class="ab__menu-item" role="none">
      <button class="ab__menu-top" type="button"
        role="menuitem" aria-haspopup="true" aria-expanded="false"
        data-menu="${m.id}">${m.label}</button>
      <div class="ab__dropdown" role="menu" aria-label="${m.label}" hidden>
        ${m.items.map(it => `
          <button class="ab__menu-action" type="button" role="menuitemcheckbox"
            data-action="${it.id}" aria-checked="false">
            <span class="ab__check" aria-hidden="true"></span><span class="ab__action-label">${it.label}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="ab">
      <div class="ab__menu" role="menubar" aria-label="document menu">
        ${menuHTML}
      </div>
      <article class="ab__doc" tabindex="0" aria-label="about cozyfiles document">
        <h1 class="ab__title">cozyfiles.txt</h1>
        <div class="ab__rule" aria-hidden="true">============================</div>

        <div class="ab__body">
          ${PARAGRAPHS.map(p => `<p class="ab__p">${p}</p>`).join('')}

          <p class="ab__p ab__p--label">we make:</p>
          <ul class="ab__list">
            ${WE_MAKE.map(item => `<li>&gt; ${item}</li>`).join('')}
          </ul>

          <p class="ab__p ab__sign">// the rest is under construction, and always will be.<span class="ab__caret" aria-hidden="true">_</span></p>
        </div>
      </article>
      <div class="ab__status" role="status">${LAST_MODIFIED}</div>
    </div>
  `;

  const menubar = el.querySelector('.ab__menu');
  const doc = el.querySelector('.ab__doc');
  const body = el.querySelector('.ab__body');
  const status = el.querySelector('.ab__status');

  // Transient status message that reverts to the last-modified line.
  let statusTimer = null;
  function flash(msg) {
    if (statusTimer) clearTimeout(statusTimer);
    status.textContent = msg;
    statusTimer = setTimeout(() => { status.textContent = LAST_MODIFIED; }, 1800);
  }

  // ---- persisted toggle state ----
  let zoom = parseInt(LS.get('zoom', '0'), 10);
  if (!Number.isFinite(zoom)) zoom = 0;
  const state = {
    wordwrap: LS.get('wordwrap', '1') === '1',
    font: LS.get('font', '0') === '1',        // true = system font
    crt: LS.get('crt', '0') === '1',
  };

  function applyState() {
    body.classList.toggle('ab__body--nowrap', !state.wordwrap);
    body.classList.toggle('ab__body--sysfont', state.font);
    body.classList.toggle('ab__body--crt', state.crt);
    zoom = Math.max(-2, Math.min(4, zoom));
    body.style.fontSize = zoom === 0 ? '' : `calc(var(--fs-body) + ${zoom * 2}px)`;
    // reflect checked state on toggle actions
    setChecked('wordwrap', state.wordwrap);
    setChecked('font', state.font);
    setChecked('crt', state.crt);
  }
  function setChecked(action, on) {
    const btn = el.querySelector(`.ab__menu-action[data-action="${action}"]`);
    if (btn) btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  // ---- dropdown open/close ----
  function openMenu(top) {
    closeMenus();
    top.setAttribute('aria-expanded', 'true');
    const dd = top.nextElementSibling;
    if (dd) {
      dd.hidden = false;
      const first = dd.querySelector('.ab__menu-action');
      if (first) first.focus();
    }
  }
  function closeMenus(focusTop) {
    menubar.querySelectorAll('.ab__menu-top').forEach(t => t.setAttribute('aria-expanded', 'false'));
    menubar.querySelectorAll('.ab__dropdown').forEach(d => { d.hidden = true; });
    if (focusTop) focusTop.focus();
  }
  function anyOpen() {
    return !!menubar.querySelector('.ab__menu-top[aria-expanded="true"]');
  }

  // top-level button: toggle its dropdown
  menubar.querySelectorAll('.ab__menu-top').forEach(top => {
    top.addEventListener('click', (e) => {
      e.stopPropagation();
      if (top.getAttribute('aria-expanded') === 'true') closeMenus();
      else openMenu(top);
    });
  });

  // ---- action dispatch ----
  async function copyText() {
    const text = docText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to legacy path */ }
    // graceful fallback: hidden textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function selectAll() {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(body);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch { return false; }
  }

  async function runAction(action) {
    switch (action) {
      case 'close':
        if (handle && typeof handle.close === 'function') handle.close();
        return;
      case 'selectall':
        flash(selectAll() ? 'selected all' : 'select failed');
        break;
      case 'copy': {
        const ok = await copyText();
        flash(ok ? 'copied to clipboard' : 'copy unavailable');
        break;
      }
      case 'wordwrap':
        state.wordwrap = !state.wordwrap; LS.set('wordwrap', state.wordwrap ? '1' : '0');
        applyState(); flash('word wrap ' + (state.wordwrap ? 'on' : 'off'));
        break;
      case 'font':
        state.font = !state.font; LS.set('font', state.font ? '1' : '0');
        applyState(); flash(state.font ? 'system font' : 'monospace font');
        break;
      case 'crt':
        state.crt = !state.crt; LS.set('crt', state.crt ? '1' : '0');
        applyState(); flash('crt tint ' + (state.crt ? 'on' : 'off'));
        break;
      case 'zoomin':
        zoom++; LS.set('zoom', String(zoom)); applyState(); flash('zoom ' + zoom);
        break;
      case 'zoomout':
        zoom--; LS.set('zoom', String(zoom)); applyState(); flash('zoom ' + zoom);
        break;
      case 'zoomreset':
        zoom = 0; LS.set('zoom', '0'); applyState(); flash('zoom reset');
        break;
    }
  }

  menubar.querySelectorAll('.ab__menu-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const isToggle = btn.getAttribute('role') === 'menuitemcheckbox' &&
        ['wordwrap', 'font', 'crt'].includes(action);
      await runAction(action);
      // keep toggles open for quick repeat tweaks; close one-shot actions
      if (!isToggle) closeMenus();
    });
  });

  // ---- keyboard accessibility ----
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (anyOpen()) { const open = menubar.querySelector('.ab__menu-top[aria-expanded="true"]'); closeMenus(open); e.stopPropagation(); }
      return;
    }
    const inMenu = e.target.closest && e.target.closest('.ab__menu');
    if (!inMenu) return;

    const tops = [...menubar.querySelectorAll('.ab__menu-top')];
    const top = e.target.closest('.ab__menu-item')?.querySelector('.ab__menu-top');

    if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ab__menu-top')) {
      e.preventDefault();
      openMenu(e.target);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const i = tops.indexOf(top);
      if (i === -1) return;
      const next = tops[(i + (e.key === 'ArrowRight' ? 1 : tops.length - 1)) % tops.length];
      if (anyOpen()) openMenu(next); else next.focus();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.classList.contains('ab__menu-action')) {
      e.preventDefault();
      const actions = [...e.target.closest('.ab__dropdown').querySelectorAll('.ab__menu-action')];
      const i = actions.indexOf(e.target);
      const next = actions[(i + (e.key === 'ArrowDown' ? 1 : actions.length - 1)) % actions.length];
      next.focus();
    }
  });

  // click outside closes any open menu
  const onDocPointer = (e) => { if (!e.target.closest || !e.target.closest('.ab__menu')) closeMenus(); };
  document.addEventListener('pointerdown', onDocPointer, true);
  el.closest('.win')?.addEventListener('animationstart', (e) => {
    if (e.animationName && /clos/i.test(e.animationName)) {
      document.removeEventListener('pointerdown', onDocPointer, true);
    }
  });

  applyState();

  // Tasteful reveal: fade each block in sequence. Skipped for reduced motion.
  const blocks = [...el.querySelectorAll('.ab__p, .ab__list')];
  if (reduced) {
    blocks.forEach(b => b.classList.add('is-in'));
    return;
  }

  const timers = [];
  blocks.forEach((b, i) => {
    timers.push(setTimeout(() => b.classList.add('is-in'), 90 * i));
  });

  // Stop pending reveals if the window closes mid-animation.
  el.closest('.win')?.addEventListener('animationstart', (e) => {
    if (e.animationName && /clos/i.test(e.animationName)) timers.forEach(clearTimeout);
  });
}

registerApp({
  id: 'about', name: 'ABOUT.TXT', icon: '📄', desktop: true,
  open: () => wm.open({
    id: 'about', title: 'ABOUT.TXT', icon: '📄', width: 460, height: 400,
    className: 'app-about',
    render,
  }),
});
