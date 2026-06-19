// radio.js - cozyfiles radio. A GENERATIVE ambient stream synthesized entirely
// with the Web Audio API (no audio files, no streaming). Slowly evolving pads,
// a low drone, and soft random "drift" textures wander through a shared lowpass
// + reverb-ish delay so the room never repeats the same way twice.
//
// 100% our own code (MIT). Voice recipes and the lookahead idea descend from
// cozyfiles' own earlier STUDIO app; this is a fresh, drone-focused engine with
// no step grid - just continuously seeded chords + textures.
//
// AUTOPLAY-SAFE: the AudioContext is only created on a user gesture (the Play
// button). An opt-in "auto-start on first interaction" toggle is persisted to
// localStorage (default OFF) and, when enabled, waits for the visitor's first
// real interaction anywhere before starting - it never autoplays cold.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const AC = window.AudioContext || window.webkitAudioContext;
const LS_AUTOSTART = 'cozyfiles.radio.autostart';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- localStorage helpers (namespaced) -------------------------------------
function getAutostart() {
  try { return localStorage.getItem(LS_AUTOSTART) === '1'; } catch { return false; }
}
function setAutostart(on) {
  try { localStorage.setItem(LS_AUTOSTART, on ? '1' : '0'); } catch { /* private mode */ }
}

// ---- musical material -------------------------------------------------------
// A small palette of ambient "moods": a root frequency + a set of intervals
// (in semitones from the root) the pad voices draw chord tones from. The
// generator slowly drifts between moods so the now-playing label keeps changing.
const A4 = 440;
const semis = (n) => A4 * Math.pow(2, (n - 9) / 12); // n: semitone index, 9 = A4
const MOODS = [
  { name: 'amber drift',   root: -17, scale: [0, 3, 7, 10, 14] },   // minor 7 add9
  { name: 'paper snow',    root: -15, scale: [0, 2, 7, 9, 12] },    // sus pentatonic
  { name: 'low tide',      root: -20, scale: [0, 5, 7, 12, 17] },   // open fourths
  { name: 'soft static',   root: -12, scale: [0, 4, 7, 11, 14] },   // major 7 add9
  { name: 'dust + light',  root: -19, scale: [0, 3, 5, 10, 12] },   // dorian-ish
  { name: 'quiet engine',  root: -22, scale: [0, 7, 12, 14, 19] },  // wide + airy
  { name: 'late window',   root: -16, scale: [0, 2, 5, 9, 11] },    // mellow
];

function noteHz(mood, scaleIdx, octave = 0) {
  const interval = mood.scale[scaleIdx % mood.scale.length];
  return semis(mood.root + interval + octave * 12);
}

