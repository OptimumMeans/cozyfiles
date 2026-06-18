// desktop.js — app registry + Logic-style session view (plugins open from left sidebar).
import { wm, onTap } from './window-manager.js';
import { createDawFaderVuRow, createDawKnob } from './daw-components.js';
import {
  createPluginLed,
  drawIrregularWaveform,
  setPluginLed,
} from './apps/plugin-ui.js';
import {
  RELEASE_STACK_URLS,
  fetchSpotifyStackMeta,
  formatStackLabel,
} from './spotify-meta.js';
import { FALLBACK_TINT, sampleArtworkTint } from './album-art.js';
import {
  MANIFESTO_PARAGRAPHS,
  MANIFESTO_WE_MAKE,
  MANIFESTO_LAST_MODIFIED,
} from './manifesto.js';

const registry = new Map();

const STACK_ZOOM_MIN = 0.55;
const STACK_ZOOM_MAX = 1.45;
const STACK_ZOOM_DEFAULT = 1;
const STACK_ZOOM_STEP = 8;

export function registerApp(cfg) { registry.set(cfg.id, cfg); }
export function getApp(id) { return registry.get(id); }
export function openApp(id) {
  const app = registry.get(id);
  if (!app) { console.warn('no such app', id); return; }
  app.open();
}

export function initDesktop() {
  const windowsEl = document.getElementById('windows');
  wm.mount(windowsEl);

  buildRuler();
  buildPluginList();
  buildReleaseStacks();
  buildNotes();
  buildSessionZoom();

  const startBtn = document.getElementById('start-btn');
  const itemsEl = document.getElementById('taskbar-items');
  onTap(startBtn, () => wm.showDesktop());

  const pluginById = new Map();
  document.querySelectorAll('.session__plugin').forEach((row) => {
    pluginById.set(row.dataset.appId, row);
  });

  wm.onChange((snap) => {
    itemsEl.innerHTML = '';

    snap.forEach((w) => {
      const b = document.createElement('button');
      b.className = 'taskitem'
        + (w.focused && !w.minimized ? ' is-focused' : '')
        + (w.minimized ? ' is-min' : '');
      b.type = 'button';
      b.innerHTML = `<span aria-hidden="true">${typeof w.icon === 'string' && w.icon.includes('/') ? '🗔' : w.icon}</span> ${w.title}`;
      onTap(b, () => wm.toggleTaskItem(w.id));
      itemsEl.appendChild(b);
    });

    pluginById.forEach((row, appId) => {
      const win = snap.find((w) => w.id === appId);
      const led = row.querySelector('.plugin-led');
      const live = win && !win.minimized;
      setPluginLed(led, live);
      row.classList.toggle('is-open', !!win);
      row.classList.toggle('is-focused', !!(win && win.focused && !win.minimized));
    });
  });

  startClock();
  startSessionTimecode();
}

function buildRuler() {
  const ruler = document.getElementById('session-ruler');
  if (!ruler) return;
  ruler.innerHTML = Array.from({ length: 24 }, (_, i) => {
    const n = 1 + i * 4;
    return `<span>${n}</span>`;
  }).join('');
}

/** Left sidebar — channel strip with insert slots + decorative mixer chrome. */
function buildPluginList() {
  const inspector = document.getElementById('session-inspector');
  if (!inspector) return;

  inspector.innerHTML = `
    <div class="session__strip-thumb" aria-hidden="true">
      <div class="session__strip-thumb-frame">
        <span class="session__strip-thumb-glyph"></span>
      </div>
      <span class="session__strip-thumb-label">session.</span>
    </div>
    <div class="session__strip-section session__strip-inserts">
      <span class="session__strip-label">inserts</span>
      <div class="session__plugins" id="session-plugins" role="list"></div>
    </div>
    <div class="session__strip-section session__strip-sends" aria-hidden="true">
      <span class="session__strip-label">sends</span>
      <div class="session__strip-slot"><span class="session__strip-slot-label">bus</span><span class="session__strip-slot-value">1</span></div>
      <div class="session__strip-slot"><span class="session__strip-slot-label">bus</span><span class="session__strip-slot-value">2</span></div>
    </div>
    <div class="session__strip-section session__strip-io" aria-hidden="true">
      <span class="session__strip-label">i/o</span>
      <div class="session__strip-io-row"><span class="session__strip-io-label">in</span><span class="session__strip-io-value">st 1</span></div>
      <div class="session__strip-io-row"><span class="session__strip-io-label">out</span><span class="session__strip-io-value">1-2</span></div>
    </div>
    <div class="session__strip-section session__strip-pan" aria-hidden="true">
      <span class="session__strip-label">pan</span>
      <div class="session__strip-pan-knob" id="session-strip-pan-knob"></div>
    </div>
    <div class="session__strip-fader-mount" id="session-strip-mixer" aria-hidden="true"></div>
  `;

  const panKnob = document.getElementById('session-strip-pan-knob');
  if (panKnob) panKnob.appendChild(createDawKnob(52));

  const mixerMount = document.getElementById('session-strip-mixer');
  if (mixerMount) {
    const mixer = document.createElement('div');
    mixer.className = 'daw-channel is-live session__strip-mixer';
    mixer.style.setProperty('--fader-rest', '62%');
    mixer.style.setProperty('--fader-target', '62%');
    mixer.appendChild(createDawFaderVuRow({ vuLevel: 8 }));
    mixerMount.appendChild(mixer);
  }

  const list = document.getElementById('session-plugins');
  const apps = [...registry.values()].filter((a) => a.desktop !== false && !a.hidden);

  apps.forEach((app, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session__plugin';
    btn.dataset.appId = app.id;
    btn.setAttribute('role', 'listitem');
    btn.style.setProperty('--plugin-i', String(i));

    const led = createPluginLed();
    const label = document.createElement('span');
    label.className = 'session__plugin-name';
    label.textContent = app.name.toLowerCase();

    btn.append(led, label);
    onTap(btn, () => app.open());
    list.appendChild(btn);
  });
}

