// guestbook.js - hidden easter egg: sign the wall.
// Pluggable persistence: localStorage by default (per-device), or a shared
// remote store when REMOTE_ENDPOINT is configured.
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

// ---------------------------------------------------------------------------
// REMOTE BACKEND CONFIG
// ---------------------------------------------------------------------------
// The site is a STATIC site (GitHub Pages) so there is no backend by default.
// Leave this empty to use localStorage (entries are per-device only).
//
// To share entries across all visitors, point this at any tiny JSON store
// (a Cloudflare Worker + KV, a JSONBin-style service, a Val Town val, etc).
//
// REMOTE CONTRACT (must satisfy both):
//   GET  <REMOTE_ENDPOINT>
//     -> 200, JSON body that is EITHER an array of entries
//        OR an object like { entries: [...] }.
//        Each entry: { name: string, msg: string, at: string, id?: string }
//        (extra fields are ignored; missing id is fine, one is derived).
//
//   POST <REMOTE_ENDPOINT>
//     Content-Type: application/json
//     body: a single entry { name, msg, at, id }
//     -> 200/201 on success. Response body is ignored (the UI already has the
//        entry from the optimistic write). Server SHOULD append and persist.
//
// The server is responsible for its own length caps / abuse filtering; the
// client also caps + escapes, but never trust the client.
const REMOTE_ENDPOINT = '';

// ---------------------------------------------------------------------------
const KEY = 'cozyfiles.guestbook';            // local entry cache
const RL_KEY = 'cozyfiles.guestbook.lastpost'; // rate-limit timestamp
const NAME_MAX = 40;
const MSG_MAX = 140;
const MAX_ENTRIES = 500;        // keep the local cache from growing unbounded
const RATE_LIMIT_MS = 15000;    // one post per 15s per device

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
  { name: 'ghost', msg: 'first.', at: 'long ago', id: 'seed-ghost' },
  { name: 'a stranger', msg: 'how did i get here', at: 'recently', id: 'seed-stranger' },
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Stable id for an entry so remote + local can be deduped. Uses an explicit id
// when present, otherwise derives one from the content.
function entryId(e) {
  if (e && e.id) return String(e.id);
  return `${e.at || ''}|${e.name || ''}|${e.msg || ''}`;
}

// Coerce arbitrary input into a clean entry (caps + trims). Returns null if junk.
function normalize(e) {
  if (!e || typeof e !== 'object') return null;
  const name = String(e.name ?? '').trim().slice(0, NAME_MAX);
  const msg = String(e.msg ?? '').trim().slice(0, MSG_MAX);
  if (!name || !msg) return null;
  const at = String(e.at ?? '').slice(0, 40) || stamp();
  const out = { name, msg, at };
  if (e.id) out.id = String(e.id).slice(0, 80);
  return out;
}

// Merge two lists, dedupe by id, cap length. Order is preserved as
// "a then any new-from-b", oldest-first (render reverses for newest-first).
function merge(a, b) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(a || []), ...(b || [])]) {
    const e = normalize(raw);
    if (!e) continue;
    const id = entryId(e);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out.slice(-MAX_ENTRIES);
}

// ---------------------------------------------------------------------------
// Storage adapters. Both expose async get() -> entries[] and add(entry) -> void.
// ---------------------------------------------------------------------------
const localStore = {
  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  },
  write(entries) {
    try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES))); }
    catch { /* storage full or blocked: keep in-memory only */ }
  },
  async get() {
    const cached = this.read();
    return cached === null ? SEED.slice() : cached;
  },
  async add(entry, currentList) {
    const next = merge(currentList, [entry]);
    this.write(next);
    return next;
  },
};

