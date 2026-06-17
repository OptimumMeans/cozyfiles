// gate.js - the cryptic gate + fake login + boot transition.
// Resolves when the user logs in. Drives new login UI by manipulating the
// existing #gate markup from index.html (we never edit index.html itself).

const LS = {
  user: 'cozyfiles.os.user',
  lastVisit: 'cozyfiles.os.lastVisit',
};

const BOOT_LINES = [
  'cozyOS v0.1 ......... ok',
  'mounting /cozyfiles ......... ok',
  'loading creative drivers ......... ok',
  'decrypting manifest ......... ok',
  'summoning desktop ......... ok',
  '',
  'welcome.',
];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- persistence helpers ------------------------------------------------
function getUser() {
  try { return localStorage.getItem(LS.user) || ''; } catch { return ''; }
}
function setUser(name) {
  try { localStorage.setItem(LS.user, name); } catch { /* storage blocked */ }
}
function getLastVisit() {
  try {
    const v = +localStorage.getItem(LS.lastVisit);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}
function stampVisit() {
  try { localStorage.setItem(LS.lastVisit, String(Date.now())); } catch { /* ignore */ }
}

// Generate a default handle like guest_4f7a.
function generateHandle() {
  let rand = Math.floor(Math.random() * 0xffff).toString(16);
  while (rand.length < 4) rand = '0' + rand;
  return `guest_${rand}`;
}

// Keep handles tame: lowercase, safe characters, bounded length. This is the
// stored form; rendering still escapes it as a second line of defense.
function sanitizeHandle(raw) {
  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-.]/g, '')
    .slice(0, 20);
  return cleaned;
}

// Escape for safe insertion as HTML text (no injection from stored handles).
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Human-friendly relative time, falling back to an absolute stamp for old visits.
function relTime(then) {
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? '' : 's'} ago`;
  const d = new Date(then);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ------------------------------------------------------------------------
export function runGate() {
  return new Promise((resolve) => {
    const gate = document.getElementById('gate');
    const inner = gate.querySelector('.gate__inner');
    const existingUser = getUser();
    const lastVisit = getLastVisit();

    // Build the login panel inside the existing gate shell. We keep the cube
    // mark + wordmark (already in the markup) and append a login block, then
    // swap the old "press enter" button for our login form.
    const oldEnter = document.getElementById('gate-enter');
    if (oldEnter) oldEnter.remove();

    const login = document.createElement('div');
    login.className = 'gate__login';

    if (existingUser) {
      // Returning visitor: greet + show last-visit line, single sign-in button.
      login.innerHTML = `
        <p class="gate__line gate__line--greet">welcome back, <b>${esc(existingUser)}</b></p>
        <p class="gate__line gate__line--last">${
          lastVisit ? `last login: ${esc(relTime(lastVisit))}` : 'last login: unknown'
        }</p>
        <div class="gate__loginrow">
          <button id="gate-enter" class="gate__enter" type="button">sign in</button>
          <button id="gate-switch" class="gate__switch" type="button">not you?</button>
        </div>
        <p class="gate__hint">press enter to continue</p>
      `;
    } else {
      // First visit: let them choose a handle (default suggested).
      const suggested = generateHandle();
      login.innerHTML = `
        <p class="gate__line gate__line--greet">new session - choose a handle</p>
        <form id="gate-form" class="gate__form" autocomplete="off">
          <span class="gate__prompt" aria-hidden="true">cozyOS login:</span>
          <input id="gate-handle" class="gate__input" type="text" name="handle"
                 maxlength="20" spellcheck="false" autocapitalize="off"
                 inputmode="latin" aria-label="choose a handle"
                 placeholder="${esc(suggested)}" value="" />
          <button id="gate-enter" class="gate__enter" type="submit">log in</button>
        </form>
        <p class="gate__hint">leave blank for a guest handle</p>
      `;
      login._suggested = suggested;
    }

    inner.appendChild(login);

    let entered = false;
    const finish = (name) => {
      if (entered) return;
      entered = true;
      setUser(name);
      stampVisit();
      window.removeEventListener('keydown', onKey);
      gate.classList.add('is-leaving');
      setTimeout(() => { gate.hidden = true; boot(name).then(resolve); }, reduced() ? 100 : 450);
    };

    let onKey = () => {};

    if (existingUser) {
      const enterBtn = login.querySelector('#gate-enter');
      const switchBtn = login.querySelector('#gate-switch');
      enterBtn.addEventListener('click', () => finish(existingUser));
      gate.querySelector('.gate__mark').addEventListener('click', () => finish(existingUser));
      onKey = (e) => { if (e.key === 'Enter' && !entered) finish(existingUser); };
      window.addEventListener('keydown', onKey);

      // "not you?" forgets the saved handle and rebuilds the gate as first-visit.
      switchBtn.addEventListener('click', () => {
        setUser('');
        window.removeEventListener('keydown', onKey);
        login.remove();
        // Re-run on the now-empty user so the chooser appears in place.
        runGate().then(resolve);
        entered = true; // prevent this closure from also resolving
      });
    } else {
      const form = login.querySelector('#gate-form');
      const input = login.querySelector('#gate-handle');
      const submit = () => {
        const chosen = sanitizeHandle(input.value) || login._suggested;
        finish(chosen);
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      // Clicking the cube mark accepts the suggested/typed handle too.
      gate.querySelector('.gate__mark').addEventListener('click', submit);
      // Focus the input so a returning-but-cleared user can type immediately.
      setTimeout(() => { try { input.focus(); } catch { /* ignore */ } }, reduced() ? 0 : 500);
    }
  });
}

function boot(name) {
  return new Promise((resolve) => {
    const bootEl = document.getElementById('boot');
    const log = document.getElementById('boot-log');
    bootEl.hidden = false;
    log.textContent = '';

    // Personalize the boot log with the session handle.
    const lines = BOOT_LINES.slice();
    if (name) {
      lines[lines.length - 1] = `welcome, ${name}.`;
      lines.splice(lines.length - 1, 0, `authenticating ${name} ......... ok`);
    }

    if (reduced()) {
      log.textContent = lines.join('\n');
      setTimeout(() => { bootEl.hidden = true; resolve(); }, 300);
      return;
    }

    let i = 0;
    const total = +getComputedStyle(document.documentElement)
      .getPropertyValue('--boot-ms').trim().replace('ms', '') || 2000;
    const per = Math.max(120, total / lines.length);
    const tick = () => {
      if (i < lines.length) {
        log.textContent += (i ? '\n' : '') + lines[i];
        i++;
        setTimeout(tick, per);
      } else {
        bootEl.classList.add('is-done');
        setTimeout(() => { bootEl.hidden = true; bootEl.classList.remove('is-done'); resolve(); }, 350);
      }
    };
    tick();
  });
}
