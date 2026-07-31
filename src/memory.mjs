// Episodic vector memory, built on ruvector (native RVF-backed VectorDb + its
// LocalNGramProvider embedder). Every board situation is written as a short
// dense note, embedded, and stored. Later situations are answered by searching
// for the notes that look most like right now.
//
// Two stores, because the two questions are different:
//   placement — "for a cell that looks like this, did this player hide a ship?"
//   shot      — "when the board looked like this, where did this player fire next?"

import { mkdirSync, existsSync, appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ruvector from 'ruvector';

const { VectorDb, LocalNGramProvider, getVersion, getImplementationType } = ruvector;

export const DIMENSIONS = 64;
const NGRAM = 3;

const embedder = new LocalNGramProvider(DIMENSIONS, NGRAM);

export function embed(note) {
  return Float32Array.from(embedder.embedSingle(note));
}

class Store {
  constructor(dir, name) {
    this.name = name;
    this.dir = dir;
    this.journalPath = path.join(dir, `${name}.jsonl`);
    this.dbPath = path.join(dir, `${name}.rvf`);
    this.count = 0;
    this.db = new VectorDb({ dimensions: DIMENSIONS, distanceMetric: 'cosine', storagePath: this.dbPath });
  }

  // The journal is the durable record; the vector index is rebuilt from it on
  // boot. That keeps export/telemetry honest even if the index is recreated.
  async restore() {
    if (!existsSync(this.journalPath)) return 0;
    const lines = readFileSync(this.journalPath, 'utf8').split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        const ep = JSON.parse(line);
        entries.push({ id: ep.id, vector: embed(ep.note), metadata: ep });
      } catch {
        // skip a torn line rather than lose the whole journal
      }
    }
    if (entries.length) await this.db.insertBatch(entries);
    this.count = entries.length;
    return this.count;
  }

  async add(note, payload) {
    const episode = { id: `${this.name}-${this.count}-${Date.now().toString(36)}`, seq: this.count, note, ...payload };
    await this.db.insert({ id: episode.id, vector: embed(note), metadata: episode });
    appendFileSync(this.journalPath, `${JSON.stringify(episode)}\n`);
    this.count += 1;
    return episode;
  }

  async addMany(items) {
    if (!items.length) return [];
    const episodes = items.map((it, i) => ({
      id: `${this.name}-${this.count + i}-${Date.now().toString(36)}-${i}`,
      seq: this.count + i,
      note: it.note,
      ...it.payload,
    }));
    await this.db.insertBatch(episodes.map((ep) => ({ id: ep.id, vector: embed(ep.note), metadata: ep })));
    appendFileSync(this.journalPath, episodes.map((ep) => `${JSON.stringify(ep)}\n`).join(''));
    this.count += episodes.length;
    return episodes;
  }

  // Returns matches with a combined weight: closer notes and more recent notes
  // count for more, exactly like the readout in the instrument panel says.
  async recall(note, k = 12) {
    if (this.count === 0) return [];
    const results = await this.db.search({ vector: embed(note), k: Math.min(k, this.count), efSearch: 128 });
    const newest = this.count - 1 || 1;
    return results.map((r) => {
      const similarity = Math.max(0, 1 - r.score); // cosine distance -> similarity
      const recency = 0.55 + 0.45 * ((r.metadata?.seq ?? 0) / newest);
      return {
        id: r.id,
        similarity,
        recency,
        weight: similarity * recency,
        episode: r.metadata ?? {},
      };
    });
  }

  export() {
    return existsSync(this.journalPath) ? readFileSync(this.journalPath, 'utf8') : '';
  }

  async reset() {
    rmSync(this.journalPath, { force: true });
    rmSync(this.dbPath, { force: true, recursive: true });
    rmSync(`${this.dbPath}.lock`, { force: true });
    this.count = 0;
    this.db = new VectorDb({ dimensions: DIMENSIONS, distanceMetric: 'cosine', storagePath: this.dbPath });
  }
}

export class Memory {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.placement = new Store(dir, 'placement');
    this.shots = new Store(dir, 'shots');
    this.statsPath = path.join(dir, 'stats.json');
    this.stats = this.#loadStats();
  }

  #loadStats() {
    if (!existsSync(this.statsPath)) return { games: 0, playerWins: 0, aiWins: 0, streak: 0, bestStreak: 0 };
    try {
      return JSON.parse(readFileSync(this.statsPath, 'utf8'));
    } catch {
      return { games: 0, playerWins: 0, aiWins: 0, streak: 0, bestStreak: 0 };
    }
  }

  saveStats() {
    writeFileSync(this.statsPath, JSON.stringify(this.stats, null, 2));
  }

  async init() {
    await this.placement.restore();
    await this.shots.restore();
    return this;
  }

  get episodes() {
    return this.placement.count + this.shots.count;
  }

  backend() {
    return { engine: 'ruvector', implementation: getImplementationType(), ...getVersion(), dimensions: DIMENSIONS };
  }

  async reset() {
    await this.placement.reset();
    await this.shots.reset();
    this.stats = { games: 0, playerWins: 0, aiWins: 0, streak: 0, bestStreak: 0 };
    this.saveStats();
  }

  export() {
    return {
      backend: this.backend(),
      stats: this.stats,
      placement: this.placement.export().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      shots: this.shots.export().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    };
  }
}
