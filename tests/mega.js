// The infinite 3D megastructure: node tests/mega.js
// It is a pure function of (seed, cell), so the tests are about what that function guarantees: the same cell is the
// same every time, voids are a good share of space, every cell is connected to the start, links are the same seen from
// both sides, and (the real test) you can walk, by steps of one voxel, from the start to every room that links in.
const { createWorld, CW, CH } = require('../mega/world.js');
const Body = require('../mega/body.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]], OPP = [1, 0, 3, 2, 5, 4];
const R = process.env.QUICK ? 4 : 6, RY = process.env.QUICK ? 2 : 3;

console.log('Determinism and variety');
{ const a = createWorld(5), b = createWorld(5), c = createWorld(6);
  let same = true, differ = false;
  for (let n = 0; n < 40; n++) { const i = n % 7 - 3, j = (n * 3) % 5 - 2, k = (n * 5) % 7 - 3; const x = a.genCell(i, j, k), y = b.genCell(i, j, k), z = c.genCell(i, j, k); if (x.some((v, q) => v !== y[q])) same = false; if (x.some((v, q) => v !== z[q])) differ = true; }
  check(same, 'the same seed gives the same cells'); check(differ, 'another seed gives other cells');
  // the cache must not change what a cell is
  const w = createWorld(5), first = Array.from(w.cell(2, 1, -1)); for (let n = 0; n < 1200; n++) w.cell(n % 40 - 20, 0, (n * 7) % 40 - 20); check(first.every((v, q) => v === w.cell(2, 1, -1)[q]), 'a cell regenerated after eviction is identical'); }

const BIOMES = ['interior', 'colonnade', 'terraces', 'chasm', 'expanse'];
const cases = [1, 2, 3, 4, 5].map(seed => ({ seed })).concat(...BIOMES.map(biome => [1, 2].map(seed => ({ seed, biome }))));
let mixVo = 0, mixN = 0, mixTerr = 0; const mixBiomes = new Set();
for (const { seed, biome } of cases) {
  const w = createWorld(seed, { biome }); console.log(`Seed ${seed}${biome ? ' (' + biome + ' only)' : ''}`);
  let vo = 0, n = 0; const variants = {};
  for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) { n++; if (w.isVoid(i, j, k)) vo++; else { const v = w.variantOf(i, j, k); variants[v] = (variants[v] || 0) + 1; } }
  const share = `${(vo / n * 100).toFixed(0)}%`;
  if (!biome) { mixVo += vo; mixN += n; for (let i = -30; i <= 30; i += 3) for (let j = -12; j <= 12; j += 2) for (let k = -30; k <= 30; k += 3) mixBiomes.add(w.districtOf(i, j, k).type); }
  else if (biome === 'interior') check(vo === 0, `the interior has no open air (${share})`);
  else if (biome === 'colonnade') check(vo / n > 0.6, `the colonnade is mostly air (${share})`);
  else if (biome === 'chasm') check(vo / n > 0.6 && vo / n < 0.95, `the chasm is mostly open, with faces standing in it (${share})`);
  else if (biome !== 'expanse') check(vo / n > 0.2 && vo / n < 0.8, `voids are a fair share of the ${biome} (${share})`);
  if (!biome || biome === 'interior' || biome === 'chasm') check(['tunnels', 'warren', 'open', 'pillars'].every(v => variants[v]), `all four interiors occur (${JSON.stringify(variants)})`);
  if (!biome) mixTerr += variants.terrace || 0;
  if (biome === 'terraces') check(variants.terrace > 5, `there are open terraces (${variants.terrace || 0})`);
  check(!w.isVoid(0, 0, 0) && [-4, -2, 1, 3].every(j => !w.isVoid(0, j, 0)), 'the start and the vertical axis are solid');

  // links are symmetric, and vertical ones join rooms only
  let asym = 0, badVert = 0, vertical = 0, bridges = 0, voidStairs = 0, badAir = 0, air = 0;
  for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) for (let d = 0; d < 6; d++) {
    const [dx, dy, dz] = DIRS[d], l = w.link(i, j, k, d);
    if (l !== w.link(i + dx, j + dy, k + dz, OPP[d])) asym++;
    if (l && d >= 4) { vertical++; const lo = d === 4 ? j : j - 1; if (w.shaftCol(i, k, j) || w.shaftCol(i, k, j + dy)) badVert++; if (w.voidStair(i, lo, k)) voidStairs++; }
    if (l && (w.isAir(i, j, k) || w.isAir(i + dx, j + dy, k + dz))) badAir++;
    if (l && d < 4 && w.isVoid(i, j, k) !== w.isVoid(i + dx, j, k + dz)) bridges++;
  }
  check(asym === 0, 'a link looks the same from both sides'); check(badVert === 0, 'no stair runs through a well or a drop'); check(badAir === 0, 'nothing links into open air'); if (biome === 'colonnade' || biome === 'chasm') check(voidStairs > 4, `the open voids have stair towers (${voidStairs / 2 | 0} flights)`); check(vertical > 10 && (biome === 'interior' || bridges > 10), `there are stairs (${vertical / 2 | 0}) and doors onto voids (${bridges / 2 | 0})`);

  // every cell reaches the start through links
  const seen = new Set(['0,0,0']), q = [[0, 0, 0]];
  for (let h = 0; h < q.length; h++) { const [i, j, k] = q[h]; for (let d = 0; d < 6; d++) { const ni = i + DIRS[d][0], nj = j + DIRS[d][1], nk = k + DIRS[d][2]; if (Math.abs(ni) > R || Math.abs(nj) > RY || Math.abs(nk) > R) continue; const key = ni + ',' + nj + ',' + nk; if (!seen.has(key) && w.link(i, j, k, d)) { seen.add(key); q.push([ni, nj, nk]); } } }
  for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) if (w.isAir(i, j, k)) air++;
  check(seen.size === n - air, `every cell that is not open air connects to the start (${seen.size}/${n - air})`);
  if (biome === 'expanse') { check(air / n > 0.35, `the expanse is mostly open air (${(air / n * 100).toFixed(0)}%)`); let ob = 0; for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) if (w.obeliskAt(i, j, k)) ob++; check(ob > 8, `obelisks hang in it (${ob} cells)`); }

  // walk it: standing places are a floor under two clear voxels; move to a neighbour on the same level or one up or down
  const WR = 3, WY = 2, lim = [WR * CW + CW, WY * CH + CH];
  const solid = (x, y, z) => w.voxel(x, y, z) !== 0;
  const stand = (x, y, z) => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z); // a person is two voxels tall
  const sp = w.spawn(), start = [Math.floor(sp.x), sp.y, Math.floor(sp.z)];
  const vis = new Set([start.join()]), st = [start]; let reachedCells = new Set();
  for (let h = 0; h < st.length; h++) {
    const [x, y, z] = st[h]; if (((y % CH) + CH) % CH === 1) reachedCells.add(Math.floor(x / CW) + ',' + Math.floor(y / CH) + ',' + Math.floor(z / CW)); // standing on a room's floor
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
      const nx = x + dx, ny = y + dy, nz = z + dz; if (Math.abs(nx) > lim[0] || Math.abs(nz) > lim[0] || ny < -lim[1] || ny > lim[1]) continue;
      const k = nx + ',' + ny + ',' + nz; if (vis.has(k) || !stand(nx, ny, nz)) continue;
      if (dy === 1 && solid(x, y + 2, z)) continue; // rising a step, the body spans both columns: the head must clear here too
      if (dy === -1 && solid(nx, y + 1, nz)) continue; // and walking off a step, the head must clear the next column
      vis.add(k); st.push([nx, ny, nz]);
    }
  }
  // rooms (not voids) in the walked box that link to the start's component should hold standing places we reached
  let rooms = 0, reached = 0;
  for (let i = -WR; i <= WR; i++) for (let j = -WY; j <= WY; j++) for (let k = -WR; k <= WR; k++) {
    if (w.isVoid(i, j, k)) continue;
    // inside the walked box, is it joined to the start without leaving the box?
    rooms++; if (reachedCells.has(i + ',' + j + ',' + k)) reached++;
  }
  check(reached === rooms, `walking from the start by steps reaches ${reached} of ${rooms} rooms in the box (${(reached / rooms * 100).toFixed(0)}%)`);
  // and it is not a dead world: the standing places span levels
  const ys = new Set([...vis].map(s => +s.split(',')[1])); check(ys.size > 10, `the walk climbs and descends (${ys.size} heights)`);
}

