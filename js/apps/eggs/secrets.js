// secrets.js - discovery triggers for the hidden easter eggs.
// Runs on import (imported by main.js). All listeners attach after the DOM is
// ready and the #desktop element exists, so it is safe at any load order.
//
// TWO WAYS TO FIND THE TERMINAL (which then unlocks the other eggs):
//   1. KONAMI CODE: up up down down left right left right b a
//      (typed anywhere on the page) -> opens the terminal.
//   2. HIDDEN HOTSPOT: a tiny, nearly invisible pixel in the BOTTOM-RIGHT
//      corner of the desktop. Click it -> opens the terminal.
//      On desktop this stays an 8x8px dim pixel (subtle, easy to miss).
//      On touch / small screens (the konami code is keyboard-only and so is
//      useless on a phone) the tap zone grows to ~28px so it is actually
//      hittable with a thumb, while staying just as faint/invisible.
// From the terminal, the commands `guestbook`, `notepad`, and `bin`/`recycle`
// open the remaining eggs.
import { openApp } from '../../desktop.js';

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

function wireKonami() {
  let pos = 0;
  document.addEventListener('keydown', (e) => {
    // ignore while typing into a field (the terminal/guestbook inputs)
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { pos = 0; return; }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[pos]) {
      pos += 1;
      if (pos === KONAMI.length) { pos = 0; openApp('terminal'); }
    } else {
      // allow a fresh start if this key is the first of the sequence
      pos = (key === KONAMI[0]) ? 1 : 0;
    }
  });
}

// Inject the hotspot's sizing rule once. The base size is a tiny 8x8 desktop
// pixel; on touch / small screens the tap zone grows to ~28px (still faint,
// still pinned to the corner) so a thumb can actually find it without the
// keyboard-only konami code. Opacity stays low so it is never obvious.
function injectHotspotStyle() {
  if (document.getElementById('secret-hotspot-style')) return;
  const style = document.createElement('style');
  style.id = 'secret-hotspot-style';
  style.textContent = `
    .secret-hotspot {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 8px;
      height: 8px;
      padding: 0;
      border: none;
      background: var(--accent);
      opacity: 0.12;
      cursor: default;
      z-index: var(--z-desktop);
    }
    @media (max-width: 640px), (hover: none) and (pointer: coarse) {
      .secret-hotspot { width: 28px; height: 28px; }
    }
  `;
  document.head.appendChild(style);
}

function wireHotspot(desktop) {
  if (!desktop || desktop.querySelector('.secret-hotspot')) return;
  injectHotspotStyle();
  const spot = document.createElement('button');
  spot.type = 'button';
  spot.className = 'secret-hotspot';
  spot.setAttribute('aria-label', 'a hidden door');
  spot.setAttribute('tabindex', '-1');
  spot.addEventListener('click', () => openApp('terminal'));
  desktop.appendChild(spot);
}

function init() {
  wireKonami();
  wireHotspot(document.getElementById('desktop'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
