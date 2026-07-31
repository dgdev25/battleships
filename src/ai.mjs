// The opponent. Two separate reads, both served by ruvector memory:
//   1. where your ships tend to be   -> drives its targeting
//   2. where you tend to fire next   -> drives the telemetry read-rate
// Plus classic hunt/target logic so it is never stupid on a fresh memory.

import crypto from 'node:crypto';
import { SIZE, FLEET, idx, inBounds, label } from './game.mjs';

export const MODES = ['dominate', 'level', 'yield'];
const HUNT_PARITY = 2;

const quadrant = (r, c) => `${r < SIZE / 2 ? 'n' : 's'}${c < SIZE / 2 ? 'w' : 'e'}`;
const edgeDist = (r, c) => Math.min(r, c, SIZE - 1 - r, SIZE - 1 - c);

// A dense note, not a sentence. Same idea as the reference build: situations
// that resemble each other must end up with similar strings.
export function placementNote(r, c) {
  const e = edgeDist(r, c);
  const corner = e === 0 && (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1) ? 1 : 0;
  return [
    'place',
    `r${r}`,
    `c${c}`,
    `q${quadrant(r, c)}`,
    `edge${e}`,
    `corner${corner}`,
    `par${(r + c) % 2}`,
    `band${Math.floor(r / 2)}${Math.floor(c / 2)}`,
    `mid${Math.abs(r - 4.5) < 2 && Math.abs(c - 4.5) < 2 ? 1 : 0}`,
  ].join(' ');
}

export function shotNote(state) {
  const { lastShots, playerHits, aiHits, turn } = state;
  const recent = lastShots.slice(-3).map((s) => `${s.hit ? 'h' : 'm'}${quadrant(s.r, s.c)}`).join('');
  const last = lastShots[lastShots.length - 1];
  return [
    'shot',
    `t${Math.min(9, Math.floor(turn / 5))}`,
    `rec${recent || 'none'}`,
    `last${last ? `r${last.r}c${last.c}` : 'none'}`,
    `hunt${last && last.hit ? 1 : 0}`,
    `score${playerHits - aiHits > 0 ? 'up' : playerHits === aiHits ? 'even' : 'down'}`,
    `ph${Math.min(9, Math.floor(playerHits / 3))}`,
  ].join(' ');
}

// Weighted vote over recalled episodes: does memory expect a ship here?
function voteOccupied(matches) {
  let yes = 0;
  let total = 0;
  for (const m of matches) {
    total += m.weight;
    if (m.episode.occupied) yes += m.weight;
  }
  if (total === 0) return { prior: 0.17, confidence: 0 };
  return { prior: yes / total, confidence: Math.min(1, total / 4) };
}

// Cells adjacent to an unresolved hit, with a bonus for continuing a line.
function targetCandidates(view) {
  const { shots, sunkCellSet } = view;
  const scores = new Map();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = idx(r, c);
      if (shots[cell] !== 2 || sunkCellSet.has(cell)) continue;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc) || shots[idx(rr, cc)] !== 0) continue;
        const back = idx(r - dr, c - dc);
        const inLine = inBounds(r - dr, c - dc) && shots[back] === 2 && !sunkCellSet.has(back);
        const key = idx(rr, cc);
        scores.set(key, Math.max(scores.get(key) ?? 0, inLine ? 1 : 0.72));
      }
    }
  }
  return scores;
}

// How many ways a still-floating ship could cover this cell. Classic density
// heuristic — keeps the AI competent before memory has anything to say.
function densityMap(view, remainingSizes) {
  const density = new Array(SIZE * SIZE).fill(0);
  let max = 1;
  for (const size of remainingSizes) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const horizontal of [true, false]) {
          const cells = [];
          let ok = true;
          for (let i = 0; i < size; i++) {
            const rr = horizontal ? r : r + i;
            const cc = horizontal ? c + i : c;
            if (!inBounds(rr, cc) || view.shots[idx(rr, cc)] === 1 || view.sunkCellSet.has(idx(rr, cc))) { ok = false; break; }
            cells.push(idx(rr, cc));
          }
          if (!ok) continue;
          for (const cell of cells) {
            density[cell] += 1;
            if (density[cell] > max) max = density[cell];
          }
        }
      }
    }
  }
  return density.map((d) => d / max);
}

export class Opponent {
  constructor(memory, mode = 'dominate') {
    this.memory = memory;
    this.mode = MODES.includes(mode) ? mode : 'dominate';
    this.sealed = null;
    this.lastScope = null;
    this.reads = { attempts: 0, correct: 0, near: 0 };
    this.prediction = null;
  }