check(mixVo / mixN > 0.25 && mixVo / mixN < 0.7, `mixed: voids are a fair share of space (${(mixVo / mixN * 100).toFixed(0)}%)`);
check(mixTerr > 5, `mixed: there are open terraces (${mixTerr})`);
check(mixBiomes.size === 5, `mixed: every kind of district occurs (${[...mixBiomes]})`);

console.log('Stair towers in the voids');
for (const biome of ['colonnade', 'chasm', null]) for (const seed of [1, 2, 3]) {
  const w = createWorld(seed, { biome }), solid = (x, y, z) => w.voxel(x, y, z) !== 0;
  const stand = (x, y, z) => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
  let tried = 0, climbed = 0;
  for (let i = -12; i <= 12 && tried < 6; i++) for (let k = -12; k <= 12 && tried < 6; k++) for (let j = -3; j <= 3 && tried < 6; j++) {
    if (!w.voidStair(i, j, k)) continue; tried++;
    const s0 = [i * CW + 3, j * CH + 1, k * CW + 3], seen = new Set([s0.join()]), q = [s0]; let ok = false;
    for (let h = 0; h < q.length && !ok; h++) { const [x, y, z] = q[h];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
        const nx = x + dx, ny = y + dy, nz = z + dz; if (nx < i * CW || nx >= (i + 1) * CW || nz < k * CW || nz >= (k + 1) * CW) continue;
        const key = nx + ',' + ny + ',' + nz; if (seen.has(key) || !stand(nx, ny, nz)) continue;
        if (dy === 1 && solid(x, y + 2, z)) continue; if (dy === -1 && solid(nx, y + 1, nz)) continue;
        seen.add(key); q.push([nx, ny, nz]); if (ny === (j + 1) * CH + 1) ok = true;
      } }
    if (ok) climbed++;
  }
  if (tried) check(climbed === tried, `${biome || 'mixed'} seed ${seed}: every stair tower flight can be climbed (${climbed}/${tried})`);
}