// ---- the generative engine -------------------------------------------------
// One AudioContext, a persistent master chain (drone + pad bus -> lowpass ->
// delay shimmer -> master gain -> analyser -> destination), and a scheduler
// that keeps spawning short-lived pad voices and a slow drone. Built lazily on
// the first user gesture; torn down fully on stop / window close.
class RadioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;       // { gain, lowpass, analyser }
    this.drone = null;        // { oscA, oscB, gain }
    this.playing = false;
    this.volume = 0.6;        // 0..1
    this.moodIndex = 0;
    this.bars = 0;            // how many voices spawned (drives mood drift)
    this._voiceTimer = 0;
    this._moodTimer = 0;
    this._activeNodes = new Set(); // live voice gain nodes, for clean teardown
    this._onMood = null;      // ui callback (moodName) => void
  }

  get supported() { return !!AC; }
  get moodName() { return MOODS[this.moodIndex].name; }

  // Build the persistent graph once. Resumes a suspended context. Returns true
  // when audio is available.
  ensureAudio() {
    if (!AC) return false;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.value = this._volToGain(this.volume);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1600;
      lowpass.Q.value = 0.4;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;

      // a soft "shimmer": short feedback delay so pad tails bloom and overlap
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.42;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.34;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;

      // pad/drone bus -> lowpass -> (dry + delayed) -> masterGain
      lowpass.connect(masterGain);
      lowpass.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(masterGain);

      masterGain.connect(analyser);
      analyser.connect(ctx.destination);

      this.master = { gain: masterGain, lowpass, analyser, delay };
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  // perceptual volume curve
  _volToGain(v) {
    const x = Math.max(0, Math.min(1, v));
    return Math.pow(x, 1.7) * 0.85;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.gain.setTargetAtTime(
        this._volToGain(this.volume), this.ctx.currentTime, 0.08);
    }
    return this.volume;
  }

  // ---- voices --------------------------------------------------------------
  // A slow low drone (two slightly detuned oscillators) that fades in under the
  // whole stream and gets retuned softly on each mood change.
  _startDrone() {
    const ctx = this.ctx;
    const mood = MOODS[this.moodIndex];
    const hz = noteHz(mood, 0, -1); // root, one octave down
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'sine';
    oscA.frequency.value = hz;
    oscB.frequency.value = hz * 1.004; // gentle beat
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.16, ctx.currentTime, 4); // slow swell
    oscA.connect(g); oscB.connect(g);
    g.connect(this.master.lowpass);
    oscA.start(); oscB.start();
    this.drone = { oscA, oscB, gain: g };
  }

  _retuneDrone() {
    if (!this.drone || !this.ctx) return;
    const mood = MOODS[this.moodIndex];
    const hz = noteHz(mood, 0, -1);
    const t = this.ctx.currentTime;
    this.drone.oscA.frequency.setTargetAtTime(hz, t, 3);
    this.drone.oscB.frequency.setTargetAtTime(hz * 1.004, t, 3);
  }

  // One soft pad note: a saw/triangle pair under a long swell envelope, drifting
  // gently in pitch. Self-cleans when its tail completes.
  _spawnPad() {
    const ctx = this.ctx;
    const mood = MOODS[this.moodIndex];
    const now = ctx.currentTime;

    const scaleIdx = Math.floor(Math.random() * mood.scale.length);
    const octave = Math.random() < 0.35 ? 1 : 0;
    const hz = noteHz(mood, scaleIdx, octave);

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'triangle';
    oscB.type = 'sawtooth';
    oscA.frequency.value = hz;
    oscB.frequency.value = hz * 1.006; // chorus-y detune

    // very gentle slow LFO drift on pitch so pads breathe
    const drift = ctx.createOscillator();
    const driftGain = ctx.createGain();
    drift.frequency.value = 0.07 + Math.random() * 0.08;
    driftGain.gain.value = hz * 0.004;
    drift.connect(driftGain);
    driftGain.connect(oscA.frequency);
    driftGain.connect(oscB.frequency);

    const g = ctx.createGain();
    const peak = 0.05 + Math.random() * 0.05;
    const attack = 2.5 + Math.random() * 2.5;
    const hold = 3 + Math.random() * 4;
    const release = 4 + Math.random() * 4;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + attack);
    g.gain.setValueAtTime(peak, now + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release);

    oscA.connect(g); oscB.connect(g);
    g.connect(this.master.lowpass);

    const stopAt = now + attack + hold + release + 0.2;
    oscA.start(now); oscB.start(now); drift.start(now);
    oscA.stop(stopAt); oscB.stop(stopAt); drift.stop(stopAt);

    this._activeNodes.add(g);
    const cleanup = () => {
      this._activeNodes.delete(g);
      try { g.disconnect(); } catch { /* */ }
      try { driftGain.disconnect(); } catch { /* */ }
    };
    oscA.onended = cleanup;
  }

  // ---- scheduler -----------------------------------------------------------
  // Not a metronome: pad voices are seeded at slow, slightly irregular gaps so
  // the texture overlaps and never locks to a beat. The mood drifts every so
  // many voices, retuning the drone and notifying the UI.
  _scheduleNextVoice() {
    if (!this.playing) return;
    this._spawnPad();
    this.bars += 1;
    // drift to a new mood every 7-10 voices
    if (this.bars % (7 + Math.floor(Math.random() * 4)) === 0) {
      this.moodIndex = (this.moodIndex + 1 + Math.floor(Math.random() * (MOODS.length - 1))) % MOODS.length;
      this._retuneDrone();
      if (this._onMood) this._onMood(this.moodName);
    }
    const gap = 1800 + Math.random() * 2600; // 1.8s..4.4s between seeds
    this._voiceTimer = setTimeout(() => this._scheduleNextVoice(), gap);
  }

  start(onMood) {
    if (this.playing) return false;
    if (!this.ensureAudio()) return false;
    this.playing = true;
    this._onMood = typeof onMood === 'function' ? onMood : null;
    this.moodIndex = Math.floor(Math.random() * MOODS.length);
    this._startDrone();
    if (this._onMood) this._onMood(this.moodName);
    // seed a couple of overlapping pads right away so it does not start empty
    this._spawnPad();
    setTimeout(() => { if (this.playing) this._spawnPad(); }, 900);
    this._voiceTimer = setTimeout(() => this._scheduleNextVoice(), 2400);
    return true;
  }

  stop() {
    this.playing = false;
    if (this._voiceTimer) { clearTimeout(this._voiceTimer); this._voiceTimer = 0; }
    if (this.drone && this.ctx) {
      const t = this.ctx.currentTime;
      // fade the drone out, then stop its oscillators
      this.drone.gain.gain.setTargetAtTime(0.0001, t, 0.6);
      try { this.drone.oscA.stop(t + 2); } catch { /* */ }
      try { this.drone.oscB.stop(t + 2); } catch { /* */ }
      this.drone = null;
    }
    // let active pad tails fade naturally; quieten the master a touch
    this._activeNodes.forEach((g) => {
      try {
        const t = this.ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.5);
      } catch { /* */ }
    });
  }

  // RMS 0..1 from the master analyser (drives the visualizer).
  level() {
    if (!this.master) return 0;
    const a = this.master.analyser;
    const buf = a.__buf || (a.__buf = new Uint8Array(a.fftSize));
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = (buf[i] - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.4);
  }

  // frequency-domain bars 0..1 for the spectrum visualizer.
  spectrum(bins) {
    if (!this.master) return new Array(bins).fill(0);
    const a = this.master.analyser;
    const freq = a.__freq || (a.__freq = new Uint8Array(a.frequencyBinCount));
    a.getByteFrequencyData(freq);
    const out = new Array(bins);
    // sample the lower 60% of the spectrum (ambient lives down low)
    const span = Math.floor(freq.length * 0.6);
    const per = Math.max(1, Math.floor(span / bins));
    for (let b = 0; b < bins; b++) {
      let m = 0;
      for (let i = 0; i < per; i++) m = Math.max(m, freq[b * per + i] || 0);
      out[b] = m / 255;
    }
    return out;
  }

  // Full teardown. Safe to call repeatedly; leaves the engine inert.
  dispose() {
    this.stop();
    this._onMood = null;
    this._activeNodes.forEach((g) => { try { g.disconnect(); } catch { /* */ } });
    this._activeNodes.clear();
    if (this.master) {
      try { this.master.gain.disconnect(); } catch { /* */ }
      try { this.master.lowpass.disconnect(); } catch { /* */ }
      try { this.master.analyser.disconnect(); } catch { /* */ }
      try { this.master.delay && this.master.delay.disconnect(); } catch { /* */ }
    }
    if (this.ctx) { try { this.ctx.close(); } catch { /* already closed */ } }
    this.ctx = null;
    this.master = null;
    this.drone = null;
  }
}

