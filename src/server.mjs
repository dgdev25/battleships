// HTTP surface: static files plus a small JSON API. One process, one memory,
// sessions held in RAM; the learning lives in ruvector on disk.

import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Memory } from './memory.mjs';
import { Opponent, MODES, placementNote, shotNote } from './ai.mjs';
import {
  SIZE, FLEET, TOTAL_SHIP_CELLS, emptyBoard, randomFleet, boardFromPlacement,
  fire, publicView, hitsOn, idx, label,
} from './game.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');
const DATA_DIR = process.env.BATTLE_DATA_DIR ?? path.join(here, '..', 'data');
// Port is owned by start.sh and cascades in through the environment — no
// hardcoded number lives in the app.
const PORT = Number(process.env.PORT);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error('PORT is not set — run ./start.sh, or set PORT=<port> yourself');
  process.exit(1);
}

const memory = await new Memory(DATA_DIR).init();
// Sessions are in RAM and finished games are dropped as soon as they end, but a
// player who closes the tab mid-game leaves one behind — those expire.
const games = new Map();
const GAME_TTL_MS = 6 * 60 * 60 * 1000;

function sweepGames() {
  const cutoff = Date.now() - GAME_TTL_MS;
  for (const [id, game] of games) {
    if (game.touched < cutoff) games.delete(id);
  }
}
setInterval(sweepGames, 30 * 60 * 1000).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.json': 'application/json' };

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
};

function viewOf(board) {
  const view = publicView(board);
  view.sunkCellSet = new Set(view.sunkCells.flatMap((s) => s.cells));
  return view;
}

function boardSnapshot(board, revealAll) {
  return {
    ...publicView(board, revealAll),
    // Undefined fields disappear from JSON. Enemy geometry therefore does not
    // cross the wire until game-over, while the player's own hulls always do.
    fleetShips: revealAll
      ? board.ships.map((ship) => ({ id: ship.id, cells: ship.cells, sunk: board.sunk.has(ship.id) }))
      : undefined,
  };
}

function stateForNote(game) {
  return {
    lastShots: game.playerShots,
    playerHits: hitsOn(game.aiBoard),
    aiHits: hitsOn(game.playerBoard),
    turn: game.turn,
  };
}

async function sealNext(game) {
  const target = await game.ai.chooseTarget(viewOf(game.playerBoard), {
    aiHits: hitsOn(game.playerBoard),
    playerHits: hitsOn(game.aiBoard),
  });
  if (!target) return null;
  const sealed = game.ai.seal(idx(target.r, target.c));
  return { hash: sealed.hash };
}

// Written once a game ends: the truth about where the fleet actually sat.
// One episode per cell, so the next game can ask "a cell like this — ship?"
async function learnPlacement(game) {
  const items = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      items.push({
        note: placementNote(r, c),
        payload: { occupied: game.playerBoard.occupied[idx(r, c)] ? 1 : 0, game: memory.stats.games + 1, r, c },
      });
    }
  }
  await memory.placement.addMany(items);
}

function telemetry(game) {
  const read = game.ai.readRate();
  return {
    episodes: memory.episodes,
    placementEpisodes: memory.placement.count,
    shotEpisodes: memory.shots.count,
    turn: game.turn,
    playerHits: hitsOn(game.aiBoard),
    aiHits: hitsOn(game.playerBoard),
    totalShipCells: TOTAL_SHIP_CELLS,
    read,
    stats: memory.stats,
    mode: game.ai.mode,
    backend: memory.backend(),
  };
}

function snapshot(game, extra = {}) {
  return {
    gameId: game.id,
    over: game.over,
    winner: game.winner,
    playerBoard: boardSnapshot(game.playerBoard, true),
    aiBoard: boardSnapshot(game.aiBoard, game.over),
    telemetry: telemetry(game),
    scope: game.ai.lastScope,
    forecast: game.forecast,
    ...extra,
  };
}

