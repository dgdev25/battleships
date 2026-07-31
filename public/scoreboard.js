// Stadium scoreboard: real seven-segment digits built from divs, so they glow
// and flicker like bulbs instead of pretending to be text.

const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '',
};

function digit(tone) {
  const el = document.createElement('div');
  el.className = `seg-digit tone-${tone}`;
  for (const name of 'abcdefg') {
    const seg = document.createElement('i');
    seg.className = `seg seg-${name}`;
    seg.dataset.seg = name; // the class list changes as segments light, the dataset does not
    el.appendChild(seg);
  }
  return el;
}

export function makeDisplay(digits, tone, colonAfter = null) {
  const wrap = document.createElement('div');
  wrap.className = 'seg-display';
  for (let i = 0; i < digits; i++) {
    wrap.appendChild(digit(tone));
    if (colonAfter === i + 1) {
      const colon = document.createElement('div');
      colon.className = 'seg-colon';
      wrap.appendChild(colon);
    }
  }
  return wrap;
}

export function setDisplay(wrap, value) {
  const cells = [...wrap.children].filter((el) => el.classList.contains('seg-digit'));
  const text = String(value).padStart(cells.length, '0').slice(-cells.length);
  cells.forEach((el, i) => {
    const lit = SEGMENTS[text[i]] ?? '';
    for (const seg of el.children) seg.classList.toggle('on', lit.includes(seg.dataset.seg));
  });
}

// Builds the board once and hands back setters, so the render path stays a
// couple of cheap assignments per turn.
export function buildScoreboard(root) {
  root.innerHTML = '';
  root.className = 'scoreboard';

  const clockRow = document.createElement('div');
  clockRow.className = 'sb-clock-row';
  const clockLabel = document.createElement('span');
  clockLabel.className = 'sb-legend';
  clockLabel.textContent = 'ENGAGEMENT';
  const clock = makeDisplay(4, 'amber', 2);
  clock.classList.add('sb-clock');
  clockRow.append(clockLabel, clock);

  const main = document.createElement('div');
  main.className = 'sb-main';

  const buildSide = (name, tone) => {
    const side = document.createElement('div');
    side.className = 'sb-side';
    const title = document.createElement('span');
    title.className = `sb-team tone-${tone}`;
    title.textContent = name;
    const value = makeDisplay(2, tone);
    value.classList.add('sb-score');
    side.append(title, value);
    return { side, value };
  };

  const home = buildSide('YOU', 'red');
  const guest = buildSide('AI', 'red');

  const centre = document.createElement('div');
  centre.className = 'sb-centre';
  const turnLabel = document.createElement('span');
  turnLabel.className = 'sb-legend';
  turnLabel.textContent = 'TURN';
  const turn = makeDisplay(2, 'green');
  turn.classList.add('sb-turn');

  const flankLeft = document.createElement('div');
  flankLeft.className = 'sb-flank';
  const flankLeftValue = makeDisplay(1, 'red');
  flankLeft.append(Object.assign(document.createElement('span'), { className: 'sb-flank-label', textContent: 'S' }), flankLeftValue);

  const flankRight = document.createElement('div');
  flankRight.className = 'sb-flank';
  const flankRightValue = makeDisplay(1, 'red');
  flankRight.append(Object.assign(document.createElement('span'), { className: 'sb-flank-label', textContent: 'S' }), flankRightValue);

  const centreRow = document.createElement('div');
  centreRow.className = 'sb-centre-row';
  centreRow.append(flankLeft, turn, flankRight);
  centre.append(turnLabel, centreRow);

  main.append(home.side, centre, guest.side);

  const strip = document.createElement('div');
  strip.className = 'sb-strip';
  const buildCount = (label, tone) => {
    const box = document.createElement('div');
    box.className = 'sb-count';
    const name = document.createElement('span');
    name.className = 'sb-count-label';
    name.textContent = label;
    const value = makeDisplay(2, tone);
    box.append(name, value);
    strip.appendChild(box);
    return value;
  };
  const shots = buildCount('SHOTS', 'green');
  const streak = buildCount('STREAK', 'amber');
  const sunk = buildCount('SUNK', 'red');

  root.append(clockRow, main, strip);

  const setters = {
    clock, playerScore: home.value, aiScore: guest.value, turn,
    playerSunk: flankLeftValue, aiSunk: flankRightValue, shots, streak, sunk,
  };
  for (const el of Object.values(setters)) setDisplay(el, 0);
  return setters;
}

export function flash(wrap) {
  wrap.classList.remove('sb-flash');
  void wrap.offsetWidth; // restart the animation
  wrap.classList.add('sb-flash');
}
