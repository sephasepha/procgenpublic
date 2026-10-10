// Voxel structures (pyramid, sunken column, tower): node tests/structures.js
// QUICK=1 checks fewer seeds.
const St = require('../voxels/structures.js');
const { walkCheck } = require('../voxels/walk.js');
const V = St.SVOX;
let fails = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.log('  FAIL ' + what); } };
const SEEDS = process.env.QUICK ? 12 : 40;
console.log('Voxel structures');

for (const shape of Object.keys(St.STRUCTURE_SHAPES)) {
  let walk = true, oneWay = 0, dead = 0, entrance = true, goalOk = true, sockets = true, stairsOk = true, vertical = true, msg = '';
  for (let seed = 1; seed <= SEEDS; seed++) {
    const st = St.generateStructure(shape, { seed });
    const w = walkCheck(st);
    if (!w.ok) { walk = false; msg = `seed ${seed}: ${w.bad.length} cells not explorable${w.reason ? ' (' + w.reason + ')' : ''}`; }
    oneWay += w.oneWay;
    dead += st.deadEnds;
    if (!w.path.length) goalOk = false;
    // exactly one entrance into the structure, and it is the entrance cell's
    const ent = st.cells.filter(c => Object.values(c.faces).includes('entrance') || (c.kind === 'entrance'));
    if (ent.length !== 1) entrance = false;
    // every face socket agrees with the cell on the other side
    const byPos = new Map(st.cells.map(c => [c.i + ',' + c.j + ',' + c.k, c]));
    const D = { px: [1, 0, 0, 'nx'], nx: [-1, 0, 0, 'px'], pz: [0, 0, 1, 'nz'], nz: [0, 0, -1, 'pz'], up: [0, 1, 0, 'down'], down: [0, -1, 0, 'up'] };
    for (const c of st.cells) for (const [dir, [dx, dy, dz, opp]] of Object.entries(D)) {
      const o = byPos.get((c.i + dx) + ',' + (c.j + dy) + ',' + (c.k + dz));
      if (!o) continue;
      const a = c.faces[dir], b = o.faces[opp];
      const same = a === b || (dir === 'up' && a === 'floor' && b === 'floor') || (dir === 'down' && a === 'floor' && b === 'floor');
      if (!same) sockets = false;
    }
    // every storey above the ground storey can be reached by a stair or a shaft from the one below
    const js = [...new Set(st.cells.map(c => c.j))].sort((a, b) => a - b);
    for (const j of js.slice(1)) if (!st.cells.some(c => c.j === j && (c.faces.down === 'stair' || c.faces.down === 'shaft'))) vertical = false;
    if (!st.stairs) stairsOk = false;
  }
  check(walk, `${shape}: every cell can be reached on foot and left again ${msg}`);
  check(oneWay === 0, `${shape}: no one-way drops (${oneWay} spots you could not get back from)`);
  check(goalOk, `${shape}: there is a walking route from the entrance to the goal`);
  check(entrance, `${shape}: exactly one entrance`);
  check(sockets, `${shape}: the sockets on both sides of every shared face agree`);
  check(vertical && stairsOk, `${shape}: every storey is joined to the one below by a stair or shaft`);
  const avg = dead / SEEDS, limit = shape === 'pyramid' ? 4 : 0.5;
  check(avg <= limit, `${shape}: dead ends stay rare (average ${avg.toFixed(2)} per structure, limit ${limit})`);
}
{ const a = St.generateStructure('tower', { seed: 9 }), b = St.generateStructure('tower', { seed: 9 });
  check(a.vox.every((v, i) => v === b.vox[i]), 'the same seed gives the same structure'); }
{ const st = St.generateStructure('tower', { seed: 4, shafts: 1 });
  const shaft = st.cells.filter(c => c.kind === 'shaft');
  const storeys = new Set(shaft.map(c => c.j));
  check(shaft.length > 0 && shaft.every(c => ['px', 'nx', 'pz', 'nz'].some(d => c.faces[d] === 'door')), 'a tower shaft has a door on every storey');
  check(storeys.size === new Set(st.cells.map(c => c.j)).size, 'and runs the full height');
  check(st.cells.filter(c => c.kind === 'entrance').every(c => c.j === 0), 'the tower entrance is on the bottom floor'); }
{ const st = St.generateStructure('column', { seed: 2 });
  const ent = st.cells.find(c => c.kind === 'entrance'), top = Math.max(...st.cells.map(c => c.j));
  const goal = st.cells.find(c => c.c === st.goal);
  check(ent.j === top && ent.faces.up === 'stair', 'the sunken column is entered by a stair from the surface');
  check(goal.j === 0, 'and its goal is on the deepest storey');
  check(st.cells.every(c => c.origin[1] + st.S <= st.groundY), 'and it lies entirely below the ground'); }
{ const st = St.generateStructure('pyramid', { seed: 3 });
  const per = {}; for (const c of st.cells) per[c.j] = (per[c.j] || 0) + 1;
  const js = Object.keys(per).map(Number).sort((a, b) => a - b);
  check(js.every((j, i) => i === 0 || per[j] <= per[js[i - 1]]), 'the pyramid narrows (never widens) going up');
  check(per[js[js.length - 1]] <= 2 && st.cells.find(c => c.c === st.goal).j === js[js.length - 1], 'and ends in a point, which is the goal'); }
{ // megastructure: an atrium void through the core, bridges across it, galleries and terraces
  let voidOk = true, bridgesOk = true, galleries = true, terraces = 0, groundFull = true, sky = true;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const st = St.generateStructure('mega', { seed }), n = 9;
    const at = new Map(st.cells.map(c => [c.i + ',' + c.j + ',' + c.k, c]));
    if (st.cells.filter(c => c.j === 0).length !== n * n) groundFull = false;
    const mid = Math.floor(n / 2);
    for (let j = 1; j < 12; j++) { const c = at.get(mid + ',' + j + ',' + mid); if (c && c.kind !== 'bridge' && c.kind !== 'goal') voidOk = false; }
    if (!st.bridges.length) bridgesOk = false;
    for (const b of st.bridges) {
      const cells = st.cells.filter(c => c.region === b.region);
      const ends = cells.flatMap(c => ['px', 'nx', 'pz', 'nz'].filter(d => c.faces[d] === 'arch' || c.faces[d] === 'door'));
      if (ends.length !== 2 || !cells.every(c => Object.values(c.faces).filter(f => f === 'rail').length === 2)) bridgesOk = false;
    }
    if (!st.cells.some(c => Object.values(c.faces).includes('gallery'))) galleries = false;
    if (st.cells.some(c => Object.values(c.faces).includes('terrace'))) terraces++;
    // nothing roofs the atrium: straight up from the middle of its floor you only meet bridge decks
    const x = st.bounds.x0 + mid * st.P + 2, z = st.bounds.z0 + mid * st.P + 2;
    for (let y = 5; y < st.H; y++) { const t = st.vox[st.idx(x, y, z)]; if (St.SVOX_SOLID[t] && t !== St.SVOX.DECK) sky = false; }
  }
  check(groundFull, 'megastructure: the ground floor covers the whole square footprint');
  check(voidOk && sky, 'megastructure: an atrium runs from the first storey up to the sky');
  check(bridgesOk, 'megastructure: bridges cross the atrium, land at both ends (wide arch, or a door into a room), and have rails on both sides');
  check(galleries, 'megastructure: walls facing the atrium open into galleries');
  check(terraces > SEEDS / 2, `megastructure: setbacks leave walk-out roof terraces (in ${terraces} of ${SEEDS})`);
}
{ let ok = true; for (const shape of Object.keys(St.STRUCTURE_SHAPES)) { const st = St.generateStructure(shape, { seed: 5 });
    const b = st.bounds; if (b.x0 < 0 || b.z0 < 0 || b.x1 >= st.W || b.z1 >= st.D || Math.max(b.y1, st.groundY) >= st.H) ok = false; }
  check(ok, 'every shape fits in its chunk'); }
console.log(`\n${n} checks`); console.log(fails ? `${fails} FAILED` : 'All passed'); process.exit(fails ? 1 : 0);
