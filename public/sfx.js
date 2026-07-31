// Layered battle audio. A tiny public-domain field recording provides the real
// detonation body and water-impact recording provide the real-world texture;
// Web Audio adds the missile whistle, sub-bass, and procedural fallbacks. The
// context still starts only on a user gesture.

let ctx = null;
let master = null;
let muted = localStorage.getItem('abyssal-muted') === '1';
const MIX = Object.freeze({
  master: 0.78,
  seaAmbience: 0.07,
  shipFire: 0.38,
  bombWhistle: 0.5,
  waterSplash: 0.66,
  bombExplosion: 0.52,
});
const sampleBuffers = new Map();
const sampleLoads = new Map();
let ambienceSource = null;
const SAMPLE_URLS = {
  bombExplosion: '/audio/bomb-explosion.mp3',
  bombWhistle: '/audio/falling-bomb-whistle.mp3',
  seaAmbience: '/audio/ww2-sea-background.mp3',
  shipFire: '/audio/ship-fire-rocket.mp3',
  waterSplash: '/audio/water-splashes.ogg',
};

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MIX.master;
  // A detonation stacks eight voices at once, which sums well past full scale.
  // The limiter catches those peaks so the blast stays big instead of turning
  // into digital clipping, and keeps the quiet sounds where they were.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = next;
  localStorage.setItem('abyssal-muted', muted ? '1' : '0');
  if (!master) return;
  master.gain.setTargetAtTime(muted ? 0 : MIX.master, ctx.currentTime, 0.02);
  if (muted) {
    stopAmbience();
    setTimeout(() => { if (muted && ctx.state === 'running') ctx.suspend(); }, 120);
  } else if (ctx.state === 'suspended') {
    ctx.resume().then(startAmbience);
  } else {
    startAmbience();
  }
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended' && !muted) c.resume().then(startAmbience);
  if (c) preloadSamples(c);
  if (c && !muted) startAmbience();
}

// Called when the tab goes to the background: nothing is audible there anyway.
export function pause() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state === 'suspended' && !muted) ctx.resume();
}

// Noise buffers are generated once per duration and reused. Filling one is a
// per-sample JS loop — a sinking ship asked for ~117k samples across four
// buffers, synchronously on the main thread, every single time it happened.
// The kit only uses a handful of distinct durations, so the cache stays tiny.
const noiseBuffers = new Map();

function disconnectOnEnd(source, ...nodes) {
  source.addEventListener('ended', () => {
    source.disconnect();
    for (const node of nodes) node.disconnect();
  }, { once: true });
}

