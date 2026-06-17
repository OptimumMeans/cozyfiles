// recycle.js - the Recycle Bin. Two layers:
//  1) real round-trip: files deleted from FILES.EXE land here (shared via
//     localStorage 'cozyfiles.files.recycle'); Restore returns them, Empty
//     clears them. Restored files reappear in their FILES folder.
//  2) gag seed: a few permanently "double-deleted" joke files for flavor.
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

const RECYCLE_KEY = 'cozyfiles.files.recycle';

// permanent gag files - not restorable, just for the bit
const GAGS = [
  { name: 'old_logo_final_FINAL_v7.png', gag: 'restored 0 times. still ugly.' },
  { name: 'passwords.txt', gag: 'nice try. it was empty anyway.' },
  { name: 'the_real_homepage.html', gag: 'this was the homepage once. it cried.' },
  { name: 'client_feedback.eml', gag: '"can you make the logo bigger" x40' },
  { name: 'budget_q3.xls', gag: 'shredded for emotional reasons.' },
];

function readBin() {
  try {
    const raw = localStorage.getItem(RECYCLE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_e) { return []; }
}
const RECYCLE_EVENT = 'cozyfiles:recycle';
function writeBin(list) {
  try { localStorage.setItem(RECYCLE_KEY, JSON.stringify(list)); } catch (_e) { /* ignore */ }
  // same-tab signal so an open FILES window refreshes (storage event is
  // cross-tab only).
  try { window.dispatchEvent(new CustomEvent(RECYCLE_EVENT)); } catch (_e) { /* old browsers */ }
}

function escapeText(el, text) { el.textContent = text; }

registerApp({
  id: 'recycle', name: 'recycle bin', icon: '🗑️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'recycle', title: 'recycle bin', icon: '🗑️', width: 460, height: 360,
    className: 'app-recycle',
    render: (el) => {
      el.innerHTML = `
        <div class="rb">
          <div class="rb__bar">
            <span class="rb__count"></span>
            <button class="rb__empty" type="button">empty bin</button>
          </div>
          <ul class="rb__list"></ul>
          <p class="rb__say" aria-live="polite"></p>
        </div>
      `;
      const listEl = el.querySelector('.rb__list');
      const countEl = el.querySelector('.rb__count');
      const sayEl = el.querySelector('.rb__say');
      const emptyBtn = el.querySelector('.rb__empty');

      const say = (text) => { sayEl.textContent = text; };

      const render = () => {
        const deleted = readBin();           // real, restorable
        const total = deleted.length + GAGS.length;
        countEl.textContent = total
          ? `${total} item${total === 1 ? '' : 's'} in bin`
          : 'bin is empty';
        listEl.innerHTML = '';

        // real deleted files first (restorable)
        deleted.forEach((it) => {
          const li = document.createElement('li');
          li.className = 'rb__item rb__item--real';

          const file = document.createElement('span');
          file.className = 'rb__file';
          file.innerHTML = '<span class="rb__ico" aria-hidden="true">🗎</span>';
          const label = document.createElement('span');
          label.className = 'rb__name';
          escapeText(label, it.name || it.title || it.slug || 'file');
          file.appendChild(label);
          const from = document.createElement('span');
          from.className = 'rb__from';
          escapeText(from, it._folder ? `from ${String(it._folder).toUpperCase()}` : '');
          file.appendChild(from);

          const restore = document.createElement('button');
          restore.type = 'button';
          restore.className = 'rb__restore';
          restore.textContent = 'restore';
          restore.addEventListener('click', () => {
            const bin = readBin().filter(x => x.slug !== it.slug);
            writeBin(bin);
            say(`restored ${it.name}. it is back where it belongs.`);
            render();
          });

          li.appendChild(file);
          li.appendChild(restore);
          listEl.appendChild(li);
        });

        // permanent gag files (click for a quip, no restore)
        GAGS.forEach((it) => {
          const li = document.createElement('li');
          li.className = 'rb__item';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'rb__file';
          btn.innerHTML = '<span class="rb__ico" aria-hidden="true">🗎</span>';
          const label = document.createElement('span');
          label.className = 'rb__name';
          escapeText(label, it.name);
          btn.appendChild(label);
          btn.addEventListener('click', () => say(it.gag));
          li.appendChild(btn);
          listEl.appendChild(li);
        });
      };

      emptyBtn.addEventListener('click', () => {
        const had = readBin().length;
        if (!had) { say('nothing of yours to empty. the gag files are forever.'); return; }
        writeBin([]);
        render();
        say('poof. your deleted files are gone for good. the gag files remain.');
      });

      // keep the bin live if FILES deletes a file while this is open.
      // same-tab via custom event, other tabs via the storage event.
      const onLocal = () => render();
      const onStorage = (e) => { if (e.key === RECYCLE_KEY) render(); };
      window.addEventListener(RECYCLE_EVENT, onLocal);
      window.addEventListener('storage', onStorage);
      const handle = wm.get('recycle');
      if (handle) {
        const origClose = handle.close;
        handle.close = () => {
          window.removeEventListener(RECYCLE_EVENT, onLocal);
          window.removeEventListener('storage', onStorage);
          origClose();
        };
      }

      say('deleted from FILES lands here. restore sends it home.');
      render();
    },
  }),
});