const remoteStore = {
  async get() {
    const res = await fetch(REMOTE_ENDPOINT, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`GET ${res.status}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
    return arr;
  },
  async add(entry) {
    const res = await fetch(REMOTE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`POST ${res.status}`);
  },
};

const REMOTE_ON = typeof REMOTE_ENDPOINT === 'string' && REMOTE_ENDPOINT.trim() !== '';

// Load entries for display. With remote on, merge remote + local cache so a
// device's own optimistic writes survive a slow/failed round-trip; on remote
// failure we degrade to the local cache. Always returns a clean, deduped list.
async function loadEntries() {
  const local = await localStore.get();
  if (!REMOTE_ON) return merge(local, []);
  try {
    const remote = await remoteStore.get();
    const combined = merge(remote, local);
    localStore.write(combined); // refresh cache with shared entries
    return combined;
  } catch {
    return merge(local, []); // offline / endpoint down: show what we have
  }
}

// Write through to the active backend. Always updates the local cache so the
// optimistic entry is durable even if the remote write fails.
async function addEntry(entry, currentList) {
  const next = await localStore.add(entry, currentList);
  if (REMOTE_ON) {
    try { await remoteStore.add(entry); }
    catch { /* keep optimistic local copy; it will sync on a later load */ }
  }
  return next;
}

// Simple per-device rate limit. Returns true if a post is allowed right now.
function rateOk() {
  try {
    const last = Number(localStorage.getItem(RL_KEY) || 0);
    return (Date.now() - last) >= RATE_LIMIT_MS;
  } catch {
    return true; // storage blocked: don't lock the user out
  }
}
function markPosted() {
  try { localStorage.setItem(RL_KEY, String(Date.now())); } catch { /* ignore */ }
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
            <input class="gb__name" type="text" maxlength="${NAME_MAX}" placeholder="name" aria-label="your name" autocomplete="off" required>
            <textarea class="gb__msg" maxlength="${MSG_MAX}" rows="2" placeholder="leave a mark (${MSG_MAX} max)" aria-label="your message" required></textarea>
            <!-- honeypot: hidden from humans, bots tend to fill it -->
            <input class="gb__hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
            <div class="gb__bar">
              <span class="gb__note" aria-live="polite"></span>
              <button class="gb__sign" type="submit">sign</button>
            </div>
          </form>
        </div>
      `;
      const list = el.querySelector('.gb__list');
      const form = el.querySelector('.gb__form');
      const nameI = el.querySelector('.gb__name');
      const msgI = el.querySelector('.gb__msg');
      const hpI = el.querySelector('.gb__hp');
      const note = el.querySelector('.gb__note');
      const signBtn = el.querySelector('.gb__sign');

      let entries = [];
      let alive = true; // guards async callbacks after the window closes

      const setNote = (txt) => { note.textContent = txt || ''; };

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

      // initial render from cache, then refresh from the active backend
      entries = merge(localStore.read() ?? SEED.slice(), []);
      renderList();
      if (REMOTE_ON) setNote('loading...');
      loadEntries().then((loaded) => {
        if (!alive) return;
        entries = loaded;
        renderList();
        setNote('');
      });

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        // honeypot tripped: silently pretend success, write nothing
        if (hpI.value) { form.reset(); return; }

        const name = nameI.value.trim();
        const msg = msgI.value.trim();
        if (!name || !msg) return;

        if (!rateOk()) {
          setNote('slow down a sec...');
          return;
        }

        const entry = {
          name: name.slice(0, NAME_MAX),
          msg: msg.slice(0, MSG_MAX),
          at: stamp(),
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        };

        // optimistic: show it immediately
        entries = merge(entries, [entry]);
        renderList();
        markPosted();
        form.reset();
        nameI.focus();
        signBtn.disabled = true;
        setNote(REMOTE_ON ? 'sending...' : '');

        try {
          const next = await addEntry(entry, entries);
          if (!alive) return;
          entries = next;
          renderList();
          setNote('');
        } catch {
          if (!alive) return;
          setNote('saved locally');
        } finally {
          if (alive) signBtn.disabled = false;
        }
      });

      // cleanup: stop async callbacks from touching a torn-down window
      const win = wm.get('guestbook');
      if (win) {
        const origClose = win.close;
        win.close = () => { alive = false; origClose(); };
      }
    },
  }),
});