/** Arrange area — expandable roster stacks with Spotify embeds. */
function buildReleaseStacks() {
  const stacksEl = document.getElementById('session-stacks');
  if (!stacksEl) return;

  stacksEl.innerHTML = '';
  let expandedStack = null;

  RELEASE_STACK_URLS.forEach((spotifyUrl, i) => {
    const stack = document.createElement('div');
    stack.className = 'session__stack';
    stack.style.setProperty('--lane-fill', FALLBACK_TINT);
    stack.dataset.spotifyUrl = spotifyUrl;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'session__stack-head';
    head.setAttribute('aria-expanded', 'false');

    const num = document.createElement('span');
    num.className = 'session__stack-num';
    num.textContent = String(i + 1).padStart(2, '0');

    const art = document.createElement('div');
    art.className = 'session__stack-art';
    const artImg = document.createElement('img');
    artImg.className = 'session__stack-art-img';
    artImg.alt = '';
    artImg.loading = 'lazy';
    artImg.hidden = true;
    art.appendChild(artImg);

    const wave = document.createElement('div');
    wave.className = 'session__stack-wave';
    const canvas = document.createElement('canvas');
    canvas.className = 'session__stack-wave-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.waveSeed = String(11 + i * 17);
    wave.appendChild(canvas);

    const labels = document.createElement('div');
    labels.className = 'session__stack-labels';
    const titleEl = document.createElement('span');
    titleEl.className = 'session__stack-title';
    titleEl.textContent = 'loading.';
    const artistEl = document.createElement('span');
    artistEl.className = 'session__stack-artist';
    artistEl.textContent = '…';
    labels.append(titleEl, artistEl);

    const chevron = document.createElement('span');
    chevron.className = 'session__stack-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    head.append(num, art, wave, labels, chevron);

    const body = document.createElement('div');
    body.className = 'session__stack-body';
    body.hidden = true;
    const embedWrap = document.createElement('div');
    embedWrap.className = 'session__stack-embed';
    body.appendChild(embedWrap);

    stack.append(head, body);
    stacksEl.appendChild(stack);

    requestAnimationFrame(() => {
      redrawStackWaveform(canvas);
    });

    onTap(head, () => {
      const isOpen = stack.classList.contains('is-expanded');
      if (expandedStack && expandedStack !== stack) collapseReleaseStack(expandedStack);
      if (isOpen) {
        collapseReleaseStack(stack);
        expandedStack = null;
      } else {
        expandReleaseStack(stack);
        expandedStack = stack;
      }
    });
  });

  RELEASE_STACK_URLS.forEach(async (spotifyUrl, i) => {
    const stack = stacksEl.children[i];
    if (!stack) return;
    try {
      const meta = await fetchSpotifyStackMeta(spotifyUrl);
      stack.dataset.embedSrc = meta.embedSrc;
      stack.dataset.embedHeight = String(meta.height);
      const titleEl = stack.querySelector('.session__stack-title');
      const artistEl = stack.querySelector('.session__stack-artist');
      const artImg = stack.querySelector('.session__stack-art-img');
      if (titleEl) titleEl.textContent = formatStackLabel(meta.title);
      if (artistEl) artistEl.textContent = '…';
      if (artImg && meta.thumbnailUrl) {
        artImg.src = meta.thumbnailUrl;
        artImg.alt = meta.title || 'album art';
        artImg.hidden = false;
        sampleArtworkTint(meta.thumbnailUrl).then((tint) => {
          stack.style.setProperty('--lane-fill', tint);
        });
      }
      meta.loadArtist().then((artist) => {
        if (artistEl && artist) artistEl.textContent = formatStackLabel(artist);
      });
    } catch (err) {
      console.warn('spotify meta failed', spotifyUrl, err);
      const titleEl = stack.querySelector('.session__stack-title');
      if (titleEl) titleEl.textContent = 'unavailable.';
    }
  });
}

