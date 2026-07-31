// Synthesised battle audio — no sample files, everything is generated in the
// browser. The context is created lazily on the first user gesture, because
// browsers refuse to start audio before one.

let ctx = null;
let master = null;
let muted = localStorage.getItem('abyssal-muted') === '1';

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = next;
  localStorage.setItem('abyssal-muted', muted ? '1' : '0');
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

// A burst of white noise, shaped by an envelope and a filter. This is the
// backbone of every impact sound here.
function noise(duration, { type = 'lowpass', freq = 900, q = 0.8, gain = 0.5, attack = 0.004, sweepTo = null, delay = 0 } = {}) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // fade the raw noise so long tails decay instead of cutting off
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 1.4;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
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
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// ---- the kit -------------------------------------------------------------

// Shell leaving the tube: a short upward whoosh.
export function launch() {
  noise(0.34, { type: 'bandpass', freq: 420, q: 1.2, gain: 0.22, sweepTo: 2600 });
  tone(180, 700, 0.28, { type: 'triangle', gain: 0.06 });
}

// Splash into open water — dull, wet, short.
export function splash() {
  noise(0.42, { type: 'lowpass', freq: 1100, q: 0.7, gain: 0.3, sweepTo: 220 });
  tone(240, 90, 0.22, { type: 'sine', gain: 0.12 });
}

// Direct hit: a crack, a body of noise, and a falling boom underneath.
export function explode() {
  noise(0.09, { type: 'highpass', freq: 2400, gain: 0.55 });          // crack
  noise(0.85, { type: 'lowpass', freq: 1800, gain: 0.65, sweepTo: 180 }); // body
  tone(150, 34, 0.75, { type: 'sine', gain: 0.55 });                   // boom
  tone(90, 28, 1.05, { type: 'triangle', gain: 0.22, delay: 0.03 });   // rumble
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
