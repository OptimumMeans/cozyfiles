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
          <div class="session__toolbar-tabs" id="session-tabs" role="tablist" aria-label="arrange area view">
            <button type="button" class="session__tab is-on" role="tab" data-view="arrange" aria-selected="true">Arrange</button>
            <button type="button" class="session__tab" role="tab" data-view="mixer" aria-selected="false">Mixer</button>
            <button type="button" class="session__tab" role="tab" data-view="media" aria-selected="false">Media</button>
            <button type="button" class="session__tab" role="tab" data-view="lists" aria-selected="false">Lists</button>
          </div>
        </div>
      </header>

      <div class="session__workspace">
        <aside class="session__inspector" id="session-inspector" aria-label="plugins"></aside>
        <div class="session__arrange">
          <div class="session__ruler" id="session-ruler" aria-hidden="true"></div>
          <div class="session__view" id="session-view-arrange" role="tabpanel" data-view="arrange">
            <div class="session__stacks" id="session-stacks" role="list"></div>
          </div>
          <div class="session__view" id="session-view-mixer" role="tabpanel" data-view="mixer" hidden></div>
          <div class="session__view" id="session-view-media" role="tabpanel" data-view="media" hidden></div>
          <div class="session__view" id="session-view-lists" role="tabpanel" data-view="lists" hidden></div>
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
  // per-render disposers (rAF loops, mixer animations) cleared on tab swap + close
  const disposers = [];

  buildRuler(root);
  buildInspector(root);
  buildReleaseStacks(root);
  buildNotes(root);
  buildSessionZoom(root, session);
  startSessionTimecode(root, intervals);
  buildToolbarTabs(root, { disposers });

  // tidy up the timecode ticker + any live view animations when the window closes
  const origClose = win.close;
  win.close = () => {
    intervals.forEach(clearInterval);
    disposers.forEach((fn) => { try { fn(); } catch { /* */ } });
    origClose();
  };
}

/* Toolbar tabs swap the center arrange-area view. Views are built lazily the
   first time their tab is shown; the live mixer's animation loop is parked when
   you leave it and resumed when you return, so nothing leaks. */
