// Core battleship rules — board, fleet, placement, shot resolution.
// Pure logic, no I/O, no AI. Shared shape between player board and AI board.

export const SIZE = 10;
export const FLEET = [
  { id: 'carrier', name: 'Carrier', size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser', name: 'Cruiser', size: 3 },
  { id: 'submarine', name: 'Submarine', size: 3 },
  { id: 'destroyer', name: 'Destroyer', size: 2 },
];

export const TOTAL_SHIP_CELLS = FLEET.reduce((n, s) => n + s.size, 0);

export const idx = (r, c) => r * SIZE + c;
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const label = (r, c) => `${String.fromCharCode(65 + r)}${c + 1}`;

export function emptyBoard() {
  return {
    ships: [],
    occupied: new Array(SIZE * SIZE).fill(null), // shipId | null
    shots: new Array(SIZE * SIZE).fill(0), // 0 unknown, 1 miss, 2 hit
    sunk: new Set(),
  };
}

export function cellsFor(r, c, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const rr = horizontal ? r : r + i;
    const cc = horizontal ? c + i : c;
    if (!inBounds(rr, cc)) return null;
    cells.push(idx(rr, cc));
  }
  return cells;
}

export function canPlace(board, r, c, size, horizontal) {
  const cells = cellsFor(r, c, size, horizontal);
  if (!cells) return null;
  for (const cell of cells) if (board.occupied[cell] !== null) return null;
  return cells;
}

export function placeShip(board, spec, r, c, horizontal) {
  const cells = canPlace(board, r, c, spec.size, horizontal);
  if (!cells) return false;
  board.ships.push({ ...spec, cells, horizontal, hits: new Set() });
  for (const cell of cells) board.occupied[cell] = spec.id;
  return true;
}

export function randomFleet(board, rng = Math.random) {
  for (const spec of FLEET) {
    let placed = false;
    for (let tries = 0; tries < 500 && !placed; tries++) {
      const horizontal = rng() < 0.5;
      const r = Math.floor(rng() * SIZE);
      const c = Math.floor(rng() * SIZE);
      placed = placeShip(board, spec, r, c, horizontal);
    }
    if (!placed) throw new Error(`could not place ${spec.id}`);
  }
  return board;
}

// Build a board from a client-supplied placement list. Validates fully —
// never trust the browser with the shape of its own fleet.
export function boardFromPlacement(placement) {
  const board = emptyBoard();
  if (!Array.isArray(placement) || placement.length !== FLEET.length) {
    throw new Error('placement must list every ship exactly once');
  }
  const seen = new Set();
  for (const spec of FLEET) {
    const entry = placement.find((p) => p && p.id === spec.id);
    if (!entry || seen.has(spec.id)) throw new Error(`bad placement for ${spec.id}`);
    seen.add(spec.id);
    const r = Number(entry.r);
    const c = Number(entry.c);
    const horizontal = Boolean(entry.horizontal);
    if (!Number.isInteger(r) || !Number.isInteger(c)) throw new Error('placement coords must be integers');
    if (!placeShip(board, spec, r, c, horizontal)) throw new Error(`invalid placement for ${spec.id}`);
  }
  return board;
}

export function fire(board, r, c) {
  const cell = idx(r, c);
  if (!inBounds(r, c)) return { ok: false, reason: 'out of bounds' };
  if (board.shots[cell] !== 0) return { ok: false, reason: 'already fired there' };
  const shipId = board.occupied[cell];
  if (!shipId) {
    board.shots[cell] = 1;
    return { ok: true, cell, r, c, hit: false, sunk: null, fleetDown: false };
  }
  board.shots[cell] = 2;
  const ship = board.ships.find((s) => s.id === shipId);
  ship.hits.add(cell);
  const sunk = ship.hits.size === ship.size;
  if (sunk) board.sunk.add(ship.id);
  return {
    ok: true,
    cell,
    r,
    c,
    hit: true,
    sunk: sunk ? { id: ship.id, name: ship.name, cells: ship.cells } : null,
    fleetDown: board.sunk.size === FLEET.length,
  };
}

export const hitsOn = (board) => board.shots.filter((s) => s === 2).length;
export const shotsOn = (board) => board.shots.filter((s) => s !== 0).length;

// What the opponent is allowed to know about a board: shots and sunk hulls only.
export function publicView(board, revealAll = false) {
  return {
    shots: [...board.shots],
    sunk: [...board.sunk],
    sunkCells: board.ships.filter((s) => board.sunk.has(s.id)).map((s) => ({ id: s.id, cells: s.cells })),
    fleet: FLEET.map((s) => ({ id: s.id, name: s.name, size: s.size, sunk: board.sunk.has(s.id) })),
    hits: hitsOn(board),
    occupied: revealAll ? [...board.occupied] : undefined,
  };
}
