// credits.js - CREDITS. A tidy, on-brand roll call of the cozyfiles team and
// collaborators, with links. Either a retro "rolling credits" crawl (fine
// pointer, motion allowed) or a clean static list when reduced motion is on or
// the visitor pauses. Everything below comes from small inline data arrays the
// owner edits later - no backend, no build step.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// ---- editable data -------------------------------------------------------
// One entry per person. "links" is a small list of { label, href }. Owner
// swaps these for real profiles. Keep copy warm, lowercase, zero em dashes.
const PEOPLE = [
  {
    name: 'Cam',
    role: 'cozyfiles - founder / creative',
    note: 'keeps the lights on and the cursor blinking.',
    links: [
      { label: 'github', href: 'https://github.com/OptimumMeans' },
      { label: 'site', href: 'https://cozyfiles.us/' },
    ],
  },
  {
    name: 'ztrafe',
    role: 'collaborator',
    note: 'sounds, ideas, and the occasional secret.',
    links: [
      { label: 'github', href: 'https://github.com/ztrafe' },
    ],
  },
];

// A short "with thanks to" list - bit-players, tools, good company.
const THANKS = [
  'everyone who booted the desktop and stayed a while',
  'the open web, for letting a room like this exist',
  'late nights and the people who kept them company',
];

// Closing card under the roll. Static placeholder, owner edits later.
const COLOPHON = 'made in a small room with the lights left on.';
const STUDIO = 'cozyfiles';
const YEAR = '2026';

// ---- helpers -------------------------------------------------------------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render the link row for a person. External links open in a new tab; the
// in-app "site" link still opens normally. rel hardening on every anchor.
function linksHTML(links) {
  if (!links || !links.length) return '';
  return `<span class="cr__links">${links.map(l => `
    <a class="cr__link" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>
  `).join('<span class="cr__linksep" aria-hidden="true">/</span>')}</span>`;
}

function personHTML(p) {
  return `
    <li class="cr__person">
      <span class="cr__name">${esc(p.name)}</span>
      <span class="cr__role">${esc(p.role)}</span>
      ${p.note ? `<span class="cr__note">${esc(p.note)}</span>` : ''}
      ${linksHTML(p.links)}
    </li>`;
}

// The full scrolling reel markup (one block, animated as a unit).
function reelHTML() {
  return `
    <div class="cr__reel">
      <p class="cr__brand">${esc(STUDIO)}</p>
      <p class="cr__sub">// credits</p>

      <p class="cr__section">cast</p>
      <ul class="cr__people">${PEOPLE.map(personHTML).join('')}</ul>

      <p class="cr__section">with thanks to</p>
      <ul class="cr__thanks">${THANKS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>

      <p class="cr__colophon">${esc(COLOPHON)}</p>
      <p class="cr__copy">(c) ${esc(YEAR)} ${esc(STUDIO)}</p>
    </div>`;
}

function render(el, handle) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.innerHTML = `
    <div class="cr">
      <div class="cr__stage" tabindex="0" aria-label="cozyfiles credits">
        ${reelHTML()}
      </div>
      <div class="cr__bar">
        <button class="cr__btn" type="button" data-act="toggle" aria-pressed="false">
          ${reduced ? 'static list' : 'pause'}
        </button>
        <button class="cr__btn" type="button" data-act="restart">restart</button>
        <span class="cr__hint" role="status">${reduced ? 'reduced motion - static list' : 'rolling'}</span>
      </div>
    </div>`;

  const stage = el.querySelector('.cr__stage');
  const reel = el.querySelector('.cr__reel');
  const toggleBtn = el.querySelector('[data-act="toggle"]');
  const restartBtn = el.querySelector('[data-act="restart"]');
  const hint = el.querySelector('.cr__hint');

  // "rolling" = crawl animation runs. When false we show the tidy static list
  // (the same content, no transform). Reduced motion starts static and the
  // toggle flips it back to a roll only if the visitor opts in.
  let rolling = !reduced;

  function applyMode() {
    stage.classList.toggle('is-rolling', rolling);
    stage.classList.toggle('is-static', !rolling);
    toggleBtn.textContent = rolling ? 'pause' : 'play';
    toggleBtn.setAttribute('aria-pressed', String(!rolling));
    restartBtn.disabled = !rolling;
    hint.textContent = rolling ? 'rolling' : (reduced ? 'reduced motion - static list' : 'paused - static list');
  }

  // Restart the crawl from the bottom by re-triggering the CSS animation.
  function restart() {
    if (!rolling) return;
    reel.classList.remove('cr__reel--run');
    // force reflow so the animation restarts cleanly
    void reel.offsetWidth;
    reel.classList.add('cr__reel--run');
  }

  onTap(toggleBtn, () => {
    rolling = !rolling;
    applyMode();
    if (rolling) restart();
  });
  onTap(restartBtn, restart);

  // Click the stage to pause/resume (a classic "tap the screen" affordance).
  // Ignore clicks that land on a link so the link still opens.
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (reduced) return; // keep it static for reduced-motion visitors
    rolling = !rolling;
    applyMode();
    if (rolling) restart();
  });

  // Keyboard: space toggles, r restarts (when the stage is focused).
  stage.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (reduced) return;
      rolling = !rolling; applyMode(); if (rolling) restart();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault(); restart();
    }
  });

  applyMode();
  if (rolling) reel.classList.add('cr__reel--run');
}

registerApp({
  id: 'credits', name: 'CREDITS', icon: '🎬', desktop: true,
  open: () => wm.open({
    id: 'credits', title: 'CREDITS', icon: '🎬', width: 440, height: 420,
    className: 'app-credits',
    render,
  }),
});
