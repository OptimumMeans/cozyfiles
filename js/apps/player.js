// player.js - PLAYER (winamp-ish fake media player; no real audio wired yet).
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// Placeholder playlist. No real audio files exist, so each track is a warm
// generative pad synthesized live via the Web Audio API. `root` is the base
// note in Hz; `mode` picks the chord tones layered above it. Drop real audio
// in later by swapping the synth for an <audio> element keyed off these rows.
const PLAYLIST = [
  { title: 'untitled (loop.001)',    artist: 'cozyfiles', seconds: 187, root: 110.00, mode: 'minor' }, // A2
  { title: 'dust on the lens',       artist: 'cozyfiles', seconds: 224, root: 130.81, mode: 'major' }, // C3
  { title: 'low orbit / no signal',  artist: 'cozyfiles', seconds: 153, root:  98.00, mode: 'sus' },   // G2
  { title: 'ghost in the cache',     artist: 'cozyfiles', seconds: 201, root: 146.83, mode: 'minor' }, // D3
  { title: 'after hours (rendered)', artist: 'cozyfiles', seconds: 168, root: 123.47, mode: 'major' }, // B2
];

// Chord tone ratios over the root for each mode (root, third, fifth, octave).
const CHORDS = {
  minor: [1, 6 / 5, 3 / 2, 2],
  major: [1, 5 / 4, 3 / 2, 2],
  sus:   [1, 4 / 3, 3 / 2, 2],
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
  el.innerHTML = `
    <div class="player">
      <div class="player__display">
        <canvas class="player__viz" width="320" height="44" aria-hidden="true"></canvas>
        <div class="player__readout">
          <span class="player__time" aria-live="off">0:00</span>
          <span class="player__sep">/</span>
          <span class="player__dur">0:00</span>
        </div>
        <div class="player__marquee" aria-hidden="true">
          <span class="player__marquee-text"></span>
        </div>
        <div class="player__now" role="status">
          <span class="player__title"></span>
          <span class="player__artist"></span>
        </div>
      </div>

      <div class="player__seek" aria-hidden="true">
        <div class="player__seek-fill"></div>
      </div>

      <div class="player__controls">
        <button class="player__btn" data-act="prev" type="button" title="previous" aria-label="previous track">|◀</button>
        <button class="player__btn player__btn--play" data-act="play" type="button" title="play" aria-label="play">▶</button>
        <button class="player__btn" data-act="next" type="button" title="next" aria-label="next track">▶|</button>
        <label class="player__vol">
          <span aria-hidden="true">VOL</span>
          <input class="player__vol-input" type="range" min="0" max="100" value="70" aria-label="volume" />
        </label>
      </div>

      <ul class="player__list"></ul>

      <audio class="player__audio" preload="none"></audio>
    </div>
  `;

  const canvas = el.querySelector('.player__viz');
  const ctx = canvas.getContext('2d');
  const timeEl = el.querySelector('.player__time');
  const durEl = el.querySelector('.player__dur');
  const fillEl = el.querySelector('.player__seek-fill');
  const marquee = el.querySelector('.player__marquee');
  const marqueeText = el.querySelector('.player__marquee-text');
  const titleEl = el.querySelector('.player__title');
  const artistEl = el.querySelector('.player__artist');
  const playBtn = el.querySelector('.player__btn--play');
  const listEl = el.querySelector('.player__list');
  const volInput = el.querySelector('.player__vol-input');
  // No audio file: keep the element guarded so a missing src never 404s.
  const audio = el.querySelector('.player__audio');
  audio.removeAttribute('src');

  let index = 0;
  let playing = false;
  let elapsed = 0;        // playback position in seconds
  let lastTs = 0;         // rAF timestamp bookkeeping
  let rafId = 0;
  let tickId = 0;         // reduced-motion fallback timer
  const bars = new Array(24).fill(0);

  // Logical (CSS-pixel) canvas size used for all draw math. The backing
  // buffer is scaled by devicePixelRatio so the visualizer stays crisp when
  // the window is a full-screen sheet on phones (or on HiDPI displays).
  let vizW = 320;
  let vizH = 44;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width)) || vizW;
    const cssH = Math.max(1, Math.round(rect.height)) || vizH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vizW = cssW;
    vizH = cssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Repaint immediately so a resize while paused does not leave it blank.
    drawViz(playing && voices.length > 0);
  }

  // ---- Web Audio synth engine -------------------------------------------
  // Lazily created on first play (an autoplay-policy-safe user gesture).
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null;        // AudioContext
  let master = null;      // master GainNode (volume)
  let analyser = null;    // AnalyserNode -> real visualizer
  let freqData = null;    // Uint8Array of frequency bins
  let voices = [];        // active oscillator/gain nodes for the current track

  function volGain() { return Math.pow(volInput.value / 100, 1.6) * 0.5; }

  function ensureAudio() {
    if (!AC) return false;            // no Web Audio: stay silent, visuals only
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

  // Build the layered pad for the current track and fade it in.
  function startVoices() {
    if (!ensureAudio()) return;
    stopVoices(true);
    const t = PLAYLIST[index];
    const ratios = CHORDS[t.mode] || CHORDS.minor;
    const now = actx.currentTime;
    ratios.forEach((ratio, i) => {
      const osc = actx.createOscillator();
      osc.type = i === ratios.length - 1 ? 'triangle' : 'sawtooth';
      osc.frequency.value = t.root * ratio;
      osc.detune.value = (i - 1.5) * 4;       // gentle chorus spread

      const filter = actx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600 + i * 220;
      filter.Q.value = 0.8;

      const g = actx.createGain();
      g.gain.value = 0;
      const target = 0.22 / ratios.length * (i === 0 ? 1.4 : 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(target, now + 1.2);

      // slow tremolo so the pad breathes
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

  // Render the playlist rows.
  PLAYLIST.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'player__track';
    li.dataset.i = String(i);
    li.innerHTML = `
      <span class="player__track-n">${String(i + 1).padStart(2, '0')}</span>
      <span class="player__track-title">${track.title}</span>
      <span class="player__track-time">${fmt(track.seconds)}</span>`;
    onTap(li, () => {
      index = i;
      loadTrack();
      start();
    });
    listEl.appendChild(li);
  });
  const rows = [...listEl.querySelectorAll('.player__track')];

  function loadTrack() {
    const t = PLAYLIST[index];
    elapsed = 0;
    titleEl.textContent = t.title;
    artistEl.textContent = t.artist;
    marqueeText.textContent = `${t.title}  -  ${t.artist}      `;
    durEl.textContent = fmt(t.seconds);
    timeEl.textContent = '0:00';
    fillEl.style.width = '0%';
    rows.forEach((r, i) => r.classList.toggle('is-active', i === index));
    if (playing) startVoices();   // retune the pad to the new track
  }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', on ? 'pause' : 'play');
    playBtn.title = on ? 'pause' : 'play';
    marquee.classList.toggle('is-running', on && !reducedMotion());
    el.querySelector('.player').classList.toggle('is-playing', on);
  }

  function updateReadout() {
    const dur = PLAYLIST[index].seconds;
    if (elapsed >= dur) { next(); elapsed = 0; }
    timeEl.textContent = fmt(elapsed);
    fillEl.style.width = `${(elapsed / PLAYLIST[index].seconds) * 100}%`;
  }

  function start() {
    if (playing) return;
    setPlaying(true);
    startVoices();          // real audio plays regardless of motion prefs
    if (reducedMotion()) {
      // No animation loop: advance the timer with a 1s tick and draw a
      // single static visualizer frame. Audio still plays.
      drawViz(false);
      tickId = setInterval(() => { elapsed += 1; updateReadout(); }, 1000);
      return;
    }
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    setPlaying(false);
    stopVoices(false);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (tickId) clearInterval(tickId);
    tickId = 0;
  }

  function next() {
    index = (index + 1) % PLAYLIST.length;
    loadTrack();
  }
  function prev() {
    index = (index - 1 + PLAYLIST.length) % PLAYLIST.length;
    loadTrack();
  }

  function drawViz(active) {
    const w = vizW;
    const h = vizH;
    ctx.clearRect(0, 0, w, h);
    const gap = 2;
    const bw = (w - gap * (bars.length - 1)) / bars.length;
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#b6ff3c';
    ctx.fillStyle = accent;
    // Pull real frequency data from the analyser when audio is running.
    const live = active && analyser && voices.length;
    if (live) analyser.getByteFrequencyData(freqData);
    for (let i = 0; i < bars.length; i++) {
      if (live) {
        const bin = freqData[Math.floor(i / bars.length * freqData.length)] / 255;
        bars[i] += (bin - bars[i]) * 0.45;
      } else if (active) {
        // Fallback pseudo-spectrum (no Web Audio available).
        const target = 0.15 + 0.85 * Math.abs(Math.sin(i * 0.7 + performance.now() / 240)) * Math.random();
        bars[i] += (target - bars[i]) * 0.35;
      } else {
        bars[i] += (0.04 - bars[i]) * 0.2;
      }
      const bh = Math.max(1, bars[i] * h);
      const x = i * (bw + gap);
      ctx.fillRect(x, h - bh, bw, bh);
    }
  }

  function loop(ts) {
    // Bail out (and stop the loop) if the window was closed/removed.
    if (!document.contains(canvas)) { stop(); return; }
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    elapsed += dt;
    updateReadout();
    drawViz(true);

    rafId = requestAnimationFrame(loop);
  }

  // Wiring (onTap so play/prev/next respond reliably to touch on mobile).
  onTap(el.querySelector('[data-act="play"]'), () => { playing ? stop() : start(); });
  onTap(el.querySelector('[data-act="next"]'), () => { next(); if (playing) { lastTs = 0; } });
  onTap(el.querySelector('[data-act="prev"]'), () => { prev(); if (playing) { lastTs = 0; } });
  volInput.addEventListener('input', () => {
    el.querySelector('.player').style.setProperty('--vol', `${volInput.value}%`);
    if (master && actx) {
      master.gain.setTargetAtTime(volGain(), actx.currentTime, 0.05);
    }
  });

  // Keep the canvas buffer matched to its rendered size. Window resize on
  // desktop and orientation changes / sheet resizes on mobile both fire here.
  // A ResizeObserver tracks the element directly (the WM resizes the window,
  // not the viewport, when dragged); window listeners cover orientation flips.
  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(canvas);
  }
  const onWinResize = () => resizeCanvas();
  window.addEventListener('resize', onWinResize);
  window.addEventListener('orientationchange', onWinResize);

  // Clean up the rAF loop AND tear down audio when the window closes.
  const origClose = win.close;
  win.close = () => {
    stop();
    if (ro) { ro.disconnect(); ro = null; }
    window.removeEventListener('resize', onWinResize);
    window.removeEventListener('orientationchange', onWinResize);
    if (actx) { try { actx.close(); } catch { /* already closed */ } actx = null; }
    origClose();
  };

  // Init.
  loadTrack();
  resizeCanvas();   // sets the backing buffer + paints the first frame
}

registerApp({
  id: 'player', name: 'PLAYER', icon: '🎵', desktop: true,
  open: () => wm.open({
    id: 'player', title: 'PLAYER', icon: '🎵', width: 360, height: 360, resizable: false,
    className: 'app-player',
    render,
  }),
});
