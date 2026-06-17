// studio.js - STUDIO (a lightweight DAW: multitrack step sequencer).
// A mockup-grade nod to Zrythm / openDAW: real tracks, a real transport, a
// real Web Audio engine. Each track is a synthesized voice triggered by a
// step grid. Timing uses the classic lookahead scheduler (a setTimeout pump
// that schedules notes slightly ahead on the audio clock) so playback stays
// tight even when the main thread is busy. No audio files: every sound is
// generated live by the shared sequencer-store voices.
//
// Features layered on the base sequencer:
//  - per-step velocity (shift/right-click cycles accent levels)
//  - 16 or 32 steps (two bars)
//  - independent patterns A and B, with optional A->B chaining
//  - swing (delays every other 16th)
//  - SHARE (encode whole beat into the URL hash + clipboard)
//  - SAVE (persist to localStorage; PLAYER reads these)
//  - export to 16-bit PCM WAV (offline render)

import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';
import {
  TRACKS, VELOCITY_LEVELS, MAX_STEPS,
  triggerVoice, secondsPerStep, swingOffset,
  defaultBeat, normalizeBeat, encodeBeat, decodeBeat,
  saveBeat, renderBeatToWav, buildSchedule,
} from './sequencer-store.js';

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Read a beat from the URL hash, if it carries one (#beat=...).
function beatFromHash() {
  const h = window.location.hash || '';
  const m = h.match(/beat=([A-Za-z0-9\-_]+)/);
  if (!m) return null;
  return decodeBeat(m[1]);
}

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
        <label class="studio__field">
          <span>SWING</span>
          <input class="studio__swing" type="range" min="0" max="60" value="0"
            aria-label="swing amount percent" />
          <span class="studio__swing-val">0%</span>
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

      <div class="studio__patbar">
        <div class="studio__patgroup" role="group" aria-label="pattern select">
          <button class="studio__pat is-active" data-pat="0" type="button" aria-label="pattern A">A</button>
          <button class="studio__pat" data-pat="1" type="button" aria-label="pattern B">B</button>
          <button class="studio__btn studio__btn--ghost studio__chain" data-act="chain" type="button"
            title="chain A then B" aria-label="chain patterns">CHAIN</button>
        </div>
        <button class="studio__btn studio__btn--ghost studio__len" data-act="len" type="button"
          title="toggle bar length" aria-label="toggle 16 or 32 steps">16</button>
        <span class="studio__spacer"></span>
        <button class="studio__btn studio__btn--ghost" data-act="save" type="button"
          title="save beat" aria-label="save beat">SAVE</button>
        <button class="studio__btn studio__btn--ghost" data-act="share" type="button"
          title="copy share link" aria-label="copy share link">SHARE</button>
        <button class="studio__btn studio__btn--ghost" data-act="wav" type="button"
          title="export wav" aria-label="export to wav">WAV</button>
      </div>

      <div class="studio__grid" role="grid" aria-label="step sequencer"></div>

      <div class="studio__meter" aria-hidden="true">
        <canvas class="studio__scope" width="480" height="40"></canvas>
        <span class="studio__toast" aria-live="polite"></span>
      </div>
    </div>
  `;

  const gridEl = el.querySelector('.studio__grid');
  const playBtn = el.querySelector('.studio__play');
  const bpmInput = el.querySelector('.studio__bpm');
  const volInput = el.querySelector('.studio__vol');
  const swingInput = el.querySelector('.studio__swing');
  const swingVal = el.querySelector('.studio__swing-val');
  const lenBtn = el.querySelector('.studio__len');
  const chainBtn = el.querySelector('.studio__chain');
  const patBtns = [...el.querySelectorAll('.studio__pat')];
  const toastEl = el.querySelector('.studio__toast');
  const scope = el.querySelector('.studio__scope');
  const sctx = scope.getContext('2d');

  // ---- beat state -------------------------------------------------------
  // Seed from the URL hash if present, else a default beat.
  const beat = beatFromHash() || defaultBeat();
  let activePat = 0;              // which pattern (0=A, 1=B) is being edited
  const muted = TRACKS.map(() => false);

  // The grid edits beat.patterns[activePat].vel directly.
  function vel() { return beat.patterns[activePat].vel; }

  // sync transport controls to the loaded beat
  bpmInput.value = beat.bpm;
  swingInput.value = beat.swing;
  swingVal.textContent = beat.swing + '%';
  lenBtn.textContent = String(beat.steps);
  chainBtn.classList.toggle('is-on', beat.chain);

  // ---- build the grid UI -----------------------------------------------
  // cellEls is rebuilt whenever the step count changes.
  let cellEls = [];

  function buildGrid() {
    gridEl.innerHTML = '';
    gridEl.classList.toggle('is-32', beat.steps === MAX_STEPS);
    cellEls = TRACKS.map(() => new Array(beat.steps));
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
      if (muted[r]) head.classList.add('is-muted');
      onTap(head, () => {
        muted[r] = !muted[r];
        head.classList.toggle('is-muted', muted[r]);
      });
      row.appendChild(head);

      const cells = document.createElement('div');
      cells.className = 'studio__cells';
      cells.style.gridTemplateColumns = `repeat(${beat.steps}, 1fr)`;
      for (let s = 0; s < beat.steps; s++) {
        const cell = document.createElement('button');
        cell.className = 'studio__cell';
        cell.type = 'button';
        cell.dataset.r = String(r);
        cell.dataset.s = String(s);
        if (s % 4 === 0) cell.classList.add('is-beat');
        if (s === 16) cell.classList.add('is-bar2'); // start of second bar
        cell.setAttribute('aria-label', `${track.name} step ${s + 1}`);

        // primary tap: toggle on/off (on -> full velocity, off when already on)
        onTap(cell, (e) => {
          // shift-tap cycles the accent level instead of toggling off
          if (e && e.shiftKey && vel()[r][s] > 0) {
            cycleVel(r, s);
          } else {
            toggleStep(r, s);
          }
        });
        // right-click cycles accent levels (and never shows the menu)
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (vel()[r][s] > 0) cycleVel(r, s);
          else toggleStep(r, s);
        });

        cells.appendChild(cell);
        cellEls[r][s] = cell;
      }
      row.appendChild(cells);
      gridEl.appendChild(row);
    });
    paintAllCells();
  }

  // velocity -> visual class. level 0 = off; otherwise 1..N accent classes.
  function velLevel(v) {
    if (v <= 0) return 0;
    // find nearest defined accent level (1-based)
    let lvl = 1;
    for (let i = 1; i < VELOCITY_LEVELS.length; i++) {
      if (v >= VELOCITY_LEVELS[i] - 1e-6) lvl = i;
    }
    return lvl;
  }

  function paintCell(r, s) {
    const cell = cellEls[r][s];
    if (!cell) return;
    const lvl = velLevel(vel()[r][s]);
    cell.classList.toggle('is-on', lvl > 0);
    cell.classList.remove('v1', 'v2', 'v3');
    if (lvl > 0) cell.classList.add('v' + lvl);
  }

  function paintAllCells() {
    for (let r = 0; r < TRACKS.length; r++)
      for (let s = 0; s < beat.steps; s++) paintCell(r, s);
  }

  function toggleStep(r, s) {
    const cur = vel()[r][s];
    if (cur > 0) {
      vel()[r][s] = 0;
    } else {
      vel()[r][s] = VELOCITY_LEVELS[VELOCITY_LEVELS.length - 1]; // full
      if (!playing) trigger(r, ensureAudio() ? actx.currentTime : 0, vel()[r][s]);
    }
    paintCell(r, s);
  }

  function cycleVel(r, s) {
    const lvl = velLevel(vel()[r][s]);
    const next = lvl + 1 >= VELOCITY_LEVELS.length ? 1 : lvl + 1;
    vel()[r][s] = VELOCITY_LEVELS[next];
    paintCell(r, s);
    if (!playing) trigger(r, ensureAudio() ? actx.currentTime : 0, vel()[r][s]);
  }

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

  // Fire track r at time t with velocity v through the shared voice recipes.
  function trigger(r, t, v) {
    if (!actx) return;
    triggerVoice(actx, master, TRACKS[r], t, v);
  }

  // ---- lookahead scheduler ---------------------------------------------
  // The scheduler walks "slots" (a slot is one step of the playing cycle).
  // When chaining, the cycle is two patterns long; the slot index maps back
  // to (pattern, step) so the right grid cells light and the right pattern
  // plays. Swing delays odd 16ths within each bar.
  let playing = false;
  let slot = 0;                  // index into the current cycle
  let nextNoteTime = 0;
  let pumpId = 0;
  let rafId = 0;
  const LOOKAHEAD = 25;
  const AHEAD = 0.1;
  const drawQueue = [];          // {pat, step, time}

  function cycleSlots() {
    return beat.chain ? beat.steps * 2 : beat.steps;
  }

  function clampBpmInput() {
    let v = parseInt(bpmInput.value, 10);
    if (!Number.isFinite(v)) v = 110;
    return Math.min(200, Math.max(60, v));
  }

  function secsPerStep() { return secondsPerStep(clampBpmInput()); }

  // resolve a cycle slot to {pat, step}
  function slotMap(sl) {
    if (beat.chain && sl >= beat.steps) return { pat: 1, step: sl - beat.steps };
    return { pat: beat.chain ? 0 : activePat, step: sl };
  }

  function scheduleSlot(sl, time) {
    const { pat, step } = slotMap(sl);
    const v = beat.patterns[pat].vel;
    TRACKS.forEach((_, r) => {
      const lvl = v[r][step];
      if (!muted[r] && lvl > 0) trigger(r, time, lvl);
    });
    drawQueue.push({ pat, step, time });
  }

  function advance() {
    nextNoteTime += secsPerStep();
    slot = (slot + 1) % cycleSlots();
  }

  function pump() {
    while (nextNoteTime < actx.currentTime + AHEAD) {
      const { step } = slotMap(slot);
      const t = nextNoteTime + swingOffset(step, clampBpmInput(), beat.swing);
      scheduleSlot(slot, t);
      advance();
    }
    pumpId = setTimeout(pump, LOOKAHEAD);
  }

  function start() {
    if (playing) return;
    if (!ensureAudio()) return;
    playing = true;
    setPlayUI(true);
    slot = 0;
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

  // The playhead only lights cells that belong to the currently shown pattern.
  let litPat = -1, litStep = -1;
  function lightStep(pat, step) {
    if (pat === litPat && step === litStep) return;
    clearPlayhead();
    if (pat === shownPat()) {
      for (let r = 0; r < TRACKS.length; r++) cellEls[r][step]?.classList.add('is-playhead');
    }
    litPat = pat; litStep = step;
  }
  function clearPlayhead() {
    if (litStep < 0) return;
    for (let r = 0; r < TRACKS.length; r++) cellEls[r][litStep]?.classList.remove('is-playhead');
    litPat = -1; litStep = -1;
  }
  // which pattern the grid is currently displaying (when chaining, the editor
  // still shows activePat; the playhead only appears while that pattern plays)
  function shownPat() { return activePat; }

  function draw() {
    if (!document.contains(gridEl)) { stop(); return; }
    if (!playing) return;
    const now = actx.currentTime;
    let cur = null;
    while (drawQueue.length && drawQueue[0].time <= now) {
      cur = drawQueue.shift();
    }
    if (cur) lightStep(cur.pat, cur.step);
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

  // ---- brief toast confirmation ----------------------------------------
  let toastId = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastId);
    toastId = setTimeout(() => toastEl.classList.remove('is-show'), 1600);
  }

  // ---- snapshot current UI into the beat object ------------------------
  function syncBeatFromUI() {
    beat.bpm = clampBpmInput();
    beat.swing = Math.min(60, Math.max(0, parseInt(swingInput.value, 10) || 0));
    // steps + chain + pattern vels are already mutated in place
    return normalizeBeat(beat);
  }

  // ---- pattern switching + length --------------------------------------
  function selectPattern(p) {
    if (p === activePat) return;
    activePat = p;
    patBtns.forEach((b, i) => b.classList.toggle('is-active', i === p));
    clearPlayhead();
    paintAllCells();
  }

  function setSteps(n) {
    if (beat.steps === n) return;
    beat.steps = n;
    // grow/shrink both patterns' velocity rows
    beat.patterns.forEach(p => {
      p.vel = p.vel.map(row => {
        const next = new Array(n).fill(0);
        for (let s = 0; s < Math.min(n, row.length); s++) next[s] = row[s];
        return next;
      });
    });
    lenBtn.textContent = String(n);
    const wasPlaying = playing;
    if (wasPlaying) stop();
    buildGrid();
    if (wasPlaying) start();
  }

  // ---- wiring -----------------------------------------------------------
  onTap(playBtn, () => { playing ? stop() : start(); });
  onTap(el.querySelector('[data-act="stop"]'), () => stop());

  onTap(el.querySelector('[data-act="clear"]'), () => {
    vel().forEach(row => row.fill(0));
    paintAllCells();
  });
  onTap(el.querySelector('[data-act="rand"]'), () => {
    const v = vel();
    TRACKS.forEach((t, r) => {
      const density = t.voice === 'hat' ? 0.5 : t.voice === 'kick' ? 0.3 : 0.25;
      for (let s = 0; s < beat.steps; s++) {
        if (Math.random() < density) {
          const levels = VELOCITY_LEVELS.slice(1);
          v[r][s] = levels[Math.floor(Math.random() * levels.length)];
        } else v[r][s] = 0;
      }
    });
    paintAllCells();
  });

  patBtns.forEach(b => onTap(b, () => selectPattern(parseInt(b.dataset.pat, 10))));
  onTap(chainBtn, () => {
    beat.chain = !beat.chain;
    chainBtn.classList.toggle('is-on', beat.chain);
    if (playing) { stop(); start(); }
  });
  onTap(lenBtn, () => setSteps(beat.steps === MAX_STEPS ? 16 : MAX_STEPS));

  onTap(el.querySelector('[data-act="save"]'), () => {
    const name = (prompt('Name this beat:', beat.name) || '').trim();
    if (!name) return;
    beat.name = name;
    saveBeat(name, syncBeatFromUI());
    toast('saved: ' + name);
  });

  onTap(el.querySelector('[data-act="share"]'), async () => {
    const hash = '#beat=' + encodeBeat(syncBeatFromUI());
    const url = location.origin + location.pathname + location.search + hash;
    try { history.replaceState(null, '', hash); } catch { /* ignore */ }
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch { ok = false; }
    toast(ok ? 'link copied' : 'link in URL bar');
  });

  onTap(el.querySelector('[data-act="wav"]'), async () => {
    toast('rendering wav...');
    try {
      const b = syncBeatFromUI();
      const blob = await renderBeatToWav(b, b.chain ? 1 : 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (b.name || 'cozy-beat').replace(/[^a-z0-9\-_]+/gi, '_') + '.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('wav exported');
    } catch (err) {
      toast('wav failed');
      console.warn('wav export failed', err);
    }
  });

  volInput.addEventListener('input', () => {
    if (master && actx) master.gain.setTargetAtTime(volGain(), actx.currentTime, 0.03);
  });
  bpmInput.addEventListener('change', () => { bpmInput.value = clampBpmInput(); beat.bpm = clampBpmInput(); });
  swingInput.addEventListener('input', () => {
    beat.swing = parseInt(swingInput.value, 10) || 0;
    swingVal.textContent = beat.swing + '%';
  });

  // tear down the engine + loops on window close
  const origClose = win.close;
  win.close = () => {
    stop();
    clearTimeout(toastId);
    if (actx) { try { actx.close(); } catch { /* already closed */ } actx = null; }
    origClose();
  };

  buildGrid();
  drawScope(false);
}

registerApp({
  id: 'studio', name: 'STUDIO', icon: '🎛️', desktop: true,
  open: () => wm.open({
    id: 'studio', title: 'STUDIO', icon: '🎛️', width: 620, height: 480,
    className: 'app-studio',
    render,
  }),
});
