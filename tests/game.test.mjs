import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLEET, TOTAL_SHIP_CELLS, boardFromPlacement, emptyBoard, fire, placeShip,
} from '../src/game.mjs';

test('fleet contains the standard seventeen occupied cells', () => {
  assert.equal(TOTAL_SHIP_CELLS, 17);
  assert.deepEqual(FLEET.map((ship) => ship.size), [5, 4, 3, 3, 2]);
});

test('a hit sinks only after every cell in that hull is struck', () => {
  const board = emptyBoard();
  const destroyer = FLEET.find((ship) => ship.id === 'destroyer');
  assert.equal(placeShip(board, destroyer, 2, 3, true), true);

  const first = fire(board, 2, 3);
  const second = fire(board, 2, 4);

  assert.equal(first.hit, true);
  assert.equal(first.sunk, null);
  assert.equal(second.sunk.id, 'destroyer');
});

test('client placement validation rejects overlapping hulls', () => {
  const placement = FLEET.map((ship) => ({ id: ship.id, r: 0, c: 0, horizontal: true }));
  assert.throws(() => boardFromPlacement(placement), /invalid placement/);
});