function preloadSamples(c) {
  for (const [name, url] of Object.entries(SAMPLE_URLS)) {
    if (sampleBuffers.has(name) || sampleLoads.has(name)) continue;
    const loading = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`sample ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => c.decodeAudioData(bytes))
      .then((buffer) => {
        sampleBuffers.set(name, buffer);
        if (name === 'seaAmbience') startAmbience();
      })
      .catch(() => null)
      .finally(() => sampleLoads.delete(name));
    sampleLoads.set(name, loading);
  }
}

function startAmbience() {
  const buffer = sampleBuffers.get('seaAmbience');
  if (!ctx || muted || ambienceSource || !buffer) return;
  const source = ctx.createBufferSource();
  const level = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  level.gain.value = MIX.seaAmbience;
  source.connect(level).connect(master);
  source.addEventListener('ended', () => {
    source.disconnect();
    level.disconnect();
    if (ambienceSource === source) ambienceSource = null;
  }, { once: true });
  ambienceSource = source;
  source.start();
}

function stopAmbience() {
  if (!ambienceSource) return;
  const source = ambienceSource;
  ambienceSource = null;
  source.stop();
}

function playSample(name, { gain = 1, rate = 1, offset = 0, duration, delay = 0 } = {}) {
  const c = ensure();
  const buffer = sampleBuffers.get(name);
  if (!c || muted || !buffer) return false;
  const source = c.createBufferSource();
  const level = c.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  level.gain.value = gain;
  source.connect(level).connect(master);
  disconnectOnEnd(source, level);
  const startsAt = c.currentTime + delay;
  if (duration == null) source.start(startsAt, offset);
  else source.start(startsAt, offset, duration);
  return true;
}

function noiseBuffer(c, duration) {
  const cached = noiseBuffers.get(duration);
  if (cached && cached.sampleRate === c.sampleRate) return cached;
  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // fade the raw noise so long tails decay instead of cutting off
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 1.4;
  }
  noiseBuffers.set(duration, buffer);
  return buffer;
}

// A burst of white noise, shaped by an envelope and a filter. This is the
// backbone of every impact sound here.
function noise(duration, { type = 'lowpass', freq = 900, q = 0.8, gain = 0.5, attack = 0.004, sweepTo = null, delay = 0 } = {}) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, duration);
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  filter.Q.value = q;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter).connect(env).connect(master);
  disconnectOnEnd(src, filter, env);
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

function tone(from, to, duration, { type = 'sine', gain = 0.5, delay = 0 } = {}) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(env).connect(master);
  disconnectOnEnd(osc, env);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// A pitched voice that can bend anywhere, not just from A to B. Used for the
// whistle, where the fall has to ease rather than run straight down.
function glide(points, duration, { type = 'sine', gain = 0.4, delay = 0, detune = 0 } = {}) {
  const c = ensure();
  if (!c || muted) return null;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(points[0][1], t0);
  for (const [at, hz] of points.slice(1)) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, hz), t0 + at * duration);
  }
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.03);
  env.gain.setValueAtTime(gain, t0 + duration * 0.72);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(env).connect(master);
  disconnectOnEnd(osc, env);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
  return osc;
}

// ---- the kit -------------------------------------------------------------

export const FLIGHT_MS = 3400; // ship launch + the full falling-bomb whistle

// The shell leaving the tube, then the long falling whistle as it arcs over.
// Two slightly detuned voices beating against each other give it the wobble a
// single clean oscillator never has.
export function launch() {
  const fired = playSample('shipFire', { gain: MIX.shipFire, duration: 1.25 });
  const whistled = playSample('bombWhistle', { gain: MIX.bombWhistle, delay: 0.38 });
  if (!fired) {
    noise(0.22, { type: 'highpass', freq: 1400, q: 0.7, gain: 0.32, sweepTo: 380 });
    tone(140, 48, 0.3, { type: 'triangle', gain: 0.3 });
  }
  if (!whistled) {
    const arc = [[0, 1750], [0.18, 2050], [0.55, 1150], [1, 330]];
    glide(arc, 2.9, { type: 'sine', gain: 0.17, delay: 0.38 });
    glide(arc, 2.9, { type: 'sine', gain: 0.11, delay: 0.38, detune: 22 });
    noise(2.85, { type: 'bandpass', freq: 2400, q: 2.4, gain: 0.05, sweepTo: 700, delay: 0.4 });
  }
}

// Into open water. These offsets select four clean, isolated impacts from the
// bundled public-domain field recording so repeat misses do not sound cloned.
const WATER_IMPACTS = [
  { offset: 3.35, duration: 1.35 },
  { offset: 6.95, duration: 1.2 },
  { offset: 16.75, duration: 1.15 },
  { offset: 45.15, duration: 1.15 },
];

export function splash() {
  const impact = WATER_IMPACTS[Math.floor(Math.random() * WATER_IMPACTS.length)];
  const recorded = playSample('waterSplash', {
    ...impact,
    gain: MIX.waterSplash,
    rate: 0.92 + Math.random() * 0.12,
  });
  // A quiet low body gives the shell weight without putting the former
  // snare-like synthesized crack back over the real recording.
  tone(120, 48, 0.48, { type: 'sine', gain: recorded ? 0.1 : 0.2 });
  if (!recorded) {
    noise(0.9, { type: 'lowpass', freq: 950, q: 0.45, gain: 0.24, sweepTo: 120, attack: 0.08 });
  }
}

// Direct hit. Layered as a real detonation is: the crack that arrives first,
// the body of the blast, a sub drop you feel more than hear, and debris.
function proceduralExplosion(recorded = false) {
  const mix = recorded ? 0.2 : 1;
  noise(0.07, { type: 'highpass', freq: 3600, gain: 0.75 * mix });
  noise(0.22, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.7 * mix });
  noise(1.25, { type: 'lowpass', freq: 2600, gain: 0.85 * mix, sweepTo: 90 });
  tone(190, 26, 1.1, { type: 'sine', gain: 0.9 * mix });
  tone(110, 21, 1.7, { type: 'triangle', gain: 0.4 * mix, delay: 0.02 });
  tone(62, 19, 2.1, { type: 'sine', gain: 0.3 * mix, delay: 0.05 });
  noise(0.9, { type: 'bandpass', freq: 900, q: 1.1, gain: 0.22 * mix, sweepTo: 240, delay: 0.14 });
  noise(1.4, { type: 'lowpass', freq: 400, gain: 0.16 * mix, sweepTo: 70, delay: 0.3 });
}

export function explode() {
  proceduralExplosion(playSample('bombExplosion', { gain: MIX.bombExplosion, rate: 0.97 + Math.random() * 0.06 }));
}

// A hull going under: the hit, then a second detonation and a long groan.
export function sink() {
  explode();
  noise(1.5, { type: 'lowpass', freq: 900, gain: 0.5, sweepTo: 90, delay: 0.12 });
  tone(120, 22, 1.6, { type: 'sine', gain: 0.5, delay: 0.14 });
  tone(300, 60, 1.2, { type: 'sawtooth', gain: 0.1, delay: 0.2 });     // metal groan
}

// Fleet destroyed — ours or theirs.
export function fanfare(win) {
  if (win) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f, 0.5, { type: 'triangle', gain: 0.22, delay: i * 0.12 }));
  } else {
    [392, 311.13, 261.63, 196].forEach((f, i) => tone(f, f * 0.98, 0.6, { type: 'sawtooth', gain: 0.16, delay: i * 0.16 }));
    noise(1.6, { type: 'lowpass', freq: 500, gain: 0.35, sweepTo: 70 });
  }
}
