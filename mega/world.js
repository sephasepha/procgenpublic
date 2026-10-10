// An infinite liminal megastructure, in three dimensions. Everything is a pure function of (seed, cell): nothing is
// stored, nothing is generated "around" the player, so the structure goes on in every direction, up and down too.
//
// Space is a lattice of cells, 17 x 8 x 17 voxels (1 voxel = 1 metre). Each cell is one of:
//   a ROOM: a floor, a ceiling, four walls and an inside (open, pillared, a maze of small rooms, or a cross of four
//     rooms); or
//   a VOID: open air with no floor, only thin bridges, a central platform and sometimes columns, so big stretches of
//     the structure are chasms and atria you look across and down into.
// Voids come from smooth noise over the lattice, so they form blobs, rifts and long shafts; "wells" are vertical
// columns of rooms with a hole through every few floors.
//
// Connection: every cell has a parent one step towards the origin (a tree that spans the whole infinite lattice,
// so everything is reachable from the start), plus extra links for loops. A link between two rooms is a doorway (or a
// colonnaded wide opening between open rooms), between a room and a void a doorway onto a bridge, between two
// rooms above one another a staircase. Vertical links are only ever between rooms.
(function (root) {
  const CW = 17, CH = 8;               // cell size in voxels: wide and deep, tall
  const FLOORY = 0, CEILY = CH - 1;    // a room's floor slab and ceiling slab (y within the cell); clear height is 1..6
  const M = { AIR: 0, FLOOR: 1, WALL: 2, CEIL: 3, PILLAR: 4, BRIDGE: 5, TRIM: 6, LIGHT: 7 };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]; // +x -x +z -z up down
  const OPP = [1, 0, 3, 2, 5, 4];
  const LANE = d => [1 + 4 * d, 3 + 4 * d];   // the four 3-wide lanes of a room; doors, stairs and bridges use them
  const fdiv = (a, b) => Math.floor(a / b);

  // palettes: colours for floor, wall, ceiling, pillar, bridge/stair, trim, light (index = material - 1)
  const PALETTES = [
    { name: 'Yellow offices', c: ['#7d6f4b', '#cdbf7a', '#dcd8c0', '#b3a560', '#8c8c86', '#5e5638', '#fffbe0'] },
    { name: 'Concrete halls', c: ['#85888b', '#a9acaf', '#b8bbbe', '#93969a', '#6e7174', '#55585b', '#f4f6ff'] },
    { name: 'Tiled baths', c: ['#5fa8a2', '#cfe9e6', '#e4f1ef', '#9fcfca', '#7a9a98', '#3f6f6b', '#f2ffff'] },
    { name: 'Rose corridors', c: ['#8a6068', '#d9a8b0', '#ead2d6', '#c58f98', '#8a7a7c', '#5f3f46', '#fff0f0'] },
    { name: 'Green institute', c: ['#5a7a60', '#9fb9a0', '#cfdccd', '#86a58a', '#76867a', '#3f5644', '#f4fff0'] },
    { name: 'Brown hotel', c: ['#4d3a30', '#7e5e4c', '#a68b78', '#6a4c3c', '#7a6f66', '#392a22', '#ffe9c8'] },
  ];

  function createWorld(seed) {
    const S = seed | 0;
    const H = (a, b, c, d) => { let h = S ^ Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15; return h >>> 0; };
    const H01 = (a, b, c, d) => H(a, b, c, d) / 4294967296;
    const smooth = t => t * t * (3 - 2 * t);
    // smooth value noise over the cell lattice (x, y, z in lattice units)
    function noise(x, y, z, salt) {
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
      let r = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) r += H01(x0 + dx, y0 + dy, z0 + dz, salt) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      return r;
    }

    // ---------- what a cell is ----------
    const voidMemo = new Map();
    function isVoid(i, j, k) {
      if (i === 0 && k === 0) return false;                // the vertical axis is solid, so up and down always connect
      const key = i + ',' + j + ',' + k, m = voidMemo.get(key); if (m !== undefined) return m;
      const n = 0.62 * noise(i / 3.4, j / 2.4, k / 3.4, 101) + 0.38 * noise(i / 8, j / 4.5, k / 8, 102);
      const rift = noise(i / 5.5, 0, k / 5.5, 103) > 0.71 && Math.abs(j - Math.round(7 * (noise(i / 9, 0, k / 9, 104) - 0.5))) <= 2;
      const v = n > 0.605 || rift;
      if (voidMemo.size > 60000) voidMemo.clear();
      voidMemo.set(key, v); return v;
    }
    const wellCol = (i, k) => !(i === 0 && k === 0) && H01(i, 0, k, 111) < 0.1;      // a column of wells through every level
    const wellHole = j => ((j % 4) + 4) % 4 !== 0;                                    // ...but a floor every fourth level
    const roomAt = (i, j, k) => !isVoid(i, j, k);

    // tree towards the origin: each cell's parent is a step that reduces one of its coordinates
    function validDir(i, j, k, d) {
      const [dx, dy, dz] = DIRS[d], ni = i + dx, nj = j + dy, nk = k + dz;
      if (dy !== 0) return roomAt(i, j, k) && roomAt(ni, nj, nk) && !wellCol(i, k);   // stairs join rooms, never through a well
      return true;                                                                    // doors and bridges go anywhere
    }
    const parentMemo = new Map();
    function parentDir(i, j, k) {
      if (!i && !j && !k) return -1;
      const key = i + ',' + j + ',' + k, m = parentMemo.get(key); if (m !== undefined) return m;
      const c = [];
      if (i) c.push(i > 0 ? 1 : 0); if (k) c.push(k > 0 ? 3 : 2); if (j) c.push(j > 0 ? 5 : 4);
      const ok = c.filter(d => validDir(i, j, k, d));
      const pick = (ok.length ? ok : c)[H(i, j, k, 120) % (ok.length ? ok : c).length];
      if (parentMemo.size > 60000) parentMemo.clear();
      parentMemo.set(key, pick); return pick;
    }
    // the opening between a cell and its neighbour in direction d (symmetric)
    function link(i, j, k, d) {
      const [dx, dy, dz] = DIRS[d], ni = i + dx, nj = j + dy, nk = k + dz;
      if (parentDir(i, j, k) === d || parentDir(ni, nj, nk) === OPP[d]) return true;
      // extra links make loops; decided once per pair from its canonical (lower) side
      const c = d % 2 === 0 ? [i, j, k, d] : [ni, nj, nk, OPP[d]];
      if (!validDir(c[0], c[1], c[2], c[3])) return false;
      const void2 = isVoid(i, j, k) || isVoid(ni, nj, nk), p = c[3] >= 4 ? 0.13 : void2 ? 0.14 : 0.24;
      return H01(c[0], c[1], c[2], 130 + c[3]) < p;
    }
    // which of a room's four lanes a doorway or bridge uses, and where a staircase goes: shared by both sides
    const pairKey = (i, j, k, d) => d % 2 === 0 ? [i, j, k, d] : [i + DIRS[d][0], j + DIRS[d][1], k + DIRS[d][2], OPP[d]];
    const laneOf = (i, j, k, d) => { const p = pairKey(i, j, k, d); return H(p[0], p[1], p[2], 140 + p[3]) % 4; };
    function stairOf(i, j, k) { return { lane: 1 + (((j % 2) + 2) % 2), // the middle lanes, so doors in the side walls never face the side of a stair; and alternating, so a stair arrives and the next one leaves in different lanes
       z0: 1 + H(i, j, k, 151) % 8 }; } // for the cell below the stair
    const stairUp = (i, j, k) => roomAt(i, j, k) && link(i, j, k, 4);

    // the inside of a room; rooms with stairs or wells keep a clear floor
    function variantOf(i, j, k) {
      if (i === 0 && j === 0 && k === 0) return 'open';
      if (wellCol(i, k)) return 'open';
      const up = link(i, j, k, 4) && roomAt(i, j + 1, k), down = link(i, j, k, 5) && roomAt(i, j - 1, k);
      const r = H01(i, j, k, 160);
      if (up || down) return r < 0.5 ? 'open' : 'pillars';
      return r < 0.24 ? 'pillars' : r < 0.38 ? 'open' : r < 0.74 ? 'maze' : 'cross';
    }
    const clearVariant = v => v === 'open' || v === 'pillars';
    // a doorway can be widened into a colonnade between two open rooms
    function wide(i, j, k, d) {
      const p = pairKey(i, j, k, d), q = [p[0] + DIRS[p[3]][0], p[1] + DIRS[p[3]][1], p[2] + DIRS[p[3]][2]];
      return d < 4 && roomAt(p[0], p[1], p[2]) && roomAt(q[0], q[1], q[2]) && clearVariant(variantOf(p[0], p[1], p[2])) && clearVariant(variantOf(q[0], q[1], q[2])) && H01(p[0], p[1], p[2], 170 + p[3]) < 0.4;
    }
    const regionOf = (i, j, k) => H(fdiv(i, 3), fdiv(j, 2), fdiv(k, 3), 180) % PALETTES.length;
    const lightOf = (i, j, k) => 0.82 + 0.22 * H01(i, j, k, 190);
    function info(i, j, k) {
      const v = isVoid(i, j, k);
      return { i, j, k, void: v, variant: v ? null : variantOf(i, j, k), region: regionOf(i, j, k), light: lightOf(i, j, k), well: !v && wellCol(i, k) };
    }

    // ---------- the voxels of a cell ----------
    function genCell(i, j, k) {
      const g = new Uint8Array(CW * CH * CW), at = (x, y, z) => (y * CW + z) * CW + x;
      const put = (x, y, z, m) => { if (x >= 0 && x < CW && y >= 0 && y < CH && z >= 0 && z < CW) g[at(x, y, z)] = m; };
      const box = (x0, x1, y0, y1, z0, z1, m) => { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, m); };
      const rng = (() => { let s = H(i, j, k, 200) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
      const links = [0, 1, 2, 3].map(d => link(i, j, k, d));

      if (isVoid(i, j, k)) {
        // thin columns, kept out of the lanes the bridges use (lanes never cover 4 or 12)
        if (H01(i, 0, k, 210) < 0.3) { const c = H(i, 0, k, 211) % 4, px = c & 1 ? 12 : 4, pz = c & 2 ? 12 : 4; box(px, px, 0, CH - 1, pz, pz, M.PILLAR); }
        if (links.some(Boolean)) {
          box(6, 10, 0, 0, 6, 10, M.BRIDGE); // the central platform
          for (let d = 0; d < 4; d++) {
            if (!links[d]) continue;
            const c = 2 + 4 * laneOf(i, j, k, d), lo = Math.min(c, 8) - 1, hi = Math.max(c, 8) + 1;
            if (d < 2) { if (d === 0) box(8, CW - 1, 0, 0, c - 1, c + 1, M.BRIDGE); else box(0, 8, 0, 0, c - 1, c + 1, M.BRIDGE); box(7, 9, 0, 0, lo, hi, M.BRIDGE); }
            else { if (d === 2) box(c - 1, c + 1, 0, 0, 8, CW - 1, M.BRIDGE); else box(c - 1, c + 1, 0, 0, 0, 8, M.BRIDGE); box(lo, hi, 0, 0, 7, 9, M.BRIDGE); }
          }
        }
        return g;
      }

      // a room: slabs and walls
      box(0, CW - 1, FLOORY, FLOORY, 0, CW - 1, M.FLOOR);
      box(0, CW - 1, CEILY, CEILY, 0, CW - 1, M.CEIL);
      box(0, 0, 1, CEILY - 1, 0, CW - 1, M.WALL); box(CW - 1, CW - 1, 1, CEILY - 1, 0, CW - 1, M.WALL);
      box(0, CW - 1, 1, CEILY - 1, 0, 0, M.WALL); box(0, CW - 1, 1, CEILY - 1, CW - 1, CW - 1, M.WALL);
      const variant = variantOf(i, j, k);
      if (variant === 'pillars') { for (const x of [4, 8, 12]) for (const z of [4, 8, 12]) if (rng() < 0.75) box(x, x, 1, CEILY - 1, z, z, M.PILLAR); }
      else if (variant === 'cross') {
        box(8, 8, 1, CEILY - 1, 1, CW - 2, M.WALL); box(1, CW - 2, 1, CEILY - 1, 8, 8, M.WALL);
        box(8, 8, 1, 4, 1, 3, 0); box(8, 8, 1, 4, 13, 15, 0); box(1, 3, 1, 4, 8, 8, 0); box(13, 15, 1, 4, 8, 8, 0);
      } else if (variant === 'maze') {
        for (const p of [4, 8, 12]) { box(p, p, 1, CEILY - 1, 1, CW - 2, M.WALL); box(1, CW - 2, 1, CEILY - 1, p, p, M.WALL); }
        // a spanning tree over the 4 x 4 small rooms, with a few extra openings
        const seen = new Uint8Array(16), st = [0]; seen[0] = 1;
        const open = (a, b) => { const ax = a % 4, az = (a / 4) | 0, bx = b % 4, bz = (b / 4) | 0, [l0, l1] = LANE(Math.min(ax, bx) === ax && ax !== bx ? ax : ax === bx ? ax : bx);
          if (ax !== bx) { const wx = 4 * Math.max(ax, bx), [z0, z1] = LANE(az); box(wx, wx, 1, 4, z0, z1, 0); } else { const wz = 4 * Math.max(az, bz), [x0, x1] = LANE(ax); box(x0, x1, 1, 4, wz, wz, 0); } };
        while (st.length) {
          const a = st[st.length - 1], ax = a % 4, az = (a / 4) | 0, nb = [];
          if (ax < 3) nb.push(a + 1); if (ax > 0) nb.push(a - 1); if (az < 3) nb.push(a + 4); if (az > 0) nb.push(a - 4);
          const free = nb.filter(b => !seen[b]);
          if (!free.length) { st.pop(); continue; }
          const b = free[Math.floor(rng() * free.length)]; seen[b] = 1; open(a, b); st.push(b);
        }
        for (let n = 0; n < 5; n++) { const a = Math.floor(rng() * 16), ax = a % 4, az = (a / 4) | 0, b = rng() < 0.5 ? (ax < 3 ? a + 1 : -1) : (az < 3 ? a + 4 : -1); if (b >= 0) open(a, b); }
      }
      // ceiling lights over some lanes
      for (const x of [2, 6, 10, 14]) for (const z of [2, 6, 10, 14]) if (variant !== 'cross' && rng() < 0.45) box(x - 1, x + 1, CEILY, CEILY, z - 1, z + 1, M.LIGHT);

      // wells: a hole through the floor and the ceiling
      if (wellCol(i, k)) {
        if (wellHole(j)) box(6, 10, FLOORY, FLOORY, 6, 10, 0);
        if (wellHole(j + 1)) box(6, 10, CEILY, CEILY, 6, 10, 0);
      }
      // stairs up from this cell, and the hole they come through from the cell below
      if (stairUp(i, j, k)) {
        const s = stairOf(i, j, k), [x0, x1] = LANE(s.lane);
        box(x0, x1, CEILY, CEILY, s.z0 + 3, s.z0 + 6, 0); // headroom starts a step early
        for (let t = 0; t <= 6; t++) box(x0, x1, 1, 1 + t, s.z0 + t, s.z0 + t, M.BRIDGE);
      }
      if (j !== undefined && stairUp(i, j - 1, k)) { const s = stairOf(i, j - 1, k), [x0, x1] = LANE(s.lane); box(x0, x1, FLOORY, FLOORY, s.z0 + 4, s.z0 + 6, 0); }

      // doorways, wide openings and windows in the walls
      for (let d = 0; d < 4; d++) {
        const nI = i + DIRS[d][0], nK = k + DIRS[d][2], nbVoid = isVoid(nI, j, nK);
        const wall = (lat0, lat1, y0, y1) => { // carve a gap in wall d over the lateral range
          if (d === 0) box(CW - 1, CW - 1, y0, y1, lat0, lat1, 0); else if (d === 1) box(0, 0, y0, y1, lat0, lat1, 0);
          else if (d === 2) box(lat0, lat1, y0, y1, CW - 1, CW - 1, 0); else box(lat0, lat1, y0, y1, 0, 0, 0);
        };
        if (links[d]) {
          if (wide(i, j, k, d)) { wall(1, CW - 2, 1, CEILY - 1); for (const p of [4, 8, 12]) { if (d === 0) box(CW - 1, CW - 1, 1, CEILY - 1, p, p, M.PILLAR); else if (d === 1) box(0, 0, 1, CEILY - 1, p, p, M.PILLAR); else if (d === 2) box(p, p, 1, CEILY - 1, CW - 1, CW - 1, M.PILLAR); else box(p, p, 1, CEILY - 1, 0, 0, M.PILLAR); } }
          else { const [a, b] = LANE(laneOf(i, j, k, d)); wall(a, b, 1, 4); }
        } else if (nbVoid) { // windows onto the void
          for (let l = 0; l < 4; l++) if (H01(i, j, k, 220 + d * 4 + l) < 0.6) { const [a, b] = LANE(l); wall(a, b, 3, 5); }
        }
      }
      return g;
    }

    // ---------- voxel access ----------
    const cache = new Map();
    function cell(i, j, k) {
      const key = i + ',' + j + ',' + k; let c = cache.get(key);
      if (!c) { c = genCell(i, j, k); if (cache.size > 900) { const first = cache.keys().next().value; cache.delete(first); } cache.set(key, c); }
      else { cache.delete(key); cache.set(key, c); } // most recently used last
      return c;
    }
    let li = NaN, lj = NaN, lk = NaN, lg = null;
    function voxel(x, y, z) {
      const i = fdiv(x, CW), j = fdiv(y, CH), k = fdiv(z, CW);
      if (i !== li || j !== lj || k !== lk) { lg = cell(i, j, k); li = i; lj = j; lk = k; }
      return lg[((y - j * CH) * CW + (z - k * CW)) * CW + (x - i * CW)];
    }
    // where you begin: the middle of the starting room, facing a way out
    function spawn() {
      let yaw = 0; for (let d = 0; d < 4; d++) if (link(0, 0, 0, d)) { yaw = [Math.PI / 2, 3 * Math.PI / 2, Math.PI, 0][d]; break; }
      return { x: 8.5, y: 1, z: 8.5, yaw };
    }
    return { seed: S, CW, CH, M, DIRS, PALETTES, info, link, isVoid, wellCol, wellHole, stairUp, stairOf, laneOf, variantOf, wide, parentDir, genCell, cell, voxel, spawn, regionOf, lightOf, LANE };
  }

  const api = { createWorld, CW, CH, MATERIALS: M, PALETTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
