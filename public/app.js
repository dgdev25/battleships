// Front-end: deployment, firing, and the instrument readouts.
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import { buildScoreboard, setDisplay, flash } from './scoreboard.js';

const SIZE = 10;
const $ = (id) => document.getElementById(id);
const api = async (url, body) => {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'request failed');
  return data;
};
const label = (r, c) => `${String.fromCharCode(65 + r)}${c + 1}`;
const pct = (x) => `${(x * 100).toFixed(0)}%`;

const MODE_COPY = {
  dominate: 'Fires every read it gets. No handicap, no mercy.',
  level: 'Steers toward a tied score — wastes shots while it is ahead of you.',
  yield: 'Once its read is strong it fires at the water it is surest is empty.',
};

const state = {
  config: null,
  phase: 'setup',
  mode: 'dominate',
  placement: [],
  shipIndex: 0,
  horizontal: true,
  game: null,
  foresight: false,
  busy: false,
  board: null,      // scoreboard displays
  startedAt: null,  // engagement clock
  clockTimer: null,
};

const enemyGrid = $('enemy-grid');
const ownGrid = $('own-grid');

function buildGrid(el, onClick, onHover) {
  el.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('aria-label', label(r, c));
      if (onClick) cell.addEventListener('click', () => onClick(r, c));
      if (onHover) {
        cell.addEventListener('mouseenter', () => onHover(r, c));
        cell.addEventListener('focus', () => onHover(r, c));
      }
      el.appendChild(cell);
    }
  }
}

const cellAt = (grid, r, c) => grid.children[r * SIZE + c];

// ---------------- deployment ----------------
function shipCells(spec, r, c, horizontal) {
  const cells = [];
  for (let i = 0; i < spec.size; i++) {
    const rr = horizontal ? r : r + i;
    const cc = horizontal ? c + i : c;
    if (rr >= SIZE || cc >= SIZE) return null;
    cells.push([rr, cc]);
  }
  return cells;
}

function occupiedSet() {
  const set = new Set();
  for (const p of state.placement) {
    const spec = state.config.fleet.find((s) => s.id === p.id);
    for (const [r, c] of shipCells(spec, p.r, p.c, p.horizontal)) set.add(r * SIZE + c);
  }
  return set;
}

function renderOwnSetup(preview) {
  const taken = occupiedSet();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = ownGrid.children[i];
    cell.className = `cell${taken.has(i) ? ' ship' : ''}`;
  }
  if (preview) {
    const { cells, ok } = preview;
    for (const [r, c] of cells) cellAt(ownGrid, r, c).classList.add('preview', ...(ok ? [] : ['bad']));
  }
  const spec = state.config.fleet[state.shipIndex];
  $('placement-msg').innerHTML = spec
    ? `Click to drop the <b>${spec.name}</b> (${spec.size}). Press <b>R</b> to rotate — currently <b>${state.horizontal ? 'horizontal' : 'vertical'}</b>.`
    : 'Fleet deployed. <b>Engage</b> when ready.';
  $('btn-engage').disabled = state.placement.length !== state.config.fleet.length;
}

function previewAt(r, c) {
  if (state.phase !== 'setup') return;
  const spec = state.config.fleet[state.shipIndex];
  if (!spec) { renderOwnSetup(); return; }
  const cells = shipCells(spec, r, c, state.horizontal);
  if (!cells) { renderOwnSetup(); return; }
  const taken = occupiedSet();
  const ok = cells.every(([rr, cc]) => !taken.has(rr * SIZE + cc));
  renderOwnSetup({ cells, ok });
}

function dropShip(r, c) {
  if (state.phase !== 'setup') return;
  const spec = state.config.fleet[state.shipIndex];
  if (!spec) return;
  const cells = shipCells(spec, r, c, state.horizontal);
  if (!cells) return;
  const taken = occupiedSet();
  if (cells.some(([rr, cc]) => taken.has(rr * SIZE + cc))) return;
  state.placement.push({ id: spec.id, r, c, horizontal: state.horizontal });
  state.shipIndex += 1;
  renderOwnSetup();
}

