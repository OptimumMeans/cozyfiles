// studio-session.js - STUDIO SESSION. His Logic-style session view, packaged as
// a single windowed app on the cozyOS desktop. The release stacks, DAW chrome,
// notes pane and the deck media plugin all live in here.
import { wm, onTap } from '../window-manager.js';
import { registerApp, openApp } from '../desktop.js';
import { createDawFaderVuRow, createDawKnob } from '../daw-components.js';
import { createPluginLed, drawIrregularWaveform, setPluginLed } from './plugin-ui.js';
import {
  RELEASE_STACK_URLS,
  fetchSpotifyStackMeta,
  formatStackLabel,
} from '../spotify-meta.js';
import { FALLBACK_TINT, sampleArtworkTint } from '../album-art.js';
import {
  MANIFESTO_PARAGRAPHS,
  MANIFESTO_WE_MAKE,
  MANIFESTO_LAST_MODIFIED,
} from '../manifesto.js';

const STACK_ZOOM_MIN = 0.55;
const STACK_ZOOM_MAX = 1.45;
const STACK_ZOOM_DEFAULT = 1;
const STACK_ZOOM_STEP = 8;

// The session markup his shell used to put straight in index.html. The bottom
// transport bar is dropped here (the real cozyOS taskbar owns that role) so its
// ids cannot collide with the desktop.
const SESSION_MARKUP = `
  <div class="studio-session">
    <div class="session" id="session">
      <header class="session__toolbar" aria-label="session toolbar">
        <div class="session__tb-cluster session__tb-cluster--left">
          <span class="session__toolbar-mark" aria-hidden="true"></span>
          <span class="session__toolbar-project">studiocozy.</span>
        </div>
        <div class="session__toolbar-lcd" aria-hidden="true">
          <span class="session__lcd-time" id="session-toolbar-timecode">01:00:00:00.00</span>
          <span class="session__lcd-row">
            <span class="session__lcd-bb">1 1 1 000</span>
            <span class="session__lcd-tempo">120.0000</span>
            <span class="session__lcd-sig">4/4</span>
            <span class="session__lcd-key">C maj.</span>
          </span>
        </div>
        <div class="session__tb-cluster session__tb-cluster--right">
          <div class="session__toolbar-zoom" aria-label="track zoom">
            <span class="session__zoom-label" aria-hidden="true">zoom</span>
            <button type="button" id="session-zoom-out" class="session__zoom-btn" aria-label="zoom out tracks">-</button>
            <input type="range" id="session-zoom-slider" class="session__zoom-slider" min="0" max="100" value="50" aria-label="track row zoom" />
            <button type="button" id="session-zoom-in" class="session__zoom-btn" aria-label="zoom in tracks">+</button>
          </div>
          <span class="session__tb-divider" aria-hidden="true"></span>
          <div class="session__toolbar-tabs" aria-hidden="true">
            <span class="is-on">Arrange</span><span>Mixer</span><span>Media</span><span>Lists</span>
          </div>
        </div>
      </header>

      <div class="session__workspace">
        <aside class="session__inspector" id="session-inspector" aria-label="plugins"></aside>
        <div class="session__arrange">
          <div class="session__ruler" id="session-ruler" aria-hidden="true"></div>
          <div class="session__stacks" id="session-stacks" role="list"></div>
        </div>
        <aside class="session__notes" aria-label="session notes">
          <div class="session__notes-head"><span>notes.</span></div>
          <div class="session__notes-body" id="session-notes"></div>
        </aside>
      </div>

      <div class="session__narrow-fallback" id="session-narrow-fallback">
        <p class="session__narrow-msg">please use a wider window.</p>
        <p class="session__narrow-hint">studiocozy needs at least 1024px width.</p>
      </div>
    </div>
  </div>
`;

function pad(n) { return String(n).padStart(2, '0'); }

function render(root, win) {
  root.innerHTML = SESSION_MARKUP;
  const session = root.querySelector('.session');
  const intervals = [];

  buildRuler(root);
  buildInspector(root);
  buildReleaseStacks(root);
  buildNotes(root);
  buildSessionZoom(root, session);
  startSessionTimecode(root, intervals);

  // tidy up the timecode ticker when the window closes
  const origClose = win.close;
  win.close = () => { intervals.forEach(clearInterval); origClose(); };
}

function buildRuler(root) {
  const ruler = root.querySelector('#session-ruler');
  if (!ruler) return;
  ruler.innerHTML = Array.from({ length: 24 }, (_, i) => `<span>${1 + i * 4}</span>`).join('');
}

/* Left channel strip + inserts. The only insert is the deck (media plugin),
   which opens its own greyscale window when clicked. */
