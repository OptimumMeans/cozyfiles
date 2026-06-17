// studio.js - STUDIO (a lightweight DAW: multitrack step sequencer).
// A mockup-grade nod to Zrythm / openDAW: real tracks, a real transport, a
// real Web Audio engine. Each track is a synthesized voice triggered by a
// 16-step grid. Timing uses the classic lookahead scheduler (a setTimeout
// pump that schedules notes slightly ahead on the audio clock) so playback
// stays tight even when the main thread is busy. No audio files: every sound
// is generated live, same approach as PLAYER.

import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const STEPS = 16;          // 16th notes -> one bar
const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Track definitions. `voice` names the synth recipe in the engine below.
// `note` (Hz) only matters for pitched voices. Default pattern seeds a beat
// so the grid is never empty on open.
const TRACKS = [
  { name: 'KICK',  voice: 'kick',  note: 0,      seed: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0] },
  { name: 'SNARE', voice: 'snare', note: 0,      seed: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1] },
  { name: 'HAT',   voice: 'hat',   note: 0,      seed: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1] },
  { name: 'BASS',  voice: 'bass',  note: 55.00,  seed: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0] }, // A1
  { name: 'LEAD',  voice: 'lead',  note: 440.00, seed: [0,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,1,0] }, // A4
];

function render(el, win) {
  el.innerHTML = `
    <div class="studio">
      <div class="studio__transport">
        <button class="studio__btn studio__play" data-act="play" type="button"
          title="play" aria-label="play">▶</button>
        <button class="studio__btn" data-act="stop" type="button"
          title="stop" aria-label="stop">■</button>
        <label class="studio__field">
          <span>BPM</span>
          <input class="studio__bpm" type="number" min="60" max="200" value="110"
            aria-label="tempo in beats per minute" />
        </label>
        <label class="studio__field studio__field--vol">
          <span>VOL</span>
          <input class="studio__vol" type="range" min="0" max="100" value="75"
            aria-label="master volume" />
        </label>
        <span class="studio__spacer"></span>
        <button class="studio__btn studio__btn--ghost" data-act="rand" type="button"
          title="randomize" aria-label="randomize pattern">RND</button>
        <button class="studio__btn studio__btn--ghost" data-act="clear" type="button"
          title="clear" aria-label="clear pattern">CLR</button>
      </div>

      <div class="studio__grid" role="grid" aria-label="step sequencer"></div>

      <div class="studio__meter" aria-hidden="true">
        <canvas class="studio__scope" width="480" height="40"></canvas>
      </div>
    </div>
  `;

  const gridEl = el.querySelector('.studio__grid');
  const playBtn = el.querySelector('.studio__play');
  const bpmInput = el.querySelector('.studio__bpm');
  const volInput = el.querySelector('.studio__vol');
  const scope = el.querySelector('.studio__scope');
  const sctx = scope.getContext('2d');

  // pattern[trackIndex][step] = 0 | 1
  const pattern = TRACKS.map(t => t.seed.slice());
  const muted = TRACKS.map(() => false);

  // ---- build the grid UI -----------------------------------------------
  // Each track is a row: a label/mute head + STEPS cells.
  const cellEls = TRACKS.map(() => new Array(STEPS));
  TRACKS.forEach((track, r) => {
    const row = document.createElement('div');
    row.className = 'studio__row';
    row.dataset.voice = track.voice;

    const head = document.createElement('button');
    head.className = 'studio__rowhead';
    head.type = 'button';
    head.textContent = track.name;
    head.title = `mute ${track.name}`;
    head.setAttribute('aria-label', `mute ${track.name}`);
    onTap(head, () => {
      muted[r] = !muted[r];
      head.classList.toggle('is-muted', muted[r]);
    });
    row.appendChild(head);

    const cells = document.createElement('div');
    cells.className = 'studio__cells';
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('button');
      cell.className = 'studio__cell';
      cell.type = 'button';
      cell.dataset.r = String(r);
      cell.dataset.s = String(s);
      // every 4th step gets a beat marker so the bar is readable
      if (s % 4 === 0) cell.classList.add('is-beat');
      if (pattern[r][s]) cell.classList.add('is-on');
      cell.setAttribute('aria-label', `${track.name} step ${s + 1}`);
      onTap(cell, () => {
        pattern[r][s] ^= 1;
        cell.classList.toggle('is-on', !!pattern[r][s]);
        // audition the hit when toggling on while stopped
        if (pattern[r][s] && !playing) trigger(track, ensureAudio() ? actx.currentTime : 0);
      });
      cells.appendChild(cell);
      cellEls[r][s] = cell;
    }
    row.appendChild(cells);
    gridEl.appendChild(row);
  });

  // ---- Web Audio engine -------------------------------------------------
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null, master = null, analyser = null, scopeData = null;

  function volGain() { return Math.pow(volInput.value / 100, 1.6) * 0.8; }

  function ensureAudio() {
    if (!AC) return false;
    if (!actx) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = volGain();
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      scopeData = new Uint8Array(analyser.fftSize);
      master.connect(analyser);
      analyser.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return true;
  }

  // Short-lived noise buffer reused by snare/hat voices.
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.4, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  // Fire one voice at audio-clock time `t`.
  function trigger(track, t) {
    if (!actx) return;
    switch (track.voice) {
      case 'kick': {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 0.32);
        break;
      }
      case 'snare': {
        const n = noise();
        const bp = actx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        n.connect(bp).connect(g).connect(master);
        n.start(t); n.stop(t + 0.2);
        break;
      }
      case 'hat': {
        const n = noise();
        const hp = actx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 7000;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        n.connect(hp).connect(g).connect(master);
        n.start(t); n.stop(t + 0.06);
        break;
      }
      case 'bass': {
        const o = actx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = track.note;
        const lp = actx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 6;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.connect(lp).connect(g).connect(master);
        o.start(t); o.stop(t + 0.24);
        break;
      }
      case 'lead': {
        const o = actx.createOscillator();
        o.type = 'triangle'; o.frequency.value = track.note;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 0.2);
        break;
      }
    }
  }

  // ---- lookahead scheduler ---------------------------------------------
  let playing = false;
  let currentStep = 0;
  let nextNoteTime = 0;          // audio-clock time of the next 16th
  let pumpId = 0;                // setTimeout handle
  let rafId = 0;
  const LOOKAHEAD = 25;          // ms between scheduler wakeups
  const AHEAD = 0.1;             // s of audio scheduled in advance
  const drawQueue = [];          // {step, time} to sync the playhead UI

  function secondsPerStep() {
    const bpm = clampBpm();
    return (60 / bpm) / 4;       // 16th note
  }

  function scheduleStep(step, time) {
    TRACKS.forEach((track, r) => {
      if (!muted[r] && pattern[r][step]) trigger(track, time);
    });
    drawQueue.push({ step, time });
  }

  function advance() {
    nextNoteTime += secondsPerStep();
    currentStep = (currentStep + 1) % STEPS;
  }

  function pump() {
    while (nextNoteTime < actx.currentTime + AHEAD) {
      scheduleStep(currentStep, nextNoteTime);
      advance();
    }
    pumpId = setTimeout(pump, LOOKAHEAD);
  }

  function start() {
    if (playing) return;
    if (!ensureAudio()) return;   // no Web Audio: stay silent
    playing = true;
    setPlayUI(true);
    currentStep = 0;
    nextNoteTime = actx.currentTime + 0.06;
    pump();
    if (!reducedMotion()) rafId = requestAnimationFrame(draw);
  }

  function stop() {
    playing = false;
    setPlayUI(false);
    if (pumpId) { clearTimeout(pumpId); pumpId = 0; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    drawQueue.length = 0;
    clearPlayhead();
    if (analyser) drawScope(false);
  }

  function setPlayUI(on) {
    playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', on ? 'pause' : 'play');
    playBtn.title = on ? 'pause' : 'play';
    el.querySelector('.studio').classList.toggle('is-playing', on);
  }

  let litStep = -1;
  function lightStep(step) {
    if (step === litStep) return;
    clearPlayhead();
    for (let r = 0; r < TRACKS.length; r++) cellEls[r][step].classList.add('is-playhead');
    litStep = step;
  }
  function clearPlayhead() {
    if (litStep < 0) return;
    for (let r = 0; r < TRACKS.length; r++) cellEls[r][litStep]?.classList.remove('is-playhead');
    litStep = -1;
  }

  // rAF loop: advance the playhead in sync with the audio clock and paint
  // the oscilloscope. Pops the draw queue once a scheduled step is audible.
  function draw() {
    if (!document.contains(gridEl)) { stop(); return; }
    if (!playing) return;
    const now = actx.currentTime;
    let step = litStep;
    while (drawQueue.length && drawQueue[0].time <= now) {
      step = drawQueue.shift().step;
    }
    if (step >= 0) lightStep(step);
    drawScope(true);
    rafId = requestAnimationFrame(draw);
  }

  function drawScope(active) {
    const w = scope.width, h = scope.height;
    sctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#b6ff3c';
    sctx.strokeStyle = accent;
    sctx.lineWidth = 1.5;
    sctx.beginPath();
    if (active && analyser) {
      analyser.getByteTimeDomainData(scopeData);
      const slice = w / scopeData.length;
      for (let i = 0; i < scopeData.length; i++) {
        const y = (scopeData[i] / 255) * h;
        const x = i * slice;
        i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
      }
    } else {
      sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2);
    }
    sctx.stroke();
  }

  function clampBpm() {
    let v = parseInt(bpmInput.value, 10);
    if (!Number.isFinite(v)) v = 110;
    return Math.min(200, Math.max(60, v));
  }

  // ---- wiring -----------------------------------------------------------
  onTap(playBtn, () => { playing ? stop() : start(); });
  onTap(el.querySelector('[data-act="stop"]'), () => stop());
  onTap(el.querySelector('[data-act="clear"]'), () => {
    pattern.forEach((row, r) => row.forEach((_, s) => {
      pattern[r][s] = 0;
      cellEls[r][s].classList.remove('is-on');
    }));
  });
  onTap(el.querySelector('[data-act="rand"]'), () => {
    pattern.forEach((row, r) => row.forEach((_, s) => {
      // weight by voice so randoms still sound like a beat, not noise
      const density = TRACKS[r].voice === 'hat' ? 0.5
                    : TRACKS[r].voice === 'kick' ? 0.3 : 0.25;
      pattern[r][s] = Math.random() < density ? 1 : 0;
      cellEls[r][s].classList.toggle('is-on', !!pattern[r][s]);
    }));
  });
  volInput.addEventListener('input', () => {
    if (master && actx) master.gain.setTargetAtTime(volGain(), actx.currentTime, 0.03);
  });
  bpmInput.addEventListener('change', () => { bpmInput.value = clampBpm(); });

  // tear down the engine + loops on window close
  const origClose = win.close;
  win.close = () => {
    stop();
    if (actx) { try { actx.close(); } catch { /* already closed */ } actx = null; }
    origClose();
  };

  drawScope(false);
}

registerApp({
  id: 'studio', name: 'STUDIO', icon: '🎛️', desktop: true,
  open: () => wm.open({
    id: 'studio', title: 'STUDIO', icon: '🎛️', width: 560, height: 420,
    className: 'app-studio',
    render,
  }),
});
