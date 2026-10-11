// The way out: a walkable route from where you stand to the nearest portal, for the guide line (F).
// Underground it is found in two steps: a breadth-first search over the cells and their links (cheap, and it finds the
// nearest portal by the structure's own connections), then a search over the voxels you can stand on, kept to the
// cells along that route (and their neighbours, if the narrow corridor is not enough). On the plain it is simply the
// ground between you and the nearest doorway. A route is a list of feet positions [x, y, z].
(function (root) {
  const fdiv = (a, b) => Math.floor(a / b);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

  // the doorway's mouth: the middle of the landing a portal's stair climbs out on to
  function mouth(world, i, k) { const [x0, x1] = world.LANE(1 + (((world.GJ - 1) % 2) + 2) % 2); return [i * world.CW + (x0 + x1 + 1) / 2, world.SURF + 2, k * world.CW + world.PZ + 10]; }

  function onPlain(world, x, z, y) {
    const { CW } = world, ci = fdiv(Math.floor(x), CW), ck = fdiv(Math.floor(z), CW);
    let best = null;
    for (let r = 0; r <= 14 && !best; r++) for (let i = ci - r; i <= ci + r; i++) for (let k = ck - r; k <= ck + r; k++) {
      if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== r || !world.portalAt(i, k)) continue;
      const m = mouth(world, i, k), d = Math.hypot(m[0] - x, m[2] - z); if (!best || d < best.d) best = { m, d };
    }
    if (!best) return null;
    // over the ground, then up to the doorway: approach the mouth from the open side so the line goes through it
    const [mx, , mz] = best.m, front = [mx, mz + 3], pts = [];
    const seg = (ax, az, bx, bz) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5)); for (let s = 0; s < n; s++) { const t = s / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, g = world.groundAt(px, pz); pts.push([px, g === null ? y : g, pz]); } };
    seg(x, z, front[0], front[1]); seg(front[0], front[1], mx, mz); pts.push([mx, world.SURF + 2, mz]);
    return pts;
  }

  function underground(world, x, y, z, maxCells) {
    const { CW, CH, GJ } = world, start = [fdiv(Math.floor(x), CW), fdiv(Math.floor(y + 0.01), CH), fdiv(Math.floor(z), CW)];
    // 1. cells: breadth first to the nearest cell under a portal
    const key = c => c[0] + ',' + c[1] + ',' + c[2], prev = new Map([[key(start), null]]), q = [start];
    let goal = null;
    for (let h = 0; h < q.length && h < maxCells; h++) {
      const c = q[h];
      if (c[1] === GJ - 1 && world.portalAt(c[0], c[2])) { goal = c; break; }
      for (let d = 0; d < 6; d++) {
        const n = [c[0] + DIRS[d][0], c[1] + DIRS[d][1], c[2] + DIRS[d][2]];
        if (n[1] >= GJ || prev.has(key(n)) || !world.link(c[0], c[1], c[2], d)) continue;
        prev.set(key(n), c); q.push(n);
      }
    }
    if (!goal) return null;
    const route = []; for (let c = goal; c; c = prev.get(key(c))) route.push(c);
    const target = mouth(world, goal[0], goal[2]);
    // 2. voxels: standing places inside the route's cells (the plain's cell over the portal too)
    const tryCells = cells => {
      const allowed = new Set(cells.map(key)); allowed.add(key([goal[0], GJ, goal[2]]));
      const solid = (a, b, c) => world.voxel(a, b, c) !== 0;
      const stand = (a, b, c) => solid(a, b - 1, c) && !solid(a, b, c) && !solid(a, b + 1, c);
      const inside = (a, b, c) => allowed.has(fdiv(a, CW) + ',' + fdiv(b, CH) + ',' + fdiv(c, CW));
      let s = [Math.floor(x), Math.floor(y + 0.01), Math.floor(z)];
      if (!stand(...s)) { // standing on an edge: the nearest standing place around the feet
        let f = null; for (let dy = 0; dy >= -2 && !f; dy--) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!f && stand(s[0] + dx, s[1] + dy, s[2] + dz)) f = [s[0] + dx, s[1] + dy, s[2] + dz];
        if (!f) return null; s = f;
      }
      const tx = Math.floor(target[0]), ty = target[1], tz = Math.floor(target[2]);
      const hfn = (a, b, c) => Math.abs(a - tx) + Math.abs(b - ty) * 2 + Math.abs(c - tz);
      // A* with a binary heap
      const heap = [], push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      const g = new Map(), par = new Map(), sk = s.join(); g.set(sk, 0); push(hfn(...s), s);
      let end = null, n = 0;
      while (heap.length && n++ < 400000) {
        const [, cur] = pop(), ck = cur.join(), gc = g.get(ck);
        if (cur[1] === ty && Math.abs(cur[0] - tx) <= 1 && cur[2] === tz) { end = cur; break; }
        const [a, b, c] = cur;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
          const na = a + dx, nb = b + dy, nc = c + dz;
          if (!inside(na, nb, nc) || !stand(na, nb, nc)) continue;
          if (dy === 1 && solid(a, b + 2, c)) continue; if (dy === -1 && solid(na, b + 1, nc)) continue;
          const nk = na + ',' + nb + ',' + nc, ng = gc + 1;
          if (g.has(nk) && g.get(nk) <= ng) continue;
          g.set(nk, ng); par.set(nk, ck); push(ng + hfn(na, nb, nc), [na, nb, nc]);
        }
      }
      if (!end) return null;
      const pts = []; for (let k = end.join(); k; k = par.get(k)) { const v = k.split(',').map(Number); pts.push([v[0] + 0.5, v[1], v[2] + 0.5]); }
      return pts.reverse();
    };
    let pts = tryCells(route);
    if (!pts) { // widen the corridor by a cell all round
      const wide = new Map(); for (const c of route) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) { const n = [c[0] + a, c[1] + b, c[2] + d]; if (n[1] < GJ) wide.set(key(n), n); }
      pts = tryCells([...wide.values()]);
    }
    return pts;
  }

  // a route to the nearest portal from feet position (x, y, z), or null
  function findRoute(world, x, y, z, opts) {
    if (y >= world.SURF + 0.5 && world.groundAt(x, z) !== null) return onPlain(world, x, z, y);
    return underground(world, x, y, z, (opts && opts.maxCells) || 50000);
  }

  const api = { findRoute, mouth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaGuide = api;
})(typeof window !== 'undefined' ? window : globalThis);
