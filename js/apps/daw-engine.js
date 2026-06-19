// daw-engine.js - the shared Web Audio engine behind STUDIO SESSION's
// "Studio" (step sequencer), "Mixer" and the master filter "device".
//
// 100% our own code (MIT). openDAW-inspired in UX only - no openDAW source is
// used here. The voice recipes + lookahead scheduler descend from cozyfiles'
// own earlier STUDIO app (033d810:js/apps/sequencer-store.js + studio.js),
// reworked here into a single shared engine with a real per-track mixer bus.
//
// Audio graph (one AudioContext per open window, lazily created on first user
// gesture so browsers permit it to start):
//
//   voice -> track.input (Gain) -> track.pan (StereoPanner)
//                                 -> track.gain (Gain, fader/mute/solo)
//                                 -> track.analyser (per-channel VU tap)
//                                 -> masterIn (Gain)
//   masterIn -> filter (BiquadFilter "device") -> masterGain (Gain, master fader)
//            -> masterAnalyser (master VU tap) -> destination
//
// Everything downstream of a voice is persistent; voices are one-shot nodes
// spawned per hit and self-cleaned by the browser once they stop.

const AC = window.AudioContext || window.webkitAudioContext;

// ---- track roster ----------------------------------------------------------
// The canonical voice set. `note` (Hz) only matters for pitched voices.
export const TRACKS = [
  { name: 'KICK',  voice: 'kick',  note: 0 },
  { name: 'SNARE', voice: 'snare', note: 0 },
  { name: 'HAT',   voice: 'hat',   note: 0 },
  { name: 'BASS',  voice: 'bass',  note: 55.00 },  // A1
  { name: 'LEAD',  voice: 'lead',  note: 440.00 }, // A4
];

// Default 16-step seed pattern (1 = on). Indexed [track][step].
const SEED = [
  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0], // kick
  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1], // snare
  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1], // hat
  [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0], // bass
  [0,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,1,0], // lead
];

export const STEPS = 16;
export const DEFAULT_BPM = 110;

// Bumped when the serialized beat shape changes so old share codes can be
// detected (and, if ever needed, migrated). v1 = { v, bpm, swing, grid }.
export const BEAT_VERSION = 1;

export function makeSeedGrid() {
  return SEED.map((row) => row.slice(0, STEPS));
}

// ---- timing helpers --------------------------------------------------------
export function secondsPerStep(bpm) { return (60 / bpm) / 4; } // 16th note

// Swing: delay every odd 16th by up to half a step.
export function swingOffset(step, bpm, swingPct) {
  if (!swingPct || step % 2 === 0) return 0;
  return secondsPerStep(bpm) * (swingPct / 100) * 0.5;
}

// ---- one shared noise buffer per context (snare/hat) -----------------------
function noiseSource(ctx) {
  if (!ctx.__cozyNoise) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ctx.__cozyNoise = buf;
  }
  const src = ctx.createBufferSource();
  src.buffer = ctx.__cozyNoise;
  return src;
}

// Fire one voice into `dest` at audio-clock time `t`. `vel` (0..1) scales gain.
export function triggerVoice(ctx, dest, track, t, vel = 1) {
  const v = vel <= 0 ? 0 : vel;
  if (v <= 0) return;
  switch (track.voice) {
    case 'kick': {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
      g.gain.setValueAtTime(0.9 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.32);
      break;
    }
    case 'snare': {
      const n = noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.6 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      n.connect(bp).connect(g).connect(dest);
      n.start(t); n.stop(t + 0.2);
      break;
    }
    case 'hat': {
      const n = noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(hp).connect(g).connect(dest);
      n.start(t); n.stop(t + 0.06);
      break;
    }
    case 'bass': {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = track.note;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(lp).connect(g).connect(dest);
      o.start(t); o.stop(t + 0.24);
      break;
    }
    case 'lead': {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = track.note;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28 * v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.2);
      break;
    }
  }
}

