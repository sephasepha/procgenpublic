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

for (const seed of [1, 2, 3, 4, 5]) {
  const w = createWorld(seed); console.log(`Seed ${seed}`);
  let vo = 0, n = 0; const variants = {};
  for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) { n++; if (w.isVoid(i, j, k)) vo++; else { const v = w.variantOf(i, j, k); variants[v] = (variants[v] || 0) + 1; } }
  check(vo / n > 0.12 && vo / n < 0.45, `voids are a fair share of space (${(vo / n * 100).toFixed(0)}%)`);
  check(Object.keys(variants).length === 4, `all four room interiors occur (${JSON.stringify(variants)})`);
  check(!w.isVoid(0, 0, 0) && [-4, -2, 1, 3].every(j => !w.isVoid(0, j, 0)), 'the start and the vertical axis are solid');

  // links are symmetric, and vertical ones join rooms only
  let asym = 0, badVert = 0, vertical = 0, bridges = 0;
  for (let i = -R; i <= R; i++) for (let j = -RY; j <= RY; j++) for (let k = -R; k <= R; k++) for (let d = 0; d < 6; d++) {
    const [dx, dy, dz] = DIRS[d], l = w.link(i, j, k, d);
    if (l !== w.link(i + dx, j + dy, k + dz, OPP[d])) asym++;
    if (l && d >= 4) { vertical++; if (w.isVoid(i, j, k) || w.isVoid(i + dx, j + dy, k + dz) || w.wellCol(i, k)) badVert++; }
    if (l && d < 4 && w.isVoid(i, j, k) !== w.isVoid(i + dx, j, k + dz)) bridges++;
  }
  check(asym === 0, 'a link looks the same from both sides'); check(badVert === 0, 'stairs only join rooms, never void or wells'); check(vertical > 20 && bridges > 10, `there are stairs (${vertical / 2 | 0}) and doors onto voids (${bridges / 2 | 0})`);

  // every cell reaches the start through links
  const seen = new Set(['0,0,0']), q = [[0, 0, 0]];
  for (let h = 0; h < q.length; h++) { const [i, j, k] = q[h]; for (let d = 0; d < 6; d++) { const ni = i + DIRS[d][0], nj = j + DIRS[d][1], nk = k + DIRS[d][2]; if (Math.abs(ni) > R || Math.abs(nj) > RY || Math.abs(nk) > R) continue; const key = ni + ',' + nj + ',' + nk; if (!seen.has(key) && w.link(i, j, k, d)) { seen.add(key); q.push([ni, nj, nk]); } } }
  check(seen.size === n, `every cell connects to the start (${seen.size}/${n})`);

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
