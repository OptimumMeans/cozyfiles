// gate.js — the cryptic gate + boot transition. Resolves when the user enters.

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

export function runGate() {
  return new Promise((resolve) => {
    const gate = document.getElementById('gate');
    const enterBtn = document.getElementById('gate-enter');

    let entered = false;
    const enter = () => {
      if (entered) return;
      entered = true;
      window.removeEventListener('keydown', onKey);
      gate.classList.add('is-leaving');
      setTimeout(() => { gate.hidden = true; boot().then(resolve); }, reduced() ? 100 : 450);
    };
    const onKey = (e) => { if (e.key === 'Enter') enter(); };

    window.addEventListener('keydown', onKey);
    enterBtn.addEventListener('click', enter);
    // hidden hotspot: clicking the glyph also enters
    gate.querySelector('.gate__glyph').addEventListener('click', enter);
  });
}

function boot() {
  return new Promise((resolve) => {
    const bootEl = document.getElementById('boot');
    const log = document.getElementById('boot-log');
    bootEl.hidden = false;
    log.textContent = '';

    if (reduced()) {
      log.textContent = BOOT_LINES.join('\n');
      setTimeout(() => { bootEl.hidden = true; resolve(); }, 300);
      return;
    }

    let i = 0;
    const total = +getComputedStyle(document.documentElement)
      .getPropertyValue('--boot-ms').trim().replace('ms', '') || 2000;
    const per = Math.max(120, total / BOOT_LINES.length);
    const tick = () => {
      if (i < BOOT_LINES.length) {
        log.textContent += (i ? '\n' : '') + BOOT_LINES[i];
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
