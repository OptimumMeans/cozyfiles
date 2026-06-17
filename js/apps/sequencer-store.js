// sequencer-store.js - shared sequencer format + audio render helpers.
// Imported by studio.js (writer) and player.js (reader). Both apps agree on
// the beat format here so a STUDIO pattern can be re-synthesized identically
// in PLAYER (or rendered offline to a WAV). No DOM, no window manager: pure
// data + Web Audio voice recipes that take any BaseAudioContext (online for
// live playback, OfflineAudioContext for export).

// ---- track definitions ------------------------------------------------------
// The canonical voice roster. `note` (Hz) only matters for pitched voices.
// studio.js seeds its grid from these; the engine keys on `voice`.
export const TRACKS = [
  { name: 'KICK',  voice: 'kick',  note: 0,      seed: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0] },
  { name: 'SNARE', voice: 'snare', note: 0,      seed: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1] },
  { name: 'HAT',   voice: 'hat',   note: 0,      seed: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1] },
  { name: 'BASS',  voice: 'bass',  note: 55.00,  seed: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0] }, // A1
  { name: 'LEAD',  voice: 'lead',  note: 440.00, seed: [0,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,1,0] }, // A4
];

// Velocity levels a step can cycle through. 0 = off; index 1..N are accents.
// The numbers are gain multipliers applied to the voice.
export const VELOCITY_LEVELS = [0, 0.55, 0.78, 1.0];
export const MAX_STEPS = 32;

// ---- voice synthesis --------------------------------------------------------
// One shared noise buffer per context (snare/hat). Stashed on the context so
// offline renders and the live context each get their own.
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
// `ctx` may be an online AudioContext or an OfflineAudioContext.
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

// ---- timing helpers ---------------------------------------------------------
// Seconds per 16th note for a BPM.
export function secondsPerStep(bpm) { return (60 / bpm) / 4; }

// Swing offset (seconds) for a given step index. Every odd 16th is delayed by
// up to `swing`% of a step. Returns 0 for even steps.
export function swingOffset(step, bpm, swingPct) {
  if (!swingPct) return 0;
  if (step % 2 === 0) return 0;
  return secondsPerStep(bpm) * (swingPct / 100) * 0.5;
}

// ---- beat format ------------------------------------------------------------
// A "beat" is the full STUDIO state:
//   { v, name, bpm, steps, swing, chain, patterns: [A, B] }
// where each pattern is { vel: number[trackCount][steps] } (0 = off).
// Velocity arrays carry both on/off (nonzero) and accent level, so a separate
// on/off grid is unnecessary.

export const BEAT_VERSION = 1;

export function emptyPattern(steps) {
  return { vel: TRACKS.map(() => new Array(steps).fill(0)) };
}

export function defaultBeat() {
  const steps = 16;
  const a = emptyPattern(steps);
  // seed pattern A from track seeds at full velocity
  TRACKS.forEach((t, r) => t.seed.forEach((on, s) => { if (on) a.vel[r][s] = 1; }));
  return {
    v: BEAT_VERSION,
    name: 'untitled beat',
    bpm: 110,
    steps,
    swing: 0,
    chain: false,
    patterns: [a, emptyPattern(steps)],
  };
}

// Coerce/repair a parsed beat so downstream code can trust its shape.
export function normalizeBeat(b) {
  if (!b || typeof b !== 'object') return defaultBeat();
  const steps = b.steps === MAX_STEPS ? MAX_STEPS : 16;
  const fixPat = (p) => {
    const vel = TRACKS.map((_, r) => {
      const src = (p && p.vel && p.vel[r]) || [];
      const row = new Array(steps).fill(0);
      for (let s = 0; s < steps; s++) row[s] = clampVel(src[s]);
      return row;
    });
    return { vel };
  };
  const pats = Array.isArray(b.patterns) ? b.patterns : [];
  return {
    v: BEAT_VERSION,
    name: typeof b.name === 'string' ? b.name : 'untitled beat',
    bpm: clampBpm(b.bpm),
    steps,
    swing: clampSwing(b.swing),
    chain: !!b.chain,
    patterns: [fixPat(pats[0]), fixPat(pats[1])],
  };
}