function buildInspector(root) {
  const inspector = root.querySelector('#session-inspector');
  if (!inspector) return;

  inspector.innerHTML = `
    <div class="session__strip-thumb" aria-hidden="true">
      <div class="session__strip-thumb-frame"><span class="session__strip-thumb-glyph"></span></div>
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

  const panKnob = root.querySelector('#session-strip-pan-knob');
  if (panKnob) panKnob.appendChild(createDawKnob(52));

  const mixerMount = root.querySelector('#session-strip-mixer');
  if (mixerMount) {
    const mixer = document.createElement('div');
    mixer.className = 'daw-channel is-live session__strip-mixer';
    mixer.style.setProperty('--fader-rest', '62%');
    mixer.style.setProperty('--fader-target', '62%');
    mixer.appendChild(createDawFaderVuRow({ vuLevel: 8 }));
    mixerMount.appendChild(mixer);
  }

  // the one insert: the deck (media). Opens his deck window.
  const list = root.querySelector('#session-plugins');
  if (list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session__plugin is-open';
    btn.dataset.appId = 'deck';
    btn.setAttribute('role', 'listitem');
    btn.style.setProperty('--plugin-i', '0');
    const led = createPluginLed({ live: true });
    const label = document.createElement('span');
    label.className = 'session__plugin-name';
    label.textContent = 'the deck.';
    btn.append(led, label);
    onTap(btn, () => openApp('deck'));
    list.appendChild(btn);
  }
}

/* Arrange area - expandable roster stacks with Spotify embeds. */
function buildReleaseStacks(root) {
  const stacksEl = root.querySelector('#session-stacks');
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
    artistEl.textContent = '...';
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

    requestAnimationFrame(() => redrawStackWaveform(canvas, session(root)));

    onTap(head, () => {
      const isOpen = stack.classList.contains('is-expanded');
      if (expandedStack && expandedStack !== stack) collapseReleaseStack(expandedStack);
      if (isOpen) { collapseReleaseStack(stack); expandedStack = null; }
      else { expandReleaseStack(stack); expandedStack = stack; }
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
      if (artistEl) artistEl.textContent = '...';
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

function session(root) { return root.querySelector('.session'); }

function getStackZoom(sessionEl) {
  if (!sessionEl) return STACK_ZOOM_DEFAULT;
  const raw = parseFloat(getComputedStyle(sessionEl).getPropertyValue('--stack-zoom'));
  return Number.isFinite(raw) ? raw : STACK_ZOOM_DEFAULT;
}

function redrawStackWaveform(canvas, sessionEl) {
  const seed = Number(canvas.dataset.waveSeed) || 1;
  drawIrregularWaveform(canvas, { seed, density: getStackZoom(sessionEl) });
}

function redrawAllStackWaveforms(root) {
  const sessionEl = session(root);
  root.querySelectorAll('.session__stack-wave-canvas').forEach((c) => redrawStackWaveform(c, sessionEl));
}

function sliderToStackZoom(value) {
  const t = Math.max(0, Math.min(100, value)) / 100;
  return STACK_ZOOM_MIN + t * (STACK_ZOOM_MAX - STACK_ZOOM_MIN);
}

function stackZoomToSlider(zoom) {
  const t = (zoom - STACK_ZOOM_MIN) / (STACK_ZOOM_MAX - STACK_ZOOM_MIN);
  return Math.round(Math.max(0, Math.min(100, t * 100)));
}

function applyStackZoom(root, sessionEl, zoom) {
  if (!sessionEl) return;
  const clamped = Math.max(STACK_ZOOM_MIN, Math.min(STACK_ZOOM_MAX, zoom));
  sessionEl.style.setProperty('--stack-zoom', String(clamped));
  const slider = root.querySelector('#session-zoom-slider');
  if (slider) {
    slider.value = String(stackZoomToSlider(clamped));
    slider.setAttribute('aria-valuenow', slider.value);
  }
  requestAnimationFrame(() => redrawAllStackWaveforms(root));
}

function buildSessionZoom(root, sessionEl) {
  const slider = root.querySelector('#session-zoom-slider');
  const outBtn = root.querySelector('#session-zoom-out');
  const inBtn = root.querySelector('#session-zoom-in');
  if (!slider) return;

  applyStackZoom(root, sessionEl, STACK_ZOOM_DEFAULT);

  slider.addEventListener('input', () => {
    applyStackZoom(root, sessionEl, sliderToStackZoom(Number(slider.value)));
  });
  if (outBtn) {
    onTap(outBtn, () => {
      const next = Math.max(0, Number(slider.value) - STACK_ZOOM_STEP);
      slider.value = String(next);
      applyStackZoom(root, sessionEl, sliderToStackZoom(next));
    });
  }
  if (inBtn) {
    onTap(inBtn, () => {
      const next = Math.min(100, Number(slider.value) + STACK_ZOOM_STEP);
      slider.value = String(next);
      applyStackZoom(root, sessionEl, sliderToStackZoom(next));
    });
  }
}

/* Right sidebar - static session notes (manifesto copy). */
function buildNotes(root) {
  const body = root.querySelector('#session-notes');
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

function startSessionTimecode(root, intervals) {
  const toolbarEl = root.querySelector('#session-toolbar-timecode');
  if (!toolbarEl) return;
  let tick = 0;
  intervals.push(setInterval(() => {
    tick += 1;
    const sub = tick % 100;
    const sec = Math.floor(tick / 25) % 60;
    const min = Math.floor(tick / 1500) % 60;
    const hr = Math.floor(tick / 90000) % 24;
    toolbarEl.textContent = `${pad(hr)}:${pad(min)}:${pad(sec)}:${pad(sub)}.${String((sub * 7) % 100).padStart(2, '0')}`;
  }, 42));
}

registerApp({
  id: 'studio-session',
  name: 'STUDIO SESSION',
  icon: '🎛',
  desktop: true,
  open: () => wm.open({
    id: 'studio-session',
    title: 'STUDIO SESSION',
    icon: '🎛',
    width: 1180,
    height: 680,
    resizable: true,
    className: 'app-studio-session',
    render,
  }),
});
