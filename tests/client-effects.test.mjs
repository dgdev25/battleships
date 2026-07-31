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
  assert.match(server, /'\.mp3': 'audio\/mpeg'/);
});

test('combat uses the supplied launch, whistle, and explosion recordings with fallbacks', async () => {
  const sfx = await read('../public/sfx.js');
  for (const sample of ['ship-fire-rocket.mp3', 'falling-bomb-whistle.mp3', 'bomb-explosion.mp3']) {
    assert.ok(sfx.includes(`/audio/${sample}`));
  }
  assert.match(sfx, /FLIGHT_MS = 3400/);
  assert.match(sfx, /function proceduralExplosion/);
});

test('misses use a bundled water recording rather than a synthesized crack', async () => {
  const sfx = await read('../public/sfx.js');
  assert.match(sfx, /\/audio\/water-splashes\.ogg/);
  assert.match(sfx, /WATER_IMPACTS/);
  const splashBody = sfx.match(/export function splash\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(splashBody, /highpass/);
});

test('the supplied sea ambience loops and obeys the global sound toggle', async () => {
  const [app, sfx] = await Promise.all([read('../public/app.js'), read('../public/sfx.js')]);
  assert.match(sfx, /\/audio\/ww2-sea-background\.mp3/);
  assert.match(sfx, /source\.loop = true/);
  assert.match(sfx, /seaAmbience: 0\.07/);
  assert.match(sfx, /if \(muted\) \{\s*stopAmbience\(\)/s);
  assert.doesNotMatch(app, /if \(!next\) sfx\.launch\(\)/);
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
  assert.match(html, /id="tempo-range"[^>]+max="5000"[^>]+value="1800"/);
  assert.ok(app.indexOf('await wait(state.returnFireMs)') < app.indexOf('log(`AI →'));
});

test('the game has a main landmark without an invalid ARIA grid tree', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /<main class="shell">/);
  assert.doesNotMatch(html, /role="grid"/);
});