async function newGame(body) {
  const mode = MODES.includes(body?.mode) ? body.mode : 'dominate';
  const playerBoard = body?.placement ? boardFromPlacement(body.placement) : randomFleet(emptyBoard());
  const aiBoard = randomFleet(emptyBoard());
  const game = {
    id: crypto.randomUUID(),
    playerBoard,
    aiBoard,
    playerShots: [],
    aiShots: [],
    turn: 0,
    over: false,
    winner: null,
    ai: new Opponent(memory, mode),
    forecast: null,
    touched: Date.now(),
  };
  games.set(game.id, game);
  const seal = await sealNext(game);
  game.forecast = await game.ai.predictPlayerShot(stateForNote(game));
  return { ...snapshot(game), seal };
}

async function fireShot(body) {
  const game = games.get(body?.gameId);
  if (!game) return { code: 404, body: { error: 'no such game' } };
  if (game.over) return { code: 409, body: { error: 'game is over' } };
  game.touched = Date.now();
  const r = Number(body.r);
  const c = Number(body.c);

  // Score the read before the shot resolves — no peeking at the outcome.
  const readResult = game.ai.scorePrediction(r, c);
  const contextNote = game.forecast?.note ?? shotNote(stateForNote(game));

  const shot = fire(game.aiBoard, r, c);
  if (!shot.ok) return { code: 400, body: { error: shot.reason } };
  game.turn += 1;
  game.playerShots.push({ r, c, hit: shot.hit });
  await memory.shots.add(contextNote, { r, c, hit: shot.hit ? 1 : 0, game: memory.stats.games + 1 });

  const events = { player: { ...shot, label: label(r, c) }, read: readResult };

  if (shot.fleetDown) {
    game.over = true;
    game.winner = 'player';
  } else {
    const reveal = game.ai.reveal();
    if (reveal) {
      const aiShot = fire(game.playerBoard, reveal.r, reveal.c);
      if (aiShot.ok) {
        game.aiShots.push({ r: reveal.r, c: reveal.c, hit: aiShot.hit });
        events.ai = { ...aiShot, label: reveal.label, reveal };
        if (aiShot.fleetDown) {
          game.over = true;
          game.winner = 'ai';
        }
      } else {
        events.ai = { ok: false, reveal, reason: aiShot.reason };
      }
    }
  }

  if (game.over) {
    await learnPlacement(game);
    memory.stats.games += 1;
    if (game.winner === 'player') {
      memory.stats.playerWins += 1;
      memory.stats.streak = Math.max(0, memory.stats.streak) + 1;
    } else {
      memory.stats.aiWins += 1;
      memory.stats.streak = 0;
    }
    memory.stats.bestStreak = Math.max(memory.stats.bestStreak, memory.stats.streak);
    memory.saveStats();
    const final = snapshot(game, { events, seal: null });
    // The board is fully described by this snapshot; nothing needs the session.
    games.delete(game.id);
    return { code: 200, body: final };
  }

  const seal = await sealNext(game);
  game.forecast = await game.ai.predictPlayerShot(stateForNote(game));
  return { code: 200, body: snapshot(game, { events, seal }) };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    // The document always revalidates so a deploy is picked up; its assets are
    // allowed a short life so a reload does not refetch every file.
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cache,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config') {
      return json(res, 200, { size: SIZE, fleet: FLEET, modes: MODES, backend: memory.backend(), stats: memory.stats, episodes: memory.episodes });
    }
    if (url.pathname === '/api/game' && req.method === 'POST') {
      return json(res, 200, await newGame(await readBody(req)));
    }
    if (url.pathname === '/api/fire' && req.method === 'POST') {
      const out = await fireShot(await readBody(req));
      return json(res, out.code, out.body);
    }
    if (url.pathname === '/api/memory/export') {
      return json(res, 200, memory.export());
    }
    if (url.pathname === '/api/memory/reset' && req.method === 'POST') {
      await memory.reset();
      games.clear();
      return json(res, 200, { ok: true, episodes: memory.episodes });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    return await serveStatic(req, res);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  const info = memory.backend();
  console.log(`ABYSSAL // battleships on http://localhost:${PORT}`);
  console.log(`memory: ruvector ${info.version} (${info.implementation}), ${memory.episodes} episodes in ${DATA_DIR}`);
});
