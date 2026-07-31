import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('repeat-play render and audio work remains bounded', async () => {
  const [css, app, fx, sfx, server] = await Promise.all([
    read('../public/styles.css'), read('../public/app.js'), read('../public/fx.js'),
    read('../public/sfx.js'), read('../src/server.mjs'),
  ]);

  assert.doesNotMatch(css, /\.cell\.burning[^}]*animation:[^;}]*infinite/s);
  assert.match(css, /\.sweep\.on::before\s*{[^}]*animation:/s);
  assert.match(app, /visibilitychange/);
  assert.match(app, /stopClock\(\)/);
  assert.match(fx, /setTimeout\(\(\) => node\.remove\(\), life\)/);
  assert.match(sfx, /const noiseBuffers = new Map\(\)/);
  assert.match(sfx, /addEventListener\('ended'/);
  assert.match(server, /games\.delete\(game\.id\)/);
  assert.match(server, /'\.ogg': 'audio\/ogg'/);
});

test('explosions use a bundled field recording with a procedural fallback', async () => {
  const sfx = await read('../public/sfx.js');
  assert.match(sfx, /\/audio\/explosion\.ogg/);
  assert.match(sfx, /function proceduralExplosion/);
});

test('impact visuals contain a fireball, smoke, sparks, and water droplets', async () => {
  const [fx, css] = await Promise.all([read('../public/fx.js'), read('../public/styles.css')]);
  for (const token of ['fx-fireball', 'fx-smoke', 'fx-spark', 'fx-droplet']) {
    assert.match(`${fx}\n${css}`, new RegExp(token));
  }
});

test('both boards render shaped hull overlays while enemy geometry stays reveal-gated', async () => {
  const [app, html, server] = await Promise.all([
    read('../public/app.js'), read('../public/index.html'), read('../src/server.mjs'),
  ]);
  assert.match(app, /renderFleetPieces/);
  assert.match(app, /renderFleetPieces\(\$\('enemy-ships'\), state\.config\.fleet, \[\]\)/);
  assert.match(html, /id="enemy-ships"/);
  assert.match(html, /id="own-ships"/);
  assert.match(html, /rel="icon"/);
  assert.match(server, /fleetShips: revealAll/);
});

test('return-fire tempo is user adjustable, displayed, and persisted', async () => {
  const [app, html] = await Promise.all([read('../public/app.js'), read('../public/index.html')]);
  assert.match(html, /input[^>]+id="tempo-range"[^>]+type="range"/);
  assert.match(html, /id="tempo-value"/);
  assert.match(app, /returnFireMs/);
  assert.match(app, /await wait\(state\.returnFireMs\)/);
  assert.match(app, /abyssal-tempo/);
});

test('the game has a main landmark without an invalid ARIA grid tree', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /<main class="shell">/);
  assert.doesNotMatch(html, /role="grid"/);
});
