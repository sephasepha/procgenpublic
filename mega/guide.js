// The way out: a walkable route from where you stand to the nearest portal, for the guide line (F).
// Underground it is found in two steps: a search over the cells and their links up to a cell under a portal, then a
// search over the voxels you can stand on, kept to the cells along that route (and their neighbours, if the narrow
// corridor is not enough); it can run spread over frames. On the plain it is simply the
// ground between you and the nearest doorway. A route is a list of feet positions [x, y, z].
(function (root) {
  const fdiv = (a, b) => Math.floor(a / b);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

  // where a route ends: underground, on the landing under the crust's doorway; on the plain, in the doorway
  function mouth(world, a, j, c) { const f = world.frameIn(a, j, c); return [(f.x0 + f.x1) / 2, f.y0, f.zP - 1]; }
  function front(world, i, k) { const f = world.frameIn(i, world.PJ, k); return [(f.x0 + f.x1) / 2, f.y0, f.zP]; }

  function onPlain(world, x, z, y) {
    const { CW } = world, ci = fdiv(Math.floor(x), CW), ck = fdiv(Math.floor(z), CW);
    let best = null;
    for (let r = 0; r <= 2 * world.PS && !best; r++) for (let i = ci - r; i <= ci + r; i++) for (let k = ck - r; k <= ck + r; k++) {
      if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== r || !world.portalAt(i, k)) continue;
      const m = front(world, i, k), d = Math.hypot(m[0] - x, m[2] - z); if (!best || d < best.d) best = { m, d };
    }
    if (!best) return null;
    // over the ground, then up to the doorway: doorways work from both sides, so come at it from the side you are on
    // and go through to the other
    const [mx, , mz] = best.m, side = z >= mz ? 1 : -1, fr = [mx, mz + 3 * side], pts = [];
    const seg = (ax, az, bx, bz) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5)); for (let s = 0; s < n; s++) { const t = s / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, g = world.groundAt(px, pz); pts.push([px, g === null ? y : g, pz]); } };
    seg(x, z, fr[0], fr[1]); seg(fr[0], fr[1], mx, mz); pts.push([mx, world.SURF + 2, mz - 0.3 * side]);
    return pts;
  }

  // a binary heap of [priority, value]
  function Heap() {
    const h = [];
    return { get size() { return h.length; },
      push(f, v) { h.push([f, v]); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } },
      pop() { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top[1]; } };
  }
  // a cell as one number, and back (each coordinate within 32768 of zero: 48 bits, exact in a double). Voxels are keyed
  // the same way but relative to where the search starts, since a doorway can put you thousands of metres out.
  const B = 65536, O = 32768;
  const CK = (i, j, k) => ((i + O) * B + (j + O)) * B + (k + O);
  const UK = key => { const kz = key % B, rest = (key - kz) / B, kj = rest % B, ki = (rest - kj) / B; return [ki - O, kj - O, kz - O]; };

  // The search, as a generator so the game can run it a few milliseconds a frame (it yields every so often).
  //  1. cells: breadth first over the cells and their links to the nearest twin doorway (the far ends of the plain's
  //     doorways, scattered through the depths);
  //  2. voxels: A* over standing places inside the route's cells (widened by a cell all round if that is not enough).
  function* underground(world, x, y, z, maxCells) {
    const { CW, CH, GJ } = world, start = [fdiv(Math.floor(x), CW), fdiv(Math.floor(y + 0.01), CH), fdiv(Math.floor(z), CW)];
    // the twins are kilometres apart and the grid says where: aim at the nearest, by A* over the cells weighted towards
    // it (a route somewhat longer than the shortest, found without searching kilometres of structure evenly)
    let aim = null; for (const t of world.twinsNear(start[0], start[2])) { const d = Math.abs(t[0] - start[0]) + Math.abs(t[2] - start[2]) + Math.abs(t[1] - start[1]); if (!aim || d < aim.d) aim = { t, d }; }
    const T = aim.t, W = 1.6, hc = (i, j, k) => W * (Math.abs(i - T[0]) + Math.abs(j - T[1]) + Math.abs(k - T[2]));
    const g = new Map(), prev = new Map(), open = Heap(), sk = CK(...start);
    g.set(sk, 0); prev.set(sk, null); open.push(hc(...start), start);
    let goal = null, n = 0;
    while (open.size && n < maxCells) {
      const c = open.pop(), ck = CK(...c), gc = g.get(ck); n++;
      if (c[0] === T[0] && c[1] === T[1] && c[2] === T[2]) { goal = c; break; }
      for (let d = 0; d < 6; d++) {
        const ni = c[0] + DIRS[d][0], nj = c[1] + DIRS[d][1], nk = c[2] + DIRS[d][2]; if (nj >= GJ) continue;
        const key = CK(ni, nj, nk); if (g.has(key) && g.get(key) <= gc + 1) continue;
        if (!world.link(c[0], c[1], c[2], d)) continue;
        g.set(key, gc + 1); prev.set(key, ck); open.push(gc + 1 + hc(ni, nj, nk), [ni, nj, nk]);
      }
      if ((n & 63) === 0) yield;
    }
    if (!goal) return null;
    const route = []; for (let k = CK(...goal); k !== null && k !== undefined; k = prev.get(k)) route.push(k);
    const target = mouth(world, goal[0], goal[1], goal[2]);
    const solid = (a, b, c) => world.voxel(a, b, c) !== 0;
    const stand = (a, b, c) => solid(a, b - 1, c) && !solid(a, b, c) && !solid(a, b + 1, c);
    function* voxels(cells) {
      const allowed = new Set(cells);
      const inside = (a, b, c) => allowed.has(CK(fdiv(a, CW), fdiv(b, CH), fdiv(c, CW)));
      let s = [Math.floor(x), Math.floor(y + 0.01), Math.floor(z)];
      if (!stand(...s)) { // standing on an edge: the nearest standing place around the feet
        let f = null; for (let dy = 0; dy >= -2 && !f; dy--) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!f && stand(s[0] + dx, s[1] + dy, s[2] + dz)) f = [s[0] + dx, s[1] + dy, s[2] + dz];
        if (!f) return null; s = f;
      }
      // the twin works from both sides: end in the doorway on whichever side is reached first (the landing the stair
      // arrives at, in front, or the step behind)
      const tx = Math.floor(target[0]), ty = target[1], tz = Math.floor(target[2]), tzB = tz + 1;
      const hfn = (a, b, c) => Math.abs(a - tx) + Math.abs(b - ty) * 2 + Math.min(Math.abs(c - tz), Math.abs(c - tzB));
      const [sx, sy, sz] = s, VK = (a, b, c) => CK(a - sx, b - sy, c - sz);
      const gv = new Map(), par = new Map(), heap = Heap(), s0 = VK(...s); gv.set(s0, 0); par.set(s0, null); heap.push(hfn(...s), s);
      let end = null, m = 0;
      while (heap.size && m < 400000) {
        const cur = heap.pop(), ck = VK(...cur), gc = gv.get(ck); m++;
        if (cur[1] === ty && Math.abs(cur[0] - tx) <= 1 && (cur[2] === tz || cur[2] === tzB)) { end = ck; break; }
        const [a, b, c] = cur;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
          const na = a + dx, nb = b + dy, nc = c + dz;
          if (!inside(na, nb, nc) || !stand(na, nb, nc)) continue;
          if (dy === 1 && solid(a, b + 2, c)) continue; if (dy === -1 && solid(na, b + 1, nc)) continue;
          const nk = VK(na, nb, nc), ng = gc + 1;
          if (gv.has(nk) && gv.get(nk) <= ng) continue;
          gv.set(nk, ng); par.set(nk, ck); heap.push(ng + hfn(na, nb, nc), [na, nb, nc]);
        }
        if ((m & 255) === 0) yield;
      }
      if (end === null) return null;
      const pts = []; for (let k = end; k !== null && k !== undefined; k = par.get(k)) { const v = UK(k); pts.push([v[0] + sx + 0.5, v[1] + sy, v[2] + sz + 0.5]); }
      pts.reverse(); pts.push([target[0], target[1], tz + 1]); // up to the doorway's plane, from either side
      return pts;
    }
    let pts = yield* voxels(route);
    if (!pts) { // widen the corridor by a cell all round
      const wide = new Set();
      for (const k of route) { const c = UK(k);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) if (c[1] + b < GJ) wide.add(CK(c[0] + a, c[1] + b, c[2] + d)); }
      pts = yield* voxels([...wide]);
    }
    return pts;
  }

  // A search job: step(ms) works for about that long and returns undefined while it is still working, then the route
  // (a list of feet positions) or null. The game steps it a little each frame, so pressing F never stalls a frame.
  function routeJob(world, x, y, z, opts) {
    if (y >= world.SURF + 0.5 && world.groundAt(x, z) !== null) { const r = onPlain(world, x, z, y); return { step: () => r, done: true, result: r }; }
    const it = underground(world, x, y, z, (opts && opts.maxCells) || 400000), job = { done: false, result: undefined, step(ms) {
      if (job.done) return job.result;
      const t0 = Date.now();
      for (;;) { const r = it.next(); if (r.done) { job.done = true; job.result = r.value || null; return job.result; } if (Date.now() - t0 >= ms) return undefined; }
    } };
    return job;
  }
  // the whole search at once (for the tests)
  function findRoute(world, x, y, z, opts) { const j = routeJob(world, x, y, z, opts); let r; do { r = j.step(1e9); } while (r === undefined); return r; }

  const api = { findRoute, routeJob, mouth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaGuide = api;
})(typeof window !== 'undefined' ? window : globalThis);
