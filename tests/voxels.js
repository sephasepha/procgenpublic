// Voxel pillars: node tests/voxels.js
const V = require('../voxels/gen.js');
const { VOXEL } = V;
let fails = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.log('  FAIL ' + what); } };
console.log('Voxel pillars');
{ const a = V.generateVoxels({ seed: 7 }), b = V.generateVoxels({ seed: 7 });
  check(a.vox.length === b.vox.length && a.vox.every((v, i) => v === b.vox[i]), 'the same seed gives the same chunk'); }
{ let ok = true, bad = ''; for (let seed = 1; seed <= 60; seed++) for (const towers of [2, 6, 10]) {
    const c = V.generateVoxels({ seed, towers, maxH: 40 });
    if (c.towers.length >= 2 && V.voxelComponents(c) !== 1) { ok = false; bad = `seed ${seed} towers ${towers}`; }
  } check(ok, 'every tower is reachable over the bridges ' + bad); }
{ let ok = true; for (let seed = 1; seed <= 40; seed++) {
    const c = V.generateVoxels({ seed });
    for (const b of c.bridges) { const A = c.towers[b.a], B = c.towers[b.b]; if (b.y % c.STOREY || b.y >= Math.min(A.h, B.h)) ok = false; }
  } check(ok, 'bridges land on a floor level both towers have'); }
{ let ok = true; for (let seed = 1; seed <= 40; seed++) {
    const c = V.generateVoxels({ seed });
    for (const b of c.bridges) for (const t of [c.towers[b.a], c.towers[b.b]]) {
      // somewhere on this tower's wall ring, at the bridge level + 1..3, there is an opening
      let open = false;
      for (let z = t.z0; z < t.z0 + t.w; z++) for (let x = t.x0; x < t.x0 + t.w; x++) {
        const edge = x === t.x0 || z === t.z0 || x === t.x0 + t.w - 1 || z === t.z0 + t.w - 1;
        if (edge && [1, 2, 3].every(dy => c.vox[c.idx(x, b.y + dy, z)] === VOXEL.EMPTY) && c.vox[c.idx(x, b.y, z)] === VOXEL.FLOOR) open = true;
      }
      if (!open) ok = false;
    }
  } check(ok, 'each bridge cuts a walkable doorway into both towers'); }
{ let ok = true; for (let seed = 1; seed <= 30; seed++) {
    const c = V.generateVoxels({ seed, towers: 10 });
    for (let i = 0; i < c.towers.length; i++) for (let j = i + 1; j < c.towers.length; j++) {
      const a = c.towers[i], b = c.towers[j];
      if (a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.z0 < b.z0 + b.w && b.z0 < a.z0 + a.w) ok = false;
    }
  } check(ok, 'towers never overlap'); }
{ const c = V.generateVoxels({ seed: 3 }); let ok = true;
  for (let z = 0; z < c.D; z++) for (let x = 0; x < c.W; x++) if (c.vox[c.idx(x, 0, z)] !== VOXEL.GROUND) ok = false;
  check(ok, 'the ground plate is complete'); }
console.log(`\n${n} checks`); console.log(fails ? `${fails} FAILED` : 'All passed'); process.exit(fails ? 1 : 0);