function buildToolbarTabs(root, ctx) {
  const tablist = root.querySelector('#session-tabs');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('.session__tab'));
  const built = new Set(['arrange']); // arrange ships rendered
  // per-view park/resume hooks (e.g. the mixer pauses its VU animation off-tab)
  const viewHooks = {};

  function viewEl(name) { return root.querySelector(`#session-view-${name}`); }

  function show(name) {
    tabs.forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    ['arrange', 'mixer', 'media', 'lists'].forEach((v) => {
      const el = viewEl(v);
      if (!el) return;
      const active = v === name;
      el.hidden = !active;
      // park the leaving view, resume/lazily-build the entering one
      if (active) {
        if (!built.has(v)) { buildView(v, el); built.add(v); }
        viewHooks[v]?.resume?.();
      } else {
        viewHooks[v]?.park?.();
      }
    });
  }

  function buildView(name, el) {
    if (name === 'mixer') viewHooks.mixer = buildMixerView(el, ctx);
    else if (name === 'media') buildMediaView(el);
    else if (name === 'lists') buildListsView(el, root);
  }

  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.classList.contains('is-on') ? 0 : -1;
    onTap(tab, () => show(tab.dataset.view));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      next.focus();
      show(next.dataset.view);
    });
  });
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
    <div class="session__strip-section session__strip-pan">
      <span class="session__strip-label">pan</span>
      <div class="session__strip-pan-knob" id="session-strip-pan-knob"></div>
      <span class="session__strip-pan-readout" id="session-strip-pan-readout">C</span>
    </div>
    <div class="session__strip-fader-mount" id="session-strip-mixer"></div>
    <span class="session__strip-fader-readout" id="session-strip-fader-readout">0.0 dB</span>
  `;

  // pan knob - draggable, visual only (no pan in the deck graph to wire to)
  const panMount = root.querySelector('#session-strip-pan-knob');
  const panReadout = root.querySelector('#session-strip-pan-readout');
  let panValue = 0.5; // 0 = hard L, 1 = hard R, 0.5 = center
  if (panMount) {
    const knob = createDawKnob(0);
    knob.classList.add('is-interactive');
    knob.removeAttribute('aria-hidden');
    knob.setAttribute('role', 'slider');
    knob.setAttribute('tabindex', '0');
    knob.setAttribute('aria-label', 'channel pan');
    panMount.appendChild(knob);
    const applyPan = (v) => {
      panValue = Math.max(0, Math.min(1, v));
      // 270deg sweep centered at 12 o'clock
      const deg = -135 + panValue * 270;
      knob.style.setProperty('--knob-rot', `${deg}deg`);
      knob.setAttribute('aria-valuenow', String(Math.round(panValue * 100)));
      if (panReadout) panReadout.textContent = panLabel(panValue);
    };
    applyPan(panValue);
    makeKnobDraggable(knob, () => panValue, applyPan);
  }

  // channel fader - draggable, drives the master-volume hook
  const faderMount = root.querySelector('#session-strip-mixer');
  const faderReadout = root.querySelector('#session-strip-fader-readout');
  const strip = { fader: 0.78 }; // 0..1, default near 0 dB
  if (faderMount) {
    const channel = document.createElement('div');
    channel.className = 'daw-channel is-live session__strip-mixer is-interactive';
    channel.appendChild(createDawFaderVuRow({ vuLevel: 8 }));
    faderMount.appendChild(channel);

    const fader = channel.querySelector('.daw-channel__fader');
    const applyFader = (v) => {
      strip.fader = Math.max(0, Math.min(1, v));
      channel.style.setProperty('--fader-pos', `${strip.fader * 100}%`);
      if (fader) {
        fader.setAttribute('aria-valuenow', String(Math.round(strip.fader * 100)));
      }
      if (faderReadout) faderReadout.textContent = faderDbLabel(strip.fader);
      pushMasterVolume(strip.fader); // lightweight, no-op if the deck is closed
    };
    if (fader) {
      fader.classList.add('is-interactive');
      fader.removeAttribute('aria-hidden');
      fader.setAttribute('role', 'slider');
      fader.setAttribute('tabindex', '0');
      fader.setAttribute('aria-label', 'channel fader (master volume)');
      fader.setAttribute('aria-valuemin', '0');
      fader.setAttribute('aria-valuemax', '100');
    }
    applyFader(strip.fader);
    if (fader) makeFaderDraggable(fader, () => strip.fader, applyFader);
  }

  // inserts: the deck (media, opens its window) + openDAW (launch-out, new tab)
  const list = root.querySelector('#session-plugins');
  if (list) {
    const deckBtn = document.createElement('button');
    deckBtn.type = 'button';
    deckBtn.className = 'session__plugin is-open';
    deckBtn.dataset.appId = 'deck';
    deckBtn.setAttribute('role', 'listitem');
    deckBtn.style.setProperty('--plugin-i', '0');
    const deckLed = createPluginLed({ live: true });
    const deckLabel = document.createElement('span');
    deckLabel.className = 'session__plugin-name';
    deckLabel.textContent = 'the deck.';
    deckBtn.append(deckLed, deckLabel);
    onTap(deckBtn, () => openApp('deck'));
    list.appendChild(deckBtn);

    // openDAW - plain launch-out to the real app (cannot be embedded; needs
    // cross-origin isolation a GitHub Pages parent cannot provide).
    const odaw = document.createElement('a');
    odaw.className = 'session__plugin session__plugin--link';
    odaw.href = 'https://opendaw.studio/';
    odaw.target = '_blank';
    odaw.rel = 'noopener noreferrer';
    odaw.setAttribute('role', 'listitem');
    odaw.style.setProperty('--plugin-i', '1');
    const odawLed = createPluginLed({ live: false });
    const odawLabel = document.createElement('span');
    odawLabel.className = 'session__plugin-name';
    odawLabel.textContent = 'openDAW.';
    const odawOut = document.createElement('span');
    odawOut.className = 'session__plugin-out';
    odawOut.setAttribute('aria-hidden', 'true');
    odawOut.textContent = '↗';
    odaw.append(odawLed, odawLabel, odawOut);
    list.appendChild(odaw);
  }

  return strip;
}

function panLabel(v) {
  const c = Math.round((v - 0.5) * 200); // -100..+100
  if (c === 0) return 'C';
  return c < 0 ? `L${-c}` : `R${c}`;
}

function faderDbLabel(v) {
  // unity at the default rest position; below = attenuation, above = a touch of gain
  if (v <= 0.001) return '-inf';
  const db = 24 * Math.log2(v / 0.78);
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`;
}

/* Lightweight shared master-volume hook. We cannot reach the deck's internal
   master GainNode (it is a closure local, and deck.js is out of scope), so this
   drives the deck VIDEO element's HTML volume when the deck window is open. That
   is a real, audible master control for video playback and never touches the
   synth voice graph, so the deck's existing playback cannot break. When the deck
   is closed this is a no-op. */
function pushMasterVolume(level01) {
  const deck = wm.get && wm.get('deck');
  if (!deck || deck.minimized) return;
  const video = deck.el && deck.el.querySelector('.deck__video');
  if (video) video.volume = Math.max(0, Math.min(1, level01));
}

