// deck.js — "the deck." unified audio/video media browser (plugin-skinned app).
// Replaces player.js on the desktop. Uses plugin-ui.js shell + shared components.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';
import {
  createPluginLed,
  createPluginVuMeter,
  drawIrregularWaveform,
  mountPluginShell,
  setPluginLed,
  updatePluginVu,
  VU_SEGMENTS,
} from './plugin-ui.js';

// Placeholder patch list — swap in real cozyfiles media paths later.
const PATCHES = [
  {
    id: 'demo-track',
    title: 'demo track.',
    type: 'audio',
    duration: 148,
    seed: 42,
    root: 110.0,
    mode: 'minor',
  },
  {
    id: 'demo-video',
    title: 'demo video.',
    type: 'video',
    duration: 0, // filled from metadata when loaded
  // CC0 sample for placeholder playback; replace with assets/media/… later.
    src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
  },
  {
    id: 'warm-pad',
    title: 'warm pad.',
    type: 'audio',
    duration: 112,
    seed: 91,
    root: 130.81,
    mode: 'major',
  },
];

const CHORDS = {
  minor: [1, 6 / 5, 3 / 2, 2],
  major: [1, 5 / 4, 3 / 2, 2],
  sus: [1, 4 / 3, 3 / 2, 2],
};

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

