// Dresses a voxel structure with the 3D tile kit (voxels/tiles/tileset.json).
//
// Two steps:
//  1. Placement: every cell's sockets choose a family of pieces (a 'window' face gets a window piece, a floor
//     above a stair gets the floor-with-hole, a walkway stair gets the stair-run, …) and a rotation about Y.
//     Pieces whose shape is fixed by the layout (doors at an offset, stair rows) are picked directly.
//  2. WFC: families with variants (walls, windows, floors, roofs, decks, monolith mass) become slots, and a
//     wave function collapse picks one variant per slot so every pair of neighbours obeys the tileset's
//     adjacency rules: pilasters run the full height of a facade, bands run its full width, one kind of
//     window per ribbon, a monolith keeps one finish.
// Output: placements in voxel-world coordinates (the centre of the cell's floor) with a rotation in degrees.
(function (root) {
  const ROT = { pz: 0, px: 90, nz: 180, nx: 270 };
  const SIDES = ['px', 'nx', 'pz', 'nz'];
  const NO_PIECE = { side: ['open', 'deck', 'stairrun'], down: ['shaft', 'sky'], up: ['floor', 'stair', 'sky', 'headroom', 'shaft'] };

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function dressStructure(st, tileset, seed) {
    const fam = tileset.families, pieces = tileset.pieces, sockets = tileset.sockets, rules = tileset.rules || {};
    const P = st.P, S = st.S;
    const out = [], slots = [], unknown = new Set();
    const slotAt = new Map(); // family|i,j,k|dir -> slot index
    const centre = c => [c.origin[0] + P / 2 + 0.5, c.origin[1], c.origin[2] + P / 2 + 0.5];
    const place = (piece, c, rot, extra) => { const [x, y, z] = centre(c); out.push(Object.assign({ piece, family: pieces[piece].family, x, y, z, rot, cell: c.c }, extra || {})); return out.length - 1; };
    // a slot: one placement whose variant WFC will choose
    const slot = (family, c, rot, key) => {
      const p = place(fam[family][0], c, rot);
      slots.push({ family, p, key }); slotAt.set(family + '|' + key, slots.length - 1);
    };

    for (const c of st.cells) {
      const f = c.faces;
      if (c.element === 'stair') { place('stair_run', c, ROT[c.rise]); continue; }
      for (const dir of SIDES) {
        const s = f[dir], family = sockets.side[s];
        if (!family) { if (!NO_PIECE.side.includes(s)) unknown.add('side:' + s); continue; }
        if (family === 'door') {
          // the door's voxel position along the face (1..3 along +x or +z) becomes an offset in the piece's own frame
          const t = (c.doors && c.doors[dir]) || 2, o = dir === 'pz' || dir === 'nx' ? t - 2 : -(t - 2);
          place(o === 0 ? 'door_c' : o < 0 ? 'door_n' : 'door_p', c, ROT[dir]);
        } else if (fam[family].length > 1) slot(family, c, ROT[dir], `${c.i},${c.j},${c.k}|${dir}`);
        else place(fam[family][0], c, ROT[dir]);
      }
      // floor face
      const d = f.down;
      if (c.element === 'flat') slot('deck', c, 0, `${c.i},${c.j},${c.k}`);
      else if (d === 'stair') place('floor_hole_r' + c.holeRow, c, 0);
      else if (sockets.down[d]) slot(sockets.down[d], c, 0, `${c.i},${c.j},${c.k}`);
      else if (!NO_PIECE.down.includes(d)) unknown.add('down:' + d);
      // ceiling face
      const u = f.up;
      if (sockets.up[u]) slot(sockets.up[u], c, 0, `${c.i},${c.j},${c.k}`);
      else if (!NO_PIECE.up.includes(u)) unknown.add('up:' + u);
      // fixtures
      if (c.stairRow) place('stair_r' + c.stairRow, c, 0);
      if (c.kind === 'shaft') { const wd = SIDES.find(x => f[x] === 'wall') || 'pz'; place('shaft_ladder', c, ROT[wd]); }
      if (c.c === st.goal) place('goal_beacon', c, 0);
    }
    // monoliths: any grid cell whose middle is solid mass
    if (st.vox && pieces.mass_plain) {
      const b = st.bounds, ni = (b.x1 - b.x0) / P, nk = (b.z1 - b.z0) / P, nj = (b.y1 - b.y0) / S;
      for (let j = 0; j < nj; j++) for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) {
        const x0 = b.x0 + i * P, y0 = b.y0 + j * S, z0 = b.z0 + k * P;
        if (st.vox[st.idx(x0 + 2, y0 + 2, z0 + 2)] !== 12) continue; // 12 = mass
        slot('mass', { c: -1, origin: [x0, y0, z0] }, 0, `${i},${j},${k}`);
      }
    }

    // ---- WFC over the slots ----
    const neighbours = slots.map(() => []);
    const nb = (a, family, key, axis) => { const b = slotAt.get(family + '|' + key); if (b !== undefined) { neighbours[a].push([b, axis]); } };
    slots.forEach((s, a) => {
      const [pos, dir] = s.key.split('|'), [i, j, k] = pos.split(',').map(Number);
      if (dir) { // a side face: up/down the facade, and along it
        nb(a, s.family, `${i},${j + 1},${k}|${dir}`, 'v'); nb(a, s.family, `${i},${j - 1},${k}|${dir}`, 'v');
        if (dir === 'px' || dir === 'nx') { nb(a, s.family, `${i},${j},${k + 1}|${dir}`, 'h'); nb(a, s.family, `${i},${j},${k - 1}|${dir}`, 'h'); }
        else { nb(a, s.family, `${i + 1},${j},${k}|${dir}`, 'h'); nb(a, s.family, `${i - 1},${j},${k}|${dir}`, 'h'); }
      } else {
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) nb(a, s.family, `${i + di},${j},${k + dk}`, 'n');
        nb(a, s.family, `${i},${j + 1},${k}`, 'v'); nb(a, s.family, `${i},${j - 1},${k}`, 'v');
      }
    });
    const allowed = (family, axis, a, b) => {
      const r = rules[family] && rules[family][axis]; if (!r) return true;
      const va = fam[family][a], vb = fam[family][b];
      return (!r[va] || r[va].includes(vb)) && (!r[vb] || r[vb].includes(va));
    };
    const weight = (family, v) => pieces[fam[family][v]].weight || 1;
    const full = s => (1 << fam[s.family].length) - 1;
    let dom, attempts = 0, solved = false;
    const rnd = mulberry32((seed || 1) * 9301 + 49297);
    for (; attempts < 10 && !solved; attempts++) {
      dom = slots.map(full);
      let failed = false;
      const propagate = start => {
        const q = [start];
        while (q.length) {
          const a = q.pop(), fa = slots[a].family;
          for (const [b, axis] of neighbours[a]) {
            let nd = 0;
            for (let vb = 0; vb < fam[fa].length; vb++) if (dom[b] >> vb & 1) for (let va = 0; va < fam[fa].length; va++) if ((dom[a] >> va & 1) && allowed(fa, axis, va, vb)) { nd |= 1 << vb; break; }
            if (nd !== dom[b]) { dom[b] = nd; if (!nd) return false; q.push(b); }
          }
        }
        return true;
      };
      const bits = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
      for (;;) {
        // the undecided slot with the fewest options left (ties broken at random)
        let best = -1, bestE = Infinity;
        for (let a = 0; a < slots.length; a++) { const n = bits(dom[a]); if (n > 1) { const e = n + rnd() * 0.5; if (e < bestE) { bestE = e; best = a; } } }
        if (best < 0) break;
        const fa = slots[best].family, opts = [];
        let tot = 0; for (let v = 0; v < fam[fa].length; v++) if (dom[best] >> v & 1) { tot += weight(fa, v); opts.push(v); }
        let r = rnd() * tot, pickV = opts[0]; for (const v of opts) { r -= weight(fa, v); if (r <= 0) { pickV = v; break; } }
        dom[best] = 1 << pickV;
        if (!propagate(best)) { failed = true; break; }
      }
      solved = !failed;
    }
    if (!solved) dom = slots.map(() => 1); // fall back to the first (plain) variant everywhere, which the rules always allow
    slots.forEach((s, a) => { let v = 0; while (!(dom[a] >> v & 1)) v++; const pl = out[s.p]; pl.piece = fam[s.family][v]; pl.variant = v; });

    return { placements: out, slots: slots.length, wfc: { solved, attempts }, unknown: [...unknown], neighbours, slotList: slots };
  }

  // Rotate a point in a piece's frame (x, z) by the placement's rotation (counter-clockwise from above)
  function rotate(x, z, deg) { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [x * c + z * s, -x * s + z * c]; }

  const api = { dressStructure, rotatePiecePoint: rotate, TILE_ROT: ROT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
