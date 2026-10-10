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
  const V = { EMPTY: 0, GROUND: 1, WALL: 2, FLOOR: 3, DECK: 4, RAIL: 5, ROOF: 6, STAIR: 7, SHAFT: 8, DOOR: 9, ENTRANCE: 10, GOAL: 11 };
  const NAMES = ['empty', 'ground', 'wall', 'floor', 'deck', 'rail', 'roof', 'stair', 'shaft', 'door', 'entrance', 'goal'];
  const SOLID = new Uint8Array(16); [V.GROUND, V.WALL, V.FLOOR, V.DECK, V.RAIL, V.ROOF, V.STAIR].forEach(t => SOLID[t] = 1);
  const P = 4, S = 4;
  const SHAPES = {
    pyramid: { name: 'Pyramid labyrinth', size: 12, storeys: 9, rooms: 1, shafts: 0, braid: 100 },
    column: { name: 'Sunken column', size: 5, storeys: 10, rooms: 1, shafts: 0, braid: 100 },
    tower: { name: 'Tower', size: 6, storeys: 8, rooms: 3, shafts: 1, braid: 100 },
    mega: { name: 'Megastructure', size: 9, storeys: 12, rooms: 2, shafts: 2, braid: 100 }
  };

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
    if (shape === 'mega') {
      // A tower hollowed by a central atrium (open from the first storey to the sky), with bridges across it.
      const vw = Math.max(1, Math.min(n - 2, Math.round(n * 0.34))), v0 = Math.floor((n - vw) / 2);
      const mega = { vi0: v0, vi1: v0 + vw - 1, vk0: v0, vk1: v0 + vw - 1, from: 1 };
      const inVoid = (i, j, k) => j >= mega.from && i >= mega.vi0 && i <= mega.vi1 && k >= mega.vk0 && k <= mega.vk1;
      return { ni: n, nj: J, nk: n, groundY: 0, goal: 'top', mega, inVoid, mask: (i, j, k) => !inVoid(i, j, k), entrance: { i: Math.floor(n / 2), j: 0, k: 0, dir: 'nz' } };
    }
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
    const E = sp.entrance, entC = cid(E.i, E.j, E.k);
    mask[entC] = 1;
    const has = (i, j, k) => inGrid(i, j, k) && mask[cid(i, j, k)] === 1;
    const DIRS = { px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1], up: [0, 1, 0], down: [0, -1, 0] };
    const OPP = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz', up: 'down', down: 'up' };
    const MG = sp.mega, inVoid = sp.inVoid || (() => false);
    const skyVoid = new Uint8Array(NC), bands = new Set();
    if (MG && nj > 3) {
      // setbacks: cut blocks out of corners from some storey upwards, leaving roof terraces
      const cs = Math.max(1, Math.round(ni / 4));
      const corners = shuffle([[0, 0], [ni - cs, 0], [0, nk - cs], [ni - cs, nk - cs]]).slice(0, 1 + Math.floor(rng() * 3));
      for (const [ci, ck] of corners) {
        const jb = Math.max(2, Math.floor(nj * (0.3 + rng() * 0.45)));
        for (let j = jb; j < nj; j++) for (let k = ck; k < ck + cs; k++) for (let i = ci; i < ci + cs; i++) if (cid(i, j, k) !== entC) mask[cid(i, j, k)] = 0;
      }
      // a stepped crown: the top storey or two lose their outer ring
      if (ni >= 5 && nk >= 5) {
        const jc = nj - 1 - Math.floor(rng() * 2);
        for (let j = jc; j < nj; j++) for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) if (i === 0 || k === 0 || i === ni - 1 || k === nk - 1) mask[cid(i, j, k)] = 0;
      }
      // sky voids: openings punched into the facade, 2–3 storeys tall, sometimes right through to the atrium.
      // The storeys above them are held up (no overhang rule here), so they read as voids in the mass.
      if (nj >= 6) for (let t = 0, made = 0; t < 12 && made < 1 + Math.floor(rng() * 3); t++) {
        const side = Math.floor(rng() * 4), h = 2 + Math.floor(rng() * 2), j0 = 2 + Math.floor(rng() * Math.max(1, nj - h - 3));
        const along = side < 2 ? ni : nk, w = Math.min(along - 2, 1 + Math.floor(rng() * 2)), a0 = 1 + Math.floor(rng() * Math.max(1, along - w - 1));
        const ring = Math.max(1, (side < 2 ? MG.vk0 : MG.vi0)), depth = rng() < 0.5 ? ring : 1;
        const cellsV = [];
        for (let j = j0; j < Math.min(nj - 1, j0 + h); j++) for (let a = a0; a < a0 + w; a++) for (let d = 0; d < depth; d++) {
          const i = side === 0 ? a : side === 1 ? a : side === 2 ? d : ni - 1 - d, k = side === 0 ? d : side === 1 ? nk - 1 - d : a;
          if (i >= 0 && k >= 0 && i < ni && k < nk && mask[cid(i, j, k)] && !(i === E.i && k === E.k)) cellsV.push(cid(i, j, k));
        }
        if (!cellsV.length) continue;
        for (const c of cellsV) { mask[c] = 0; skyVoid[c] = 1; }
        made++;
      }
      // open-deck bands: one or two storeys whose outer walls are only parapets
      for (let t = 0; t < 1 + Math.floor(rng() * 2); t++) bands.add(2 + Math.floor(rng() * Math.max(1, nj - 3)));
    }
    // A cell above must sit on a cell below (no overhangs), so drop any that float, then anything not connected to the entrance.
    // (Cells over a sky void are the exception: the megastructure holds them up.)
    for (let j = 1; j < nj; j++) for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) {
      const c = cid(i, j, k), below = cid(i, j - 1, k);
      if (mask[c] && !mask[below] && !skyVoid[below]) mask[c] = 0;
    }
    // Bridges across the atrium: the only cells allowed to float. One every couple of storeys, alternating direction.
    const floatC = new Uint8Array(NC), bridges = [];
    if (MG) {
      let axis = rng() < 0.5 ? 'x' : 'z';
      for (let j = MG.from + 1; j < nj; j += 2 + Math.floor(rng() * 2)) {
        const lo = axis === 'x' ? MG.vk0 : MG.vi0, hi = axis === 'x' ? MG.vk1 : MG.vi1;
        const rows = []; for (let r = lo; r <= hi; r++) if (hi - lo < 2 || (r > lo && r < hi)) rows.push(r);
        const row = pick(rows);
        const span = []; const a0 = axis === 'x' ? MG.vi0 : MG.vk0, a1 = axis === 'x' ? MG.vi1 : MG.vk1;
        for (let a = a0; a <= a1; a++) span.push(axis === 'x' ? cid(a, j, row) : cid(row, j, a));
        const endA = axis === 'x' ? [a0 - 1, j, row] : [row, j, a0 - 1], endB = axis === 'x' ? [a1 + 1, j, row] : [row, j, a1 + 1];
        if (!has(endA[0], endA[1], endA[2]) || !has(endB[0], endB[1], endB[2])) continue;
        for (const c of span) { mask[c] = 1; floatC[c] = 1; }
        bridges.push({ axis, j, cells: span, ends: [cid(...endA), cid(...endB)] });
        axis = axis === 'x' ? 'z' : 'x';
      }
    }
    { const seen = new Uint8Array(NC), q = [entC]; seen[entC] = 1;
      while (q.length) { const c = q.pop(), [i, j, k] = cpos(c); for (const d of Object.values(DIRS)) { const a = i + d[0], b = j + d[1], e = k + d[2]; if (has(a, b, e) && !seen[cid(a, b, e)]) { seen[cid(a, b, e)] = 1; q.push(cid(a, b, e)); } } }
      for (let c = 0; c < NC; c++) if (!seen[c]) mask[c] = 0; }

    // ---- regions: shafts, rooms, halls ----
    const region = new Int32Array(NC).fill(-1), regions = [];
    const newRegion = kind => { regions.push({ id: regions.length, kind, cells: [] }); return regions.length - 1; };
    const claim = (c, r) => { region[c] = r; regions[r].cells.push(c); };
    if (MG) {
      // the atrium floor: the ground-storey cells under the void, one open space
      const base = []; for (let k = MG.vk0; k <= MG.vk1; k++) for (let i = MG.vi0; i <= MG.vi1; i++) if (mask[cid(i, 0, k)] && cid(i, 0, k) !== entC) base.push(cid(i, 0, k));
      if (base.length) { const r = newRegion('atrium'); for (const c of base) claim(c, r); }
      for (const b of bridges) { const r = newRegion('bridge'); for (const c of b.cells) claim(c, r); b.region = r; }
    }
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
    const isShaft = c => regions[region[c]].kind === 'shaft';
    const isBridge = c => floatC[c] === 1;
    const linkKind = (a, b, dir) => {
      if (dir === 'up') return 'stair';
      const ka = regions[region[a]].kind, kb = regions[region[b]].kind;
      // rooms and shafts are entered by narrow doors; halls, the atrium and bridges open wide into each other
      return ka === 'room' || kb === 'room' || ka === 'shaft' || kb === 'shaft' ? 'door' : 'arch';
    };
    // union-find over regions
    const par = regions.map((_, i) => i);
    const find = x => par[x] === x ? x : (par[x] = find(par[x]));
    const cand = []; // links between different regions that are allowed
    for (let c = 0; c < NC; c++) if (mask[c]) {
      const [i, j, k] = cpos(c);
      for (const dir of ['px', 'pz', 'up']) {
        const d = DIRS[dir], a = i + d[0], b = j + d[1], e = k + d[2];
        if (!has(a, b, e)) continue;
        const n = cid(a, b, e);
        if (region[c] === region[n]) { addLink(c, dir, isShaft(c) ? 'shaft' : isBridge(c) ? 'deck' : 'open'); continue; }
        if (dir === 'up' && (isShaft(c) || isShaft(n) || isBridge(c) || isBridge(n))) continue; // shafts and bridges are entered sideways only
        if (isBridge(c) !== isBridge(n) && !bridges.some(b => b.ends.includes(isBridge(c) ? n : c))) continue; // a bridge only lands at its two ends
        cand.push({ a: c, b: n, dir, key: rng() + (dir === 'up' ? 0.55 : 0) });
      }
    }
    const regionLinked = new Set();
    const rkey = (x, y) => x < y ? x + ',' + y : y + ',' + x;
    const join = e => { addLink(e.a, e.dir, linkKind(e.a, e.b, e.dir)); regionLinked.add(rkey(region[e.a], region[e.b])); };
    cand.sort((x, y) => x.key - y.key);
    for (const e of cand) { const x = find(region[e.a]), y = find(region[e.b]); if (x !== y) { par[x] = y; join(e); } }

    // Both ends of every bridge land in the tower
    for (const b of bridges) for (const end of b.ends) for (const e of cand) {
      if (!((e.a === end && isBridge(e.b)) || (e.b === end && isBridge(e.a)))) continue;
      if (!linkAt.has(e.a + ':' + e.dir)) join(e);
    }
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
    const goalJ = sp.goal === 'top' ? Math.max(...[...Array(NC).keys()].filter(c => mask[c]).map(c => cpos(c)[1])) : 0;
    for (let c = 0; c < NC; c++) if (mask[c] && cpos(c)[1] === goalJ && !isShaft(c) && (goalC < 0 || dist[c] > dist[goalC])) goalC = c;

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
    for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) {
      const [x0, y0, z0] = origin(c), [i, j, k] = cpos(c), r = region[c];
      const openAbove = inVoid(i, j + 1, k); // the atrium floor is open to the sky
      for (let z = z0; z <= z0 + P; z++) for (let x = x0; x <= x0 + P; x++) {
        if (get(x, y0, z) !== V.GROUND || j > 0) set(x, y0, z, V.FLOOR, r);
        if (!has(i, j + 1, k) && !openAbove) { if (get(x, y0 + S, z) !== V.GROUND) set(x, y0 + S, z, V.ROOF, r); }
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
    for (const L of links) {
      if (L.dir === 'up') continue;
      const r = region[L.a];
      if (L.kind === 'deck') continue;
      if (L.kind === 'open' || L.kind === 'shaft') { for (const [x, y, z] of faceVoxels(L.a, L.dir, [1, 2, 3], [1, 2, 3])) set(x, y, z, L.kind === 'shaft' ? V.SHAFT : V.EMPTY, r); }
      else if (L.kind === 'arch') { for (const [x, y, z] of faceVoxels(L.a, L.dir, [1, 2, 3], [1, 2])) set(x, y, z, V.DOOR, r); }
      else if (L.kind === 'door') {
        // pick the door position that suits both sides
        const a1 = doorAlong(L.a, L.dir), a2 = doorAlong(L.b, OPP[L.dir]);
        const along = a1[0] === 1 || a2[0] === 1 ? [1] : [2];
        for (const [x, y, z] of faceVoxels(L.a, L.dir, along, [1, 2])) set(x, y, z, V.DOOR, r);
      }
    }
    // room interiors: clear the corner posts where four cells of one room meet
    for (const R of regions) if (R.kind === 'room' || R.kind === 'atrium') for (const c of R.cells) {
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
    // What lies beyond a face that has no link: another cell, the atrium void, a roof terrace, or the outside
    const beyond = (c, dir) => {
      const [i, j, k] = cpos(c), d = DIRS[dir], a = i + d[0], b = j + d[1], e = k + d[2];
      if (has(a, b, e)) return 'cell';
      if (!MG) return 'outside';
      if (inGrid(a, b, e) && inVoid(a, b, e)) return 'void';
      if (inGrid(a, b, e) && has(a, b - 1, e)) return 'terrace';
      if (inGrid(a, b, e) && skyVoid[cid(a, b, e)]) return 'void';
      return 'outside';
    };
    const HDIRS = ['px', 'nx', 'pz', 'nz'];
    if (MG) {
      for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) for (const dir of HDIRS) {
        if (linkAt.has(c + ':' + dir) || (c === entC && dir === E.dir)) continue;
        const what = beyond(c, dir), r = region[c];
        // galleries: the wall facing the atrium becomes a waist-high parapet
        if (what === 'void') for (const [x, y, z] of faceVoxels(c, dir, [1, 2, 3], [2, 3])) set(x, y, z, V.EMPTY, r);
        // terraces: a wide opening onto the roof of the setback below
        if (what === 'terrace') for (const [x, y, z] of faceVoxels(c, dir, [1, 2, 3], [1, 2])) set(x, y, z, V.DOOR, r);
        // the outside: a ribbon window under the ceiling, or a parapet on an open-deck band
        if (what === 'outside') for (const [x, y, z] of faceVoxels(c, dir, [1, 2, 3], bands.has(cpos(c)[1]) ? [2, 3] : [3])) set(x, y, z, V.EMPTY, r);
      }
      // rails round the open edges of terraces
      for (let c = 0; c < NC; c++) if (mask[c] && !floatC[c]) {
        const [i, j, k] = cpos(c), [x0, y0, z0] = origin(c);
        if (j + 1 >= nj || has(i, j + 1, k) || inVoid(i, j + 1, k)) continue; // not a terrace roof
        for (const dir of HDIRS) {
          const d = DIRS[dir], a = i + d[0], e = k + d[2];
          if (has(a, j + 1, e) || has(a, j, e)) continue;
          for (let t = 0; t <= P; t++) {
            const x = dir === 'px' ? x0 + P : dir === 'nx' ? x0 : x0 + t, z = dir === 'pz' ? z0 + P : dir === 'nz' ? z0 : z0 + t;
            if (get(x, y0 + S + 1, z) === V.EMPTY) set(x, y0 + S + 1, z, V.RAIL, region[c]);
          }
        }
      }
      // bridge decks with rails along both sides
      for (const b of bridges) for (const c of b.cells) {
        const [x0, y0, z0] = origin(c), [i, j, k] = cpos(c);
        for (let z = z0; z <= z0 + P; z++) for (let x = x0; x <= x0 + P; x++) if (get(x, y0, z) === V.EMPTY) set(x, y0, z, V.DECK, b.region);
        const sides = b.axis === 'x' ? ['pz', 'nz'] : ['px', 'nx'];
        for (const dir of sides) {
          const d = DIRS[dir]; if (has(i + d[0], j, k + d[2])) continue;
          for (let t = 0; t <= P; t++) {
            const x = dir === 'px' ? x0 + P : dir === 'nx' ? x0 : x0 + t, z = dir === 'pz' ? z0 + P : dir === 'nz' ? z0 : z0 + t;
            if (get(x, y0 + 1, z) === V.EMPTY) set(x, y0 + 1, z, V.RAIL, b.region);
          }
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
        else if (dir === 'up') faces[dir] = has(i, j + 1, k) ? 'floor' : floatC[c] || inVoid(i, j + 1, k) ? 'sky' : 'roof';
        else if (dir === 'down') faces[dir] = floatC[c] ? 'deck' : 'floor';
        else if (floatC[c]) faces[dir] = has(i + DIRS[dir][0], j, k + DIRS[dir][2]) ? 'wall' : 'rail';
        else { const w = beyond(c, dir); faces[dir] = w === 'void' ? 'gallery' : w === 'terrace' ? 'terrace' : w === 'outside' && MG ? (bands.has(j) ? 'parapet' : 'window') : 'wall'; }
      }
      cells.push({ c, i, j, k, origin: origin(c), region: region[c], kind: c === goalC ? 'goal' : c === entC ? 'entrance' : regions[region[c]].kind, faces, dist: dist[c] });
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
      bridges: bridges.map(b => ({ axis: b.axis, j: b.j, cells: b.cells.length, region: b.region })),
      entrance: entC, goal: goalC, start, focusY: shape === 'column' ? sp.groundY / 2 : nj * S / 2, groundY: sp.groundY,
      bounds: { x0: ox, y0: oy, z0: oz, x1: ox + ni * P, y1: oy + nj * S, z1: oz + nk * P }
    };
  }

  const api = { generateStructure, STRUCTURE_SHAPES: SHAPES, SVOX: V, SVOX_NAMES: NAMES, SVOX_SOLID: SOLID };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