console.log('Every stair that touches open space can be climbed');
for (const biome of ['expanse', null]) for (const seed of [1, 2, 3, 4]) {
  const w = createWorld(seed, { biome }), solid = (x, y, z) => w.voxel(x, y, z) !== 0;
  const stand = (x, y, z) => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
  let tried = 0, climbed = 0, kinds = new Set(); const bad = [];
  for (let i = -8; i <= 8; i++) for (let k = -8; k <= 8; k++) for (let j = -4; j <= 3; j++) {
    if (!w.link(i, j, k, 4)) continue; const a = w.isVoid(i, j, k), b = w.isVoid(i, j + 1, k); if (!a && !b) continue;
    tried++; kinds.add((a ? 'void' : 'room') + '>' + (b ? 'void' : 'room'));
    const q = [], seen = new Set();
    for (let x = i * CW; x < (i + 1) * CW; x++) for (let z = k * CW; z < (k + 1) * CW; z++) if (stand(x, j * CH + 1, z)) { q.push([x, j * CH + 1, z]); seen.add(x + ',' + (j * CH + 1) + ',' + z); }
    let ok = false;
    for (let h = 0; h < q.length && !ok; h++) { const [x, y, z] = q[h];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
        const nx = x + dx, ny = y + dy, nz = z + dz; if (nx < i * CW || nx >= (i + 1) * CW || nz < k * CW || nz >= (k + 1) * CW || ny < j * CH || ny > (j + 1) * CH + 1) continue;
        const key = nx + ',' + ny + ',' + nz; if (seen.has(key) || !stand(nx, ny, nz)) continue;
        if (dy === 1 && solid(x, y + 2, z)) continue; if (dy === -1 && solid(nx, y + 1, nz)) continue;
        seen.add(key); q.push([nx, ny, nz]); if (ny === (j + 1) * CH + 1) ok = true;
      } }
    if (ok) climbed++; else if (bad.length < 3) bad.push([i, j, k].join());
  }
  check(tried > 0 && climbed === tried, `${biome || 'mixed'} seed ${seed}: ${climbed}/${tried} flights out of or into open space climb (${[...kinds]}) ${bad.join(' ')}`);
}

