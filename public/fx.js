// Impact effects. Each burst is a short-lived DOM node layered over the grid,
// removed once its animation ends — nothing accumulates.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Geometry is only re-read once per frame. A sinking hull spawns a stack of
// bursts in quick succession, and every one of them used to force its own
// layout pass to ask the same two elements where they were.
const rects = new Map();
let rectsFrame = 0;

function rectOf(el) {
  if (rectsFrame === 0) {
    rectsFrame = requestAnimationFrame(() => { rects.clear(); rectsFrame = 0; });
  }
  let box = rects.get(el);
  if (!box) {
    box = el.getBoundingClientRect();
    rects.set(el, box);
  }
  return box;
}

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
  const cellBox = rectOf(cell);
  const layerBox = rectOf(layer);
  node.style.left = `${cellBox.left - layerBox.left + cellBox.width / 2}px`;
  node.style.top = `${cellBox.top - layerBox.top + cellBox.height / 2}px`;
  node.style.setProperty('--cell', `${cellBox.width}px`);
}

// Effects are decoration: when the tab is in the background there is nobody to
// see them, and their cleanup timers are throttled anyway.
const idle = () => reduced || document.hidden;

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
  if (idle()) return;
  spawn(cell, 'fx fx-splash', 800);
}

// Direct hit: flash core, shockwave, and debris thrown outward.
export function explode(cell, { big = false } = {}) {
  if (idle()) return;
  const life = big ? 1600 : 1100;
  const node = spawn(cell, `fx fx-blast${big ? ' fx-blast-big' : ''}`, life);
  if (!node) return;
  const shards = big ? 12 : 8;
  // one insertion instead of one per shard
  const batch = document.createDocumentFragment();
  for (let i = 0; i < shards; i++) {
    const shard = document.createElement('i');
    const angle = (i / shards) * 360 + Math.random() * 18;
    const distance = (big ? 46 : 30) + Math.random() * (big ? 40 : 24);
    shard.style.setProperty('--a', `${angle}deg`);
    shard.style.setProperty('--d', `${distance}px`);
    shard.style.animationDelay = `${Math.random() * 70}ms`;
    batch.appendChild(shard);
  }
  node.appendChild(batch);
}

// A whole hull going down: burn the wreck and wash the screen once.
export function sink(cells, grid) {
  if (idle() || !grid) return;
  const centre = Math.floor(cells.length / 2);
  for (const [i, index] of cells.entries()) {
    const cell = grid.children[index];
    if (!cell) continue;
    cell.classList.add('burning');
    setTimeout(() => explode(cell, { big: i === centre }), i * 90);
  }
  const wash = document.createElement('div');
  wash.className = 'fx-wash';
  document.body.appendChild(wash);
  setTimeout(() => wash.remove(), 900);
}
