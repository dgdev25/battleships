// Layered battle audio. A tiny public-domain field recording provides the real
// detonation body; Web Audio adds the missile whistle, water, sub-bass, and a
// procedural fallback. The context still starts only on a user gesture.

let ctx = null;
let master = null;
let muted = localStorage.getItem('abyssal-muted') === '1';
const sampleBuffers = new Map();
const sampleLoads = new Map();
const SAMPLE_URLS = { explosion: '/audio/explosion.ogg' };

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
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
  master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  // Silence is not the same as stopped — park the audio thread while muted.
  if (muted) setTimeout(() => { if (muted && ctx.state === 'running') ctx.suspend(); }, 120);
  else if (ctx.state === 'suspended') ctx.resume();
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended' && !muted) c.resume();
  if (c) preloadSamples(c);
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
      .then((buffer) => sampleBuffers.set(name, buffer))
      .catch(() => null)
      .finally(() => sampleLoads.delete(name));
    sampleLoads.set(name, loading);
  }
}

function playSample(name, { gain = 1, rate = 1 } = {}) {
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
  source.start();
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

export const FLIGHT_MS = 540; // how long a shell is in the air

// The shell leaving the tube, then the long falling whistle as it arcs over.
// Two slightly detuned voices beating against each other give it the wobble a
// single clean oscillator never has.
export function launch() {
  // muzzle crack
  noise(0.16, { type: 'highpass', freq: 1400, q: 0.7, gain: 0.32, sweepTo: 380 });
  tone(140, 48, 0.24, { type: 'triangle', gain: 0.3 });
  // the whistle: high, holds, then falls away as it comes down
  const arc = [[0, 1750], [0.18, 2050], [0.55, 1150], [1, 330]];
  glide(arc, 0.54, { type: 'sine', gain: 0.17, delay: 0.04 });
  glide(arc, 0.54, { type: 'sine', gain: 0.11, delay: 0.04, detune: 22 });
  glide(arc, 0.54, { type: 'triangle', gain: 0.05, delay: 0.04, detune: -14 });
  // thin air rush under the tone
  noise(0.52, { type: 'bandpass', freq: 2400, q: 2.4, gain: 0.05, sweepTo: 700, delay: 0.04 });
}

// Into open water: the surface breaking, then the column collapsing back.
export function splash() {
  noise(0.1, { type: 'highpass', freq: 3200, q: 0.6, gain: 0.34 });                       // surface break
  noise(0.5, { type: 'lowpass', freq: 1800, q: 0.8, gain: 0.42, sweepTo: 260 });          // the gulp
  tone(300, 70, 0.3, { type: 'sine', gain: 0.22 });                                        // body of water
  noise(0.85, { type: 'lowpass', freq: 700, q: 0.5, gain: 0.2, sweepTo: 150, delay: 0.1 }); // wash falling back
  tone(150, 55, 0.5, { type: 'sine', gain: 0.1, delay: 0.12 });
}

// Direct hit. Layered as a real detonation is: the crack that arrives first,
// the body of the blast, a sub drop you feel more than hear, and debris.
function proceduralExplosion(recorded = false) {
  noise(0.07, { type: 'highpass', freq: 3600, gain: 0.75 });                                  // crack
  noise(0.22, { type: 'bandpass', freq: 1500, q: 0.8, gain: recorded ? 0.25 : 0.7 });          // punch
  noise(1.25, { type: 'lowpass', freq: 2600, gain: recorded ? 0.24 : 0.85, sweepTo: 90 });     // body/fallback
  tone(190, 26, 1.1, { type: 'sine', gain: recorded ? 0.62 : 0.9 });                           // sub drop
  tone(110, 21, 1.7, { type: 'triangle', gain: 0.4, delay: 0.02 });                           // rumble
  tone(62, 19, 2.1, { type: 'sine', gain: 0.3, delay: 0.05 });                                // the floor
  noise(0.9, { type: 'bandpass', freq: 900, q: 1.1, gain: 0.22, sweepTo: 240, delay: 0.14 }); // debris
  noise(1.4, { type: 'lowpass', freq: 400, gain: 0.16, sweepTo: 70, delay: 0.3 });            // tail
}

export function explode() {
  proceduralExplosion(playSample('explosion', { gain: 1.05, rate: 0.92 + Math.random() * 0.14 }));
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
