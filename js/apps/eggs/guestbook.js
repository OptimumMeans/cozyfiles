// guestbook.js - hidden easter egg: sign the guestbook, persists in localStorage.
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

const KEY = 'cozyfiles.guestbook';

// escape any user-supplied text before it touches the DOM (XSS guard)
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEED = [
  { name: 'ghost', msg: 'first.', at: 'long ago' },
  { name: 'a stranger', msg: 'how did i get here', at: 'recently' },
];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SEED.slice();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : SEED.slice();
  } catch {
    return SEED.slice();
  }
}

function save(entries) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); }
  catch { /* storage full or blocked: keep in-memory only */ }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

registerApp({
  id: 'guestbook', name: 'guestbook', icon: '📓', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'guestbook', title: 'guestbook', icon: '📓', width: 440, height: 380,
    className: 'app-guestbook',
    render: (el) => {
      el.innerHTML = `
        <div class="gb">
          <h2 class="gb__title">sign the wall</h2>
          <ul class="gb__list" aria-live="polite"></ul>
          <form class="gb__form" novalidate>
            <input class="gb__name" type="text" maxlength="40" placeholder="name" aria-label="your name" required>
            <textarea class="gb__msg" maxlength="140" rows="2" placeholder="leave a mark (140 max)" aria-label="your message" required></textarea>
            <button class="gb__sign" type="submit">sign</button>
          </form>
        </div>
      `;
      const list = el.querySelector('.gb__list');
      const form = el.querySelector('.gb__form');
      const nameI = el.querySelector('.gb__name');
      const msgI = el.querySelector('.gb__msg');

      let entries = load();

      const renderList = () => {
        list.innerHTML = '';
        if (!entries.length) {
          const li = document.createElement('li');
          li.className = 'gb__empty';
          li.textContent = 'nobody has signed yet. be the first.';
          list.appendChild(li);
          return;
        }
        // newest first
        entries.slice().reverse().forEach((e) => {
          const li = document.createElement('li');
          li.className = 'gb__entry';
          li.innerHTML =
            `<div class="gb__row"><span class="gb__who">${esc(e.name)}</span>` +
            `<span class="gb__at">${esc(e.at || '')}</span></div>` +
            `<div class="gb__text">${esc(e.msg)}</div>`;
          list.appendChild(li);
        });
      };

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = nameI.value.trim();
        const msg = msgI.value.trim();
        if (!name || !msg) return;
        entries.push({ name: name.slice(0, 40), msg: msg.slice(0, 140), at: stamp() });
        save(entries);
        renderList();
        form.reset();
        nameI.focus();
      });

      renderList();
    },
  }),
});