// ---- share-code encoding ---------------------------------------------------
// Compact, URL-safe base64 of the beat JSON. Small enough to live in a query
// string. encodeBeat/decodeBeat are a matched pair; decode returns null on any
// malformed input so callers can ignore a bad code silently.
export function encodeBeat(beat) {
  const json = JSON.stringify(beat);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBeat(code) {
  try {
    let b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

// Pull a beat code from a URL/Location-like object's ?beat= query param.
// Accepts a Location, a URL, or a raw search/href string. Returns the decoded
// beat object, or null when absent/invalid.
export function beatFromLocation(loc = window.location) {
  let search = '';
  if (loc && typeof loc === 'object') search = loc.search || '';
  else if (typeof loc === 'string') search = loc;
  if (!search && typeof loc === 'string') search = loc;
  let code = null;
  try {
    // tolerate a full href, a "?a=b" search, or a bare "beat=xyz"
    const qs = search.includes('?') ? search.slice(search.indexOf('?') + 1) : search;
    code = new URLSearchParams(qs).get('beat');
  } catch {
    const m = String(search).match(/[?&]beat=([^&#]+)/);
    code = m ? decodeURIComponent(m[1]) : null;
  }
  if (!code) return null;
  return decodeBeat(code);
}

// ---- WAV encoding ----------------------------------------------------------
// Encode an AudioBuffer (mono or stereo) as a 16-bit PCM WAV Blob.
export function wavBlobFromBuffer(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);          // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, chans[ch][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(off, s, true);
      off += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

// ---- saved projects (localStorage) -----------------------------------------
// Named patterns persisted as a JSON map under one namespaced key:
//   cozyfiles.studio.projects = { "<name>": <beat>, ... }
// The name is the key, so saving the same name overwrites. All reads are
// defensive (blocked storage / bad JSON -> empty map) so the UI never throws.
const PROJECTS_KEY = 'cozyfiles.studio.projects';

export function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeProjects(map) {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(map)); return true; }
  catch { return false; } // quota or blocked storage
}

// Save (or overwrite) a beat under `name`. Returns the trimmed name on success,
// null if the name was empty or storage was unavailable.
export function saveProject(name, beat) {
  const key = String(name || '').trim();
  if (!key) return null;
  const map = loadProjects();
  map[key] = beat;
  return writeProjects(map) ? key : null;
}

export function deleteProject(name) {
  const map = loadProjects();
  if (!(name in map)) return false;
  delete map[name];
  return writeProjects(map);
}

// ---- the engine ------------------------------------------------------------
// A single instance owns the AudioContext, the master chain + filter device,
// and one mixer channel per track. The step sequencer reads/writes `grid`
// (velocity 0..1 per [track][step]) and the engine schedules it on play.
export class DawEngine {
  constructor() {
    this.ctx = null;
    this.tracks = [];        // per-track { input, pan, gain, analyser, fader, panValue, mute, solo }
    this.master = null;      // { in, filter, gain, analyser }
    this.grid = makeSeedGrid();
    this.bpm = DEFAULT_BPM;
    this.swing = 0;
    this.masterFader = 0.8;  // 0..1
    this.filter = { cutoff: 1.0, resonance: 0.18, on: true }; // normalized 0..1

    // transport state
    this.playing = false;
    this._step = 0;
    this._nextNoteTime = 0;
    this._pumpId = 0;
    this.currentStep = -1;   // last scheduled step (for the playhead UI)

    // scheduler constants
    this._LOOKAHEAD = 25;    // ms between pump() calls
    this._AHEAD = 0.1;       // seconds scheduled ahead of the clock
  }

  get supported() { return !!AC; }

  // Build the persistent audio graph on first gesture. Idempotent + resumes a
  // suspended context. Returns true if audio is available and running.
  ensureAudio() {
    if (!AC) return false;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;

      // master chain: in -> filter -> gain -> analyser -> destination
      const masterIn = ctx.createGain();
      masterIn.gain.value = 1;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const masterGain = ctx.createGain();
      masterGain.gain.value = this._faderToGain(this.masterFader);
      const masterAnalyser = ctx.createAnalyser();
      masterAnalyser.fftSize = 1024;
      masterAnalyser.smoothingTimeConstant = 0.5;

      masterIn.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(masterAnalyser);
      masterAnalyser.connect(ctx.destination);

      this.master = { in: masterIn, filter, gain: masterGain, analyser: masterAnalyser };
      this._applyFilter();

      // per-track mixer channels feeding masterIn
      this.tracks = TRACKS.map(() => {
        const input = ctx.createGain();   // voices land here
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const gain = ctx.createGain();    // fader * (mute/solo)
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;

        // input -> [pan] -> gain -> analyser -> masterIn
        if (pan) { input.connect(pan); pan.connect(gain); }
        else { input.connect(gain); }
        gain.connect(analyser);
        analyser.connect(masterIn);

        return {
          input, pan, gain, analyser,
          fader: 0.75, panValue: 0.5, mute: false, solo: false,
        };
      });
      this._applyMixGains();
    }
    if (this.ctx.state === 'suspended') {
      // resume() is async; we do not await it (scheduler tolerates a tiny ramp)
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  // ---- mixer params --------------------------------------------------------
  // Perceptual fader curve: unity near the default rest, smooth taper to zero.
  _faderToGain(v) {
    const x = Math.max(0, Math.min(1, v));
    return Math.pow(x, 1.8) * 1.28; // ~1.0 at v=0.8
  }

  // Recompute every track gain from fader + mute/solo. Any soloed track mutes
  // all non-soloed ones.
  _applyMixGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const anySolo = this.tracks.some((t) => t.solo);
    this.tracks.forEach((t) => {
      const audible = t.mute ? false : (anySolo ? t.solo : true);
      const g = audible ? this._faderToGain(t.fader) : 0;
      t.gain.gain.setTargetAtTime(g, now, 0.02);
      if (t.pan) t.pan.pan.setTargetAtTime((t.panValue - 0.5) * 2, now, 0.02);
    });
  }

  setTrackFader(i, v) {
    const t = this.tracks[i]; if (!t) return;
    t.fader = Math.max(0, Math.min(1, v));
    this._applyMixGains();
  }
  setTrackPan(i, v) {
    const t = this.tracks[i]; if (!t) return;
    t.panValue = Math.max(0, Math.min(1, v));
    this._applyMixGains();
  }
  toggleMute(i) {
    const t = this.tracks[i]; if (!t) return false;
    t.mute = !t.mute; this._applyMixGains(); return t.mute;
  }
  toggleSolo(i) {
    const t = this.tracks[i]; if (!t) return false;
    t.solo = !t.solo; this._applyMixGains(); return t.solo;
  }
  setMasterFader(v) {
    this.masterFader = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.gain.setTargetAtTime(
        this._faderToGain(this.masterFader), this.ctx.currentTime, 0.02);
    }
  }

  // ---- filter "device" -----------------------------------------------------
  // cutoff/resonance are normalized 0..1; map cutoff log to 80Hz..18kHz and
  // resonance to a musical Q range.
  setFilterCutoff(v) { this.filter.cutoff = Math.max(0, Math.min(1, v)); this._applyFilter(); }
  setFilterResonance(v) { this.filter.resonance = Math.max(0, Math.min(1, v)); this._applyFilter(); }
  setFilterEnabled(on) { this.filter.on = !!on; this._applyFilter(); }

  filterCutoffHz() {
    const min = 80, max = 18000;
    return min * Math.pow(max / min, this.filter.cutoff);
  }
  filterQ() { return 0.3 + this.filter.resonance * 16; }

  _applyFilter() {
    if (!this.master || !this.ctx) return;
    const f = this.master.filter;
    const now = this.ctx.currentTime;
    // disabled = wide-open lowpass (effectively bypass) at low Q
    const hz = this.filter.on ? this.filterCutoffHz() : 20000;
    const q = this.filter.on ? this.filterQ() : 0.0001;
    f.frequency.setTargetAtTime(hz, now, 0.02);
    f.Q.setTargetAtTime(q, now, 0.02);
  }

  // ---- metering ------------------------------------------------------------
  // RMS level 0..1 from an analyser's time-domain data. Returns 0 with no ctx.
  _rms(analyser) {
    if (!analyser) return 0;
    const buf = analyser.__buf || (analyser.__buf = new Uint8Array(analyser.fftSize));
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = (buf[i] - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 2.6);
  }
  trackLevel(i) { const t = this.tracks[i]; return t ? this._rms(t.analyser) : 0; }
  masterLevel() { return this.master ? this._rms(this.master.analyser) : 0; }

  // ---- one-shot audition (used when toggling a step while stopped) ---------
  audition(trackIndex, vel = 1) {
    if (!this.ensureAudio()) return;
    const t = this.tracks[trackIndex];
    if (!t) return;
    triggerVoice(this.ctx, t.input, TRACKS[trackIndex], this.ctx.currentTime + 0.01, vel);
  }

  // ---- step grid -----------------------------------------------------------
  toggleStep(r, s) {
    const cur = this.grid[r][s];
    this.grid[r][s] = cur > 0 ? 0 : 1;
    if (this.grid[r][s] > 0 && !this.playing) this.audition(r, 1);
    return this.grid[r][s];
  }
  cycleStepVelocity(r, s) {
    // off -> full; otherwise step down through accent levels then off
    const levels = [0, 0.5, 0.78, 1.0];
    const cur = this.grid[r][s];
    let idx = levels.findIndex((l) => Math.abs(l - cur) < 1e-6);
    if (idx < 0) idx = cur > 0 ? 3 : 0;
    const next = idx >= levels.length - 1 ? 1 : idx + 1;
    this.grid[r][s] = levels[next];
    if (this.grid[r][s] > 0 && !this.playing) this.audition(r, this.grid[r][s]);
    return this.grid[r][s];
  }
  clearGrid() { this.grid = TRACKS.map(() => new Array(STEPS).fill(0)); }
  randomizeGrid() {
    this.grid = TRACKS.map((t) => {
      const density = t.voice === 'hat' ? 0.5 : t.voice === 'kick' ? 0.32 : 0.26;
      const accents = [0.5, 0.78, 1.0];
      return Array.from({ length: STEPS }, () =>
        (Math.random() < density ? accents[Math.floor(Math.random() * accents.length)] : 0));
    });
  }

  setBpm(bpm) {
    const n = parseInt(bpm, 10);
    this.bpm = Number.isFinite(n) ? Math.min(200, Math.max(60, n)) : DEFAULT_BPM;
    return this.bpm;
  }
  setSwing(pct) {
    const n = Number(pct);
    this.swing = Number.isFinite(n) ? Math.min(60, Math.max(0, Math.round(n))) : 0;
    return this.swing;
  }

  // ---- transport (lookahead scheduler) -------------------------------------
  // Walks one step at a time, scheduling all on-steps slightly ahead on the
  // audio clock. `onStep(step, time)` is called per scheduled step so the UI
  // can queue a playhead light.
  start(onStep) {
    if (this.playing) return false;
    if (!this.ensureAudio()) return false;
    this.playing = true;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.06;
    this._onStep = typeof onStep === 'function' ? onStep : null;
    this._pump();
    return true;
  }

  stop() {
    this.playing = false;
    this.currentStep = -1;
    if (this._pumpId) { clearTimeout(this._pumpId); this._pumpId = 0; }
  }

  toggleTransport(onStep) {
    if (this.playing) { this.stop(); return false; }
    return this.start(onStep);
  }

  _scheduleStep(step, time) {
    for (let r = 0; r < TRACKS.length; r++) {
      const vel = this.grid[r][step];
      if (vel > 0) {
        const t = this.tracks[r];
        triggerVoice(this.ctx, t.input, TRACKS[r], time, vel);
      }
    }
    this.currentStep = step;
    if (this._onStep) this._onStep(step, time);
  }

  _pump() {
    if (!this.playing || !this.ctx) return;
    const sps = secondsPerStep(this.bpm);
    while (this._nextNoteTime < this.ctx.currentTime + this._AHEAD) {
      const t = this._nextNoteTime + swingOffset(this._step, this.bpm, this.swing);
      this._scheduleStep(this._step, t);
      this._nextNoteTime += sps;
      this._step = (this._step + 1) % STEPS;
    }
    this._pumpId = setTimeout(() => this._pump(), this._LOOKAHEAD);
  }

  // ---- serialize / share ---------------------------------------------------
  // A "beat" is the compact, portable state of the sequencer: the step grid
  // (velocities), tempo and swing. The version tag lets future formats be
  // detected and repaired. Mixer/filter state is intentionally NOT included so
  // a shared link stays tiny and reproducible.
  serialize() {
    return {
      v: BEAT_VERSION,
      bpm: this.bpm,
      swing: this.swing,
      // round velocities to 2dp so the JSON (and thus the share code) is tight
      grid: this.grid.map((row) =>
        row.map((cell) => (cell > 0 ? Math.round(cell * 100) / 100 : 0))),
    };
  }

  // Load a serialized beat into this engine, coercing/repairing its shape so a
  // malformed or stale code can never corrupt engine state. Unknown extra
  // tracks/steps are ignored; missing ones default to silence. Returns true on
  // a successful load, false if the beat was unusable.
  deserialize(beat) {
    if (!beat || typeof beat !== 'object') return false;
    const grid = TRACKS.map((_, r) => {
      const src = (Array.isArray(beat.grid) && beat.grid[r]) || [];
      const row = new Array(STEPS).fill(0);
      for (let s = 0; s < STEPS; s++) {
        const n = Number(src[s]);
        row[s] = Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0;
      }
      return row;
    });
    this.grid = grid;
    this.setBpm(beat.bpm);
    this.setSwing(beat.swing);
    return true;
  }

  // ---- offline render (export) ---------------------------------------------
  // Render `cycles` loops of the current grid to a 16-bit PCM WAV Blob using
  // OfflineAudioContext and the SAME triggerVoice() recipes as live playback,
  // so the export never desyncs from what you hear. Returns a Promise<Blob>.
  async renderToWav(cycles = 2) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error('OfflineAudioContext unavailable');
    const sps = secondsPerStep(this.bpm);
    const tail = 0.6; // let the last hits ring out
    const cycleDur = STEPS * sps;
    const total = cycleDur * cycles + tail;
    const sampleRate = 44100;
    // stereo so the export honors per-track pan, matching what you hear
    const ctx = new OAC(2, Math.ceil(total * sampleRate), sampleRate);

    // Rebuild the LIVE signal chain offline so the export matches the mix.
    // Routing every voice straight into one master (the old way) dropped the
    // per-track fader attenuation, ran ~2-3 dB hot and clipped stacked hits, and
    // ignored the filter device. Chain: voice -> per-track gain (fader, honoring
    // mute/solo) -> master filter -> master gain -> destination. this.tracks may
    // be empty if live audio was never started, so read with safe defaults.
    const master = ctx.createGain();
    master.gain.value = this._faderToGain(this.masterFader);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.filter.on ? this.filterCutoffHz() : 20000;
    filter.Q.value = this.filter.on ? this.filterQ() : 0.0001;
    filter.connect(master);
    master.connect(ctx.destination);

    const anySolo = this.tracks.some((t) => t && t.solo);
    const trackDest = TRACKS.map((_, r) => {
      const t = this.tracks[r] || {};
      const audible = t.mute ? false : (anySolo ? !!t.solo : true);
      const g = ctx.createGain();
      g.gain.value = audible ? this._faderToGain(t.fader ?? 0.75) : 0;
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = ((t.panValue ?? 0.5) - 0.5) * 2;
        g.connect(pan).connect(filter);
      } else {
        g.connect(filter);
      }
      return g; // voices trigger into the per-track gain (head of the chain)
    });

    for (let c = 0; c < cycles; c++) {
      for (let step = 0; step < STEPS; step++) {
        const base = c * cycleDur + step * sps;
        const t = base + swingOffset(step, this.bpm, this.swing);
        for (let r = 0; r < TRACKS.length; r++) {
          const vel = this.grid[r][step];
          if (vel > 0) triggerVoice(ctx, trackDest[r], TRACKS[r], t, vel);
        }
      }
    }

    const rendered = await ctx.startRendering();
    return wavBlobFromBuffer(rendered);
  }

  // ---- teardown ------------------------------------------------------------
  // Stop transport, disconnect everything, close the context. Safe to call
  // more than once; leaves the engine inert.
  dispose() {
    this.stop();
    this._onStep = null;
    try {
      this.tracks.forEach((t) => {
        try { t.input.disconnect(); } catch { /* */ }
        try { t.pan && t.pan.disconnect(); } catch { /* */ }
        try { t.gain.disconnect(); } catch { /* */ }
        try { t.analyser.disconnect(); } catch { /* */ }
      });
      if (this.master) {
        try { this.master.in.disconnect(); } catch { /* */ }
        try { this.master.filter.disconnect(); } catch { /* */ }
        try { this.master.gain.disconnect(); } catch { /* */ }
        try { this.master.analyser.disconnect(); } catch { /* */ }
      }
    } catch { /* */ }
    if (this.ctx) { try { this.ctx.close(); } catch { /* already closed */ } }
    this.ctx = null;
    this.tracks = [];
    this.master = null;
  }
}
