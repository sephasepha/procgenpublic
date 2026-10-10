// 3D tile kit and WFC dressing: node tests/dress3d.js
const fs = require('fs'), path = require('path');
const St = require('../voxels/structures.js');
const { dressStructure, rotatePiecePoint } = require('../voxels/dress3d.js');
const TS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'voxels', 'tiles', 'tileset.json'), 'utf8'));
const V = St.SVOX;
let fails = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.log('  FAIL ' + what); } };
console.log('3D tile dressing');

{ // every piece in the manifest is a valid OBJ inside its cell (plus the half-voxel shared lines and rails above)
  let ok = true, msg = '';
  for (const [name, p] of Object.entries(TS.pieces)) {
    const txt = fs.readFileSync(path.join(__dirname, '..', 'voxels', 'tiles', p.file), 'utf8');
    const vs = txt.split('\n').filter(l => l.startsWith('v ')).map(l => l.slice(2).split(' ').map(Number));
    const fs2 = txt.split('\n').filter(l => l.startsWith('f '));
    const bad = fs2.some(l => l.slice(2).split(' ').some(t => { const i = Number(t.split('/')[0]); return !(i >= 1 && i <= vs.length); }));
    const out = vs.some(([x, y, z]) => Math.abs(x) > 2.6 || Math.abs(z) > 2.6 || y < 0 || y > 8.01);
    if (!vs.length || !fs2.length || bad || out) { ok = false; msg = name; }
    if (!TS.families[p.family].includes(name)) ok = false;
  }
  check(ok, 'every piece is a well-formed OBJ that stays inside its cell ' + msg);
}

for (const shape of Object.keys(St.STRUCTURE_SHAPES)) {
  let unknown = new Set(), solved = true, rulesOk = true, doorsOk = true, runsOk = true, flightsOk = true, coverage = true;
  for (let seed = 1; seed <= 8; seed++) {
    const st = St.generateStructure(shape, { seed });
    const d = dressStructure(st, TS, seed);
    d.unknown.forEach(u => unknown.add(u));
    if (!d.wfc.solved) solved = false;
    // every pair of neighbouring slots obeys the adjacency rules
    d.slotList.forEach((s, a) => { for (const [b, axis] of d.neighbours[a]) {
      const r = TS.rules[s.family] && TS.rules[s.family][axis]; if (!r) continue;
      const pa = d.placements[s.p].piece, pb = d.placements[d.slotList[b].p].piece;
      if (r[pa] && !r[pa].includes(pb)) rulesOk = false;
    } });
    const vox = (x, y, z) => st.vox[st.idx(Math.floor(x), y, Math.floor(z))];
    for (const pl of d.placements) {
      // doors: the doorway in the piece lines up with the door voxels the layout carved
      if (pl.family === 'door') {
        const o = TS.pieces[pl.piece].offset, [rx, rz] = rotatePiecePoint(o, 2, pl.rot);
        if (vox(pl.x + rx, pl.y + 1, pl.z + rz) !== V.DOOR) doorsOk = false;
      }
      // stair runs: rotated the right way, so the third step is higher than the first, as in the voxels
      if (pl.piece === 'stair_run') {
        const [ax, az] = rotatePiecePoint(0, 1, pl.rot), [bx, bz] = rotatePiecePoint(0, -1, pl.rot);
        if (vox(pl.x + ax, pl.y + 3, pl.z + az) !== V.STAIR || vox(pl.x + bx, pl.y + 3, pl.z + bz) === V.STAIR) runsOk = false;
      }
      // in-cell flights: the top step sits where the voxel flight's top step is
      if (pl.family === 'stair') { const row = TS.pieces[pl.piece].row; if (vox(pl.x + 0.5, pl.y + 3, pl.z - 2.5 + row) !== V.STAIR) flightsOk = false; }
    }
    // each cell that is not open sky gets something
    const touched = new Set(d.placements.map(p => p.cell));
    if (st.cells.some(c => !touched.has(c.c))) coverage = false;
  }
  check(unknown.size === 0, `${shape}: every socket the layout writes has a piece (or deliberately none) ${[...unknown].join(' ')}`);
  check(solved, `${shape}: WFC finds a variant for every slot without falling back`);
  check(rulesOk, `${shape}: neighbouring variants obey the adjacency rules`);
  check(doorsOk, `${shape}: door pieces line up with the carved doorways`);
  check(runsOk, `${shape}: stair-run pieces climb the same way as the voxel stairs`);
  check(flightsOk, `${shape}: in-cell stair pieces sit on the voxel flights`);
  check(coverage, `${shape}: every cell gets at least one piece`);
}
{ // pilasters really do run the full height of a facade, and bands its full width
  const st = St.generateStructure('tower', { seed: 3 }), d = dressStructure(st, TS, 3);
  const at = new Map(d.slotList.map(s => [s.family + '|' + s.key, d.placements[s.p].piece]));
  let v = true, h = true;
  for (const s of d.slotList) if (s.family === 'wall') {
    const [pos, dir] = s.key.split('|'), [i, j, k] = pos.split(',').map(Number), me = d.placements[s.p].piece;
    const up = at.get(`wall|${i},${j + 1},${k}|${dir}`); if (me === 'wall_ribbed' && up && up !== 'wall_ribbed') v = false;
    const side = dir === 'px' || dir === 'nx' ? at.get(`wall|${i},${j},${k + 1}|${dir}`) : at.get(`wall|${i + 1},${j},${k}|${dir}`);
    if (me === 'wall_banded' && side && side !== 'wall_banded') h = false;
  }
  check(v && h, 'pilasters continue up the facade and bands continue along it');
  const variety = new Set(d.placements.filter(p => p.family === 'wall').map(p => p.piece)).size;
  check(variety >= 2, 'and the walls are not all one variant');
}
console.log(`\n${n} checks`); console.log(fails ? `${fails} FAILED` : 'All passed'); process.exit(fails ? 1 : 0);