const MARKUP = `
  <div class="radio">
    <div class="radio__screen">
      <canvas class="radio__viz" aria-hidden="true"></canvas>
      <div class="radio__nowplaying">
        <span class="radio__np-label">now playing</span>
        <span class="radio__np-mood" id="radio-mood">- off air -</span>
        <span class="radio__np-sub">cozyfiles ambient // generated live</span>
      </div>
      <span class="radio__onair" id="radio-onair" aria-hidden="true">ON AIR</span>
    </div>

    <div class="radio__controls">
      <button type="button" class="radio__play" id="radio-play"
        aria-label="play ambient radio" aria-pressed="false">
        <span class="radio__play-glyph" aria-hidden="true">&#9654;</span>
        <span class="radio__play-text">play</span>
      </button>
      <label class="radio__vol">
        <span class="radio__vol-label" aria-hidden="true">vol</span>
        <input type="range" class="radio__vol-slider" id="radio-vol"
          min="0" max="100" value="60" aria-label="volume" />
      </label>
    </div>

    <label class="radio__auto">
      <input type="checkbox" class="radio__auto-box" id="radio-auto" />
      <span class="radio__auto-text">auto-start ambient on first interaction</span>
    </label>

    <p class="radio__note" id="radio-note">// press play. no files, no streaming - the room is synthesized live.</p>
  </div>
`;