function scatter() {
  state.placement = [];
  state.shipIndex = 0;
  for (const spec of state.config.fleet) {
    for (let tries = 0; tries < 800; tries++) {
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const cells = shipCells(spec, r, c, horizontal);
      if (!cells) continue;
      const taken = occupiedSet();
      if (cells.some(([rr, cc]) => taken.has(rr * SIZE + cc))) continue;
      state.placement.push({ id: spec.id, r, c, horizontal });
      break;
    }
  }
  state.shipIndex = state.placement.length;
  renderOwnSetup();
}

// ---------------- battle rendering ----------------
function renderBoard(grid, view, { showShips, sealCell, predicted }) {
  const sunkCells = new Set(view.sunkCells.flatMap((s) => s.cells));
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = grid.children[i];
    const shot = view.shots[i];
    const classes = ['cell'];
    if (showShips && view.occupied && view.occupied[i]) classes.push('ship');
    if (shot === 1) classes.push('miss', 'spent');
    // sunk hulls keep burning — the class survives re-renders because it is
    // derived here rather than left behind by the effect layer
    if (shot === 2) classes.push(sunkCells.has(i) ? 'sunk burning' : 'hit', 'spent');
    if (sealCell === i) classes.push('sealed');
    if (predicted === i) classes.push('predicted');
    cell.className = classes.join(' ');
  }
}

function renderFleet(el, view, mine) {
  el.innerHTML = '';
  for (const ship of view.fleet) {
    const row = document.createElement('div');
    row.className = `fleet-row${ship.sunk ? ' down' : ''}`;
    const pips = document.createElement('span');
    pips.className = 'pips';
    for (let i = 0; i < ship.size; i++) {
      const pip = document.createElement('i');
      pip.className = `pip${ship.sunk ? '' : mine ? ' alive' : ' enemy'}`;
      pips.appendChild(pip);
    }
    row.append(pips, Object.assign(document.createElement('span'), { textContent: ship.name.toUpperCase() }));
    el.appendChild(row);
  }
}

function renderScope(scope) {
  const el = $('scope');
  el.querySelectorAll('.blip').forEach((b) => b.remove());
  if (!scope || !scope.matches?.length) {
    $('scope-caption').textContent = 'Nothing recalled yet. The scope fills in once the AI has memories to search.';
    $('scope-note').textContent = scope?.note ?? '—';
    return;
  }
  // Similarities bunch up near 1, so rank them inside this recall set —
  // the scope is about relative closeness, not absolute cosine values.
  const sims = scope.matches.map((m) => m.similarity);
  const lo = Math.min(...sims);
  const hi = Math.max(...sims);
  const span = hi - lo || 1;
  scope.matches.forEach((m, i) => {
    const blip = document.createElement('div');
    const norm = (m.similarity - lo) / span; // 1 = closest match in this recall
    const radius = 6 + (1 - norm) * 40; // nearer centre = more similar
    const angle = i * 2.399963; // golden angle, keeps the dots from stacking
    const size = 2 + m.weight * 6;
    blip.className = `blip ${m.occupied ? 'ship' : 'empty'}`;
    blip.style.left = `${50 + radius * Math.cos(angle)}%`;
    blip.style.top = `${50 + radius * Math.sin(angle)}%`;
    blip.style.width = `${size}px`;
    blip.style.height = `${size}px`;
    el.appendChild(blip);
  });
  const ships = scope.matches.filter((m) => m.occupied).length;
  $('scope-caption').innerHTML = `${scope.matches.length} memories recalled · <b>${ships}</b> held a hull · hull odds at its pick ${pct(scope.hullOdds ?? 0)} on ${pct(scope.support ?? 0)} support`;
  $('scope-note').textContent = scope.note ?? '—';
}

