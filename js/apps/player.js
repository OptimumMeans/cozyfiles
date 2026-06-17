// player.js - PLAYER (winamp-ish fake media player; no real audio wired yet).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// Placeholder playlist. No real audio files exist yet, so durations are faked.
const PLAYLIST = [
  { title: 'untitled (loop.001)', artist: 'cozyfiles', seconds: 187 },
  { title: 'dust on the lens', artist: 'cozyfiles', seconds: 224 },
  { title: 'low orbit / no signal', artist: 'cozyfiles', seconds: 153 },
  { title: 'ghost in the cache', artist: 'cozyfiles', seconds: 201 },
  { title: 'after hours (rendered)', artist: 'cozyfiles', seconds: 168 },
];

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
  // Guard the audio element so a missing src never errors or 404s.
  const audio = el.querySelector('.player__audio');
  audio.removeAttribute('src');

  let index = 0;
  let playing = false;
  let elapsed = 0;        // fake playback position in seconds
  let lastTs = 0;         // rAF timestamp bookkeeping
  let rafId = 0;
  let tickId = 0;         // reduced-motion fallback timer
  const bars = new Array(24).fill(0);

  // Render the playlist rows.
  PLAYLIST.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'player__track';
    li.dataset.i = String(i);
    li.innerHTML = `
      <span class="player__track-n">${String(i + 1).padStart(2, '0')}</span>
      <span class="player__track-title">${track.title}</span>
      <span class="player__track-time">${fmt(track.seconds)}</span>`;
    li.addEventListener('click', () => {
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
    if (reducedMotion()) {
      // No animation loop: advance the fake timer with a 1s tick and draw
      // a single static visualizer frame.
      drawViz(false);
      tickId = setInterval(() => { elapsed += 1; updateReadout(); }, 1000);
      return;
    }
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    setPlaying(false);
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
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const gap = 2;
    const bw = (w - gap * (bars.length - 1)) / bars.length;
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#b6ff3c';
    ctx.fillStyle = accent;
    for (let i = 0; i < bars.length; i++) {
      if (active) {
        // Decorative pseudo-spectrum: smooth toward a noisy target.
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

  // Wiring.
  el.querySelector('[data-act="play"]').addEventListener('click', () => {
    playing ? stop() : start();
  });
  el.querySelector('[data-act="next"]').addEventListener('click', () => {
    next();
    if (playing) { lastTs = 0; }
  });
  el.querySelector('[data-act="prev"]').addEventListener('click', () => {
    prev();
    if (playing) { lastTs = 0; }
  });
  volInput.addEventListener('input', () => {
    el.querySelector('.player').style.setProperty('--vol', `${volInput.value}%`);
  });

  // Clean up the rAF loop when the window closes.
  const origClose = win.close;
  win.close = () => { stop(); origClose(); };

  // Init.
  loadTrack();
  drawViz(false);
}

registerApp({
  id: 'player', name: 'PLAYER', icon: '🎵', desktop: true,
  open: () => wm.open({
    id: 'player', title: 'PLAYER', icon: '🎵', width: 360, height: 360, resizable: false,
    className: 'app-player',
    render,
  }),
});
