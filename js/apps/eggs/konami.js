// konami.js - global keydown listener for the konami code that triggers an
// on-brand "party mode": a brief lime glitch wash over the whole OS plus a
// rain of falling cozyfiles glyphs. Self-installs on import. Idempotent (guards
// against double-install), self-cleaning (every effect tears itself down), and
// leaks nothing - no globals, no dangling timers, no orphaned nodes.
//
// NOTE: secrets.js owns a SEPARATE konami listener that opens the terminal.
// The two coexist on purpose: enter the code on the desktop and you get the
// terminal AND the party. This module also answers a `cozyfiles:party`
// CustomEvent so the terminal's hidden `party` command can fire the same gag.

const SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

const STYLE_ID = 'konami-party-style';
const FLAG = '__cozyfilesKonamiInstalled';

// glyphs that rain during the party (kept literal + short so nothing escapes)
const GLYPHS = ['c', 'o', 'z', 'y', '0', '1', '*', '+', '<', '>', '/', '.'];

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .konami-party {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: var(--z-crt, 10000);
      overflow: hidden;
    }
    .konami-party__flash {
      position: absolute;
      inset: 0;
      background: var(--accent, #b6ff3c);
      mix-blend-mode: screen;
      opacity: 0;
      animation: konami-flash 700ms ease-out forwards;
    }
    .konami-drop {
      position: absolute;
      top: -8%;
      font-family: var(--font-mono, monospace);
      font-size: 20px;
      color: var(--accent, #b6ff3c);
      text-shadow: 0 0 6px var(--accent, #b6ff3c);
      opacity: 0.9;
      will-change: transform;
      animation: konami-fall linear forwards;
    }
    @keyframes konami-flash {
      0%   { opacity: 0; }
      18%  { opacity: 0.5; }
      100% { opacity: 0; }
    }
    @keyframes konami-fall {
      to { transform: translateY(118vh); }
    }
    @media (prefers-reduced-motion: reduce) {
      .konami-party__flash { animation-duration: 300ms; }
      .konami-drop { display: none; }
    }
  `;
  document.head.appendChild(style);
}

let partyActive = false;

function party() {
  // ignore re-triggers while a party is already running (idempotent)
  if (partyActive) return;
  partyActive = true;
  injectStyle();

  const layer = document.createElement('div');
  layer.className = 'konami-party';
  layer.setAttribute('aria-hidden', 'true');

  const flash = document.createElement('div');
  flash.className = 'konami-party__flash';
  layer.appendChild(flash);

  document.body.appendChild(layer);

  const reduce =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let spawnTimer = 0;
  if (!reduce) {
    spawnTimer = setInterval(() => {
      const drop = document.createElement('span');
      drop.className = 'konami-drop';
      drop.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      drop.style.left = Math.random() * 100 + 'vw';
      drop.style.fontSize = 14 + Math.floor(Math.random() * 18) + 'px';
      const dur = 1.6 + Math.random() * 1.8;
      drop.style.animationDuration = dur + 's';
      drop.addEventListener('animationend', () => drop.remove(), { once: true });
      layer.appendChild(drop);
    }, 70);
  }

  // tear everything down after the party window closes
  const lifespan = reduce ? 600 : 2600;
  setTimeout(() => {
    if (spawnTimer) clearInterval(spawnTimer);
    layer.remove();
    partyActive = false;
  }, lifespan);
}

function install() {
  // guard against a second import / double install
  if (window[FLAG]) return;
  window[FLAG] = true;

  let pos = 0;
  document.addEventListener('keydown', (e) => {
    // do not capture sequence keys while the visitor is typing in a field
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      pos = 0;
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === SEQUENCE[pos]) {
      pos += 1;
      if (pos === SEQUENCE.length) { pos = 0; party(); }
    } else {
      // allow restarting mid-stream if this key is the first of the sequence
      pos = (key === SEQUENCE[0]) ? 1 : 0;
    }
  });

  // the terminal's hidden `party` command dispatches this event
  window.addEventListener('cozyfiles:party', party);
}

install();