/* Vertical fader drag: pointer Y within the track sets 0..1 (bottom..top). */
function makeFaderDraggable(faderEl, getValue, setValue) {
  const setFromPointer = (clientY) => {
    const rect = faderEl.getBoundingClientRect();
    if (rect.height < 2) return;
    const t = 1 - (clientY - rect.top) / rect.height;
    setValue(t);
  };
  let dragging = false;
  faderEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    faderEl.classList.add('is-dragging');
    try { faderEl.setPointerCapture?.(e.pointerId); } catch { /* synthetic / lost pointer */ }
    setFromPointer(e.clientY);
    e.preventDefault();
  });
  faderEl.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e.clientY); });
  const end = () => { dragging = false; faderEl.classList.remove('is-dragging'); };
  faderEl.addEventListener('pointerup', end);
  faderEl.addEventListener('pointercancel', end);
  faderEl.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp') { setValue(getValue() + step); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { setValue(getValue() - step); e.preventDefault(); }
  });
}

/* Rotary knob drag: vertical pointer travel sweeps the value (DAW convention). */
function makeKnobDraggable(knobEl, getValue, setValue) {
  let dragging = false;
  let startY = 0;
  let startVal = 0;
  knobEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startVal = getValue();
    knobEl.classList.add('is-dragging');
    try { knobEl.setPointerCapture?.(e.pointerId); } catch { /* synthetic / lost pointer */ }
    e.preventDefault();
  });
  knobEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY; // up = increase
    setValue(startVal + dy / 140);
  });
  const end = () => { dragging = false; knobEl.classList.remove('is-dragging'); };
  knobEl.addEventListener('pointerup', end);
  knobEl.addEventListener('pointercancel', end);
  knobEl.addEventListener('dblclick', () => setValue(0.5)); // recenter
  knobEl.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setValue(getValue() + step); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setValue(getValue() - step); e.preventDefault(); }
  });
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

/* ── Mixer view ─────────────────────────────────────────────────────────────
   A small native mixer: a row of channel strips built from the shared DAW
   components, each fader draggable, VU ladders animated by a parked rAF loop. */
const MIXER_CHANNELS = [
  { name: 'drums.', fader: 0.74, base: 7 },
  { name: 'bass.', fader: 0.68, base: 5 },
  { name: 'keys.', fader: 0.81, base: 8 },
  { name: 'vox.', fader: 0.62, base: 6 },
  { name: 'master.', fader: 0.78, base: 9, master: true },
];

function buildMixerView(viewEl, ctx) {
  viewEl.innerHTML = `<div class="session__mixer" role="group" aria-label="mixer"></div>`;
  const board = viewEl.querySelector('.session__mixer');
  const channels = [];

  MIXER_CHANNELS.forEach((cfg) => {
    const ch = document.createElement('div');
    ch.className = 'session__mixer-ch' + (cfg.master ? ' is-master' : '');

    const knobWrap = document.createElement('div');
    knobWrap.className = 'session__mixer-knob';
    const knob = createDawKnob(0);
    knob.classList.add('is-interactive');
    knob.removeAttribute('aria-hidden');
    knob.setAttribute('role', 'slider');
    knob.setAttribute('tabindex', '0');
    knob.setAttribute('aria-label', `${cfg.name} pan`);
    knobWrap.appendChild(knob);
    let pan = 0.5;
    const applyPan = (v) => {
      pan = Math.max(0, Math.min(1, v));
      knob.style.setProperty('--knob-rot', `${-135 + pan * 270}deg`);
    };
    applyPan(pan);
    makeKnobDraggable(knob, () => pan, applyPan);

    const channel = document.createElement('div');
    channel.className = 'daw-channel is-live is-interactive';
    channel.appendChild(createDawFaderVuRow({ vuLevel: cfg.base }));
    const fader = channel.querySelector('.daw-channel__fader');
    const segs = Array.from(channel.querySelectorAll('.daw-channel__vu-seg'));

    let faderVal = cfg.fader;
    const applyFader = (v) => {
      faderVal = Math.max(0, Math.min(1, v));
      channel.style.setProperty('--fader-pos', `${faderVal * 100}%`);
      fader?.setAttribute('aria-valuenow', String(Math.round(faderVal * 100)));
      // the master channel mirrors to the deck master-volume hook
      if (cfg.master) pushMasterVolume(faderVal);
    };
    if (fader) {
      fader.classList.add('is-interactive');
      fader.removeAttribute('aria-hidden');
      fader.setAttribute('role', 'slider');
      fader.setAttribute('tabindex', '0');
      fader.setAttribute('aria-label', `${cfg.name} fader`);
      fader.setAttribute('aria-valuemin', '0');
      fader.setAttribute('aria-valuemax', '100');
    }
    applyFader(faderVal);
    if (fader) makeFaderDraggable(fader, () => faderVal, applyFader);

    const label = document.createElement('span');
    label.className = 'session__mixer-label';
    label.textContent = cfg.name;

    ch.append(knobWrap, channel, label);
    board.appendChild(ch);
    channels.push({ cfg, segs, getFader: () => faderVal });
  });

  // VU animation, parked when the mixer tab is not visible (no leak)
  let rafId = 0;
  let phase = 0;
  const tick = () => {
    phase += 0.08;
    channels.forEach(({ cfg, segs, getFader }, i) => {
      const wobble = (Math.sin(phase + i * 1.3) + Math.sin(phase * 2.1 + i)) * 0.25 + 0.5;
      const level = Math.round((cfg.base * 0.5 + wobble * segs.length * 0.6) * getFader());
      segs.forEach((seg, s) => seg.classList.toggle('is-lit', s < level));
    });
    rafId = requestAnimationFrame(tick);
  };
  const resume = () => { if (!rafId && !reducedMotionSession()) rafId = requestAnimationFrame(tick); };
  const park = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };

  // register park as a disposer so window close also stops it
  ctx.disposers.push(park);
  resume();
  return { resume, park };
}