// The stadium board mirrors the live score; everything else stays in telemetry.
function renderScoreboard(t) {
  const b = state.board;
  if (!b) return;
  setDisplay(b.playerScore, t.playerHits);
  setDisplay(b.aiScore, t.aiHits);
  setDisplay(b.turn, t.turn);
  setDisplay(b.shots, t.turn);
  setDisplay(b.streak, t.stats.streak);
  setDisplay(b.playerSunk, state.game?.aiBoard.fleet.filter((s) => s.sunk).length ?? 0);
  setDisplay(b.aiSunk, state.game?.playerBoard.fleet.filter((s) => s.sunk).length ?? 0);
  setDisplay(b.sunk, (state.game?.aiBoard.fleet.filter((s) => s.sunk).length ?? 0)
    + (state.game?.playerBoard.fleet.filter((s) => s.sunk).length ?? 0));
}

function tickClock() {
  if (!state.board || !state.startedAt) return;
  const secs = Math.floor((Date.now() - state.startedAt) / 1000);
  const value = `${String(Math.min(99, Math.floor(secs / 60))).padStart(2, '0')}${String(secs % 60).padStart(2, '0')}`;
  setDisplay(state.board.clock, value);
}

function renderTelemetry(t) {
  $('tl-episodes').textContent = t.episodes;
  $('tl-episodes-sub').textContent = `${t.placementEpisodes} board · ${t.shotEpisodes} shot`;
  if (t.read) {
    $('tl-read').textContent = pct(t.read.exact);
    $('tl-read-sub').textContent = `within 2 cells ${pct(t.read.near)} · blind is 1% / 13%`;
    $('tl-read-bar').style.width = `${Math.min(100, t.read.exact * 400)}%`;
  }
  $('tl-streak').textContent = t.stats.streak;
  $('tl-best').textContent = `best ${t.stats.bestStreak}`;
  $('tl-games').textContent = t.stats.games;
  $('tl-record').textContent = `${t.stats.playerWins}W · ${t.stats.aiWins}L`;
  $('enemy-progress').textContent = `${t.playerHits} / ${t.totalShipCells}`;
  $('own-progress').textContent = `${t.aiHits} / ${t.totalShipCells}`;
  $('engine-status').textContent = `ruvector ${t.backend.version} · ${t.backend.implementation} · ${t.backend.dimensions}d · ${t.episodes} episodes`;
}

function log(text, kind = '') {
  const p = document.createElement('p');
  if (kind) p.className = kind;
  p.innerHTML = text;
  $('log').prepend(p);
}

