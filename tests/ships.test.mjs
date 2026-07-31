import assert from 'node:assert/strict';
import test from 'node:test';

let fleetPieces;
try {
  ({ fleetPieces } = await import('../public/ships.js'));
} catch {
  // RED phase: the fleet geometry module does not exist yet.
}

const specs = [
  { id: 'carrier', size: 5 },
  { id: 'submarine', size: 3 },
];

test('placement geometry preserves real hull size and orientation', () => {
  assert.equal(typeof fleetPieces, 'function', 'fleetPieces must be implemented');
  const pieces = fleetPieces(specs, [
    { id: 'carrier', r: 1, c: 2, horizontal: true },
    { id: 'submarine', r: 4, c: 7, horizontal: false },
  ]);

  assert.deepEqual(pieces, [
    { id: 'carrier', size: 5, r: 1, c: 2, horizontal: true, sunk: false },
    { id: 'submarine', size: 3, r: 4, c: 7, horizontal: false, sunk: false },
  ]);
});

test('server cell geometry reconstructs an oriented hull without leaking extra data', () => {
  assert.equal(typeof fleetPieces, 'function', 'fleetPieces must be implemented');
  const pieces = fleetPieces(specs, [
    { id: 'carrier', cells: [23, 24, 25, 26, 27] },
    { id: 'submarine', cells: [17, 27, 37], sunk: true },
  ]);

  assert.deepEqual(pieces, [
    { id: 'carrier', size: 5, r: 2, c: 3, horizontal: true, sunk: false },
    { id: 'submarine', size: 3, r: 1, c: 7, horizontal: false, sunk: true },
  ]);
});

test('a sinking hull stays visually afloat until the withheld impact lands', () => {
  assert.equal(typeof fleetPieces, 'function', 'fleetPieces must be implemented');
  const [piece] = fleetPieces(specs, [
    { id: 'submarine', cells: [17, 27, 37], sunk: true },
  ], { withheld: new Set([37]) });

  assert.equal(piece.sunk, false);
});
