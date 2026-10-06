// Dressing: example-driven tile WFC.
//
// Each biome has a small hand-drawn tileset (4x4 pixel tiles) and a few example rooms built from it.
// From the examples we learn:
//   * the tiles, including rotated versions of directional ones (a niche facing south becomes four niches),
//   * which tile may sit next to which, in each direction (the "locality" of the examples),
//   * how often each tile appears (its weight).
// Then a WFC pass fills a sector's finished floor/wall layout with tiles: floor cells only take walkable
// tiles, wall cells only solid ones, and every neighbouring pair must have appeared side by side in an
// example. In a 3D engine the same learned rules would place modular meshes instead of pixel tiles.
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  // Every tileset has three base tiles: F (plain floor), E (plain wall) and R (deep rock). F and E may always
  // touch, E and R may always touch, which guarantees any layout can be filled (walls facing a floor are
  // always at least plain masonry, never bare rock). Everything else must follow the examples.
  // Tile fields: px = 4 rows of 4 palette chars, walk = 1 floor / 0 solid, rot = also use rotated copies,
  // w = weight bias on top of how often the tile appears in the examples.
  const TILESETS = [
    { // 0: Garrison crypts / Ossuary
      key: 'crypt', name: 'Garrison crypts',
      palette: { '.': '#8f8263', ',': '#837756', '#': '#22252c', 'w': '#4d473a', 'W': '#3a352b', 'b': '#e8dcc0', 'k': '#15130f', 'g': '#f0c75e', 'r': '#7a2e2a', 'R': '#a3423a' },
      tiles: {
        F: { px: ['....', '.,..', '....', '..,.'], walk: 1, name: 'Flagstones' },
        R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
        E: { px: ['wwWw', 'wwww', 'Wwww', 'wwwW'], walk: 0, name: 'Masonry' },
        N: { px: ['wwww', 'wkkw', 'wkbw', 'wbbw'], walk: 0, rot: 1, w: 2, name: 'Burial niche' },
        C: { px: ['wwww', 'wwww', 'wwgw', 'wwWw'], walk: 0, rot: 1, w: 1.5, name: 'Sconce' },
        B: { px: ['.b..', '..,.', '...b', 'b...'], walk: 1, name: 'Scattered bones' },
        U: { px: ['.rR.', '.rR.', '.rR.', '.rR.'], walk: 1, rot: 1, name: 'Runner' },
        T: { px: [',ww,', ',wW,', ',ww,', ',,,,'], walk: 1, name: 'Tomb slab' },
      },
      examples: [
        ['RRRRRRRRRRRRRR',
         'RNECNENNECENNR',
         'EFFFFUFFFFFFFE',
         'EFBFFUFFFTFFFE',
         'EFFFFUFFFFFBFE',
         'EFFTFUFFFFFFFE',
         'EFFFFUFFFBFFFE',
         'REEEEUEEEEEEER',
         'RRRREUERRRRRRR',
         'RRRREUERRRRRRR'],
        ['RRRRRRRRRR',
         'RNEENCENER',
         'EFFFBFFFFE',
         'ENECENEEFE',
         'EFFFFFFBFE',
         'EEEEEFEEEE',
         'RRRREFERRR'],
      ],
    },
    { // 1: Breach / Fungal caverns
      key: 'breach', name: 'Breach',
      palette: { '.': '#2f6e62', ',': '#295f54', '#': '#22252c', 'r': '#7a7f88', 'R': '#4e525a', 'm': '#5db7a3', 'f': '#c4f5b4', 'x': '#7a6438', 'c': '#3b3e46', 'C': '#2e3037' },
      tiles: {
        F: { px: ['....', '.,..', '..,.', '....'], walk: 1, name: 'Damp floor' },
        R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
        E: { px: ['cccC', 'cCcc', 'ccCc', 'Cccc'], walk: 0, name: 'Cracked wall' },
        M: { px: ['cccc', 'cCcc', 'cmcm', 'mmmm'], walk: 0, rot: 1, name: 'Moss' },
        T: { px: ['cxcc', 'cxxc', 'ccxc', 'cxcx'], walk: 0, rot: 1, name: 'Roots' },
        U: { px: ['r.R.', '.rr.', 'R..r', '.R.r'], walk: 1, name: 'Rubble' },
        Q: { px: ['..f.', '.f..', 'f..f', '....'], walk: 1, name: 'Glowing fungus' },
      },
      examples: [
        ['RRRRRRRRRRRR',
         'RRMMTMRRMMRR',
         'EUFFQFFFFUFE',
         'EFUFFFQFUUFE',
         'EFFFUFFFFFQE',
         'ETMMEFFFMMTE',
         'EFQFFFUFFFFE',
         'EEEEEFEEEEEE'],
      ],
    },
    { // 2: Foundry works / Dwarven forge
      key: 'foundry', name: 'Foundry works',
      palette: { '.': '#8c4521', ',': '#7c3c1c', '#': '#22252c', 'm': '#5e626b', 'M': '#41444b', 'o': '#ffb347', 'O': '#ff7a2f', 'r': '#cdd1d8', 'k': '#1a1210', 'g': '#4e2513' },
      tiles: {
        F: { px: ['....', '..,.', '.,..', '....'], walk: 1, name: 'Packed floor' },
        R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
        E: { px: ['mMmm', 'mmmM', 'Mmmm', 'mmMm'], walk: 0, name: 'Plated wall' },
        O: { px: ['MmmM', 'mOOm', 'mooM', 'kook'], walk: 0, rot: 1, w: 1.5, name: 'Furnace' },
        V: { px: ['gkgk', 'kgkg', 'gkgk', 'kgkg'], walk: 1, name: 'Heat grate' },
        L: { px: ['r..r', 'rkkr', 'r..r', 'rkkr'], walk: 1, rot: 1, name: 'Rails' },
        S: { px: ['.k..', 'kok.', '.k..', '....'], walk: 1, name: 'Slag' },
        G: { px: ['.mm.', 'm..m', 'm..m', '.mm.'], walk: 1, name: 'Floor plate' },
      },
      examples: [
        ['RRRRRRRRRRRRRR',
         'REOOEEOOEEOOER',
         'EFVVFFVVFFVVFE',
         'EFFFFLFFFFFSFE',
         'EFSFFLFFGFFFFE',
         'EFFFFLFFFSFFFE',
         'EFGFFLFFFFFGFE',
         'REEEELEEEEEEER',
         'RRRRELERRRRRRR'],
      ],
    },
    { // 3: Service ducts / Sunken warrens
      key: 'ducts', name: 'Service ducts',
      palette: { '.': '#44508f', ',': '#3c4780', '#': '#22252c', 'p': '#8a93a8', 'P': '#5f6880', 'v': '#d65a5a', 'g': '#2b3150', 'w': '#5db7d6', 'W': '#3f8fb0', 's': '#30395f', 'S': '#262e4e' },
      tiles: {
        F: { px: ['....', '.,..', '....', '...,'], walk: 1, name: 'Duct floor' },
        R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
        E: { px: ['ssss', 'sSss', 'ssss', 'sssS'], walk: 0, name: 'Duct wall' },
        I: { px: ['ssss', 'ssss', 'pppp', 'PPPP'], walk: 0, rot: 1, w: 2, name: 'Pipe run' },
        X: { px: ['ssss', 'spps', 'pvvp', 'PvvP'], walk: 0, rot: 1, w: 0.7, name: 'Valve' },
        G: { px: ['g.g.', '....', 'g.g.', '....'], walk: 1, name: 'Grating' },
        D: { px: ['.wW.', '.wW.', '.wW.', '.wW.'], walk: 1, rot: 1, name: 'Drain channel' },
      },
      examples: [
        ['RRRRRRRRRRRR',
         'RIIXIIIIXIIR',
         'EFFFFDFFFFFE',
         'EFGFFDFFFGFE',
         'EFFFFDFFFFFE',
         'EIIIEDEIIXIE',
         'EFFFFDFFFFFE',
         'EEEEEDEEEEEE',
         'RRRREDERRRRR'],
      ],
    },
    { // 4: Reliquary keep
      key: 'keep', name: 'Reliquary keep',
      palette: { '.': '#4f5e74', ',': '#46546a', '#': '#22252c', 'm': '#414a5b', 'M': '#363e4d', 'p': '#d8e0ec', 'P': '#aab4c4', 'g': '#e6c35c', 'r': '#a33a3a', 'k': '#1b1f28' },
      tiles: {
        F: { px: ['..,,', '..,,', ',,..', ',,..'], walk: 1, name: 'Chequered floor' },
        R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
        E: { px: ['MmMm', 'mmmm', 'mMmM', 'mmmm'], walk: 0, name: 'Marble wall' },
        P: { px: ['kppk', 'ppPp', 'pPpp', 'kppk'], walk: 0, name: 'Pillar' },
        B: { px: ['MmmM', 'mrrm', 'mrrm', 'krgk'], walk: 0, rot: 1, w: 0.5, name: 'Banner' },
        L: { px: ['gggg', '....', '..,,', ',,..'], walk: 1, rot: 1, name: 'Gold trim' },
        C: { px: ['rrrr', 'rgrr', 'rrrr', 'rrgr'], walk: 1, name: 'Carpet' },
      },
      examples: [
        ['RRRRRRRRRRRRRR',
         'REBEEBEEBEEBER',
         'ELLLLLLLLLLLLE',
         'EFFFFFCCFFFFFE',
         'EFPFFFCCFFFPFE',
         'EFFFFFCCFFFFFE',
         'EFPFFFCCFFFPFE',
         'EFFFFFCCFFFFFE',
         'REEEEECCEEEEER',
         'RRRRRECCERRRRR'],
      ],
    },
  ];

  const rotPx = px => [0, 1, 2, 3].map(y => [0, 1, 2, 3].map(x => px[3 - x][y]).join(''));
  const rotGrid = g => { const H = g.length, W = g[0].length, out = []; for (let y = 0; y < W; y++) { let row = []; for (let x = 0; x < H; x++) row.push(g[H - 1 - x][y]); out.push(row); } return out; };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

  // ---------- learning from the examples ----------
  function learn(ts, tsIndex) {
    const variants = [], index = {};
    Object.entries(ts.tiles).forEach(([L, t]) => {
      let px = t.px; const seen = {};
      for (let r = 0; r < 4; r++) {
        if (r > 0 && !t.rot) { index[L + r] = index[L + 0]; continue; }
        const k = px.join('');
        if (seen[k] !== undefined) index[L + r] = seen[k];
        else { seen[k] = index[L + r] = variants.length; variants.push({ letter: L, r, px, walk: t.walk, name: t.name, ts: tsIndex }); }
        px = rotPx(px);
      }
    });
    const n = variants.length;
    if (n > 32) throw new Error(`tileset ${ts.key} has ${n} variants; 32 is the limit`);
    const allow = [0, 1, 2, 3].map(() => new Uint32Array(n));
    const weight = new Float64Array(n), pairs = [0, 1, 2, 3].map(() => new Uint32Array(n * n));
    ts.examples.forEach(ex => {
      let grid = ex.map(r => r.split(''));
      for (let k = 0; k < 4; k++) {
        const H = grid.length, W = grid[0].length;
        const id = (x, y) => { const L = grid[y][x], v = index[L + k]; if (v === undefined) throw new Error(`unknown tile ${L} in ${ts.key}`); return v; };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const a = id(x, y); weight[a]++;
          if (x + 1 < W) { const b = id(x + 1, y); allow[1][a] |= 1 << b; allow[3][b] |= 1 << a; pairs[1][a * n + b]++; }
          if (y + 1 < H) { const b = id(x, y + 1); allow[2][a] |= 1 << b; allow[0][b] |= 1 << a; pairs[2][a * n + b]++; }
        }
        grid = rotGrid(grid);
      }
    });
    const F = index.F0, E = index.E0, R = index.R0;
    for (let d = 0; d < 4; d++) {
      allow[d][F] |= (1 << F) | (1 << E); allow[d][E] |= (1 << F) | (1 << E) | (1 << R); allow[d][R] |= (1 << E) | (1 << R);
    }
    const walkMask = [0, 0];
    variants.forEach((v, i) => { walkMask[v.walk] |= 1 << i; if (!weight[i]) weight[i] = 0.5; const b = ts.tiles[v.letter].w; if (b) weight[i] *= b; });
    // plain floor and rock dominate real layouts far more than the examples: lift them so detail stays an accent
    weight[F] *= 3; weight[R] *= 3;
    const pal = {}; Object.entries(ts.palette).forEach(([c, h]) => pal[c] = hexRgb(h));
    variants.forEach(v => { v.rgb = v.px.join('').split('').map(c => pal[c] || [255, 0, 255]); });
    return { ...ts, variants, n, allow, weight, walkMask, base: [E, F], pairs, index };
  }
  const SETS = TILESETS.map(learn);
  // global tile ids (0 = none), so a sector can mix tilesets
  const GTILES = [null], OFFSET = [];
  SETS.forEach(s => { OFFSET.push(GTILES.length); s.variants.forEach(v => GTILES.push(v)); });

  // ---------- the dressing WFC ----------
  // pass[i]: 1 walkable / 0 solid; setOf[i]: which tileset each cell uses. Returns global tile ids.
  function dress(pass, setOf, W, H, seed) {
    const N = W * H, dom = new Uint32Array(N), rng = mulberry(seed);
    for (let i = 0; i < N; i++) dom[i] = SETS[setOf[i]].walkMask[pass[i]];
    const cache = SETS.map(() => [0, 1, 2, 3].map(() => new Map()));
    const allowed = (s, d, m) => {
      const c = cache[s][d]; let r = c.get(m); if (r !== undefined) return r;
      r = 0; const A = SETS[s].allow[d];
      for (let b = m; b; b &= b - 1) r |= A[31 - Math.clz32(b & -b)];
      c.set(m, r); return r;
    };
    let fallbacks = 0;
    const heap = [], ver = new Uint32Array(N);
    const entropy = (i) => {
      const s = SETS[setOf[i]], wt = s.weight; let sw = 0, swl = 0;
      for (let b = dom[i]; b; b &= b - 1) { const w = wt[31 - Math.clz32(b & -b)]; sw += w; swl += w * Math.log(w); }
      return Math.log(sw) - swl / sw + rng() * 1e-4;
    };
    const push = i => {
      if ((dom[i] & (dom[i] - 1)) === 0) return; // already decided
      ver[i]++; heap.push([entropy(i), i, ver[i]]);
      let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
      return top;
    };
    const propagate = q => {
      while (q.length) {
        const i = q.pop(), s = setOf[i], x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (setOf[n] !== s) continue; // different tilesets don't constrain each other
          const nd = dom[n] & allowed(s, d, dom[i]);
          if (nd === dom[n]) continue;
          if (nd === 0) { dom[n] = 1 << SETS[s].base[pass[n]]; fallbacks++; continue; } // contradiction: plain base tile
          dom[n] = nd; q.push(n); push(n);
        }
      }
    };
    const all = []; for (let i = 0; i < N; i++) all.push(i);
    propagate(all);
    for (let i = 0; i < N; i++) push(i);
    while (heap.length) {
      const [, i, v] = pop();
      if (v !== ver[i] || (dom[i] & (dom[i] - 1)) === 0) continue;
      const wt = SETS[setOf[i]].weight; let sw = 0;
      for (let b = dom[i]; b; b &= b - 1) sw += wt[31 - Math.clz32(b & -b)];
      let r = rng() * sw, pick = 0;
      for (let b = dom[i]; b; b &= b - 1) { const t = 31 - Math.clz32(b & -b); pick = t; r -= wt[t]; if (r <= 0) break; }
      dom[i] = 1 << pick;
      propagate([i]);
    }
    const out = new Uint16Array(N);
    let violations = 0;
    for (let i = 0; i < N; i++) {
      const m = dom[i], t = m ? 31 - Math.clz32(m & -m) : SETS[setOf[i]].base[pass[i]];
      out[i] = OFFSET[setOf[i]] + t;
    }
    // count neighbouring pairs that never appeared together in an example (only possible after a fallback)
    for (let i = 0; i < N; i++) {
      const x = i % W, s = setOf[i], a = out[i] - OFFSET[s];
      if (x + 1 < W && setOf[i + 1] === s && !(SETS[s].allow[1][a] >> (out[i + 1] - OFFSET[s]) & 1)) violations++;
      if (i + W < N && setOf[i + W] === s && !(SETS[s].allow[2][a] >> (out[i + W] - OFFSET[s]) & 1)) violations++;
    }
    return { tiles: out, fallbacks, violations };
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const api = { DRESS_SETS: SETS, DRESS_TILES: GTILES, DRESS_OFFSET: OFFSET, dress, DRESS_TILE_PX: 4 };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