function renderGame(data, events) {
  state.game = data;
  const predicted = state.foresight && data.forecast?.prediction
    ? data.forecast.prediction.r * SIZE + data.forecast.prediction.c
    : null;
  renderBoard(enemyGrid, data.aiBoard, { showShips: data.over, predicted });
  renderBoard(ownGrid, data.playerBoard, { showShips: true });
  renderFleet($('enemy-fleet'), data.aiBoard, false);
  renderFleet($('own-fleet'), data.playerBoard, true);
  renderTelemetry(data.telemetry);
  renderScoreboard(data.telemetry);
  renderScope(data.scope);

  const f = data.forecast?.prediction;
  $('forecast').innerHTML = f
    ? `It expects your next shot near <b>${label(f.r, f.c)}</b> — confidence ${pct(f.confidence)}. Looking does not change it.`
    : 'The AI is still bootstrapping — it has no read on your next shot yet.';

  if (events?.ai?.reveal) {
    const rev = events.ai.reveal;
    $('seal-verdict').className = `readout tiny verdict ${rev.verified ? 'ok' : 'bad'}`;
    $('seal-verdict').textContent = rev.verified ? `✓ opened ${rev.label}` : '✗ seal broken';
  }
  $('seal-hash').textContent = data.seal ? `${data.seal.hash.slice(0, 24)}…` : (data.over ? 'stood down' : 'sealing…');

  if (data.over) {
    $('setup').style.display = '';
    const alreadyOver = state.phase === 'over';
    state.phase = 'over';
    enemyGrid.classList.remove('live');
    $('phase').textContent = data.winner === 'player' ? 'enemy fleet destroyed' : 'your fleet is gone';
    if (!alreadyOver) {
      clearInterval(state.clockTimer);
      setTimeout(() => sfx.fanfare(data.winner === 'player'), 700);
    }
    if (!alreadyOver) log(data.winner === 'player'
      ? '<b>Enemy fleet destroyed.</b> Board written to memory.'
      : '<b>Your fleet is gone.</b> Board written to memory.', data.winner === 'player' ? 'hit' : 'enemy');
    $('setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('btn-engage').disabled = false;
    $('btn-engage').textContent = 'New engagement';
  } else {
    $('phase').textContent = 'your shot';
    $('setup').style.display = 'none';
  }
}

// ---------------- actions ----------------
async function engage() {
  if (state.phase === 'over') {
    state.phase = 'setup';
    state.placement = [];
    state.shipIndex = 0;
    state.game = null;
    $('btn-engage').textContent = 'Engage';
    $('log').innerHTML = '<p>Awaiting deployment.</p>';
    enemyGrid.querySelectorAll('.cell').forEach((c) => { c.className = 'cell'; });
    renderOwnSetup();
    $('phase').textContent = 'place your fleet';
    return;
  }
  if (state.placement.length !== state.config.fleet.length) return;
  state.busy = true;
  $('enemy-sweep').classList.add('on');
  sfx.unlock();
  const data = await api('/api/game', { mode: state.mode, placement: state.placement });
  state.phase = 'battle';
  enemyGrid.classList.add('live');
  state.startedAt = Date.now();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClock, 1000);
  tickClock();
  log('Engagement opened. AI has sealed its first target.');
  renderGame(data);
  $('enemy-sweep').classList.remove('on');
  state.busy = false;
}

async function shoot(r, c) {
  if (state.phase !== 'battle' || state.busy || !state.game) return;
  const cell = cellAt(enemyGrid, r, c);
  if (cell.classList.contains('spent')) return;
  state.busy = true;
  cell.classList.add('ping');
  $('enemy-sweep').classList.add('on');
  sfx.unlock();
  sfx.launch();
  try {
    const data = await api('/api/fire', { gameId: state.game.gameId, r, c });
    const ev = data.events ?? {};
    if (ev.player) {
      log(`You → <b>${ev.player.label}</b> ${ev.player.hit ? 'HIT' : 'miss'}${ev.player.sunk ? ` · ${ev.player.sunk.name} sunk` : ''}`, ev.player.hit ? 'hit' : '');
      if (ev.player.hit) {
        enemyGrid.classList.add('shake');
        fx.explode(cell, { big: Boolean(ev.player.sunk) });
        if (ev.player.sunk) { sfx.sink(); fx.sink(ev.player.sunk.cells, enemyGrid); } else sfx.explode();
      } else {
        fx.splash(cell);
        sfx.splash();
      }
    }
    if (ev.read?.exact) log('It called that shot exactly.', 'enemy');
    if (ev.ai?.ok) {
      log(`AI → <b>${ev.ai.label}</b> ${ev.ai.hit ? 'HIT' : 'miss'}${ev.ai.sunk ? ` · your ${ev.ai.sunk.name} sunk` : ''}`, 'enemy');
      const own = cellAt(ownGrid, ev.ai.r, ev.ai.c);
      own.classList.add('ping', 'fresh');
      // stagger the return fire so the two impacts read as separate events
      setTimeout(() => {
        if (ev.ai.hit) {
          ownGrid.classList.add('shake');
          fx.explode(own, { big: Boolean(ev.ai.sunk) });
          if (ev.ai.sunk) { sfx.sink(); fx.sink(ev.ai.sunk.cells, ownGrid); } else sfx.explode();
        } else {
          fx.splash(own);
          sfx.splash();
        }
      }, 620);
    }
    renderGame(data, ev);
    if (ev.player?.hit || ev.ai?.hit) flash($('scoreboard'));
  } catch (err) {
    log(`<b>${err.message}</b>`, 'enemy');
  } finally {
    setTimeout(() => {
      enemyGrid.classList.remove('shake');
      enemyGrid.querySelectorAll('.ping').forEach((n) => n.classList.remove('ping'));
    }, 450);
    setTimeout(() => {
      ownGrid.classList.remove('shake');
      ownGrid.querySelectorAll('.ping').forEach((n) => n.classList.remove('ping'));
    }, 1100);
    $('enemy-sweep').classList.remove('on');
    state.busy = false;
  }
}