function reducedMotionSession() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── Media view ─────────────────────────────────────────────────────────────
   A short panel that launches / focuses the deck media window. */
function buildMediaView(viewEl) {
  viewEl.innerHTML = `
    <div class="session__media">
      <div class="session__media-card">
        <span class="session__media-glyph" aria-hidden="true">▣</span>
        <div class="session__media-text">
          <span class="session__media-title">the deck.</span>
          <span class="session__media-sub">audio / video media browser</span>
        </div>
        <button type="button" class="session__media-open" id="session-media-open">open the deck.</button>
      </div>
      <p class="session__media-note">// media plays in its own greyscale window. the channel fader doubles as its master volume while it is open.</p>
    </div>
  `;
  const openBtn = viewEl.querySelector('#session-media-open');
  if (openBtn) onTap(openBtn, () => openApp('deck'));
}

/* ── Lists view ─────────────────────────────────────────────────────────────
   A flat list of the releases (same data as the arrange stacks). Each row
   expands the matching Spotify embed inline. */
function buildListsView(viewEl, root) {
  viewEl.innerHTML = `<div class="session__list" role="list"></div>`;
  const listEl = viewEl.querySelector('.session__list');
  const stacks = Array.from(root.querySelectorAll('#session-stacks .session__stack'));
  let openRow = null;

  stacks.forEach((stack, i) => {
    const title = stack.querySelector('.session__stack-title')?.textContent || 'loading.';
    const artist = stack.querySelector('.session__stack-artist')?.textContent || '...';

    const row = document.createElement('div');
    row.className = 'session__list-row';
    row.setAttribute('role', 'listitem');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'session__list-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML = `
      <span class="session__list-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="session__list-labels">
        <span class="session__list-title">${escapeText(title)}</span>
        <span class="session__list-artist">${escapeText(artist)}</span>
      </span>
      <span class="session__list-chevron" aria-hidden="true"></span>
    `;
    const body = document.createElement('div');
    body.className = 'session__list-body';
    body.hidden = true;

    onTap(head, () => {
      const isOpen = row.classList.contains('is-expanded');
      if (openRow && openRow !== row) collapseListRow(openRow);
      if (isOpen) { collapseListRow(row); openRow = null; }
      else { expandListRow(row, stack); openRow = row; }
    });

    row.append(head, body);
    listEl.appendChild(row);
  });
}

function expandListRow(row, stack) {
  row.classList.add('is-expanded');
  const head = row.querySelector('.session__list-head');
  const body = row.querySelector('.session__list-body');
  head.setAttribute('aria-expanded', 'true');
  body.hidden = false;
  if (body.querySelector('iframe')) return;
  const src = stack.dataset.embedSrc;
  if (!src) {
    body.innerHTML = '<span class="session__list-pending">embed loading.</span>';
    return;
  }
  const iframe = document.createElement('iframe');
  iframe.className = 'session__stack-iframe';
  iframe.src = src;
  iframe.width = '100%';
  iframe.height = stack.dataset.embedHeight || '152';
  iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  iframe.loading = 'lazy';
  iframe.title = stack.querySelector('.session__stack-title')?.textContent || 'Spotify player';
  body.innerHTML = '';
  body.appendChild(iframe);
}

function collapseListRow(row) {
  row.classList.remove('is-expanded');
  const head = row.querySelector('.session__list-head');
  const body = row.querySelector('.session__list-body');
  head.setAttribute('aria-expanded', 'false');
  body.hidden = true;
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
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
