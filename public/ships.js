// Fleet geometry shared by setup placement and server snapshots. Keeping this
// pure makes the visual layer deterministic and easy to verify without a DOM.

const SIZE = 10;

export function fleetPieces(specs, fleet = [], { withheld = new Set() } = {}) {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return fleet.flatMap((ship) => {
    const spec = byId.get(ship.id);
    if (!spec) return [];

    if (Array.isArray(ship.cells) && ship.cells.length) {
      const first = ship.cells[0];
      const second = ship.cells[1] ?? first + 1;
      return [{
        id: spec.id,
        size: spec.size,
        r: Math.floor(first / SIZE),
        c: first % SIZE,
        horizontal: second - first === 1,
        sunk: Boolean(ship.sunk) && !ship.cells.some((cell) => withheld.has(cell)),
      }];
    }

    if (!Number.isInteger(ship.r) || !Number.isInteger(ship.c)) return [];
    return [{
      id: spec.id,
      size: spec.size,
      r: ship.r,
      c: ship.c,
      horizontal: Boolean(ship.horizontal),
      sunk: Boolean(ship.sunk),
    }];
  });
}

export function renderFleetPieces(layer, specs, fleet, options) {
  const pieces = fleetPieces(specs, fleet, options);
  const active = new Set();

  for (const piece of pieces) {
    active.add(piece.id);
    let hull = layer.querySelector(`[data-ship-id="${piece.id}"]`);
    if (!hull) {
      hull = document.createElement('div');
      hull.dataset.shipId = piece.id;
      hull.setAttribute('aria-hidden', 'true');
      hull.append(
        Object.assign(document.createElement('i'), { className: 'ship-deck' }),
        Object.assign(document.createElement('i'), { className: 'ship-bridge' }),
        Object.assign(document.createElement('i'), { className: 'ship-wake' }),
      );
      layer.appendChild(hull);
    }

    hull.className = `ship-piece ship-${piece.id} ${piece.horizontal ? 'horizontal' : 'vertical'}${piece.sunk ? ' is-sunk' : ''}`;
    hull.style.gridColumn = `${piece.c + 1} / span ${piece.horizontal ? piece.size : 1}`;
    hull.style.gridRow = `${piece.r + 1} / span ${piece.horizontal ? 1 : piece.size}`;
  }

  for (const hull of [...layer.children]) {
    if (!active.has(hull.dataset.shipId)) hull.remove();
  }
}