// ---------------- wiring ----------------
async function boot() {
  state.board = buildScoreboard($('scoreboard'));
  state.config = await api('/api/config');
  buildGrid(enemyGrid, shoot);
  buildGrid(ownGrid, dropShip, previewAt);
  ownGrid.addEventListener('mouseleave', () => { if (state.phase === 'setup') renderOwnSetup(); });
  renderOwnSetup();
  $('engine-status').textContent = `ruvector ${state.config.backend.version} · ${state.config.backend.implementation} · ${state.config.backend.dimensions}d · ${state.config.episodes} episodes`;
  $('tl-episodes').textContent = state.config.episodes;
  $('tl-episodes-sub').textContent = state.config.episodes ? 'board + shot memories' : 'nothing stored';
  $('tl-games').textContent = state.config.stats.games;
  $('tl-record').textContent = `${state.config.stats.playerWins}W · ${state.config.stats.aiWins}L`;
  $('tl-streak').textContent = state.config.stats.streak;
  $('tl-best').textContent = `best ${state.config.stats.bestStreak}`;
}

$('btn-sound').addEventListener('click', (e) => {
  sfx.unlock();
  const next = !sfx.isMuted();
  sfx.setMuted(next);
  e.currentTarget.textContent = next ? 'Sound off' : 'Sound on';
  e.currentTarget.setAttribute('aria-pressed', String(!next));
  if (!next) sfx.launch();
});
$('btn-random').addEventListener('click', scatter);
$('btn-clear').addEventListener('click', () => { state.placement = []; state.shipIndex = 0; renderOwnSetup(); });
$('btn-engage').addEventListener('click', () => engage().catch((e) => log(`<b>${e.message}</b>`, 'enemy')));
$('btn-foresight').addEventListener('click', (e) => {
  state.foresight = !state.foresight;
  e.currentTarget.setAttribute('aria-pressed', String(state.foresight));
  if (state.game) renderGame(state.game);
});
$('btn-export').addEventListener('click', async () => {
  const data = await api('/api/memory/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'abyssal-memory.json' }).click();
  URL.revokeObjectURL(url);
});
$('btn-reset').addEventListener('click', async () => {
  await api('/api/memory/reset', {});
  log('<b>AI memory wiped.</b> It is guessing from scratch again.', 'enemy');
  const cfg = await api('/api/config');
  state.config = cfg;
  $('tl-episodes').textContent = cfg.episodes;
  $('tl-streak').textContent = cfg.stats.streak;
  $('tl-games').textContent = cfg.stats.games;
  $('tl-record').textContent = '0W · 0L';
  renderScope(null);
});
document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    $('mode-copy').textContent = MODE_COPY[state.mode];
  });
});
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && state.phase === 'setup') {
    state.horizontal = !state.horizontal;
    renderOwnSetup();
  }
});

// reflect the stored mute preference on load
$('btn-sound').textContent = sfx.isMuted() ? 'Sound off' : 'Sound on';
$('btn-sound').setAttribute('aria-pressed', String(!sfx.isMuted()));

boot().catch((e) => { $('engine-status').textContent = `boot failed: ${e.message}`; });