function render(root, handle) {
  root.innerHTML = MARKUP;
  const engine = new RadioEngine();

  const playBtn = root.querySelector('#radio-play');
  const playText = playBtn.querySelector('.radio__play-text');
  const playGlyph = playBtn.querySelector('.radio__play-glyph');
  const volSlider = root.querySelector('#radio-vol');
  const moodEl = root.querySelector('#radio-mood');
  const onairEl = root.querySelector('#radio-onair');
  const autoBox = root.querySelector('#radio-auto');
  const noteEl = root.querySelector('#radio-note');
  const canvas = root.querySelector('.radio__viz');
  const radioEl = root.querySelector('.radio');
  const ctx2d = canvas.getContext('2d');

  let rafId = 0;
  let firstInteractionHook = null; // listener disposer if auto-start is armed

  if (!engine.supported) {
    noteEl.textContent = '// Web Audio is unavailable in this browser.';
    playBtn.disabled = true;
    volSlider.disabled = true;
    autoBox.disabled = true;
  }

  // ---- volume --------------------------------------------------------------
  engine.setVolume(Number(volSlider.value) / 100);
  volSlider.addEventListener('input', () => {
    engine.setVolume(Number(volSlider.value) / 100);
  });

  // ---- now-playing / on-air UI ---------------------------------------------
  function setMood(name) {
    moodEl.textContent = name;
  }
  function setPlayUI(on) {
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    playBtn.classList.toggle('is-playing', on);
    playGlyph.innerHTML = on ? '&#9632;' : '&#9654;'; // stop : play
    playText.textContent = on ? 'stop' : 'play';
    onairEl.classList.toggle('is-live', on);
    radioEl.classList.toggle('is-playing', on);
    if (!on) {
      setMood('- off air -');
      noteEl.textContent = '// press play. no files, no streaming - the room is synthesized live.';
    } else {
      noteEl.textContent = '// generative ambient. the room drifts and never repeats.';
    }
  }

  // ---- visualizer ----------------------------------------------------------
  const BINS = 28;
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
  }
  function drawIdle() {
    sizeCanvas();
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    // a flat resting line
    ctx2d.strokeStyle = 'rgba(140,140,140,0.45)';
    ctx2d.lineWidth = Math.max(1, h * 0.012);
    ctx2d.beginPath();
    ctx2d.moveTo(0, h / 2);
    ctx2d.lineTo(w, h / 2);
    ctx2d.stroke();
  }
  function drawFrame() {
    if (!engine.playing || !engine.ctx) { rafId = 0; return; }
    sizeCanvas();
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    const bars = engine.spectrum(BINS);
    const lvl = engine.level();
    const gap = w * 0.01;
    const bw = (w - gap * (BINS - 1)) / BINS;
    for (let i = 0; i < BINS; i++) {
      // ease the bars so the ambient reads as a gentle bloom, not a spike
      const v = Math.pow(bars[i], 0.7);
      const bh = Math.max(h * 0.02, v * h * 0.92);
      const x = i * (bw + gap);
      const y = (h - bh) / 2;
      const shade = 120 + Math.round(v * 110);
      ctx2d.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx2d.fillRect(x, y, bw, bh);
    }
    // a faint center level glow line
    const g = Math.round(120 + lvl * 120);
    ctx2d.strokeStyle = `rgba(${g},${g},${g},0.5)`;
    ctx2d.lineWidth = Math.max(1, h * 0.01);
    ctx2d.beginPath();
    ctx2d.moveTo(0, h / 2);
    ctx2d.lineTo(w, h / 2);
    ctx2d.stroke();
    rafId = requestAnimationFrame(drawFrame);
  }
  function startViz() {
    if (reducedMotion()) { sizeCanvas(); drawIdle(); return; }
    if (!rafId) rafId = requestAnimationFrame(drawFrame);
  }
  function stopViz() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    drawIdle();
  }

  // ---- transport -----------------------------------------------------------
  function play() {
    const ok = engine.start(setMood);
    if (!ok) {
      noteEl.textContent = '// could not start audio (browser blocked it).';
      return;
    }
    setPlayUI(true);
    startViz();
  }
  function stop() {
    engine.stop();
    setPlayUI(false);
    stopViz();
  }
  function toggle() { engine.playing ? stop() : play(); }

  onTap(playBtn, () => toggle());

  // ---- auto-start (opt-in, default OFF) ------------------------------------
  // When enabled we do NOT autoplay; we arm a one-shot listener that starts the
  // stream on the visitor's very first real interaction anywhere on the page,
  // honoring autoplay policy (the gesture is the user's own click/key/touch).
  function disarmAutostart() {
    if (firstInteractionHook) { firstInteractionHook(); firstInteractionHook = null; }
  }
  function armAutostart() {
    disarmAutostart();
    if (engine.playing) return;
    const onFirst = () => {
      disarmAutostart();
      if (!engine.playing) play();
    };
    const opts = { once: true, capture: true };
    window.addEventListener('pointerdown', onFirst, opts);
    window.addEventListener('keydown', onFirst, opts);
    firstInteractionHook = () => {
      window.removeEventListener('pointerdown', onFirst, opts);
      window.removeEventListener('keydown', onFirst, opts);
    };
  }

  autoBox.checked = getAutostart();
  autoBox.addEventListener('change', () => {
    setAutostart(autoBox.checked);
    if (autoBox.checked) armAutostart();
    else disarmAutostart();
  });
  // If the preference is already on when the window opens, arm it now.
  if (autoBox.checked && engine.supported) armAutostart();

  // keep the still visualizer crisp when the window is resized while stopped
  // (the rAF loop already re-measures every frame while playing).
  const onResize = () => { if (!engine.playing || reducedMotion()) drawIdle(); };
  window.addEventListener('resize', onResize);

  // ---- initial paint -------------------------------------------------------
  setPlayUI(false);
  drawIdle();

  // ---- teardown: stop audio + cancel rAF + drop listeners on close ---------
  const origClose = handle.close;
  handle.close = () => {
    disarmAutostart();
    window.removeEventListener('resize', onResize);
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    try { engine.dispose(); } catch { /* */ }
    origClose();
  };
}

registerApp({
  id: 'radio',
  name: 'RADIO',
  icon: '📻',
  desktop: true,
  open: () => wm.open({
    id: 'radio',
    title: 'RADIO',
    icon: '📻',
    width: 440,
    height: 380,
    resizable: true,
    className: 'app-radio',
    render,
  }),
});
