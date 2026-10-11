// An infinite megastructure in the manner of Blame!: vast, dark, mostly solid, and endless in every direction, up and
// down too. Everything is a pure function of (seed, cell): nothing is stored, nothing is generated "around" the player.
//
// Space is a lattice of cells, 17 x 8 x 17 voxels (1 voxel = 1 metre). Each cell is one of:
//   a VOID: open air with no floor, only walkways, a central platform and sometimes a column. Voids are large: smooth
//     noise makes them blobs many cells across, and "shafts" run through many levels, so you stand on a thin walkway
//     beside a sheer face of structure that drops a hundred metres; the faces carry ribs, pipes and cornices;
//   or a block of the STRUCTURE with its inside carved out: TUNNELS (a star of tight two-metre corridors, three metres
//     high, meeting at a junction), a WARREN (a grid of small three-metre cells), or a HALL (a big dark chamber, open or
//     with a grid of columns, where stairs and wells are). Some tunnel columns have a narrow drop through four levels.
//
// Connection: every cell has a parent one step towards the origin (a tree that spans the whole infinite lattice, so
// everything is reachable from the start), plus extra links for loops. A link is a corridor or doorway between two
// blocks, a doorway onto a walkway between a block and a void, a walkway between voids, or a staircase between halls one
// above the other. Vertical links are only ever between halls.
(function (root) {
  const CW = 17, CH = 8;               // cell size in voxels: wide and deep, tall
  const FLOORY = 0, CEILY = CH - 1;    // a room's floor slab and ceiling slab (y within the cell); clear height is 1..6
  const M = { AIR: 0, FLOOR: 1, WALL: 2, CEIL: 3, PILLAR: 4, BRIDGE: 5, TRIM: 6, LIGHT: 7 };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]; // +x -x +z -z up down
  const OPP = [1, 0, 3, 2, 5, 4];
  const LANE = d => [1 + 4 * d, 3 + 4 * d];   // the four 3-wide lanes of a room; doors, stairs and bridges use them
  const fdiv = (a, b) => Math.floor(a / b);

  // palettes: colours for floor, wall, ceiling, pillar, walkway, trim, lamp (index = material - 1). Dark and cold:
  // surfaces are near-black against a pale haze, so distance reads as light and nearness as shadow.
  const PALETTES = [
    { name: 'Basalt', c: ['#3a3d42', '#4a4e55', '#2c2f34', '#5a5f67', '#6b7078', '#23262a', '#f2f6ff'] },
    { name: 'Concrete', c: ['#55585c', '#6d7075', '#45484c', '#7b7e83', '#8a8d92', '#35383b', '#f2f6ff'] },
    { name: 'Steel', c: ['#3b4650', '#4d5a66', '#2e3841', '#62717e', '#7a8996', '#232b32', '#eef6ff'] },
    { name: 'Rust', c: ['#4a3a31', '#5e4a3e', '#382c25', '#75594a', '#8a6c5a', '#2a211c', '#ffe6d0'] },
    { name: 'Ash', c: ['#6b6e70', '#85888a', '#55585a', '#9a9da0', '#b0b3b5', '#404345', '#ffffff'] },
    { name: 'Verdigris', c: ['#34433f', '#44574f', '#28332f', '#587068', '#6e8a80', '#1f2825', '#eefff6'] },
    { name: 'Stone', c: ['#4d4842', '#605a52', '#3c3833', '#716a60', '#837b6f', '#2d2a26', '#fff0dc'] },
    { name: 'Obsidian', c: ['#2c2e33', '#2a2c31', '#1e2023', '#3a3d44', '#565a62', '#18191c', '#e8f0ff'] },
    { name: 'Ossuary', c: ['#3e3a33', '#4a443b', '#2f2b26', '#5a5246', '#6a6152', '#24211d', '#ffcf8a'] },
    { name: 'Earth', c: ['#3d3a30', '#4b473b', '#34312a', '#5c574b', '#6a6456', '#2b2923', '#dff2ff'] },
  ];
  // The surface: the structure has a lid. Level GJ is a crust of solid rock; above it, on level PJ, lies the ground
  // floor, a gently rolling plain of grass and dirt (a smooth heightfield, not voxels) in dense fog, empty but for
  // doorways. A doorway on the plain is one of a pair of portals, a wormhole: its twin stands somewhere deep in the
  // structure (up to 500 cells away and 40 levels down), the same shape, at the head of a stair down. Looking through
  // one you see what is beyond the other; walking through moves you between them, so the descent is seamless.
  const GJ = 4, PJ = GJ + 1, SURF = PJ * CH;
  // Districts: big regions of space (about ten cells across and six levels tall) that each have an identity you
  // recognise as you walk in. They share one connection scheme, so you can always cross from one into the next.
  //   interior   the dense inside of the structure: conduits, cells and halls, no open air
  //   colonnade  one enormous void under a roof, held up by pillars seven metres thick, crossed by walkways
  //   terraces   a stepped stone massif: open shelves that fall away level by level, monoliths standing on them,
  //              and corridors cut into the rock behind
  //   chasm      sheer faces: canyons several cells wide and many levels deep, crossing, and colossal voids
  //   catacombs  rock threaded with passages one metre wide and two high, winding, dead-ending, their walls cut
  //              with burial niches; now and then a small ossuary; narrow stairwells between levels
  //   expanse    empty space: open air with decks of walkways every third level, and huge obelisks floating in it
  const BIOMES = ['interior', 'colonnade', 'terraces', 'chasm', 'expanse', 'catacombs'];
  const BIOME_NAMES = { interior: 'The Interior', colonnade: 'The Colonnade', terraces: 'The Terraces', chasm: 'The Chasm', expanse: 'The Expanse', catacombs: 'The Catacombs', surface: 'The Surface' };
  const BIOME_PAL = { interior: [0, 1, 2, 3, 4, 5], colonnade: [1, 4, 0], terraces: [6, 6, 4], chasm: [2, 3, 0, 5], expanse: [7], catacombs: [8], surface: [9] };
  const DX = 16, DY = 9; // a district: 272 m across, 72 m tall

  function createWorld(seed, opts) {
    const S = seed | 0, force = opts && BIOMES.includes(opts.biome) ? opts.biome : null;
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

    // ---------- districts ----------
    // boxes of the lattice with wobbling sides (the wobble depends on i and k only, so walls of a district are plumb)
    const distMemo = new Map();
    function districtOf(i, j, k) {
      const key = i + ',' + j + ',' + k, m = distMemo.get(key); if (m) return m;
      const wi = i + Math.round(5 * (noise(i / 6, 0, k / 6, 401) - 0.5)), wk = k + Math.round(5 * (noise(i / 6, 0, k / 6, 402) - 0.5));
      const bi = fdiv(wi, DX), bk = fdiv(wk, DX), bj = fdiv(j, DY);
      let type = j >= GJ ? 'surface' : force;
      if (!type) { const r = H01(bi, bj, bk, 403); type = r < 0.18 ? 'interior' : r < 0.35 ? 'colonnade' : r < 0.52 ? 'terraces' : r < 0.69 ? 'chasm' : r < 0.84 ? 'expanse' : 'catacombs'; }
      const d = { type, bi, bj, bk, li: wi - bi * DX, lj: j - bj * DY, lk: wk - bk * DX };
      if (distMemo.size > 60000) distMemo.clear();
      distMemo.set(key, d); return d;
    }
    const pillarCol = (i, k) => H01(i, 0, k, 410) < 0.6;   // in the colonnade: a great pillar stands in this column

    // ---------- what a cell is ----------
    const voidMemo = new Map();
    function isVoid(i, j, k) {
      if (i === 0 && k === 0) return false;                // the vertical axis is solid, so up and down always connect
      const key = i + ',' + j + ',' + k, m = voidMemo.get(key); if (m !== undefined) return m;
      const v = voidIn(districtOf(i, j, k), i, j, k);
      if (voidMemo.size > 60000) voidMemo.clear();
      voidMemo.set(key, v); return v;
    }
    // obelisks: on a lattice seven cells apart, two or three cells across and nine or twelve levels tall, hanging in
    // the air (they exist only where the district is an expanse); you can go inside them
    function obeliskAt(i, j, k) {
      const bi = fdiv(i, 10), bk = fdiv(k, 10), w = 3 + (H(bi, 0, bk, 430) & 1), d = 3 + (H(bi, 0, bk, 431) & 1);
      const ox = bi * 10 + H(bi, 0, bk, 432) % (9 - w), oz = bk * 10 + H(bi, 0, bk, 433) % (9 - d);
      if (i < ox || i >= ox + w || k < oz || k >= oz + d) return false;
      const bj = fdiv(j, 22); if (H01(bi, bj, bk, 434) > 0.8) return false;
      const h = 12 + 3 * (H(bi, bj, bk, 435) % 3), y0 = bj * 22 + 1 + H(bi, bj, bk, 436) % (21 - h);
      return j >= y0 && j < y0 + h;
    }
    const obeliskCol = (i, k) => { const bi = fdiv(i, 10), bk = fdiv(k, 10), w = 3 + (H(bi, 0, bk, 430) & 1), d = 3 + (H(bi, 0, bk, 431) & 1);
      const ox = bi * 10 + H(bi, 0, bk, 432) % (9 - w), oz = bk * 10 + H(bi, 0, bk, 433) % (9 - d); return i >= ox && i < ox + w && k >= oz && k < oz + d; };
    const isExpanse = (i, j, k) => districtOf(i, j, k).type === 'expanse';
    // supports: now and then a column two or three cells thick hangs from the roof of an expanse (only where the roof is
    // structure, not more open air) five to eight levels down, as if holding it up
    function supportAt(i, j, k) {
      const D = districtOf(i, j, k); if (D.type !== 'expanse') return false;
      const bi = fdiv(i, 12), bk = fdiv(k, 12); if (H01(bi, D.bj, bk, 440) > 0.35) return false;
      const w = H01(bi, D.bj, bk, 441) < 0.3 ? 3 : 2, ox = bi * 12 + 1 + H(bi, D.bj, bk, 442) % (10 - w), oz = bk * 12 + 1 + H(bi, D.bj, bk, 443) % (10 - w);
      if (i < ox || i >= ox + w || k < oz || k >= oz + w) return false;
      const top = D.bj * DY + DY - 1, h = 5 + H(bi, D.bj, bk, 444) % 4;
      if (j > top || j <= top - h) return false;
      return districtOf(ox, top + 1, oz).type !== 'expanse';
    }
    const deckLevel = j => ((j % 3) + 3) % 3 === 0;
    // open air: an expanse cell that is no part of the network at all, so the expanse is truly empty. Only away from
    // the decks, the obelisks, the stair towers and the edges of the district (every one of its neighbours is expanse)
    const airMemo = new Map();
    function isAir(i, j, k) {
      if (j >= GJ) return true; // above the lid: no part of the network
      if (deckLevel(j) || (i === 0 && k === 0)) return false;
      const key = i + ',' + j + ',' + k, m = airMemo.get(key); if (m !== undefined) return m;
      let a = isExpanse(i, j, k) && !obeliskAt(i, j, k) && !supportAt(i, j, k) && !towerCol(i, k);
      for (let d = 0; d < 6 && a; d++) if (!isExpanse(i + DIRS[d][0], j + DIRS[d][1], k + DIRS[d][2])) a = false;
      if (airMemo.size > 60000) airMemo.clear();
      airMemo.set(key, a); return a;
    }
    function voidIn(D, i, j, k) {
      if (D.type === 'surface') return true;
      if (D.type === 'interior' || D.type === 'catacombs') return false;
      if (D.type === 'expanse') return !obeliskAt(i, j, k) && !supportAt(i, j, k);
      if (D.type === 'colonnade') return D.lj !== DY - 1 && H01(i, 0, k, 405) > 0.04; // all air under a roof, a few towers
      if (D.type === 'terraces') { // a stepped massif, narrowing as it rises, its centre off to one side
        const cx = 5 + H(D.bi, D.bj, D.bk, 406) % 6, cz = 5 + H(D.bi, D.bj, D.bk, 407) % 6;
        const dd = Math.max(Math.abs(D.li - cx), Math.abs(D.lk - cz)), R = 8.6 - 0.8 * D.lj + 1.6 * (noise(i / 3.5, j / 2.5, k / 3.5, 408) - 0.5);
        return dd >= R;
      }
      // the chasm: a canyon across the district, plus blobs, shafts and colossal voids
      // big blobs, with a finer grain; and shafts that run through many levels
      const n = 0.66 * noise(i / 5, j / 3.6, k / 5, 101) + 0.34 * noise(i / 3.2, j / 2.4, k / 3.2, 102);
      const shaft = noise(i / 6.5, 0, k / 6.5, 103) > 0.68 && Math.abs(j - Math.round(10 * (noise(i / 14, 0, k / 14, 104) - 0.5))) <= 4;
      // colossal voids: boxes 4-6 cells across and 9-14 levels tall, one in about every other lattice node
      const bi = Math.floor(i / 12), bj = Math.floor(j / 18), bk = Math.floor(k / 12);
      let big = false;
      if (H01(bi, bj, bk, 121) < 0.5) {
        const w = 4 + (H(bi, bj, bk, 122) % 3), d = 4 + (H(bi, bj, bk, 123) % 3), hh = 9 + (H(bi, bj, bk, 124) % 6);
        const ox = bi * 12 + (H(bi, bj, bk, 125) % (12 - w)), oz = bk * 12 + (H(bi, bj, bk, 126) % (12 - d)), oy = bj * 18 + (H(bi, bj, bk, 127) % (18 - hh));
        big = i >= ox && i < ox + w && k >= oz && k < oz + d && j >= oy && j < oy + hh;
      }
      const along = H(D.bi, 0, D.bk, 409) & 1, a = along ? D.lk : D.li, b = along ? D.li : D.lk;
      const canyon = Math.abs(a - 7.5 - 5 * (noise(b / 6, j / 7, 0, 411) - 0.5)) < 4.8;
      // and a second canyon crossing it in some districts
      const cross = H01(D.bi, 0, D.bk, 413) < 0.5 && Math.abs(b - 7.5 - 5 * (noise(a / 6, j / 7, 0, 414) - 0.5)) < 3;
      return canyon || cross || big;
    }
    // wells and drops are columns, but they stop in an expanse and the level either side of it
    const noShafts = (i, j, k) => { const t = districtOf(i, j, k).type; return t === 'expanse' || t === 'catacombs'; };
    const nearExpanse = (i, j, k) => noShafts(i, j, k) || noShafts(i, j - 1, k) || noShafts(i, j + 1, k);
    const wellCol = (i, k, j) => !(i === 0 && k === 0) && H01(i, 0, k, 111) < 0.07 && (j === undefined || !nearExpanse(i, j, k)); // wide wells (in halls)
    const dropCol = (i, k, j) => !(i === 0 && k === 0) && !(H01(i, 0, k, 111) < 0.07) && H01(i, 0, k, 112) < 0.1 && (j === undefined || !nearExpanse(i, j, k)); // narrow drops (in tunnels)
    const shaftCol = (i, k, j) => wellCol(i, k, j) || dropCol(i, k, j);
    const wellHole = j => ((j % 4) + 4) % 4 !== 0;                                    // wells have a floor every fourth level
    const dropHole = j => ((j % 5) + 5) % 5 !== 0;                                    // drops fall four levels, then a floor
    const roomAt = (i, j, k) => !isVoid(i, j, k);

    // tree towards the origin: each cell's parent is a step that reduces one of its coordinates
    function validDir(i, j, k, d) {
      const [dx, dy, dz] = DIRS[d], ni = i + dx, nj = j + dy, nk = k + dz;
      if (dy !== 0) return roomAt(i, j, k) && roomAt(ni, nj, nk) && !shaftCol(i, k, j) && !shaftCol(i, k, nj);   // stairs join halls, never through a shaft
      return true;                                                                    // doors and bridges go anywhere
    }
    // Every step to a parent lowers (|i| + |k|, off a deck level, |j|) in that order, so the parents form a tree. In an
    // expanse the steps that reduce a coordinate may all lead into open air; then the cell's parent is the deck level
    // next to it (decks are every third level, so one is always adjacent), by a stair of whatever kind fits.
    const pot = (i, j, k) => [Math.abs(i) + Math.abs(k), (i || k) && !deckLevel(j) ? 1 : 0, Math.abs(j)];
    const lower = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
    const parentMemo = new Map();
    function parentDir(i, j, k) {
      if (!i && !j && !k) return -1;
      const key = i + ',' + j + ',' + k, m = parentMemo.get(key); if (m !== undefined) return m;
      if (isAir(i, j, k)) { parentMemo.set(key, -1); return -1; }
      const c = [], me = pot(i, j, k);
      if (i) c.push(i > 0 ? 1 : 0); if (k) c.push(k > 0 ? 3 : 2); if (j) c.push(j > 0 ? 5 : 4);
      const ok = c.filter(d => { const ni = i + DIRS[d][0], nj = j + DIRS[d][1], nk = k + DIRS[d][2]; return validDir(i, j, k, d) && !isAir(ni, nj, nk) && lower(pot(ni, nj, nk), me); });
      const pool = ok.length ? ok : [((j % 3) + 3) % 3 === 1 ? 5 : 4], wts = pool.map(d => (d >= 4 ? 0.5 : 1)), tot = wts.reduce((a, b) => a + b, 0);
      let r = H01(i, j, k, 120) * tot, pick = pool[0]; for (let n = 0; n < pool.length; n++) { if ((r -= wts[n]) < 0) { pick = pool[n]; break; } }
      if (parentMemo.size > 60000) parentMemo.clear();
      parentMemo.set(key, pick); return pick;
    }
    // stair towers in the open: some columns carry a landing at every level of a void and a stair up to the next,
    // so the voids can be climbed and descended (never where a colonnade pillar or a well or drop stands)
    function towerCol(i, k) { return !shaftCol(i, k) && !obeliskCol(i, k) && H01(i, 0, k, 420) < 0.08; }
    const voidStair = (i, j, k) => j < GJ - 1 && towerCol(i, k) && isVoid(i, j, k) && isVoid(i, j + 1, k) && !(pillarCol(i, k) && (districtOf(i, j, k).type === 'colonnade' || districtOf(i, j + 1, k).type === 'colonnade'));
    // the opening between a cell and its neighbour in direction d (symmetric)
    function link(i, j, k, d) {
      const [dx, dy, dz] = DIRS[d], ni = i + dx, nj = j + dy, nk = k + dz;
      if (d === 4 && isSite(i, j + 1, k) || d === 5 && isSite(i, j, k)) return true; // the stair down from a twin doorway
      if (isAir(i, j, k) || isAir(ni, nj, nk)) return false;
      if (d === 4 && voidStair(i, j, k)) return true;
      if (d === 5 && voidStair(i, j - 1, k)) return true;
      if (parentDir(i, j, k) === d || parentDir(ni, nj, nk) === OPP[d]) return true;
      // extra links make loops; decided once per pair from its canonical (lower) side
      const c = d % 2 === 0 ? [i, j, k, d] : [ni, nj, nk, OPP[d]];
      if (!validDir(c[0], c[1], c[2], c[3])) return false;
      const void2 = isVoid(i, j, k) || isVoid(ni, nj, nk), p = c[3] >= 4 ? 0.13 : (isExpanse(i, j, k) || isExpanse(ni, nj, nk)) ? 0.04 : void2 ? 0.14 : 0.24;
      return H01(c[0], c[1], c[2], 130 + c[3]) < p;
    }
    // which of a room's four lanes a doorway or bridge uses, and where a staircase goes: shared by both sides
    const pairKey = (i, j, k, d) => d % 2 === 0 ? [i, j, k, d] : [i + DIRS[d][0], j + DIRS[d][1], k + DIRS[d][2], OPP[d]];
    const laneOf = (i, j, k, d) => { const p = pairKey(i, j, k, d); return H(p[0], p[1], p[2], 140 + p[3]) % 4; };
    function stairOf(i, j, k) { return { lane: 1 + (((j % 2) + 2) % 2), // the middle lanes, so doors in the side walls never face the side of a stair; and alternating, so a stair arrives and the next one leaves in different lanes
       z0: isSite(i, j + 1, k) ? PZ : 2 + H(i, j, k, 151) % 7 }; } // for the cell below the stair: 2..8, so there is always a metre of floor before the first step and after the last (a portal's starts at the back, so it can climb on to the surface)

    // ---------- the surface ----------
    // portals: now and then a cell of the plain has one; there is always one over the start
    const portalMemo = new Map();
    function portalAt(i, k) {
      if (i === 0 && k === 0) return true;
      const key = i + ',' + k, m = portalMemo.get(key); if (m !== undefined) return m;
      let v = i === 0 && k === 0 || H01(i, 0, k, 500) < 0.035;
      if (v) { // its twin must stand in the structure, with the cell under it, away from wells, drops and open air
        const [a, b, c] = siteOf(i, k);
        v = !isAir(a, b, c) && !isAir(a, b - 1, c) && !shaftCol(a, c, b) && !shaftCol(a, c, b - 1);
      }
      if (portalMemo.size > 60000) portalMemo.clear();
      portalMemo.set(key, v); return v;
    }
    // where a doorway's twin is: a shuffle of the plane that can be undone (two Feistel rounds), so any cell can tell
    // whether it holds a twin and whose. Up to 500 cells either way; an even level from 40 down to 2 (even, so the
    // stair under it rises in lane 2 and the stairs either side of it alternate as everywhere else)
    const F = (n, salt) => Math.floor(H01(n, 0, 0, salt) * 1001) - 500;
    function siteOf(i, k) { const a = i + F(k, 510), c = k + F(a, 511); return [a, 2 - 2 * Math.floor(H01(i, 0, k, 512) * 20), c]; }
    function siteA(a, j, c) { // the plain's doorway whose twin is at (a, j, c), or null
      if (j >= GJ - 1 || ((j % 2) + 2) % 2) return null;
      const k = c - F(a, 511), i = a - F(k, 510);
      return siteOf(i, k)[1] === j && portalAt(i, k) ? [i, k] : null;
    }
    const isSite = (a, j, c) => j < GJ - 1 && siteA(a, j, c) !== null;
    const PZ = 2; // where a portal's stair starts in the cell below the twin
    const portalLane = () => LANE(2);
    // the plain's height (voxel units, the height you stand at), smooth; flattened to SURF + 2 round each portal
    function terrainH(x, z) {
      let h = SURF + 2.5 + 1.2 * (noise(x / 48, 0, z / 48, 501) - 0.5) * 2 + 0.4 * (noise(x / 13, 0, z / 13, 502) - 0.5) * 2;
      const i = fdiv(Math.floor(x), CW), k = fdiv(Math.floor(z), CW);
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!portalAt(i + di, k + dk)) continue;
        const [x0, x1] = portalLane(i + di, k + dk), ox = (i + di) * CW, oz = (k + dk) * CW;
        const dx = Math.max(ox + x0 - 3 - x, 0, x - (ox + x1 + 4)), dz = Math.max(oz - z, 0, z - (oz + PZ + 12));
        const t = Math.min(1, Math.hypot(dx, dz) / 9), w = t * t * (3 - 2 * t);
        h = SURF + 2 + (h - SURF - 2) * w;
      }
      return Math.max(SURF + 1.1, h);
    }
    // where you stand on the plain, or null over a portal's stairwell
    function groundAt(x, z) {
      const i = fdiv(Math.floor(x), CW), k = fdiv(Math.floor(z), CW);
      return terrainH(x, z);
    }
    // a surface cell: a slab of rock under the plain (the structure's lid), and a portal where there is one: a trench
    // with walls, the top of the stair climbing out of the cell below, a landing at ground level, and the doorway
    // the doorway: two piers and a lintel, two deep, with a cold light along its inner edge (the same on both sides)
    function doorway(box, x0, x1, Z) {
      box(x0 - 1, x0 - 1, 1, 6, Z + 9, Z + 10, M.PILLAR); box(x1 + 1, x1 + 1, 1, 6, Z + 9, Z + 10, M.PILLAR); box(x0 - 1, x1 + 1, 6, 7, Z + 9, Z + 10, M.PILLAR);
      box(x0 - 1, x0 - 1, 2, 5, Z + 9, Z + 9, M.LIGHT); box(x1 + 1, x1 + 1, 2, 5, Z + 9, Z + 9, M.LIGHT); box(x0, x1, 6, 6, Z + 9, Z + 9, M.LIGHT);
    }
    // the crust (level GJ) is solid rock; the plain (level PJ) holds only the doorways
    function surfaceCell(i, j, k, g, box) {
      if (j === GJ) { box(0, CW - 1, 0, CH - 1, 0, CW - 1, M.CEIL); return g; }
      if (j === PJ && portalAt(i, k)) { const [x0, x1] = portalLane(); doorway(box, x0, x1, PZ); }
      return g;
    }
    // a twin doorway stamped into whatever cell holds it: the floor where the stair below arrives, a step, the landing
    // under the doorway, clear air through it, and the doorway
    function stampTwin(g) {
      const at = (x, y, z) => (y * CW + z) * CW + x, box = (x0, x1, y0, y1, z0, z1, m) => { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[at(x, y, z)] = m; };
      const [x0, x1] = portalLane(), Z = PZ;
      box(x0, x1, 1, 5, Z + 7, Z + 10, 0);
      box(x0, x1, 0, 0, Z + 7, Z + 10, M.BRIDGE); box(x0, x1, 1, 1, Z + 8, Z + 10, M.BRIDGE);
      doorway(box, x0, x1, Z);
      return g;
    }
    // A portal's doorway, wherever it is: the cell it is in, the opening (x0..x1, from y0 up h), its plane zP in the
    // middle of the doorway's depth, and where its other end is (to = [di, dj, dk] in cells)
    function frameIn(i, j, k) { const [x0, x1] = portalLane(); return { i, j, k, x0: i * CW + x0, x1: i * CW + x1 + 1, zP: k * CW + PZ + 10, y0: j * CH + 2, h: 4 }; }
    // the doorway on the plain at (i, k) and its twin; or the twin at cell (a, j, c) and its doorway on the plain
    function portalPair(i, k) { const [a, j, c] = siteOf(i, k); return { A: frameIn(i, PJ, k), B: frameIn(a, j, c), d: [(a - i) * CW, (j - PJ) * CH, (c - k) * CW] }; }
    function pairOfSite(a, j, c) { const p = siteA(a, j, c); return p ? portalPair(p[0], p[1]) : null; }
    // crossing a doorway's plane through its opening: from the front of the plain's (going -z) to its twin, and from
    // the front of a twin (going +z) back to the plain. Returns the move { d: [dx, dy, dz], a: [i, k], down } or null.
    function portalCross(ox, oy, oz, nx, ny, nz) {
      const i = fdiv(Math.floor(nx), CW), k = fdiv(Math.floor(nz), CW), j = fdiv(Math.floor(ny + 0.01), CH);
      if (j === PJ && portalAt(i, k)) {
        const P = portalPair(i, k), f = P.A;
        if (nx >= f.x0 && nx <= f.x1 && oz >= f.zP && nz < f.zP && ny >= f.y0 - 1 && ny < f.y0 + f.h) return { d: P.d, a: [i, k], down: true };
      }
      if (j < GJ && isSite(i, j, k)) {
        const P = pairOfSite(i, j, k), f = P.B;
        if (nx >= f.x0 && nx <= f.x1 && oz < f.zP && nz >= f.zP && ny >= f.y0 - 1 && ny < f.y0 + f.h) return { d: P.d.map(v => -v), a: siteA(i, j, k), down: false };
      }
      return null;
    }
    function surfaceSpawn() { const [x0, x1] = portalLane(0, 0), x = (x0 + x1 + 1) / 2, z = CW + 7.5; return { x, y: terrainH(x, z), z, yaw: 0 }; }
    const stairUp = (i, j, k) => roomAt(i, j, k) && link(i, j, k, 4);
    const linkedUp = (i, j, k) => link(i, j, k, 4); // a stair rises from this cell, whatever the two cells are

    // the inside of a block: tunnels, a warren, or a hall; halls hold the stairs and the wells, tunnels the narrow drops
    function variantOf(i, j, k) {
      if (i === 0 && j === 0 && k === 0) return 'open';
      if (wellCol(i, k, j)) return 'open';
      if (dropCol(i, k, j)) return 'tunnels';
      const D = districtOf(i, j, k), up = link(i, j, k, 4), down = link(i, j, k, 5);
      const r = H01(i, j, k, 160);
      if (D.type === 'catacombs') return up || down ? 'crypt' : 'catacomb';
      if (up || down) return r < 0.5 ? 'open' : 'pillars';
      if (D.type === 'terraces') return isVoid(i, j + 1, k) ? 'terrace' : r < 0.5 ? 'tunnels' : r < 0.8 ? 'warren' : 'open';
      if (D.type === 'colonnade') return r < 0.6 ? 'pillars' : 'open';
      if (D.type === 'expanse') return r < 0.45 ? 'tunnels' : r < 0.7 ? 'open' : 'warren';
      if (D.type === 'interior') return r < 0.34 ? 'tunnels' : r < 0.56 ? 'warren' : r < 0.78 ? 'open' : 'pillars';
      return r < 0.46 ? 'tunnels' : r < 0.72 ? 'warren' : r < 0.82 ? 'open' : 'pillars';
    }
    const clearVariant = v => v === 'open' || v === 'pillars';
    const DOORH = { tunnels: 3, warren: 3, open: 4, pillars: 4, terrace: 3, catacomb: 2, crypt: 3 };
    // a doorway can be widened into a colonnade between two open rooms
    function wide(i, j, k, d) {
      const p = pairKey(i, j, k, d), q = [p[0] + DIRS[p[3]][0], p[1] + DIRS[p[3]][1], p[2] + DIRS[p[3]][2]];
      return d < 4 && roomAt(p[0], p[1], p[2]) && roomAt(q[0], q[1], q[2]) && clearVariant(variantOf(p[0], p[1], p[2])) && clearVariant(variantOf(q[0], q[1], q[2])) && H01(p[0], p[1], p[2], 170 + p[3]) < 0.65;
    }
    const regionOf = (i, j, k) => { const D = districtOf(i, j, k), L = BIOME_PAL[D.type]; return L[H(D.bi, D.bj, D.bk, 180) % L.length]; };
    const lightOf = (i, j, k) => 1;
    function info(i, j, k) {
      const v = isVoid(i, j, k);
      return { i, j, k, void: v, variant: v ? null : variantOf(i, j, k), region: regionOf(i, j, k), light: lightOf(i, j, k), well: !v && wellCol(i, k, j), drop: !v && dropCol(i, k, j), site: j < GJ - 1 && isSite(i, j, k), air: isAir(i, j, k), biome: districtOf(i, j, k).type };
    }

    // ---------- the voxels of a cell ----------
    function genCell(i, j, k) { const g = genBase(i, j, k); return j < GJ - 1 && isSite(i, j, k) ? stampTwin(g) : g; }
    function genBase(i, j, k) {
      const g = new Uint8Array(CW * CH * CW), at = (x, y, z) => (y * CW + z) * CW + x;
      const put = (x, y, z, m) => { if (x >= 0 && x < CW && y >= 0 && y < CH && z >= 0 && z < CW) g[at(x, y, z)] = m; };
      const box = (x0, x1, y0, y1, z0, z1, m) => { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, m); };
      if (j >= GJ) return surfaceCell(i, j, k, g, box);
      const rng = (() => { let s = H(i, j, k, 200) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
      const links = [0, 1, 2, 3].map(d => link(i, j, k, d));
      const laneC = d => 2 + 4 * laneOf(i, j, k, d); // the lateral centre of the lane a doorway or walkway uses
      // every staircase is the same: an open flight of single slabs climbing one voxel a step through a hole in the level
      // above, in halls and out in the voids alike
      const flight = st => { const [x0, x1] = LANE(st.lane); for (let t = 0; t <= 6; t++) box(x0, x1, 1 + t, 1 + t, st.z0 + t, st.z0 + t, M.BRIDGE); };

      if (isVoid(i, j, k)) {
        const D = districtOf(i, j, k), up = link(i, j, k, 4), down = link(i, j, k, 5);
        // the faces of the structure that border this void: ribs and pipes against them, and a cornice at every level
        // (but obelisks stay bare)
        for (let d = 0; d < 4; d++) {
          if (isVoid(i + DIRS[d][0], j, k + DIRS[d][2]) || D.type === 'expanse' || isExpanse(i + DIRS[d][0], j, k + DIRS[d][2])) continue;
          const along = d < 2, near = d === 1 || d === 3; // the face is at x or z = 0 when the neighbour is on the minus side
          const cut = (a0, a1, n0, n1, y0, y1, m) => { // a box against the face: positions a (along the face), depth n from the face
            const [x0, x1] = along ? (near ? [n0, n1] : [CW - 1 - n1, CW - 1 - n0]) : [a0, a1], [z0, z1] = along ? [a0, a1] : (near ? [n0, n1] : [CW - 1 - n1, CW - 1 - n0]);
            box(x0, x1, y0, y1, z0, z1, m);
          };
          cut(0, CW - 1, 0, 1, CH - 1, CH - 1, M.TRIM);            // cornice
          if (H01(i, j, k, 300 + d) < 0.4) cut(0, CW - 1, 0, 0, 3, 3, M.TRIM); // and sometimes a ledge halfway
          [4, 8, 12].forEach((p, n) => { const r = H01(i, j, k, 310 + d * 3 + n); if (r < 0.34) cut(p, p, 0, 1, 1, CH - 2, M.PILLAR); else if (r < 0.62) cut(p, p, 1, 1, 1, CH - 2, M.TRIM); });
        }
        if (D.type === 'colonnade' && pillarCol(i, k) && !up && !down) {
          // a great pillar through every level, a ring around it where walkways meet, and a collar under the roof
          const nl = links.filter(Boolean).length;
          if (nl) for (let d = 0; d < 4; d++) {
            if (!links[d]) continue;
            const c = laneC(d);
            if (d === 0) box(8, CW - 1, 0, 0, c - 1, c + 1, M.BRIDGE); else if (d === 1) box(0, 8, 0, 0, c - 1, c + 1, M.BRIDGE);
            else if (d === 2) box(c - 1, c + 1, 0, 0, 8, CW - 1, M.BRIDGE); else box(c - 1, c + 1, 0, 0, 0, 8, M.BRIDGE);
            if (d < 2) box(7, 9, 0, 0, Math.min(c, 8) - 1, Math.max(c, 8) + 1, M.BRIDGE); else box(Math.min(c, 8) - 1, Math.max(c, 8) + 1, 0, 0, 7, 9, M.BRIDGE);
          }
          if (nl >= 2) { box(3, 13, 0, 0, 3, 13, M.BRIDGE); }
          box(5, 11, 0, CH - 1, 5, 11, M.PILLAR);
          if (D.lj === DY - 2) box(4, 12, CH - 2, CH - 1, 4, 12, M.TRIM);
          if (H01(i, j, k, 412) < 0.5) box(5, 11, 3, 3, 4, 4, M.TRIM);
          return g;
        }
        // a slender column, kept out of the lanes the walkways use (lanes never cover 4 or 12)
        if (H01(i, 0, k, 210) < 0.3 && D.type !== 'expanse') { const c = H(i, 0, k, 211) % 4, px = c & 1 ? 12 : 4, pz = c & 2 ? 12 : 4; box(px, px, 0, CH - 1, pz, pz, M.PILLAR); }
        if (links.some(Boolean) || up || down) {
          box(6, 10, 0, 0, 6, 10, M.BRIDGE); // the central platform
          for (let d = 0; d < 4; d++) {
            if (!links[d]) continue;
            const c = laneC(d), lo = Math.min(c, 8) - 1, hi = Math.max(c, 8) + 1;
            if (d < 2) { if (d === 0) box(8, CW - 1, 0, 0, c - 1, c + 1, M.BRIDGE); else box(0, 8, 0, 0, c - 1, c + 1, M.BRIDGE); box(7, 9, 0, 0, lo, hi, M.BRIDGE); }
            else { if (d === 2) box(c - 1, c + 1, 0, 0, 8, CW - 1, M.BRIDGE); else box(c - 1, c + 1, 0, 0, 0, 8, M.BRIDGE); box(lo, hi, 0, 0, 7, 9, M.BRIDGE); }
          }
        }
        if (up || down) {
          // a landing that every walkway here joins, a stair of single slabs up to the landing above, and the hole the
          // stair from below comes up through (the lanes alternate by level, so the two never meet)
          box(1, CW - 2, 0, 0, 1, CW - 2, M.BRIDGE);
          for (const [x, z] of [[1, 1], [1, CW - 2], [CW - 2, 1], [CW - 2, CW - 2]]) box(x, x, 1, 1, z, z, M.TRIM);
          if (down) { const st = stairOf(i, j - 1, k), [x0, x1] = LANE(st.lane); box(x0, x1, 0, 0, st.z0 + 4, st.z0 + 6, 0); }
          if (up) flight(stairOf(i, j, k));
        }
        return g;
      }

      const variant = variantOf(i, j, k), hall = variant === 'open' || variant === 'pillars';
      if (variant === 'terrace') {
        // an open stone shelf under the sky: the rock it is cut from rises behind it, the void falls away in front,
        // and monoliths stand on it (two rectangles inside the shelf never cut it in two)
        box(0, CW - 1, 0, 0, 0, CW - 1, M.FLOOR);
        for (let d = 0; d < 4; d++) {
          const nI = i + DIRS[d][0], nK = k + DIRS[d][2];
          if (isVoid(nI, j, nK) || variantOf(nI, j, nK) === 'terrace') continue;
          const lat = links[d] ? LANE(laneOf(i, j, k, d)) : null;
          for (let l = 0; l < CW; l++) for (let y = 1; y < CH; y++) {
            if (lat && l >= lat[0] && l <= lat[1] && y <= 3) continue; // a corridor cut into the rock
            if (d === 0) put(CW - 1, y, l, M.WALL); else if (d === 1) put(0, y, l, M.WALL); else if (d === 2) put(l, y, CW - 1, M.WALL); else put(l, y, 0, M.WALL);
          }
        }
        const nm = rng() < 0.75 ? 1 + (rng() < 0.5 ? 1 : 0) : 0;
        for (let n = 0; n < nm; n++) {
          const sx = 2 + Math.floor(rng() * 3), sz = 2 + Math.floor(rng() * 3), x0 = 4 + Math.floor(rng() * (10 - sx)), z0 = 4 + Math.floor(rng() * (10 - sz));
          box(x0, x0 + sx - 1, 1, 2 + Math.floor(rng() * 6), z0, z0 + sz - 1, M.PILLAR);
        }
        // the lip of the shelf where it falls away
        for (let d = 0; d < 4; d++) if (isVoid(i + DIRS[d][0], j, k + DIRS[d][2])) {
          if (d === 0) box(CW - 1, CW - 1, 0, 0, 0, CW - 1, M.TRIM); else if (d === 1) box(0, 0, 0, 0, 0, CW - 1, M.TRIM);
          else if (d === 2) box(0, CW - 1, 0, 0, CW - 1, CW - 1, M.TRIM); else box(0, CW - 1, 0, 0, 0, 0, M.TRIM);
        }
        return g;
      }
      if (hall) {
        // a big chamber: slabs and thin walls, a clear inside
        box(0, CW - 1, FLOORY, FLOORY, 0, CW - 1, M.FLOOR);
        box(0, CW - 1, CEILY, CEILY, 0, CW - 1, M.CEIL);
        box(0, 0, 1, CEILY - 1, 0, CW - 1, M.WALL); box(CW - 1, CW - 1, 1, CEILY - 1, 0, CW - 1, M.WALL);
        box(0, CW - 1, 1, CEILY - 1, 0, 0, M.WALL); box(0, CW - 1, 1, CEILY - 1, CW - 1, CW - 1, M.WALL);
        if (variant === 'pillars') { for (const x of [4, 8, 12]) for (const z of [4, 8, 12]) if (rng() < 0.75) box(x, x, 1, CEILY - 1, z, z, M.PILLAR); }
        // a few small lamps in the ceiling
        const roofOpen = isVoid(i, j + 1, k); for (const x of [2, 6, 10, 14]) for (const z of [2, 6, 10, 14]) if (rng() < 0.22 && !roofOpen) put(x, CEILY, z, M.LIGHT);
      } else {
        // solid structure, to be carved
        box(0, CW - 1, 0, CH - 1, 0, CW - 1, M.WALL);
        box(0, CW - 1, 0, 0, 0, CW - 1, M.FLOOR); box(0, CW - 1, CEILY, CEILY, 0, CW - 1, M.CEIL);
      }

      if (variant === 'tunnels') {
        // a star of tight corridors, two wide and three high, meeting at a small junction
        box(7, 9, 1, 3, 7, 9, 0);
        for (let d = 0; d < 4; d++) {
          if (!links[d]) continue;
          const c = laneC(d), z0 = Math.min(c, 7), z1 = Math.max(c + 1, 9);
          if (d < 2) { box(7, 9, 1, 3, z0, z1, 0); if (d === 0) box(9, CW - 1, 1, 3, c, c + 1, 0); else box(0, 7, 1, 3, c, c + 1, 0); }
          else { box(z0, z1, 1, 3, 7, 9, 0); if (d === 2) box(c, c + 1, 1, 3, 9, CW - 1, 0); else box(c, c + 1, 1, 3, 0, 7, 0); }
        }
        if (rng() < 0.6) put(8, 4, 8, M.LIGHT);
        if (dropCol(i, k, j)) { // a narrow drop through the floor and the ceiling at the junction
          if (dropHole(j)) box(7, 8, 0, 0, 7, 8, 0);
          if (dropHole(j + 1)) box(7, 8, 4, CEILY, 7, 8, 0);
        }
      } else if (variant === 'catacomb' || variant === 'crypt') {
        // passages one voxel wide and two high: each doorway's runs in from the wall, jogs sideways at a random depth
        // and meets the middle. A crypt (a cell with a stair) has a narrow stairwell down its middle instead of a
        // junction: x 4..12 (the stair lanes and the free columns 4, 8 and 12 either side of them, so it can always be
        // crossed), the full depth, and three high
        const crypt = variant === 'crypt', hgt = crypt ? 3 : 2;
        const cx = crypt ? null : 8;
        if (crypt) box(4, 12, 1, 4, 1, CW - 2, 0);
        else if (rng() < 0.18) { box(6, 10, 1, 3, 6, 10, 0); box(8, 8, 1, 3, 8, 8, M.PILLAR); } // a small ossuary round a pier
        else box(7, 9, 1, 2, 7, 9, 0);
        const run = []; // passage voxels, for the niches
        const cut = (x0, x1, z0, z1) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) { box(x, x, 1, hgt, z, z, 0); run.push([x, z]); } };
        for (let d = 0; d < 4; d++) {
          if (!links[d]) continue;
          const c = laneC(d), m = 2 + Math.floor(rng() * 4);
          if (crypt) { // straight to the stairwell's nearest free column (4 or 12) or, from the sides, along row 1 or 15
            if (d === 0) cut(CW - 1, 12, c, c); else if (d === 1) cut(0, 4, c, c);
            else if (d === 2) { cut(c, c, CW - 1, CW - 2); cut(c, c < 8 ? 4 : 12, CW - 2, CW - 2); } else { cut(c, c, 0, 1); cut(c, c < 8 ? 4 : 12, 1, 1); }
            continue;
          }
          if (d === 0) { cut(CW - 1, CW - 1 - m, c, c); cut(CW - 1 - m, CW - 1 - m, c, cx); cut(CW - 1 - m, cx, cx, cx); }
          else if (d === 1) { cut(0, m, c, c); cut(m, m, c, cx); cut(m, cx, cx, cx); }
          else if (d === 2) { cut(c, c, CW - 1, CW - 1 - m); cut(c, cx, CW - 1 - m, CW - 1 - m); cut(cx, cx, CW - 1 - m, cx); }
          else { cut(c, c, 0, m); cut(c, cx, m, m); cut(cx, cx, m, cx); }
        }
        if (!crypt) for (let n = 0; n < 2; n++) { // dead ends
          const dir = Math.floor(rng() * 4), len = 3 + Math.floor(rng() * 4);
          if (dir === 0) cut(9, 9 + len, 8, 8); else if (dir === 1) cut(7 - len, 7, 8, 8); else if (dir === 2) cut(8, 8, 9, 9 + len); else cut(8, 8, 7 - len, 7);
        }
        // burial niches: one-voxel recesses in the passage walls, at the floor or at head height; a few hold a light
        for (const [x, z] of run) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz; if (nx < 1 || nx > CW - 2 || nz < 1 || nz > CW - 2 || g[at(nx, 1, nz)] === 0 || g[at(nx, 2, nz)] === 0) continue;
          const r = rng(); if (r < 0.16) put(nx, 1 + (rng() < 0.5 ? 1 : 0), nz, r < 0.012 ? M.LIGHT : 0);
        }
        if (crypt) {
          if (linkedUp(i, j - 1, k)) { const st = stairOf(i, j - 1, k), [x0, x1] = LANE(st.lane); box(x0, x1, 0, 0, st.z0 + 4, st.z0 + 6, 0); }
          if (stairUp(i, j, k)) { const st = stairOf(i, j, k), [x0, x1] = LANE(st.lane); box(x0, x1, 5, 6, st.z0 - 1, st.z0 + 6, 0); box(x0, x1, CEILY, CEILY, st.z0 + 3, st.z0 + 6, 0); flight(st); }
        }
      } else if (variant === 'warren') {
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) box(1 + 4 * a, 3 + 4 * a, 1, 3, 1 + 4 * b, 3 + 4 * b, 0); // the small cells
        const seen = new Uint8Array(16), st = [0]; seen[0] = 1;
        const open = (a, b) => { const ax = a % 4, az = (a / 4) | 0, bx = b % 4, bz = (b / 4) | 0;
          if (ax !== bx) { const wx = 4 * Math.max(ax, bx), [z0, z1] = LANE(az); box(wx, wx, 1, 3, z0, z1, 0); } else { const wz = 4 * Math.max(az, bz), [x0, x1] = LANE(ax); box(x0, x1, 1, 3, wz, wz, 0); } };
        while (st.length) {
          const a = st[st.length - 1], ax = a % 4, az = (a / 4) | 0, nb = [];
          if (ax < 3) nb.push(a + 1); if (ax > 0) nb.push(a - 1); if (az < 3) nb.push(a + 4); if (az > 0) nb.push(a - 4);
          const free = nb.filter(b => !seen[b]);
          if (!free.length) { st.pop(); continue; }
          const b = free[Math.floor(rng() * free.length)]; seen[b] = 1; open(a, b); st.push(b);
        }
        for (let n = 0; n < 5; n++) { const a = Math.floor(rng() * 16), ax = a % 4, az = (a / 4) | 0, b = rng() < 0.5 ? (ax < 3 ? a + 1 : -1) : (az < 3 ? a + 4 : -1); if (b >= 0) open(a, b); }
        for (let n = 0; n < 3; n++) { const a = Math.floor(rng() * 16); put(2 + 4 * (a % 4), 4, 2 + 4 * ((a / 4) | 0), rng() < 0.5 ? M.LIGHT : M.WALL); }
      }

      if (hall) {
        // wells: a wide hole through the floor and the ceiling
        if (wellCol(i, k, j)) {
          if (wellHole(j)) box(6, 10, FLOORY, FLOORY, 6, 10, 0);
          if (wellHole(j + 1)) box(6, 10, CEILY, CEILY, 6, 10, 0);
        }
        // stairs up from this hall, and the hole they come through from the hall below
        if (stairUp(i, j, k)) {
          const s = stairOf(i, j, k), [x0, x1] = LANE(s.lane);
          box(x0, x1, CEILY, CEILY, s.z0 + 3, s.z0 + 6, 0); // headroom starts a step early
          flight(s);
        }
        if (linkedUp(i, j - 1, k)) { const s = stairOf(i, j - 1, k), [x0, x1] = LANE(s.lane); box(x0, x1, FLOORY, FLOORY, s.z0 + 4, s.z0 + 6, 0); }
      }

      // doorways in the walls
      for (let d = 0; d < 4; d++) {
        if (variant === 'tunnels' || variant === 'catacomb' || variant === 'crypt') continue; // their corridors are already cut through
        const nI = i + DIRS[d][0], nK = k + DIRS[d][2], nbVoid = isVoid(nI, j, nK), dh = DOORH[variant];
        const wall = (lat0, lat1, y0, y1) => { // carve a gap in wall d over the lateral range
          if (d === 0) box(CW - 1, CW - 1, y0, y1, lat0, lat1, 0); else if (d === 1) box(0, 0, y0, y1, lat0, lat1, 0);
          else if (d === 2) box(lat0, lat1, y0, y1, CW - 1, CW - 1, 0); else box(lat0, lat1, y0, y1, 0, 0, 0);
        };
        if (links[d]) {
          if (hall && wide(i, j, k, d)) { wall(1, CW - 2, 1, CEILY - 1); for (const p of [4, 8, 12]) { if (d === 0) box(CW - 1, CW - 1, 1, CEILY - 1, p, p, M.PILLAR); else if (d === 1) box(0, 0, 1, CEILY - 1, p, p, M.PILLAR); else if (d === 2) box(p, p, 1, CEILY - 1, CW - 1, CW - 1, M.PILLAR); else box(p, p, 1, CEILY - 1, 0, 0, M.PILLAR); } }
          else { const [a, b] = LANE(laneOf(i, j, k, d)); wall(a, b, 1, dh); }
        } else if (hall && nbVoid && !isExpanse(i, j, k)) { // slit windows onto the void
          for (let l = 0; l < 4; l++) if (H01(i, j, k, 220 + d * 4 + l) < 0.45) { const [a, b] = LANE(l); wall(a + 1, a + 1, 2, 5); }
        }
      }
      return g;
    }

    // ---------- voxel access ----------
    const cache = new Map();
    function cell(i, j, k) {
      const key = i + ',' + j + ',' + k; let c = cache.get(key);
      if (!c) { c = genCell(i, j, k); if (cache.size > 6000) { const first = cache.keys().next().value; cache.delete(first); } cache.set(key, c); }
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
    return { seed: S, GJ, PJ, SURF, PZ, portalPair, pairOfSite, siteOf, siteA, isSite, frameIn, portalCross, supportAt, portalAt, terrainH, groundAt, surfaceSpawn, biome: force, voidStair, towerCol, isAir, obeliskAt, isExpanse, districtOf, BIOMES, BIOME_NAMES, CW, CH, M, DIRS, PALETTES, info, link, isVoid, wellCol, dropCol, shaftCol, wellHole, dropHole, stairUp, stairOf, laneOf, variantOf, wide, parentDir, genCell, cell, voxel, spawn, regionOf, lightOf, LANE };
  }

  const api = { createWorld, GJ, CW, CH, MATERIALS: M, PALETTES, BIOMES, BIOME_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
