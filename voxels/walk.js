// Walk check for voxel structures: can an explorer two voxels tall actually get everywhere and back?
//
// A position is a voxel where the feet go: feet and head are air, and there is something solid
// underneath (or the feet are in a climbable shaft). Moves: walk to a neighbouring position on the
// same level, step up one voxel, drop down any distance, and climb up or down inside a shaft.
// We search forwards from the start and backwards to it, so a cell only counts as explorable if you
// can reach it and also get back out (no one-way drops into pits).
(function (root) {
  const S = typeof module !== 'undefined' && module.exports ? require('./structures.js') : root;
  const { SVOX: V, SVOX_SOLID: SOLID } = S;

  function walkCheck(st) {
    const { W, H, D, vox } = st;
    const vi = (x, y, z) => x + z * W + y * W * D;
    const solid = (x, y, z) => x < 0 || z < 0 || x >= W || z >= D || y < 0 ? true : y >= H ? false : SOLID[vox[vi(x, y, z)]] === 1;
    const shaft = (x, y, z) => y >= 0 && y < H && x >= 0 && z >= 0 && x < W && z < D && vox[vi(x, y, z)] === V.SHAFT;
    const valid = (x, y, z) => y >= 0 && y < H - 1 && !solid(x, y, z) && !solid(x, y + 1, z) && (solid(x, y - 1, z) || shaft(x, y, z));
    // Only search the structure's box plus a margin of ground around it
    const b = st.bounds, m = 4;
    const X0 = Math.max(0, b.x0 - m), X1 = Math.min(W - 1, b.x1 + m), Z0 = Math.max(0, b.z0 - m), Z1 = Math.min(D - 1, b.z1 + m);
    const Y1 = Math.min(H - 2, Math.max(b.y1, st.groundY) + 2);
    const inBox = (x, y, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1 && y >= 0 && y <= Y1;
    const fwd = new Map(); // node -> [nodes]
    const nodes = [];
    for (let y = 0; y <= Y1; y++) for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) if (valid(x, y, z)) nodes.push(vi(x, y, z));
    const dec = i => { const y = Math.floor(i / (W * D)), r = i % (W * D); return [r % W, y, Math.floor(r / W)]; };
    const out = i => {
      const [x, y, z] = dec(i), res = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!inBox(nx, y, nz)) continue;
        if (valid(nx, y, nz)) { res.push(vi(nx, y, nz)); continue; }
        if (valid(nx, y + 1, nz)) { res.push(vi(nx, y + 1, nz)); continue; } // step up one
        if (valid(nx, y - 1, nz) && !solid(nx, y, nz)) { res.push(vi(nx, y - 1, nz)); continue; } // step down one
        if (!solid(nx, y, nz) && !solid(nx, y + 1, nz)) { // walk off an edge and fall
          let fy = y - 1;
          while (fy >= 0 && !valid(nx, fy, nz) && !solid(nx, fy, nz)) fy--;
          if (fy >= 0 && valid(nx, fy, nz)) res.push(vi(nx, fy, nz));
        }
      }
      if (shaft(x, y, z) || shaft(x, y - 1, z)) {
        if (valid(x, y + 1, z) && shaft(x, y + 1, z)) res.push(vi(x, y + 1, z));
        if (valid(x, y - 1, z)) res.push(vi(x, y - 1, z));
      }
      return res;
    };
    for (const n of nodes) fwd.set(n, out(n));
    const rev = new Map(); for (const n of nodes) rev.set(n, []);
    for (const [a, list] of fwd) for (const bb of list) if (rev.has(bb)) rev.get(bb).push(a);
    const start = vi(...st.start);
    const bfs = (adj, from) => {
      const seen = new Map([[from, -1]]), q = [from];
      for (let h = 0; h < q.length; h++) for (const n of adj.get(q[h]) || []) if (!seen.has(n)) { seen.set(n, q[h]); q.push(n); }
      return seen;
    };
    if (!fwd.has(start)) return { ok: false, reason: 'start is not a standing spot', cells: st.cells.length, explorable: 0, bad: st.cells.map(c => c.c), path: [] };
    const reach = bfs(fwd, start), back = bfs(rev, start);
    // A cell is explorable if some position inside its interior is reachable and returnable
    const cellOf = new Map();
    for (const c of st.cells) {
      const [x0, y0, z0] = c.origin;
      for (let y = y0 + 1; y < y0 + st.S + 1; y++) for (let z = z0 + 1; z < z0 + st.P; z++) for (let x = x0 + 1; x < x0 + st.P; x++) cellOf.set(vi(x, y, z), c.c);
    }
    const good = new Set();
    for (const n of reach.keys()) if (back.has(n) && cellOf.has(n)) good.add(cellOf.get(n));
    const bad = st.cells.filter(c => !good.has(c.c)).map(c => c.c);
    // shortest walk from the start to the goal cell
    let path = [], best = -1;
    for (const n of reach.keys()) if (cellOf.get(n) === st.goal) { best = n; break; }
    for (let n = best; n !== -1 && n !== undefined; n = reach.get(n)) path.push(dec(n));
    path.reverse();
    return { ok: bad.length === 0, cells: st.cells.length, explorable: good.size, bad, path, positions: nodes.length, oneWay: [...reach.keys()].filter(n => !back.has(n)).length };
  }

  const api = { walkCheck };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
