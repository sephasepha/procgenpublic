// The first-person spawn room: node tests/spawn.js
// Over a spread of seeds and presets: a spawn room is always found in solid rock near the entrance, it is joined to the
// maze by one corridor that touches the maze only at its end, and everything it joins is reachable from the entrance.
const W = require('../gen/world.js');
const { planSpawn } = require('../walk/spawn.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const COLS = 120, ROWS = 156;
let found = 0, total = 0, minLen = 99, maxLen = 0;
for (const preset of ['underdark', 'arsenal', 'generic']) for (let seed = 1; seed <= 12; seed++) {
  const S = { ...W.WORLD_DEFAULTS, preset, seed };
  const s = W.genSector(S, 0, 0), ex = s.entranceSub % COLS, ey = (s.entranceSub / COLS) | 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? -1 : s.pass[y * COLS + x];
  const r = planSpawn(at, ex, ey); total++;
  check(r.ok, `${preset} ${seed}: a spawn room was found`); if (!r.ok) continue; found++;
  const inRoom = (x, y) => r.cells.get(x + ',' + y) === 'room';
  check(r.room.w === 7 && [...r.cells.values()].filter(v => v === 'room').length === 49, `${preset} ${seed}: the room is a 7 by 7 chamber`);
  check([...r.cells.keys()].every(k => { const [x, y] = k.split(',').map(Number); return at(x, y) === 0 || k === r.join.join(','); }), `${preset} ${seed}: everything it carves was rock`);
  // the new floor touches the maze only at the corridor's end
  let touches = 0; r.cells.forEach((v, k) => { const [x, y] = k.split(',').map(Number); [[0, 1], [1, 0], [0, -1], [-1, 0]].forEach(([dx, dy]) => { if (at(x + dx, y + dy) === 1) touches++; }); });
  check(touches === 1, `${preset} ${seed}: it meets the maze in exactly one place (${touches})`);
  check(r.length >= 6, `${preset} ${seed}: a real corridor (${r.length} cells)`); minLen = Math.min(minLen, r.length); maxLen = Math.max(maxLen, r.length);
  // walk from the start over the old floor plus the new, to the entrance
  const floor = (x, y) => r.cells.has(x + ',' + y) || at(x, y) === 1;
  const seen = new Set([r.start.gx + ',' + r.start.gy]), q = [[r.start.gx, r.start.gy]];
  for (let h = 0; h < q.length; h++) { const [x, y] = q[h]; [[0, 1], [1, 0], [0, -1], [-1, 0]].forEach(([dx, dy]) => { const k = (x + dx) + ',' + (y + dy); if (!seen.has(k) && floor(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } }); }
  check(seen.has(ex + ',' + ey), `${preset} ${seed}: the start reaches the maze entrance`);
  check(inRoom(r.start.gx, r.start.gy), `${preset} ${seed}: you start inside the room`);
}
console.log(`${found}/${total} found, corridors ${minLen} to ${maxLen} cells`);
console.log(`\n${checks} checks`); console.log(failures ? failures + ' FAILED' : 'All passed'); process.exit(failures ? 1 : 0);