console.log('Walking it with the real body: stairs up and down, bridges over voids');
for (const seed of [1, 2, 3]) {
  const w = createWorld(seed), solid = (x, y, z) => w.voxel(x, y, z) !== 0;
  const stand = (x, y, z) => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
  const sp = w.spawn(), start = [Math.floor(sp.x), sp.y, Math.floor(sp.z)], par = new Map([[start.join(), null]]), order = [start];
  for (let h = 0; h < order.length; h++) {
    const [x, y, z] = order[h];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
      const nx = x + dx, ny = y + dy, nz = z + dz; if (Math.abs(nx) > 70 || Math.abs(nz) > 70 || Math.abs(ny) > 30) continue;
      const key = nx + ',' + ny + ',' + nz; if (par.has(key) || !stand(nx, ny, nz)) continue;
      if (dy === 1 && solid(x, y + 2, z)) continue; if (dy === -1 && solid(nx, y + 1, nz)) continue;
      par.set(key, [x, y, z].join()); order.push([nx, ny, nz]);
    }
  }
  const cellJ = p => Math.floor(p[1] / CH), cellOf = p => [Math.floor(p[0] / CW), Math.floor(p[2] / CW)];
  const goals = { up: order.find(p => cellJ(p) === 1 && ((p[1] % CH) + CH) % CH === 1), down: order.find(p => cellJ(p) === -1 && ((p[1] % CH) + CH) % CH === 1), bridge: order.find(p => { const c = cellOf(p); return cellJ(p) === 0 && w.isVoid(c[0], 0, c[1]) && p[1] === 1; }) };
  for (const [name, goal] of Object.entries(goals)) {
    if (!goal) { check(false, `seed ${seed}: there is a place to walk to: ${name}`); continue; }
    const path = []; for (let k = goal.join(); k; k = par.get(k)) path.unshift(k.split(',').map(Number));
    const b = Body.createBody(w, sp.x, sp.y, sp.z, 0); let wi = 1, t = 0, lastProgress = 0, ok = false;
    for (let n = 0; n < 60 * 400 && wi < path.length; n++) {
      const tx = path[wi][0] + 0.5, tz = path[wi][2] + 0.5, dx = tx - b.p.x, dz = tz - b.p.z;
      if (Math.hypot(dx, dz) < 0.35 && Math.abs(b.p.y - path[wi][1]) < 0.6) { wi++; lastProgress = b.t; continue; }
      b.p.yaw = Math.atan2(dx, -dz); Body.step(b, 1 / 60, 1, 0, false, 1);
      if (b.t - lastProgress > 4) break; // stuck
    }
    ok = wi >= path.length;
    check(ok, `seed ${seed}: the body walks ${path.length} steps to ${name} (reached waypoint ${wi}/${path.length}, at ${b.p.x.toFixed(1)}, ${b.p.y.toFixed(1)}, ${b.p.z.toFixed(1)})`);
  }
}

console.log('The body');
{ const w = createWorld(3), sp = w.spawn(); const b = Body.createBody(w, sp.x, sp.y, sp.z, 0); for (let n = 0; n < 60; n++) Body.step(b, 1 / 60, 0, 0, false, 1);
  const y0 = b.p.y; check(b.grounded && Math.abs(y0 - 1) < 1e-6, 'it stands on the floor');
  b.jumpAt = b.t; let top = y0; for (let n = 0; n < 90; n++) { Body.step(b, 1 / 60, 0, 0, false, 1); top = Math.max(top, b.p.y); }
  check(top - y0 > 1.2 && top - y0 < 1.6, `a jump rises about ${(top - y0).toFixed(2)} m`); check(b.grounded && Math.abs(b.p.y - y0) < 1e-6, 'and lands again');
  // walking into a wall stops you
  const c = Body.createBody(w, 8.5, 1, 8.5, Math.PI / 2); for (let n = 0; n < 240; n++) Body.step(c, 1 / 60, 1, 0, true, 1); check(c.p.x < 17 && c.p.x > 14, `a wall stops you (x ${c.p.x.toFixed(2)})`); }

console.log('Speed');
{ const w = createWorld(9); const t0 = Date.now(); let c = 0; for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) for (let k = -4; k <= 4; k++) { w.genCell(i, j, k); c++; } const ms = (Date.now() - t0) / c; check(ms < 3, `a cell generates in ${ms.toFixed(2)} ms`); }
console.log(`\n${checks} checks`); console.log(failures ? failures + ' FAILED' : 'All passed'); process.exit(failures ? 1 : 0);
