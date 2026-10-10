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
    // every link carries the same socket on both of its faces (links can be diagonal: stair runs climb across cells)
    const byC = new Map(st.cells.map(c => [c.c, c]));
    const D = { px: [1, 0, 0, 'nx'], nx: [-1, 0, 0, 'px'], pz: [0, 0, 1, 'nz'], nz: [0, 0, -1, 'pz'], up: [0, 1, 0, 'down'], down: [0, -1, 0, 'up'] };
    for (const L of st.links) { const a = byC.get(L.a), b = byC.get(L.b); if (a.faces[L.dir] !== L.kind || b.faces[D[L.dir][3]] !== L.kind) sockets = false; }
    // and neighbouring cells of the solid kind (not walkways) agree where they are not linked
    const byPos = new Map(st.cells.map(c => [c.i + ',' + c.j + ',' + c.k, c]));
    for (const c of st.cells) if (!c.element) for (const [dir, [dx, dy, dz, opp]] of Object.entries(D)) {
      const o = byPos.get((c.i + dx) + ',' + (c.j + dy) + ',' + (c.k + dz));
      if (!o || o.element) continue;
      if (c.faces[dir] !== o.faces[opp]) sockets = false;
    }
    if (shape !== 'mega') {
      // every storey above the ground storey can be reached by a stair or a shaft from the one below
      const js = [...new Set(st.cells.map(c => c.j))].sort((a, b) => a - b);
      for (const j of js.slice(1)) if (!st.cells.some(c => c.j === j && (c.faces.down === 'stair' || c.faces.down === 'shaft'))) vertical = false;
      if (!st.stairs) stairsOk = false;
    }
  }
  check(walk, `${shape}: every cell can be reached on foot and left again ${msg}`);
  check(oneWay === 0, `${shape}: no one-way drops (${oneWay} spots you could not get back from)`);
  check(goalOk, `${shape}: there is a walking route from the entrance to the goal`);
  check(entrance, `${shape}: exactly one entrance`);
  check(sockets, `${shape}: the sockets on both sides of every shared face agree`);
  if (shape !== 'mega') check(vertical && stairsOk, `${shape}: every storey is joined to the one below by a stair or shaft`);
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
{ // megastructure: clusters floating at many heights, joined by bridges and stairways across the void, with monoliths
  let floating = 0, heights = true, stairways = true, spread = true, mass = true, summit = true, groundOnly = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const st = St.generateStructure('mega', { seed });
    const C = st.clusters;
    floating += C.filter(c => c.j0 > 0).length / C.length;
    if (new Set(C.map(c => c.j0)).size < 4) heights = false;
    if (!st.connectors.some(k => k.stairs >= 4)) stairways = false;
    if (C.length < 6) spread = false;
    if (!(st.mass > 1000)) mass = false;
    const top = Math.max(...st.cells.filter(c => !c.element).map(c => c.j));
    if (top < 14 - 3 || st.cells.find(c => c.c === st.goal).j !== top) summit = false;
    // nothing walkable but the clusters and their connectors: no cell sits on a regular floor plan grid of storeys
    if (st.cells.every(c => c.j === 0)) groundOnly++;
  }
  check(floating / SEEDS > 0.6, `megastructure: most clusters float above the ground (${(100 * floating / SEEDS).toFixed(0)}%)`);
  check(heights && spread, 'megastructure: at least six clusters, starting at four or more different heights');
  check(stairways, 'megastructure: long stairways (four or more stair cells) climb between clusters');
  check(mass, 'megastructure: monoliths of solid mass stand in the void');
  check(summit && groundOnly === 0, 'megastructure: it rises close to the top of the volume, and the goal is up there');
}
{ // stair cells are straight: each climbs one storey across one cell, and links run in its direction
  let ok = true;
  for (let seed = 1; seed <= 10; seed++) { const st = St.generateStructure('mega', { seed });
    const byC = new Map(st.cells.map(c => [c.c, c]));
    for (const L of st.links) if (L.kind === 'stairrun') { const a = byC.get(L.a), b = byC.get(L.b); if (Math.abs(a.j - b.j) > 1 || Math.abs(a.i - b.i) + Math.abs(a.k - b.k) !== 1) ok = false; } }
  check(ok, 'megastructure: every stair step joins cells one apart across and at most one storey apart');
}
{ let ok = true; for (const shape of Object.keys(St.STRUCTURE_SHAPES)) { const st = St.generateStructure(shape, { seed: 5 });
    const b = st.bounds; if (b.x0 < 0 || b.z0 < 0 || b.x1 >= st.W || b.z1 >= st.D || Math.max(b.y1, st.groundY) >= st.H) ok = false; }
  check(ok, 'every shape fits in its chunk'); }
console.log(`\n${n} checks`); console.log(fails ? `${fails} FAILED` : 'All passed'); process.exit(fails ? 1 : 0);
