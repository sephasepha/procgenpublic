// Explorable voxel structures on a shared cell grid: the blocking-in layer that WFC will later skin.
//
// Every structure is a set of cells on a 3D grid. A cell is P=4 voxels across (a 1-voxel wall line
// plus a 3×3 interior) and S=4 voxels tall (a 1-voxel floor slab plus 3 voxels of headroom).
// Cells are grouped into regions: halls (single cells), rooms (rectangles of cells on one storey,
// fully open inside) and shafts (a column of cells through every storey, climbable).
// A spanning tree over the regions (Kruskal) guarantees every region is reachable; braiding then
// adds links from dead-end regions, so dead ends are rare or absent. Links between storeys are
// stairs (a 3-step flight inside the lower cell, with a hole in the slab above) or shafts.
//
// What WFC gets: `vox` (one label per voxel, below), and `cells`, one entry per cell with its region,
// kind and the socket on each of its six faces (wall / open / arch / door / entrance / stair / shaft / floor / roof).
(function (root) {
  // Solid labels first; the rest are air with a meaning (markers for WFC, ignored by collision).
  const V = { EMPTY: 0, GROUND: 1, WALL: 2, FLOOR: 3, DECK: 4, RAIL: 5, ROOF: 6, STAIR: 7, SHAFT: 8, DOOR: 9, ENTRANCE: 10, GOAL: 11, MASS: 12 };
  const NAMES = ['empty', 'ground', 'wall', 'floor', 'deck', 'rail', 'roof', 'stair', 'shaft', 'door', 'entrance', 'goal', 'mass'];
  const SOLID = new Uint8Array(16); [V.GROUND, V.WALL, V.FLOOR, V.DECK, V.RAIL, V.ROOF, V.STAIR, V.MASS].forEach(t => SOLID[t] = 1);
  const P = 4, S = 4;
  const SHAPES = {
    pyramid: { name: 'Pyramid labyrinth', size: 12, storeys: 9, rooms: 1, shafts: 0, braid: 100 },
    column: { name: 'Sunken column', size: 5, storeys: 10, rooms: 1, shafts: 0, braid: 100 },
    tower: { name: 'Tower', size: 6, storeys: 8, rooms: 3, shafts: 1, braid: 100 },
    mega: { name: 'Megastructure', size: 13, storeys: 14, rooms: 1, shafts: 0, braid: 100 }
  };

  // ---- the megastructure: an abstract volume, not a building ----
  // Habitation clusters (boxes of cells) hang at any height in a mostly empty volume. Connectors found by A*
  // join them across the void: flat bridge cells, and stair cells that climb or drop one storey per cell in
  // straight runs, so long stairways zig-zag up through the gulfs. Monoliths (solid mass) stand in the voids
  // and prop up some clusters. There is no floor plan: the only promise is that it can all be walked.
  const D4 = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }, DL = ['px', 'nx', 'pz', 'nz'];
  const OPP4 = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' };
  function layoutMega(g, o, rng) {
    const { ni, nj, nk, NC, cid, cpos, inGrid } = g;
    const occ = new Uint8Array(NC); // 1 cluster, 2 connector, 3 headroom kept clear over a stair
    const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const clusters = [];
    const ov = (a0, aw, b0, bw) => a0 - 1 < b0 + bw && b0 - 1 < a0 + aw; // overlap with a one-cell gap
    const fits = (i0, j0, k0, w, h, d) => i0 >= 0 && k0 >= 0 && j0 >= 0 && i0 + w <= ni && k0 + d <= nk && j0 + h <= nj &&
      !clusters.some(c => ov(i0, w, c.i0, c.w) && ov(k0, d, c.k0, c.d) && ov(j0, h, c.j0, c.h));
    const add = (i0, j0, k0, w, h, d, tag) => {
      const c = { id: clusters.length, i0, j0, k0, w, h, d, tag, cells: [] };
      for (let j = j0; j < j0 + h; j++) for (let k = k0; k < k0 + d; k++) for (let i = i0; i < i0 + w; i++) { const x = cid(i, j, k); occ[x] = 1; c.cells.push(x); }
      clusters.push(c); return c;
    };
    // the ground cluster, with the entrance on its front face
    const ew = Math.min(ni, ri(2, 4)), ed = Math.min(nk, ri(2, 3)), eh = Math.min(nj, ri(1, 2));
    const ent = add(ri(0, ni - ew), 0, 0, ew, eh, ed, 'entrance');
    const E = { i: ent.i0 + Math.floor(ew / 2), j: 0, k: 0, dir: 'nz' };
    // a summit cluster near the top, where the goal will be
    for (let t = 0; t < 60; t++) { const w = Math.min(ni, ri(2, 3)), d = Math.min(nk, ri(2, 3)), h = Math.min(nj, ri(1, 2)); const i0 = ri(0, ni - w), k0 = ri(0, nk - d), j0 = nj - h; if (fits(i0, j0, k0, w, h, d)) { add(i0, j0, k0, w, h, d, 'summit'); break; } }
    // the rest: blocks, thin towers and wide slabs, anywhere in the volume
    const target = Math.max(2, Math.round(ni * nk * nj / 190) + 2);
    for (let t = 0; t < 400 && clusters.length < target; t++) {
      const kind = rng(), tall = kind < 0.25, slab = kind > 0.8;
      const w = tall ? 2 : slab ? ri(3, 5) : ri(2, 4), d = tall ? 2 : slab ? ri(3, 5) : ri(2, 3), h = tall ? ri(3, 5) : slab ? 1 : ri(1, 2);
      const i0 = ri(0, ni - w), k0 = ri(0, nk - d), j0 = ri(0, nj - h);
      if (w <= ni && d <= nk && h <= nj && fits(i0, j0, k0, w, h, d)) add(i0, j0, k0, w, h, d, tall ? 'tower' : slab ? 'slab' : 'block');
    }

    // ---- connectors by A* ----
    const free = c => c >= 0 && occ[c] === 0;
    const stepC = (c, dir) => { const [i, j, k] = cpos(c), a = i + D4[dir][0], e = k + D4[dir][1]; return inGrid(a, j, e) ? cid(a, j, e) : -1; };
    const upC = c => { const [i, j, k] = cpos(c); return j + 1 < nj ? cid(i, j + 1, k) : -1; };
    const downC = c => { const [i, j, k] = cpos(c); return j > 0 ? cid(i, j - 1, k) : -1; };
    const lower = (a, b) => { const [ai, aj, ak] = cpos(a), [bi, bj, bk] = cpos(b), hd = Math.abs(ai - bi) + Math.abs(ak - bk), dj = Math.abs(aj - bj); return 1.4 * dj + Math.max(0, hd - dj); };
    function route(Oa, dA, Ob) {
      // state = (cell where the walker stands, last move direction, mode: 0 free to turn / 1 leaving a stair, must go straight)
      const key = (p, di, m) => (p * 4 + di) * 2 + m;
      const gC = new Map(), prev = new Map(), heap = [];
      const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; [heap[pa], heap[i]] = [heap[i], heap[pa]]; i = pa; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      const k0 = key(Oa, DL.indexOf(dA), 0);
      gC.set(k0, 0); prev.set(k0, null); push(lower(Oa, Ob), k0);
      let expanded = 0;
      while (heap.length && expanded++ < 40000) {
        const [, kk] = pop(); const m = kk & 1, di = (kk >> 1) & 3, p = kk >> 3, gk = gC.get(kk);
        const dirs = m ? [DL[di]] : DL.filter(d => d !== OPP4[DL[di]]);
        for (const dir of dirs) {
          const q = stepC(p, dir); if (q < 0) continue;
          const turn = dir !== DL[di] ? 0.7 : 0, nd = DL.indexOf(dir);
          const tries = [];
          if (q === Ob || free(q)) tries.push([q, 0, 1 + turn, { t: 'flat', c: q, dir }]);
          if (q !== Ob && free(q) && free(upC(q))) tries.push([upC(q), 1, 1.4 + turn, { t: 'stair', c: q, rise: dir, dir }]);
          const qb = downC(q); if (q !== Ob && qb >= 0 && free(qb) && free(q)) tries.push([qb, 1, 1.4 + turn, { t: 'stair', c: qb, rise: OPP4[dir], dir }]);
          for (const [np, nm, cost, el] of tries) {
            const nk2 = key(np, nd, nm), ng = gk + cost;
            if (gC.has(nk2) && gC.get(nk2) <= ng) continue;
            gC.set(nk2, ng); prev.set(nk2, { from: kk, el });
            if (el.t === 'flat' && el.c === Ob) {
              const els = []; for (let x = nk2; prev.get(x); x = prev.get(x).from) els.push(prev.get(x).el);
              els.push({ t: 'flat', c: Oa, dir: dA }); els.reverse();
              return els;
            }
            push(ng + lower(np, Ob), nk2);
          }
        }
      }
      return null;
    }
    const portsOf = C => {
      const out = [];
      for (const T of C.cells) { const [i, j, k] = cpos(T); for (const dir of DL) {
        const O = stepC(T, dir); if (O < 0 || !free(O)) continue;
        if (C.cells.includes(O)) continue;
        if (T === cid(E.i, E.j, E.k) && dir === E.dir) continue;
        out.push({ T, dir, O, j }); } }
      return out;
    };
    const connectors = [];
    function connect(A, B) {
      const pa = portsOf(A), pb = portsOf(B), combos = [];
      for (const a of pa) for (const b of pb) if (a.O !== b.O) combos.push([lower(a.O, b.O) + rng() * 0.8, a, b]);
      combos.sort((x, y) => x[0] - y[0]);
      for (const [, a, b] of combos.slice(0, 4)) {
        const els = route(a.O, a.dir, b.O);
        if (!els) continue;
        // a path must not use a cell twice (as a walkway or as a stair's headroom)
        const used = new Set(); let ok = true;
        for (const e of els) { const cs = e.t === 'stair' ? [e.c, upC(e.c)] : [e.c]; for (const c of cs) { if (used.has(c) || !free(c)) ok = false; used.add(c); } }
        if (!ok) continue;
        for (const e of els) { occ[e.c] = 2; if (e.t === 'stair') occ[upC(e.c)] = 3; }
        connectors.push({ els, A: { T: a.T, dir: a.dir }, B: { T: b.T, dir: b.dir }, a: A.id, b: B.id });
        return true;
      }
      return false;
    }
    // spanning tree over the clusters (nearest first), dropping any cluster that cannot be reached
    const ctr = c => [c.i0 + c.w / 2, c.j0 + c.h / 2, c.k0 + c.d / 2];
    const dist = (a, b) => { const p = ctr(a), q = ctr(b); return Math.abs(p[0] - q[0]) + Math.abs(p[2] - q[2]) + 1.4 * Math.abs(p[1] - q[1]); };
    const inTree = [clusters[0]], rest = clusters.slice(1);
    while (rest.length) {
      const pairs = [];
      for (const r of rest) for (const t of inTree) pairs.push([dist(r, t), r, t]);
      pairs.sort((x, y) => x[0] - y[0]);
      let joined = null;
      for (const [, r, t] of pairs.slice(0, 6)) if (connect(t, r)) { joined = r; break; }
      if (!joined) {
        // could not reach the nearest candidates: give up on the closest unreached cluster
        const r = pairs[0][1]; for (const c of r.cells) occ[c] = 0; r.dropped = true; rest.splice(rest.indexOf(r), 1); continue;
      }
      inTree.push(joined); rest.splice(rest.indexOf(joined), 1);
    }
    // extra connectors make loops, so few clusters are dead ends
    const kept = clusters.filter(c => !c.dropped);
    const extra = Math.round(kept.length * 0.5 * (o.braid / 100));
    for (let t = 0, made = 0; t < extra * 4 && made < extra; t++) {
      const a = kept[Math.floor(rng() * kept.length)], b = kept[Math.floor(rng() * kept.length)];
      if (a === b || connectors.some(c => (c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id))) continue;
      if (connect(a, b)) made++;
    }
    return { occ, clusters: kept, connectors, E };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- shape definitions: a cell mask, the entrance, how the goal is chosen, where the ground is ----
  function shapeSpec(shape, o) {
    const n = o.size, J = o.storeys;
    if (shape === 'pyramid') {
      // Triangular footprint shrinking towards its centroid with height: a stepped tetrahedron.
      const A = [0, 0], B = [n, 0], C = [n / 2, n * 0.866], G = [n / 2, n * 0.2887];
      const inTri = (x, z) => {
        const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        const pt = [x, z], d1 = s(A, B, pt), d2 = s(B, C, pt), d3 = s(C, A, pt);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      };
      const gi = Math.floor(G[0]), gk = Math.floor(G[1]);
      return {
        ni: n, nj: J, nk: n, groundY: 0, goal: 'top',
        mask: (i, j, k) => {
          if (i === gi && k === gk) return true; // the spine: the apex column always exists
          const sc = 1 - j / J; if (sc <= 0) return false;
          return inTri(G[0] + (i + 0.5 - G[0]) / sc, G[1] + (k + 0.5 - G[1]) / sc);
        },
        entrance: { i: Math.floor(n / 2), j: 0, k: 0, dir: 'nz' }
      };
    }
    if (shape === 'column') {
      // A square shaft of labyrinth dug down from the surface; you enter by a stair from the top.
      return { ni: n, nj: J, nk: n, groundY: J * S, goal: 'bottom', mask: () => true, entrance: { i: Math.floor(n / 2), j: J - 1, k: Math.floor(n / 2), dir: 'up' } };
    }
    if (shape === 'mega') return { ni: n, nj: J, nk: n, groundY: 0, goal: 'top', abstract: true, mask: () => false, entrance: { i: 0, j: 0, k: 0, dir: 'nz' } };
    // tower
    return { ni: n, nj: J, nk: n, groundY: 0, goal: 'top', mask: () => true, entrance: { i: Math.floor(n / 2), j: 0, k: 0, dir: 'nz' } };
  }

  function generateStructure(shape, opts) {
    const def = SHAPES[shape];
    const o = Object.assign({ seed: 1, W: 64, H: 64, D: 64 }, def, opts || {});
    const sp = shapeSpec(shape, o);
    const { ni, nj, nk } = sp;
    const rng = mulberry32(o.seed * 2246822519 + 13);
    const pick = a => a[Math.floor(rng() * a.length)];
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const NC = ni * nj * nk;
    const cid = (i, j, k) => i + k * ni + j * ni * nk;
    const cpos = c => [c % ni, Math.floor(c / (ni * nk)), Math.floor((c % (ni * nk)) / ni)];
    const inGrid = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < ni && j < nj && k < nk;
    const mask = new Uint8Array(NC);
    for (let j = 0; j < nj; j++) for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) if (sp.mask(i, j, k)) mask[cid(i, j, k)] = 1;
    // the megastructure lays out its own cells
    const floatC = new Uint8Array(NC), elem = new Map();
    let ML = null;
    if (sp.abstract) {
      ML = layoutMega({ ni, nj, nk, NC, cid, cpos, inGrid }, o, rng);
      for (const C of ML.clusters) for (const c of C.cells) mask[c] = 1;
      for (const [n, K] of ML.connectors.entries()) for (const e of K.els) { mask[e.c] = 1; floatC[e.c] = 1; elem.set(e.c, Object.assign({ conn: n }, e)); }
      sp.entrance = ML.E;
    }
    const E = sp.entrance, entC = cid(E.i, E.j, E.k);
    mask[entC] = 1;
    const has = (i, j, k) => inGrid(i, j, k) && mask[cid(i, j, k)] === 1;
    const DIRS = { px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1], up: [0, 1, 0], down: [0, -1, 0] };
    const OPP = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz', up: 'down', down: 'up' };
    // A cell above must sit on a cell below (no overhangs), so drop any that float, then anything not connected to the entrance.
    // (The megastructure floats by design and is connected by construction.)
    if (!sp.abstract) for (let j = 1; j < nj; j++) for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) if (mask[cid(i, j, k)] && !mask[cid(i, j - 1, k)]) mask[cid(i, j, k)] = 0;
    if (!sp.abstract) { const seen = new Uint8Array(NC), q = [entC]; seen[entC] = 1;
      while (q.length) { const c = q.pop(), [i, j, k] = cpos(c); for (const d of Object.values(DIRS)) { const a = i + d[0], b = j + d[1], e = k + d[2]; if (has(a, b, e) && !seen[cid(a, b, e)]) { seen[cid(a, b, e)] = 1; q.push(cid(a, b, e)); } } }
      for (let c = 0; c < NC; c++) if (!seen[c]) mask[c] = 0; }

    // ---- regions: shafts, rooms, halls ----
    const region = new Int32Array(NC).fill(-1), regions = [];
    const newRegion = kind => { regions.push({ id: regions.length, kind, cells: [] }); return regions.length - 1; };
    const claim = (c, r) => { region[c] = r; regions[r].cells.push(c); };
    if (ML) for (const K of ML.connectors) { K.region = newRegion(K.els.some(e => e.t === 'stair') ? 'stairway' : 'bridge'); for (const e of K.els) claim(e.c, K.region); }
    if (o.shafts > 0) {
      const cols = [];
      for (let k = 1; k < nk - 1; k++) for (let i = 1; i < ni - 1; i++) {
        let full = true; for (let j = 0; j < nj; j++) if (!mask[cid(i, j, k)]) full = false;
        if (full && !(i === E.i && k === E.k)) cols.push([i, k]);
      }
      shuffle(cols);
      const taken = [];
      for (const [i, k] of cols) {
        if (taken.length >= o.shafts) break;
        if (taken.some(([a, b]) => Math.abs(a - i) <= 1 && Math.abs(b - k) <= 1)) continue; // keep shafts apart
        taken.push([i, k]);
        const r = newRegion('shaft');
        for (let j = 0; j < nj; j++) claim(cid(i, j, k), r);
      }
    }
    if (o.rooms > 0) {
      const sizes = [[2, 2], [2, 3], [3, 2], [2, 1], [1, 2], [3, 3]];
      for (let j = 0; j < nj; j++) {
        let made = 0;
        for (let t = 0; t < 40 && made < o.rooms; t++) {
          const [w, d] = pick(sizes), i0 = Math.floor(rng() * (ni - w + 1)), k0 = Math.floor(rng() * (nk - d + 1));
          let ok = true;
          for (let k = k0; k < k0 + d && ok; k++) for (let i = i0; i < i0 + w && ok; i++) {
            const c = cid(i, j, k);
            if (!mask[c] || region[c] >= 0 || c === entC) ok = false;
          }
          if (!ok) continue;
          const r = newRegion('room');
          for (let k = k0; k < k0 + d; k++) for (let i = i0; i < i0 + w; i++) claim(cid(i, j, k), r);
          made++;
        }
      }
    }
    for (let c = 0; c < NC; c++) if (mask[c] && region[c] < 0) claim(c, newRegion('hall'));

    // ---- links ----
    // A link joins two cells: kind 'open' (inside a room), 'shaft' (inside a shaft), 'arch' (hall to hall),
    // 'door' (anything touching a room or shaft) or 'stair' (between storeys; the lower cell holds the flight).
    const links = [], linkAt = new Map(); // key "c:dir" -> link
    const addLink = (a, dir, kind) => {
      const [i, j, k] = cpos(a), d = DIRS[dir], b = cid(i + d[0], j + d[1], k + d[2]);
      const L = { a, b, dir, kind }; links.push(L);
      linkAt.set(a + ':' + dir, L); linkAt.set(b + ':' + OPP[dir], L);
      return L;
    };
    // links that are not between grid neighbours (stair runs climb diagonally), keyed by the direction of travel
    const addLinkRaw = (a, b, dir, kind) => { const L = { a, b, dir, kind }; links.push(L); linkAt.set(a + ':' + dir, L); linkAt.set(b + ':' + OPP[dir], L); return L; };
    const isShaft = c => regions[region[c]].kind === 'shaft';
    const linkKind = (a, b, dir) => {
      if (dir === 'up') return 'stair';
      const ka = regions[region[a]].kind, kb = regions[region[b]].kind;
      return ka === 'hall' && kb === 'hall' ? 'arch' : 'door';
    };
    // union-find over regions
    const par = regions.map((_, i) => i);
    const find = x => par[x] === x ? x : (par[x] = find(par[x]));
    const cand = []; // links between different regions that are allowed
    for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) {
      const [i, j, k] = cpos(c);
      for (const dir of ['px', 'pz', 'up']) {
        const d = DIRS[dir], a = i + d[0], b = j + d[1], e = k + d[2];
        if (!has(a, b, e)) continue;
        const n = cid(a, b, e);
        if (floatC[n]) continue; // connectors join only where they were routed
        if (region[c] === region[n]) { addLink(c, dir, isShaft(c) ? 'shaft' : 'open'); continue; }
        if (dir === 'up' && (isShaft(c) || isShaft(n))) continue; // shafts are entered sideways only
        cand.push({ a: c, b: n, dir, key: rng() + (dir === 'up' ? 0.55 : 0) });
      }
    }
    const regionLinked = new Set();
    const rkey = (x, y) => x < y ? x + ',' + y : y + ',' + x;
    const join = e => { addLink(e.a, e.dir, linkKind(e.a, e.b, e.dir)); regionLinked.add(rkey(region[e.a], region[e.b])); };
    // the megastructure's connectors are already decided: link them in and count them in the spanning tree
    if (ML) for (const K of ML.connectors) {
      const els = K.els;
      addLinkRaw(K.A.T, els[0].c, K.A.dir, 'arch');
      for (let n = 1; n < els.length; n++) addLinkRaw(els[n - 1].c, els[n].c, els[n].dir, els[n - 1].t === 'flat' && els[n].t === 'flat' ? 'deck' : 'stairrun');
      addLinkRaw(K.B.T, els[els.length - 1].c, K.B.dir, 'arch');
      for (const T of [K.A.T, K.B.T]) { const x = find(K.region), y = find(region[T]); if (x !== y) par[x] = y; regionLinked.add(rkey(K.region, region[T])); }
    }
    cand.sort((x, y) => x.key - y.key);
    for (const e of cand) { const x = find(region[e.a]), y = find(region[e.b]); if (x !== y) { par[x] = y; join(e); } }

    // Shafts get a door on every storey, so they work as lifts
    for (const r of regions) if (r.kind === 'shaft') for (const c of r.cells) {
      const [i, j, k] = cpos(c);
      if (['px', 'nx', 'pz', 'nz'].some(d => { const L = linkAt.get(c + ':' + d); return L && L.kind === 'door'; })) continue;
      const opts2 = cand.filter(e => (e.a === c || e.b === c) && e.dir !== 'up' && !linkAt.has(e.a + ':' + e.dir));
      if (opts2.length) join(pick(opts2));
    }

    // Braid: give dead-end regions a second way out
    const degree = () => {
      const deg = new Array(regions.length).fill(0);
      for (const L of links) if (region[L.a] !== region[L.b]) { deg[region[L.a]]++; deg[region[L.b]]++; }
      deg[region[entC]]++; // the entrance counts as a way out
      return deg;
    };
    {
      const deg = degree();
      for (const r of shuffle(regions.map(r => r.id))) {
        if (deg[r] !== 1 || rng() * 100 >= o.braid) continue;
        const opts2 = cand.filter(e => (region[e.a] === r || region[e.b] === r) && !linkAt.has(e.a + ':' + e.dir) && !regionLinked.has(rkey(region[e.a], region[e.b])));
        if (!opts2.length) continue;
        const best = opts2.filter(e => deg[region[e.a] === r ? region[e.b] : region[e.a]] === 1);
        const e = pick(best.length ? best : opts2);
        join(e); deg[region[e.a]]++; deg[region[e.b]]++;
      }
    }

    // ---- goal: the farthest cell on the top (or bottom) storey, by link steps from the entrance ----
    const dist = new Int32Array(NC).fill(-1);
    { const q = [entC]; dist[entC] = 0;
      for (let h = 0; h < q.length; h++) { const c = q[h];
        for (const dir of Object.keys(DIRS)) { const L = linkAt.get(c + ':' + dir); if (!L) continue; const n = L.a === c ? L.b : L.a; if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); } } } }
    let goalC = -1;
    const goalJ = sp.goal === 'top' ? Math.max(...[...Array(NC).keys()].filter(c => mask[c] && !floatC[c]).map(c => cpos(c)[1])) : 0;
    for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c] && cpos(c)[1] === goalJ && !isShaft(c) && (goalC < 0 || dist[c] > dist[goalC])) goalC = c;

    // ---- voxelise ----
    const { W, H, D } = o;
    const ox = Math.floor((W - (ni * P + 1)) / 2), oz = Math.floor((D - (nk * P + 1)) / 2), oy = 0;
    const vox = new Uint8Array(W * H * D), owner = new Int16Array(W * H * D).fill(-1);
    const vi = (x, y, z) => x + z * W + y * W * D;
    const inb = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D;
    const set = (x, y, z, t, who) => { if (inb(x, y, z)) { vox[vi(x, y, z)] = t; owner[vi(x, y, z)] = who; } };
    const get = (x, y, z) => inb(x, y, z) ? vox[vi(x, y, z)] : V.EMPTY;
    const origin = c => { const [i, j, k] = cpos(c); return [ox + i * P, oy + j * S, oz + k * P]; };

    // ground: the whole chunk, except for the sunken column, whose surface is only a margin round the top so the shaft below stays visible
    const gm = shape === 'column' ? 7 : W;
    for (let z = Math.max(0, oz - gm); z <= Math.min(D - 1, oz + nk * P + gm); z++) for (let x = Math.max(0, ox - gm); x <= Math.min(W - 1, ox + ni * P + gm); x++) set(x, sp.groundY, z, V.GROUND, -1);
    // stair row inside the lower cell alternates by storey, so a cell's down-hole and up-flight never overlap
    const stairRow = j => (j % 2 === 0 ? 1 : 3);
    const stairBelow = c => { const L = linkAt.get(c + ':down'); return L && L.kind === 'stair'; };
    const stairUp = c => { const L = linkAt.get(c + ':up'); return (L && L.kind === 'stair') || (c === entC && E.dir === 'up'); };

    // slabs, roofs and walls
    const solidCell = (i, j, k) => has(i, j, k) && !floatC[cid(i, j, k)];
    for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) {
      const [x0, y0, z0] = origin(c), [i, j, k] = cpos(c), r = region[c];
      for (let z = z0; z <= z0 + P; z++) for (let x = x0; x <= x0 + P; x++) {
        if (get(x, y0, z) !== V.GROUND || j > 0) set(x, y0, z, V.FLOOR, r);
        if (!solidCell(i, j + 1, k)) { if (get(x, y0 + S, z) !== V.GROUND) set(x, y0 + S, z, V.ROOF, r); }
      }
      for (let y = y0 + 1; y < y0 + S; y++) for (let t = 0; t <= P; t++) {
        set(x0 + t, y, z0, V.WALL, r); set(x0 + t, y, z0 + P, V.WALL, r);
        set(x0, y, z0 + t, V.WALL, r); set(x0 + P, y, z0 + t, V.WALL, r);
      }
    }
    // Openings on a face. `along` runs the 3 interior voxels of the wall; `heights` are offsets above the slab.
    const faceVoxels = (c, dir, along, heights) => {
      const [x0, y0, z0] = origin(c), out = [];
      for (const t of along) for (const h of heights) {
        if (dir === 'px') out.push([x0 + P, y0 + h, z0 + t]);
        if (dir === 'nx') out.push([x0, y0 + h, z0 + t]);
        if (dir === 'pz') out.push([x0 + t, y0 + h, z0 + P]);
        if (dir === 'nz') out.push([x0 + t, y0 + h, z0]);
      }
      return out;
    };
    // A narrow door sits mid-wall, except on the wall beside a stair row (it would open onto a step or a hole)
    const doorAlong = (c, dir) => {
      const [, j] = cpos(c);
      const rows = []; if (stairUp(c)) rows.push(stairRow(j)); if (stairBelow(c)) rows.push(stairRow(j - 1));
      if ((dir === 'nz' && rows.includes(1)) || (dir === 'pz' && rows.includes(3))) return [1];
      return [2];
    };
    const doorAt = new Map(); // "cell:dir" -> which of the 3 voxels along the face the door uses (1..3, along +x or +z)
    for (const L of links) {
      if (L.dir === 'up') continue;
      const r = region[L.a];
      if (L.kind === 'deck' || L.kind === 'stairrun') continue;
      if (L.kind === 'open' || L.kind === 'shaft') { for (const [x, y, z] of faceVoxels(L.a, L.dir, [1, 2, 3], [1, 2, 3])) set(x, y, z, L.kind === 'shaft' ? V.SHAFT : V.EMPTY, r); }
      else if (L.kind === 'arch') { for (const [x, y, z] of faceVoxels(L.a, L.dir, [1, 2, 3], [1, 2])) set(x, y, z, V.DOOR, r); }
      else if (L.kind === 'door') {
        // pick the door position that suits both sides
        const a1 = doorAlong(L.a, L.dir), a2 = doorAlong(L.b, OPP[L.dir]);
        const along = a1[0] === 1 || a2[0] === 1 ? [1] : [2];
        for (const [x, y, z] of faceVoxels(L.a, L.dir, along, [1, 2])) set(x, y, z, V.DOOR, r);
        doorAt.set(L.a + ':' + L.dir, along[0]); doorAt.set(L.b + ':' + OPP[L.dir], along[0]); // for the tile placer
      }
    }
    // room interiors: clear the corner posts where four cells of one room meet
    for (const R of regions) if (R.kind === 'room') for (const c of R.cells) {
      const [i, j, k] = cpos(c), [x0, y0, z0] = origin(c);
      if (has(i + 1, j, k) && has(i, j, k + 1) && has(i + 1, j, k + 1) && region[cid(i + 1, j, k)] === R.id && region[cid(i, j, k + 1)] === R.id && region[cid(i + 1, j, k + 1)] === R.id)
        for (let y = y0 + 1; y < y0 + S; y++) set(x0 + P, y, z0 + P, V.EMPTY, R.id);
    }
    // shafts: clear the interior through every storey and mark it climbable
    for (const R of regions) if (R.kind === 'shaft') for (const c of R.cells) {
      const [x0, y0, z0] = origin(c), [i, j, k] = cpos(c);
      const top = has(i, j + 1, k) && region[cid(i, j + 1, k)] === R.id ? S : S - 1;
      for (let y = (j === 0 ? 1 : 0); y <= top; y++) for (let z = 1; z < P; z++) for (let x = 1; x < P; x++) set(x0 + x, y0 + y, z0 + z, V.SHAFT, R.id);
    }
    if (ML) {
      // a line of voxels along one face of a cell (corners included), at height y
      const faceLine = (c, dir, y, t) => { const [x0, , z0] = origin(c); const out = []; for (let s2 = 0; s2 <= P; s2++) out.push(dir === 'px' ? [x0 + P, y, z0 + s2] : dir === 'nx' ? [x0, y, z0 + s2] : dir === 'pz' ? [x0 + s2, y, z0 + P] : [x0 + s2, y, z0]); return out; };
      // cluster walls that face the void get a slot window under the ceiling (too high to climb through)
      for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) { const [i, j, k] = cpos(c); for (const dir of DL) {
        if (linkAt.has(c + ':' + dir) || (c === entC && dir === E.dir)) continue;
        if (solidCell(i + D4[dir][0], j, k + D4[dir][1])) continue;
        for (const [x, y, z] of faceVoxels(c, dir, [1, 2, 3], [3])) set(x, y, z, V.EMPTY, region[c]);
      } }
      for (const K of ML.connectors) for (const e of K.els) {
        const c = e.c, [x0, y0, z0] = origin(c), r = K.region;
        const put = (x, y, z, t) => { if (get(x, y, z) === V.EMPTY) set(x, y, z, t, r); };
        if (e.t === 'flat') {
          // a bridge deck; rails two voxels tall on every side that is not a way on (too tall to climb over)
          for (let z = z0; z <= z0 + P; z++) for (let x = x0; x <= x0 + P; x++) put(x, y0, z, V.DECK);
          for (const dir of DL) if (!linkAt.has(c + ':' + dir)) for (const h of [1, 2]) for (const [x, y, z] of faceLine(c, dir, y0 + h)) put(x, y, z, V.RAIL);
        } else {
          // a stair cell: four 1-voxel risers across the cell, a solid ramp underneath, rail walls 3 above each step
          const rd = D4[e.rise];
          for (let t = 0; t <= P; t++) for (let w = 0; w <= P; w++) {
            const xx = rd[0] !== 0 ? x0 + (rd[0] > 0 ? t : P - t) : x0 + w, zz = rd[0] !== 0 ? z0 + w : z0 + (rd[1] > 0 ? t : P - t);
            const top = Math.min(t, P); // walking surface at y0 + top
            put(xx, y0, zz, V.DECK);
            for (let y = y0 + 1; y <= y0 + Math.min(top, 3); y++) put(xx, y, zz, V.STAIR);
            if (t === P) put(xx, y0 + P, zz, V.DECK);
            if (w === 0 || w === P) for (let h = 1; h <= 3; h++) put(xx, y0 + top + h, zz, V.RAIL);
          }
        }
      }
    }
    let massCount = 0;
    if (ML) {
      // monoliths: solid mass in cells nothing else uses. A voxel on a cell boundary is filled only if every cell touching it is unused.
      const occ = ML.occ, unused = (i, j, k) => inGrid(i, j, k) && occ[cid(i, j, k)] === 0;
      const fillCell = (i, j, k) => {
        const [x0, y0, z0] = origin(cid(i, j, k));
        for (let y = y0; y <= y0 + S; y++) for (let z = z0; z <= z0 + P; z++) for (let x = x0; x <= x0 + P; x++) {
          const is = x === x0 ? [i - 1, i] : x === x0 + P ? [i, i + 1] : [i], ks = z === z0 ? [k - 1, k] : z === z0 + P ? [k, k + 1] : [k], js = y === y0 ? [j - 1, j] : y === y0 + S ? [j, j + 1] : [j];
          let ok = true;
          for (const a of is) for (const b of js) for (const e of ks) if (inGrid(a, b, e) && occ[cid(a, b, e)] !== 0) ok = false;
          if (ok && y > 0 && get(x, y, z) === V.EMPTY) { set(x, y, z, V.MASS, -1); massCount++; }
        }
      };
      // pillars under some floating clusters, down to the ground
      for (const C of ML.clusters) if (C.j0 > 1 && rng() < 0.55) {
        const i = C.i0 + Math.floor(rng() * C.w), k = C.k0 + Math.floor(rng() * C.d);
        for (let j = C.j0 - 1; j >= 0 && unused(i, j, k); j--) fillCell(i, j, k);
      }
      // free-standing monoliths: tall thin slabs and pillars, some rising from the ground, some hanging from the top
      const nMono = Math.round(ni * nk / 14);
      for (let t = 0; t < nMono; t++) {
        const slab = rng() < 0.6, along = rng() < 0.5, len = slab ? 2 + Math.floor(rng() * 4) : 1;
        const hgt = 3 + Math.floor(rng() * Math.max(1, nj - 3)), fromTop = rng() < 0.3;
        const i0 = Math.floor(rng() * ni), k0 = Math.floor(rng() * nk);
        for (let a = 0; a < len; a++) {
          const i = along ? i0 + a : i0, k = along ? k0 : k0 + a;
          for (let h = 0; h < hgt; h++) { const j = fromTop ? nj - 1 - h : h; if (unused(i, j, k)) fillCell(i, j, k); else break; }
        }
      }
    }
    // stairs: 3 steps along x in the lower cell's stair row, and a hole in the slab above the top two
    const stairs = [];
    for (let c = 0; c < NC; c++) if (mask[c] && stairUp(c)) {
      const [x0, y0, z0] = origin(c), [, j] = cpos(c), zr = z0 + stairRow(j), r = region[c];
      for (let s = 0; s < 3; s++) for (let y = y0 + 1; y <= y0 + 1 + s; y++) set(x0 + 1 + s, y, zr, V.STAIR, r);
      const holeT = c === entC && E.dir === 'up' ? V.ENTRANCE : V.EMPTY;
      for (let s = 1; s < 3; s++) set(x0 + 1 + s, y0 + S, zr, holeT, r);
      stairs.push(c);
    }
    // entrance doorway in the outer wall
    if (E.dir !== 'up') for (const [x, y, z] of faceVoxels(entC, E.dir, [1, 2, 3], [1, 2])) set(x, y, z, V.ENTRANCE, region[entC]);
    // goal marker in the middle of the goal cell
    { const [x0, y0, z0] = origin(goalC); for (const [dx, dz] of [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]]) if (get(x0 + dx, y0 + 1, z0 + dz) === V.EMPTY) { set(x0 + dx, y0 + 1, z0 + dz, V.GOAL, region[goalC]); break; } }

    // ---- per-cell sockets for WFC ----
    const cells = [];
    for (let c = 0; c < NC; c++) if (mask[c]) {
      const [i, j, k] = cpos(c), faces = {};
      for (const dir of Object.keys(DIRS)) {
        const L = linkAt.get(c + ':' + dir);
        if (L) faces[dir] = L.kind;
        else if (c === entC && dir === E.dir) faces[dir] = E.dir === 'up' ? 'stair' : 'entrance';
        else if (floatC[c]) faces[dir] = dir === 'up' ? (elem.get(c).t === 'stair' ? 'headroom' : 'sky') : dir === 'down' ? 'deck' : 'rail';
        else if (ML) faces[dir] = dir === 'up' ? (solidCell(i, j + 1, k) ? 'floor' : 'roof') : dir === 'down' ? 'floor' : solidCell(i + DIRS[dir][0], j, k + DIRS[dir][2]) ? 'wall' : 'window';
        else faces[dir] = dir === 'up' ? (has(i, j + 1, k) ? 'floor' : 'roof') : dir === 'down' ? 'floor' : 'wall';
      }
      cells.push({ c, i, j, k, origin: origin(c), region: region[c], kind: c === goalC ? 'goal' : c === entC ? 'entrance' : regions[region[c]].kind, faces, dist: dist[c],
        ...(stairUp(c) ? { stairRow: stairRow(j) } : {}), ...(stairBelow(c) ? { holeRow: stairRow(j - 1) } : {}),
        ...(['px', 'nx', 'pz', 'nz'].some(d => doorAt.has(c + ':' + d)) ? { doors: Object.fromEntries(['px', 'nx', 'pz', 'nz'].filter(d => doorAt.has(c + ':' + d)).map(d => [d, doorAt.get(c + ':' + d)])) } : {}),
        ...(floatC[c] ? { element: elem.get(c).t, rise: elem.get(c).rise } : {}) });
    }
    const deg = degree();
    const deadEnds = regions.filter(r => deg[r.id] <= 1 && r.cells.indexOf(goalC) < 0).length;
    // Where an explorer starts: outside the entrance, on the ground
    let start;
    { const [x0, y0, z0] = origin(entC);
      if (E.dir === 'up') start = [x0 + 3, sp.groundY + 1, z0 + 2];
      else { const d = DIRS[E.dir]; start = [x0 + 2 + d[0] * 3, y0 + 1, z0 + 2 + d[2] * 3]; } }
    let count = 0; for (let i = 0; i < vox.length; i++) if (vox[i]) count++;
    return {
      shape, W, H, D, vox, owner, idx: vi, count, P, S, cells, regions: regions.map(r => ({ id: r.id, kind: r.kind, cells: r.cells.length })),
      links: links.map(L => ({ a: L.a, b: L.b, dir: L.dir, kind: L.kind })), stairs: stairs.length, deadEnds,
      ...(ML ? { clusters: ML.clusters.map(C => ({ tag: C.tag, i0: C.i0, j0: C.j0, k0: C.k0, w: C.w, h: C.h, d: C.d })), connectors: ML.connectors.map(K => ({ cells: K.els.length, stairs: K.els.filter(e => e.t === 'stair').length, region: K.region })), mass: massCount } : {}),
      entrance: entC, goal: goalC, start, focusY: shape === 'column' ? sp.groundY / 2 : nj * S / 2, groundY: sp.groundY,
      bounds: { x0: ox, y0: oy, z0: oz, x1: ox + ni * P, y1: oy + nj * S, z1: oz + nk * P }
    };
  }

  const api = { generateStructure, STRUCTURE_SHAPES: SHAPES, SVOX: V, SVOX_NAMES: NAMES, SVOX_SOLID: SOLID };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