function render(el, win) {
  const { rail, display, transport } = mountPluginShell(el, {
    name: 'the deck.',
    version: 'v1.0',
  });

  // ── Main display layers (audio waveform vs video) ─────────────────────────
  display.innerHTML = `
    <div class="deck__wave-wrap" hidden>
      <canvas class="deck__wave" aria-hidden="true"></canvas>
      <div class="deck__playhead" aria-hidden="true"></div>
    </div>
    <div class="deck__video-wrap" hidden>
      <video class="deck__video" playsinline preload="metadata"></video>
      <div class="deck__video-fallback" hidden>
        <span class="deck__video-fallback-label">demo video.</span>
        <span class="deck__video-fallback-note">media unavailable</span>
      </div>
    </div>
  `;

  const waveWrap = display.querySelector('.deck__wave-wrap');
  const waveCanvas = display.querySelector('.deck__wave');
  const playhead = display.querySelector('.deck__playhead');
  const videoWrap = display.querySelector('.deck__video-wrap');
  const videoEl = display.querySelector('.deck__video');
  const videoFallback = display.querySelector('.deck__video-fallback');

  // ── Transport strip ─────────────────────────────────────────────────────
  const vu = createPluginVuMeter();
  transport.innerHTML = `
    <button class="plugin__play" type="button" aria-label="play">▶</button>
    <div class="plugin__scrub">
      <input class="plugin__scrub-input" type="range" min="0" max="1000" value="0" aria-label="scrub" />
      <div class="plugin__scrub-track" aria-hidden="true"><div class="plugin__scrub-fill"></div></div>
    </div>
    <div class="plugin__time" aria-live="off">
      <span class="plugin__time-elapsed">0:00</span>
      <span class="plugin__time-sep">/</span>
      <span class="plugin__time-remain">-0:00</span>
    </div>
  `;
  transport.appendChild(vu);

  const playBtn = transport.querySelector('.plugin__play');
  const scrubInput = transport.querySelector('.plugin__scrub-input');
  const scrubFill = transport.querySelector('.plugin__scrub-fill');
  const timeElapsed = transport.querySelector('.plugin__time-elapsed');
  const timeRemain = transport.querySelector('.plugin__time-remain');

  // ── Patch browser (left rail) ───────────────────────────────────────────
  const patchEls = [];
  PATCHES.forEach((patch, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plugin__patch';
    btn.dataset.index = String(i);
    const led = createPluginLed();
    const icon = document.createElement('span');
    icon.className = `plugin__patch-icon plugin__patch-icon--${patch.type}`;
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'plugin__patch-title';
    title.textContent = patch.title;
    btn.append(led, icon, title);
    onTap(btn, () => selectPatch(i));
    rail.appendChild(btn);
    patchEls.push({ btn, led });
  });

  let index = 0;
  let playing = false;
  let scrubbing = false;
  let elapsed = 0;
  let duration = PATCHES[0].duration;
  let rafId = 0;
  let tickId = 0;
  let waveSeed = PATCHES[0].seed ?? 1;

  // ── Web Audio (audio synth + video analyser) ──────────────────────────────
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  let master = null;
  let analyser = null;
  let freqData = null;
  let mediaSource = null;
  let voices = [];
  let videoConnected = false;

  function volGain() { return 0.45; }

  function ensureAudio() {
    if (!AC) return false;
    if (!actx) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = volGain();
      analyser = actx.createAnalyser();
      analyser.fftSize = 64;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      master.connect(analyser);
      analyser.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return true;
  }

  function connectVideoAudio() {
    if (!ensureAudio() || videoConnected) return;
    try {
      mediaSource = actx.createMediaElementSource(videoEl);
      mediaSource.connect(master);
      videoConnected = true;
    } catch {
      // already connected or CORS-blocked analyser path — VU falls back to generic
    }
  }

  function startVoices() {
    if (!ensureAudio()) return;
    stopVoices(true);
    const patch = PATCHES[index];
    const ratios = CHORDS[patch.mode] || CHORDS.minor;
    const now = actx.currentTime;
    ratios.forEach((ratio, i) => {
      const osc = actx.createOscillator();
      osc.type = i === ratios.length - 1 ? 'triangle' : 'sawtooth';
      osc.frequency.value = patch.root * ratio;
      osc.detune.value = (i - 1.5) * 4;

      const filter = actx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600 + i * 220;
      filter.Q.value = 0.8;

      const g = actx.createGain();
      g.gain.value = 0;
      const target = 0.22 / ratios.length * (i === 0 ? 1.4 : 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(target, now + 1.0);

      const lfo = actx.createOscillator();
      lfo.frequency.value = 0.07 + i * 0.03;
      const lfoGain = actx.createGain();
      lfoGain.gain.value = target * 0.35;
      lfo.connect(lfoGain).connect(g.gain);

      osc.connect(filter).connect(g).connect(master);
      osc.start(now);
      lfo.start(now);
      voices.push({ osc, lfo, g });
    });
  }

  function stopVoices(immediate) {
    if (!actx) { voices = []; return; }
    const now = actx.currentTime;
    voices.forEach(({ osc, lfo, g }) => {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + (immediate ? 0.02 : 0.3));
        osc.stop(now + (immediate ? 0.05 : 0.35));
        lfo.stop(now + (immediate ? 0.05 : 0.35));
      } catch { /* already stopped */ }
    });
    voices = [];
  }

  function currentPatch() { return PATCHES[index]; }
  function isAudio() { return currentPatch().type === 'audio'; }
  function isVideo() { return currentPatch().type === 'video'; }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', on ? 'pause' : 'play');
    display.classList.toggle('is-playing', on);
  }

  function updatePatchLeds() {
    patchEls.forEach(({ led }, i) => setPluginLed(led, i === index));
  }

  function resizeWaveform() {
    drawIrregularWaveform(waveCanvas, { seed: waveSeed });
  }

  function setPlayhead(pct) {
    playhead.style.left = `${Math.min(100, Math.max(0, pct * 100))}%`;
  }

  function updateReadout() {
    const dur = Math.max(0.001, duration);
    const pct = elapsed / dur;
    if (!scrubbing) scrubInput.value = String(Math.round(pct * 1000));
    scrubFill.style.width = `${pct * 100}%`;
    timeElapsed.textContent = fmt(elapsed);
    timeRemain.textContent = `-${fmt(Math.max(0, dur - elapsed))}`;
    setPlayhead(pct);
  }

  function showDisplayMode() {
    const audio = isAudio();
    waveWrap.hidden = !audio;
    videoWrap.hidden = audio;
    if (audio) resizeWaveform();
  }

  function stopAllMedia() {
    stopVoices(false);
    if (!videoEl.paused) videoEl.pause();
  }

  function seekTo(seconds) {
    elapsed = Math.max(0, Math.min(duration, seconds));
    if (isVideo() && videoEl.duration) {
      videoEl.currentTime = elapsed;
    }
    updateReadout();
  }

  function selectPatch(i) {
    const wasPlaying = playing;
    pause();
    index = i;
    elapsed = 0;
    const patch = currentPatch();
    duration = patch.duration || 0;
    waveSeed = patch.seed ?? index + 1;
    updatePatchLeds();
    showDisplayMode();

    if (isVideo()) {
      videoEl.classList.remove('is-ready');
      videoFallback.hidden = true;
      videoEl.hidden = false;
      videoEl.src = patch.src || '';
      videoEl.load();
      videoEl.onloadedmetadata = () => {
        duration = videoEl.duration || patch.duration || 0;
        updateReadout();
      };
      videoEl.onerror = () => {
        videoEl.hidden = true;
        videoFallback.hidden = false;
        duration = patch.duration || 30;
        updateReadout();
      };
    }

    updateReadout();
    if (wasPlaying) play();
  }

  function pause() {
    setPlaying(false);
    stopAllMedia();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (tickId) clearInterval(tickId);
    tickId = 0;
    updatePluginVu(vu, 0);
  }

  function play() {
    if (playing) return;
    setPlaying(true);

    if (isAudio()) {
      startVoices();
    } else if (isVideo() && !videoEl.hidden) {
      connectVideoAudio();
      videoEl.play().catch(() => pause());
    }

    if (reducedMotion()) {
      tickId = setInterval(() => {
        if (isVideo() && !videoEl.hidden) elapsed = videoEl.currentTime;
        else elapsed += 1;
        if (elapsed >= duration) { elapsed = duration; pause(); return; }
        updateReadout();
        updateVuGeneric();
      }, 1000);
      return;
    }

    let lastTs = 0;
    const loop = (ts) => {
      if (!document.contains(el)) { pause(); return; }
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      if (isVideo() && !videoEl.hidden) {
        elapsed = videoEl.currentTime;
        if (videoEl.ended) { elapsed = duration; pause(); return; }
      } else {
        elapsed += dt;
        if (elapsed >= duration) { elapsed = duration; pause(); return; }
      }

      updateReadout();
      updateVuLive();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function togglePlay() {
    playing ? pause() : play();
  }

  function updateVuLive() {
    if (analyser && (voices.length || (isVideo() && !videoEl.paused))) {
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < freqData.length; i++) sum += freqData[i];
      const avg = sum / freqData.length / 255;
      const level = Math.max(2, Math.floor(avg * VU_SEGMENTS * 1.1));
      updatePluginVu(vu, level);
      return;
    }
    updateVuGeneric();
  }

  function updateVuGeneric() {
    const level = 3 + Math.floor(Math.random() * (VU_SEGMENTS - 3));
    updatePluginVu(vu, level);
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  onTap(playBtn, togglePlay);
  scrubInput.addEventListener('pointerdown', () => { scrubbing = true; });
  scrubInput.addEventListener('pointerup', () => { scrubbing = false; });
  scrubInput.addEventListener('input', () => {
    seekTo((Number(scrubInput.value) / 1000) * duration);
  });
  videoEl.addEventListener('click', togglePlay);

  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => { if (isAudio()) resizeWaveform(); });
    ro.observe(display);
  }

  const origClose = win.close;
  win.close = () => {
    pause();
    if (ro) { ro.disconnect(); ro = null; }
    videoEl.removeAttribute('src');
    videoEl.load();
    if (actx) { try { actx.close(); } catch { /* */ } actx = null; videoConnected = false; }
    origClose();
  };

  selectPatch(0);
}

registerApp({
  id: 'deck',
  name: 'the deck.',
  icon: '▣',
  desktop: true,
  open: () => wm.open({
    id: 'deck',
    title: 'the deck.',
    icon: '▣',
    width: 720,
    height: 480,
    resizable: true,
    className: 'app-deck',
    render,
  }),
});
