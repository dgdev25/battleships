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

// Water hit: pressure rings, a bright central plume, and ballistic droplets.
export function splash(cell) {
  if (idle()) return;
  const node = spawn(cell, 'fx fx-splash', 1350);
  if (!node) return;
  const batch = document.createDocumentFragment();
  for (let i = 0; i < 18; i++) {
    const drop = document.createElement('i');
    drop.className = 'fx-droplet';
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.2;
    const distance = 24 + Math.random() * 42;
    drop.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    drop.style.setProperty('--lift', `${-30 - Math.random() * 42}px`);
    drop.style.setProperty('--fall', `${14 + Math.random() * 28}px`);
    drop.style.animationDelay = `${Math.random() * 70}ms`;
    batch.appendChild(drop);
  }
  node.appendChild(batch);
}

// Direct hit: flash core, shockwave, and debris thrown outward.
export function explode(cell, { big = false } = {}) {
  if (idle()) return;
  const life = big ? 1600 : 1100;
  const node = spawn(cell, `fx fx-blast${big ? ' fx-blast-big' : ''}`, life);
  if (!node) return;
  const shards = big ? 12 : 8;
  const smokeClouds = big ? 7 : 5;
  const fireballs = big ? 4 : 3;
  // One insertion for the entire effect keeps its richer particle count cheap.
  const batch = document.createDocumentFragment();
  for (let i = 0; i < fireballs; i++) {
    const fireball = document.createElement('b');
    fireball.className = 'fx-fireball';
    fireball.style.setProperty('--x', `${(Math.random() - 0.5) * (big ? 30 : 20)}px`);
    fireball.style.setProperty('--y', `${(Math.random() - 0.6) * (big ? 34 : 24)}px`);
    fireball.style.setProperty('--s', `${0.65 + Math.random() * 0.7}`);
    fireball.style.animationDelay = `${i * 35}ms`;
    batch.appendChild(fireball);
  }
  for (let i = 0; i < smokeClouds; i++) {
    const smoke = document.createElement('span');
    smoke.className = 'fx-smoke';
    smoke.style.setProperty('--x', `${(Math.random() - 0.5) * (big ? 44 : 30)}px`);
    smoke.style.setProperty('--y', `${-18 - Math.random() * (big ? 60 : 42)}px`);
    smoke.style.setProperty('--s', `${0.7 + Math.random() * 0.8}`);
    smoke.style.animationDelay = `${100 + i * 45}ms`;
    batch.appendChild(smoke);
  }
  for (let i = 0; i < shards; i++) {
    const shard = document.createElement('i');
    shard.className = 'fx-spark';
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