  // ---- commit and reveal -------------------------------------------------
  seal(cell) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `${cell}:${nonce}`;
    this.sealed = { cell, nonce, hash: crypto.createHash('sha256').update(payload).digest('hex') };
    return { hash: this.sealed.hash, r: Math.floor(cell / SIZE), c: cell % SIZE };
  }

  reveal() {
    if (!this.sealed) return null;
    const { cell, nonce, hash } = this.sealed;
    const recomputed = crypto.createHash('sha256').update(`${cell}:${nonce}`).digest('hex');
    return {
      cell, nonce, hash, verified: recomputed === hash,
      r: Math.floor(cell / SIZE), c: cell % SIZE, label: label(Math.floor(cell / SIZE), cell % SIZE),
    };
  }

  // ---- targeting ---------------------------------------------------------
  async chooseTarget(view, context) {
    const targets = targetCandidates(view);
    const remainingSizes = FLEET.filter((s) => !view.sunk.includes(s.id)).map((s) => s.size);
    const density = densityMap(view, remainingSizes);

    const unknown = [];
    for (let cell = 0; cell < SIZE * SIZE; cell++) if (view.shots[cell] === 0) unknown.push(cell);
    if (!unknown.length) return null;

    // Memory pass: ask ruvector, per candidate cell, whether this player has
    // hidden hulls in cells that look like this one.
    const scored = [];
    for (const cell of unknown) {
      const r = Math.floor(cell / SIZE);
      const c = cell % SIZE;
      const note = placementNote(r, c);
      const matches = await this.memory.placement.recall(note, 10);
      const { prior, confidence } = voteOccupied(matches);
      const parity = (r + c) % HUNT_PARITY === 0 ? 1 : 0.55;
      const hunt = 0.5 * density[cell] + 0.2 * parity + 0.3 * prior * confidence;
      const score = targets.has(cell) ? 1.6 + targets.get(cell) : hunt;
      scored.push({ cell, r, c, score, prior, confidence, density: density[cell], targeting: targets.has(cell) });
    }

    scored.sort((a, b) => b.score - a.score);
    const pick = this.#applyMode(scored, context);

    // The scope draws the recall that actually decided this shot.
    const pickNote = placementNote(pick.r, pick.c);
    const pickMatches = await this.memory.placement.recall(pickNote, 48);
    this.lastScope = {
      matches: pickMatches.map((m) => ({
        similarity: m.similarity, weight: m.weight, occupied: Boolean(m.episode.occupied),
        r: m.episode.r ?? pick.r, c: m.episode.c ?? pick.c,
      })),
      hullOdds: pick.prior,
      support: pick.confidence,
      heat: scored.slice(0, 12).map((s) => ({ r: s.r, c: s.c, score: Number(s.score.toFixed(3)), targeting: s.targeting })),
      episodes: this.memory.placement.count,
      note: pickNote,
    };
    return pick;
  }

  // Dominate plays every read. Level steers toward a tied score. Yield throws
  // the shot away once its read is strong — the read itself never weakens.
  #applyMode(scored, { aiHits, playerHits }) {
    if (this.mode === 'dominate' || scored.length === 1) return scored[0];
    const lead = aiHits - playerHits;
    if (this.mode === 'level') {
      if (lead >= 2) return scored[Math.min(scored.length - 1, Math.floor(scored.length * 0.7))];
      if (lead <= -2) return scored[0];
      return scored[Math.min(scored.length - 1, Math.floor(scored.length * 0.25))];
    }
    // yield: only fold when the read is actually strong, otherwise hold mid.
    const strong = scored[0].confidence > 0.4 || scored[0].targeting;
    return strong ? scored[scored.length - 1] : scored[Math.floor(scored.length / 2)];
  }

  // ---- reading the player -----------------------------------------------
  async predictPlayerShot(state) {
    const note = shotNote(state);
    const matches = await this.memory.shots.recall(note, 12);
    if (!matches.length) {
      this.prediction = null;
      return { note, prediction: null, matches: [] };
    }
    const votes = new Map();
    for (const m of matches) {
      const key = `${m.episode.r},${m.episode.c}`;
      votes.set(key, (votes.get(key) ?? 0) + m.weight);
    }
    const [best] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [r, c] = best[0].split(',').map(Number);
    const total = [...votes.values()].reduce((a, b) => a + b, 0);
    this.prediction = { r, c, confidence: best[1] / (total || 1), note };
    return {
      note,
      prediction: this.prediction,
      matches: matches.slice(0, 24).map((m) => ({
        similarity: m.similarity, weight: m.weight, r: m.episode.r, c: m.episode.c, hit: Boolean(m.episode.hit),
      })),
    };
  }

  scorePrediction(r, c) {
    if (!this.prediction) return null;
    this.reads.attempts += 1;
    const exact = this.prediction.r === r && this.prediction.c === c;
    const near = Math.abs(this.prediction.r - r) + Math.abs(this.prediction.c - c) <= 2;
    if (exact) this.reads.correct += 1;
    else if (near) this.reads.near += 1;
    return { exact, near, predicted: { r: this.prediction.r, c: this.prediction.c } };
  }

  readRate() {
    if (!this.reads.attempts) return null;
    return {
      attempts: this.reads.attempts,
      exact: this.reads.correct / this.reads.attempts,
      near: (this.reads.correct + this.reads.near) / this.reads.attempts,
      baseline: 0.01, // one cell in a hundred, blind
      nearBaseline: 0.13, // ~13 cells inside a manhattan radius of 2
    };
  }
}
