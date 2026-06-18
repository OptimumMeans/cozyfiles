// plugin-ui.js — reusable plugin-skin UI primitives for cozyfiles apps.
// CSS: css/apps/plugin.css (.plugin__, .plugin-led, .plugin-vu, …)
// First consumer: the deck. Future plugins (roster, etc.) should reuse this shell.

export const VU_SEGMENTS = 12;

/** LED dot — lights when .is-live (matches boot-sequence functional color rule). */
export function createPluginLed({ live = false } = {}) {
  const led = document.createElement('span');
  led.className = 'plugin-led' + (live ? ' is-live' : '');
  led.setAttribute('aria-hidden', 'true');
  return led;
}

export function setPluginLed(led, live) {
  led.classList.toggle('is-live', !!live);
}

/** Vertical VU ladder — update levels via updatePluginVu(). */
export function createPluginVuMeter() {
  const vu = document.createElement('div');
  vu.className = 'plugin-vu';
  vu.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < VU_SEGMENTS; i++) {
    const tier = i >= VU_SEGMENTS - 1 ? 'peak' : i >= VU_SEGMENTS - 4 ? 'high' : 'low';
    const seg = document.createElement('div');
    seg.className = 'plugin-vu__seg';
    seg.dataset.tier = tier;
    vu.appendChild(seg);
  }
  return vu;
}

export function updatePluginVu(vu, level) {
  vu.querySelectorAll('.plugin-vu__seg').forEach((seg, i) => {
    seg.classList.toggle('is-lit', i < level);
  });
}

/** Dense irregular bar waveform (from boot DAW region renderer). */
export function drawIrregularWaveform(canvas, { seed = 1, density = 1 } = {}) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.floor(rect.width));
  const h = Math.max(2, Math.floor(rect.height));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#e8e6df';
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--ink-dim').trim() || '#888888';
  const zoom = Math.max(0.45, Math.min(1.6, density));
  const barPitch = 3 / zoom;
  const minBars = zoom < 0.75 ? 8 : zoom < 1 ? 14 : 20;
  const barCount = Math.max(minBars, Math.floor(w / barPitch));
  const barW = Math.max(1, (w / barCount) * 0.7);
  const gap = Math.max(0.4, (w / barCount) * 0.3);
  const rand = seededRandom(seed);

  const bases = Array.from({ length: barCount }, () => {
    const roll = rand();
    if (roll < 0.3) return 0.05 + rand() * 0.14;
    if (roll < 0.45) return 0.7 + rand() * 0.3;
    return 0.15 + rand() * 0.5;
  });

  let x = 0;
  for (let i = 0; i < barCount; i++) {
    const bh = Math.max(1, bases[i] * h * 0.88);
    ctx.fillStyle = i % 4 === 0 ? ink : dim;
    ctx.globalAlpha = 0.3 + (bh / h) * 0.5;
    ctx.fillRect(x, h - bh, barW, bh);
    x += barW + gap;
  }
  ctx.globalAlpha = 1;
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Plugin chrome header: cozyfiles mark + plugin name + version tag.
 * Reuse for any future plugin-skinned app.
 */
export function createPluginHeader({ name, version = 'v1.0' } = {}) {
  const header = document.createElement('header');
  header.className = 'plugin__header';
  header.innerHTML = `
    <div class="plugin__brand">
      <span class="plugin__mark" aria-hidden="true"></span>
      <span class="plugin__name">${name}</span>
    </div>
    <span class="plugin__version" aria-hidden="true">${version}</span>
  `;
  return header;
}

/**
 * Mount the standard plugin layout skeleton:
 *   header | workspace (rail + main display) | transport strip
 * Returns element refs for the app to populate.
 */
export function mountPluginShell(container, { name, version = 'v1.0' } = {}) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'plugin';

  const header = createPluginHeader({ name, version });
  const workspace = document.createElement('div');
  workspace.className = 'plugin__workspace';

  const rail = document.createElement('nav');
  rail.className = 'plugin__rail';
  rail.setAttribute('aria-label', 'patch browser');

  const display = document.createElement('main');
  display.className = 'plugin__display';

  workspace.append(rail, display);

  const transport = document.createElement('footer');
  transport.className = 'plugin__transport';

  root.append(header, workspace, transport);
  container.appendChild(root);

  return { root, rail, display, transport };
}
