// Impact effects. Each burst is a short-lived DOM node layered over the grid,
// removed once its animation ends — nothing accumulates.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function layerFor(cell) {
  const wrap = cell.closest('.grid-wrap');
  if (!wrap) return null;
  let layer = wrap.querySelector('.fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    wrap.appendChild(layer);
  }
  return layer;
}

function place(node, cell, layer) {
  const cellBox = cell.getBoundingClientRect();
  const layerBox = layer.getBoundingClientRect();
  node.style.left = `${cellBox.left - layerBox.left + cellBox.width / 2}px`;
  node.style.top = `${cellBox.top - layerBox.top + cellBox.height / 2}px`;
  node.style.setProperty('--cell', `${cellBox.width}px`);
}

function spawn(cell, className, life) {
  const layer = layerFor(cell);
  if (!layer) return null;
  const node = document.createElement('div');
  node.className = className;
  place(node, cell, layer);
  layer.appendChild(node);
  setTimeout(() => node.remove(), life);
  return node;
}

// Water hit: a ring and a small plume, nothing dramatic.
export function splash(cell) {
  if (reduced) return;
  spawn(cell, 'fx fx-splash', 800);
}

// Direct hit: flash core, shockwave, and debris thrown outward.
export function explode(cell, { big = false } = {}) {
  if (reduced) return;
  const life = big ? 1600 : 1100;
  const node = spawn(cell, `fx fx-blast${big ? ' fx-blast-big' : ''}`, life);
  if (!node) return;
  const shards = big ? 14 : 9;
  for (let i = 0; i < shards; i++) {
    const shard = document.createElement('i');
    const angle = (i / shards) * 360 + Math.random() * 18;
    const distance = (big ? 46 : 30) + Math.random() * (big ? 40 : 24);
    shard.style.setProperty('--a', `${angle}deg`);
    shard.style.setProperty('--d', `${distance}px`);
    shard.style.animationDelay = `${Math.random() * 70}ms`;
    node.appendChild(shard);
  }
}

// A whole hull going down: burn the wreck and wash the screen once.
export function sink(cells, grid) {
  if (reduced || !grid) return;
  for (const [i, index] of cells.entries()) {
    const cell = grid.children[index];
    if (!cell) continue;
    cell.classList.add('burning');
    setTimeout(() => explode(cell, { big: i === Math.floor(cells.length / 2) }), i * 90);
  }
  const wash = document.createElement('div');
  wash.className = 'fx-wash';
  document.body.appendChild(wash);
  setTimeout(() => wash.remove(), 900);
}