function clampVel(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, n);
}
export function clampBpm(x) {
  let v = parseInt(x, 10);
  if (!Number.isFinite(v)) v = 110;
  return Math.min(200, Math.max(60, v));
}
export function clampSwing(x) {
  let v = Number(x);
  if (!Number.isFinite(v)) v = 0;
  return Math.min(60, Math.max(0, Math.round(v)));
}

// ---- share-url encoding -----------------------------------------------------
// Compact base64 of the JSON beat, made URL-safe. Small enough for a hash.
export function encodeBeat(beat) {
  const json = JSON.stringify(beat);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBeat(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    return normalizeBeat(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---- localStorage saved beats ----------------------------------------------
const SAVED_KEY = 'cozyfiles.studio.beats';

export function loadSavedBeats() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(rec => ({ id: rec.id, name: rec.name, beat: normalizeBeat(rec.beat) }));
  } catch {
    return [];
  }
}

function writeSavedBeats(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* quota or blocked */ }
}

// Save (or overwrite by name) a beat. Returns the stored record.
export function saveBeat(name, beat) {
  const list = loadSavedBeats();
  const clean = normalizeBeat({ ...beat, name });
  const existing = list.find(r => r.name === name);
  let rec;
  if (existing) {
    existing.beat = clean;
    rec = existing;
  } else {
    rec = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, beat: clean };
    list.push(rec);
  }
  writeSavedBeats(list);
  return rec;
}

export function deleteBeat(id) {
  writeSavedBeats(loadSavedBeats().filter(r => r.id !== id));
}

// ---- pattern -> schedule ----------------------------------------------------
// Flatten a beat into an ordered list of {trackIndex, step, vel} for one full
// cycle. When chain is on, both patterns play back to back (A then B). Returns
// { events: [ [ {r,vel} ... ] per slot ], slots } where slots is the total
// step count of the cycle (steps, or steps*2 when chained).
export function buildSchedule(beat) {
  const b = normalizeBeat(beat);
  const pats = b.chain ? [b.patterns[0], b.patterns[1]] : [b.patterns[0]];
  const events = [];
  pats.forEach(p => {
    for (let s = 0; s < b.steps; s++) {
      const slot = [];
      TRACKS.forEach((_, r) => {
        const vel = p.vel[r][s];
        if (vel > 0) slot.push({ r, vel });
      });
      events.push(slot);
    }
  });
  return { events, slots: events.length, steps: b.steps, bpm: b.bpm, swing: b.swing };
}

// Total duration (seconds) of one cycle of a beat.
export function beatDuration(beat) {
  const sch = buildSchedule(beat);
  return sch.slots * secondsPerStep(sch.bpm);
}

// ---- offline render to WAV --------------------------------------------------
// Render `cycles` cycles of a beat to a 16-bit PCM WAV Blob via
// OfflineAudioContext. Returns a Promise<Blob>.
export async function renderBeatToWav(beat, cycles = 1) {
  const b = normalizeBeat(beat);
  const sch = buildSchedule(b);
  const sps = secondsPerStep(b.bpm);
  const tail = 0.6; // let the last hits ring out
  const cycleDur = sch.slots * sps;
  const total = cycleDur * cycles + tail;
  const sampleRate = 44100;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext unavailable');
  const ctx = new OAC(1, Math.ceil(total * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  for (let c = 0; c < cycles; c++) {
    sch.events.forEach((slot, i) => {
      const base = c * cycleDur + i * sps;
      const t = base + swingOffset(i % b.steps, b.bpm, b.swing);
      slot.forEach(({ r, vel }) => triggerVoice(ctx, master, TRACKS[r], t, vel));
    });
  }

  const rendered = await ctx.startRendering();
  return wavBlobFromBuffer(rendered);
}

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