function expandReleaseStack(stack) {
  stack.classList.add('is-expanded');
  const head = stack.querySelector('.session__stack-head');
  const body = stack.querySelector('.session__stack-body');
  head.setAttribute('aria-expanded', 'true');
  body.hidden = false;

  const embedWrap = stack.querySelector('.session__stack-embed');
  if (!embedWrap || embedWrap.querySelector('iframe')) return;

  const src = stack.dataset.embedSrc;
  if (!src) return;

  const iframe = document.createElement('iframe');
  iframe.className = 'session__stack-iframe';
  iframe.src = src;
  iframe.width = '100%';
  iframe.height = stack.dataset.embedHeight || '152';
  iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  iframe.loading = 'lazy';
  iframe.title = stack.querySelector('.session__stack-title')?.textContent || 'Spotify player';
  embedWrap.appendChild(iframe);
}

function collapseReleaseStack(stack) {
  stack.classList.remove('is-expanded');
  const head = stack.querySelector('.session__stack-head');
  const body = stack.querySelector('.session__stack-body');
  head.setAttribute('aria-expanded', 'false');
  body.hidden = true;
}

function getStackZoom() {
  const session = document.getElementById('session');
  if (!session) return STACK_ZOOM_DEFAULT;
  const raw = parseFloat(getComputedStyle(session).getPropertyValue('--stack-zoom'));
  return Number.isFinite(raw) ? raw : STACK_ZOOM_DEFAULT;
}

function redrawStackWaveform(canvas) {
  const seed = Number(canvas.dataset.waveSeed) || 1;
  drawIrregularWaveform(canvas, { seed, density: getStackZoom() });
}

function redrawAllStackWaveforms() {
  document.querySelectorAll('.session__stack-wave-canvas').forEach(redrawStackWaveform);
}

function sliderToStackZoom(value) {
  const t = Math.max(0, Math.min(100, value)) / 100;
  return STACK_ZOOM_MIN + t * (STACK_ZOOM_MAX - STACK_ZOOM_MIN);
}

function stackZoomToSlider(zoom) {
  const t = (zoom - STACK_ZOOM_MIN) / (STACK_ZOOM_MAX - STACK_ZOOM_MIN);
  return Math.round(Math.max(0, Math.min(100, t * 100)));
}

function applyStackZoom(zoom) {
  const session = document.getElementById('session');
  if (!session) return;
  const clamped = Math.max(STACK_ZOOM_MIN, Math.min(STACK_ZOOM_MAX, zoom));
  session.style.setProperty('--stack-zoom', String(clamped));
  const slider = document.getElementById('session-zoom-slider');
  if (slider) {
    slider.value = String(stackZoomToSlider(clamped));
    slider.setAttribute('aria-valuenow', slider.value);
  }
  requestAnimationFrame(redrawAllStackWaveforms);
}

function buildSessionZoom() {
  const slider = document.getElementById('session-zoom-slider');
  const outBtn = document.getElementById('session-zoom-out');
  const inBtn = document.getElementById('session-zoom-in');
  if (!slider) return;

  applyStackZoom(STACK_ZOOM_DEFAULT);

  slider.addEventListener('input', () => {
    applyStackZoom(sliderToStackZoom(Number(slider.value)));
  });

  if (outBtn) {
    onTap(outBtn, () => {
      const next = Math.max(0, Number(slider.value) - STACK_ZOOM_STEP);
      slider.value = String(next);
      applyStackZoom(sliderToStackZoom(next));
    });
  }

  if (inBtn) {
    onTap(inBtn, () => {
      const next = Math.min(100, Number(slider.value) + STACK_ZOOM_STEP);
      slider.value = String(next);
      applyStackZoom(sliderToStackZoom(next));
    });
  }
}

/** Right sidebar — static session notes (manifesto copy). */
function buildNotes() {
  const body = document.getElementById('session-notes');
  if (!body) return;

  body.innerHTML = `
    <p class="session__notes-lead">${MANIFESTO_PARAGRAPHS[0]}</p>
    ${MANIFESTO_PARAGRAPHS.slice(1).map((p) => `<p class="session__notes-p">${p}</p>`).join('')}
    <p class="session__notes-label">we make:</p>
    <ul class="session__notes-list">
      ${MANIFESTO_WE_MAKE.map((item) => `<li>&gt; ${item}</li>`).join('')}
    </ul>
    <p class="session__notes-foot">// the rest is under construction, and always will be.</p>
    <p class="session__notes-meta">${MANIFESTO_LAST_MODIFIED}</p>
  `;
}

function startClock() {
  const el = document.getElementById('taskbar-clock');
  if (!el) return;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  tick();
  setInterval(tick, 15000);
}

function startSessionTimecode() {
  const transportEl = document.getElementById('session-timecode');
  const toolbarEl = document.getElementById('session-toolbar-timecode');
  if (!transportEl && !toolbarEl) return;
  let tick = 0;
  setInterval(() => {
    tick += 1;
    const sub = tick % 100;
    const sec = Math.floor(tick / 25) % 60;
    const min = Math.floor(tick / 1500) % 60;
    const hr = Math.floor(tick / 90000) % 24;
    const tc = `${pad(hr)}:${pad(min)}:${pad(sec)}:${pad(sub)}.${String((sub * 7) % 100).padStart(2, '0')}`;
    if (transportEl) transportEl.textContent = tc;
    if (toolbarEl) toolbarEl.textContent = tc;
  }, 42);
}

function pad(n) { return String(n).padStart(2, '0'); }
