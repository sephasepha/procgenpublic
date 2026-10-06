// Dressing: example-driven tile WFC with structural context.
//
// Every cell of a finished layout has a context, read from the floor/wall pattern around it: a wall with
// floor below is a "south face", a floor with walls left and right is a "corridor", and so on (see classAt).
// Each biome has a tileset of 4x4 pixel tiles: a shared structural kit (faces, corners, thin walls, end
// caps, pillars, floor shadows, corridor edges) drawn in the biome's palette, plus the biome's own details.
// From hand-drawn example rooms we learn, for every tile:
//   * which contexts it appears in (so faces only go on faces, runners only in corridors, centrepieces
//     only in room centres),
//   * its orientation, inferred from context: write a tile's letter and it turns to face the right way,
//   * which tiles may sit next to it (strict tiles, like the pieces of a 2x2 centrepiece, keep exactly the
//     neighbours they had in the examples; other tiles may sit beside anything),
//   * how often it appears.
// A WFC pass then fills each layout cell with a tile that fits its context and its neighbours. In 3D the
// same rules would place modular meshes.
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  // ---------- context ----------
  // Floor cell: bits for walls to the N=1, E=2, S=4, W=8. Wall cell: bits for floor N/E/S/W.
  // Only when no side is set do the diagonals count (NE=16, SE=32, SW=64, NW=128), which tells inner
  // corners apart from open floor and deep rock. +256 marks a floor context.
  function classAt(walk, W, H, x, y) {
    const self = walk(x, y), other = c => c !== self;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : walk(xx, yy);
    let m = 0;
    for (let d = 0; d < 4; d++) if (other(at(x + DX[d], y + DY[d]))) m |= 1 << d;
    if (m === 0) {
      if (other(at(x + 1, y - 1))) m |= 16; if (other(at(x + 1, y + 1))) m |= 32;
      if (other(at(x - 1, y + 1))) m |= 64; if (other(at(x - 1, y - 1))) m |= 128;
    }
    return m | (self ? 256 : 0);
  }
  // rotate a context a quarter turn clockwise (N->E->S->W, NE->SE->SW->NW)
  function rotCls(c, r) {
    for (let k = 0; k < r; k++) {
      const o = c & 15, dg = (c >> 4) & 15;
      c = (c & 256) | (((o << 1) | (o >> 3)) & 15) | ((((dg << 1) | (dg >> 3)) & 15) << 4);
    }
    return c;
  }
  const FLOOR = 256;

  // ---------- the shared structural kit (palette roles: . , ; floor tones, k floor shadow,
  // # rock, w W wall tones, h lit wall lip, d crack) ----------
  // anchor = the context the tile is drawn for; rotated copies cover the other orientations.
  const KIT = {
    F: { px: ['....', '.,..', '....', '..,.'], walk: 1, spin: 1, name: 'Floor' },
    G: { px: ['.,..', '....', ',..,', '....'], walk: 1, spin: 1, name: 'Floor, worn' },
    X: { px: ['..;.', '.;..', '.;;.', '....'], walk: 1, spin: 1, w: 0.6, name: 'Floor, cracked' },
    K: { px: ['kkkk', ';...', '.,..', '....'], walk: 1, anchor: FLOOR | 1, name: 'Wall shadow' },
    L: { px: ['kkkk', 'k;..', 'k.,.', 'k...'], walk: 1, anchor: FLOOR | 9, name: 'Corner shadow' },
    C: { px: ['k..k', 'k.,k', 'k..k', 'k,.k'], walk: 1, anchor: FLOOR | 10, name: 'Corridor' },
    Z: { px: ['k..k', 'k..k', 'k.,k', 'kkkk'], walk: 1, anchor: FLOOR | 14, name: 'Dead end' },
    I: { px: ['k...', '....', '.,..', '....'], walk: 1, anchor: FLOOR | 128, name: 'Inner corner' },
    R: { px: ['####', '####', '####', '####'], walk: 0, name: 'Rock' },
    E: { px: ['wwWw', 'wwww', 'Wwww', 'wwwW'], walk: 0, name: 'Masonry' },
    A: { px: ['wWww', 'wwww', 'wwwW', 'hhhh'], walk: 0, anchor: 4, name: 'Wall face' },
    Y: { px: ['wwww', 'wWww', 'wwwW', 'hhhh'], walk: 0, anchor: 4, name: 'Wall face, plain' },
    S: { px: ['WwWw', 'wWwW', 'wwww', 'hhhh'], walk: 0, anchor: 4, w: 0.7, name: 'Wall face, coursed' },
    B: { px: ['wWdw', 'wwdW', 'wdww', 'hhhh'], walk: 0, anchor: 4, w: 0.5, name: 'Wall face, cracked' },
    Q: { px: ['wwwh', 'wWwh', 'wwwh', 'hhhh'], walk: 0, anchor: 6, name: 'Outer corner' },
    H: { px: ['hhhh', 'wwWw', 'wWww', 'hhhh'], walk: 0, anchor: 5, name: 'Thin wall' },
    J: { px: ['hhhh', 'wWwh', 'wwWh', 'hhhh'], walk: 0, anchor: 7, name: 'Wall end' },
    P: { px: ['hhhh', 'hwWh', 'hWwh', 'hhhh'], walk: 0, anchor: 15, name: 'Pillar' },
    D: { px: ['####', '####', '###w', '##wh'], walk: 0, anchor: 32, name: 'Inner corner' },
  };

  // split an 8x8 drawing into four 4x4 tiles: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right
  function quad(rows8, names, extra) {
    const out = {};
    [[0, 0], [4, 0], [0, 4], [4, 4]].forEach(([ox, oy], k) => {
      out[String(k + 1)] = { px: [0, 1, 2, 3].map(y => rows8[oy + y].slice(ox, ox + 4)), walk: 1, strict: 1, name: names, ...extra };
    });
    return out;
  }

  // ---------- biome tilesets: palette, details, example rooms ----------
  // Example rooms are grids of tile letters. Orientation is inferred, so a face letter on any wall
  // facing a floor turns to face it. Digits 1-4 are the quarters of a 2x2 centrepiece.
  const TILESETS = [
    { key: 'crypt', name: 'Garrison crypts',
      palette: { '.': '#8f8263', ',': '#837756', ';': '#6f6448', 'k': '#5e5440', '#': '#1c1e24', 'w': '#4d473a', 'W': '#3a352b', 'h': '#a89a74', 'd': '#24211b', 'v': '#14120e', 'b': '#e8dcc0', 'g': '#f0c75e', 'r': '#7a2e2a', 'R': '#a3423a' },
      tiles: {
        n: { px: ['wwww', 'wvvw', 'wvbw', 'hbbh'], walk: 0, anchor: 4, w: 1.4, name: 'Burial niche' },
        s: { px: ['wwww', 'wwgw', 'wwWw', 'hhhh'], walk: 0, anchor: 4, name: 'Sconce' },
        u: { px: ['krRk', 'krRk', 'krRk', 'krRk'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.3, name: 'Runner' },
        b: { px: ['.b..', '..,.', '...b', 'b...'], walk: 1, spin: 1, name: 'Bones' },
        t: { px: [',ww,', ',wW,', ',ww,', ',,,,'], walk: 1, name: 'Tomb slab' },
        ...quad(['...gg...', '.gg..gg.', '.g.rr.g.', 'g.r..r.g', 'g.r..r.g', '.g.rr.g.', '.gg..gg.', '...gg...'], 'Rose mosaic'),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAnsYAnAsnYAAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFFbFFGFFFbFFKARRRR',
         'AKFKPKFFFFKPKFKQAAAA',
         'AKFbKFFFFFFKFFFuuuuL',
         'AKFGFFF12FFFFFKQAAQC',
         'AKFFKFF34FFbFFKARRAC',
         'AKFKPKFtFFKPKGKARRAC',
         'AKFFKbFFFFGKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZCKCCCCCCCCCCCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
        ['RRRRRRRRRRRRR',
         'DnYAsAnAYAEsD',
         'ALuuuuuKCZHZA',
         'ACJHHHJCJHACA',
         'AKuuuuuKuLHCA',
         'ACQAAAAAQCJCA',
         'AZARRRRRALCLA',
         'DADRRRRRDAAAD'],
      ],
    },
    { key: 'breach', name: 'Breach',
      palette: { '.': '#2f6e62', ',': '#295f54', ';': '#245246', 'k': '#1e463c', '#': '#1c1e24', 'w': '#3b3e46', 'W': '#2e3037', 'h': '#5d6270', 'd': '#1f2126', 'm': '#5db7a3', 'x': '#7a6438', 'r': '#7a7f88', 'R': '#4e525a', 'f': '#c4f5b4', 'q': '#3f9a8a', 'Q': '#2c7a6c' },
      tiles: {
        m: { px: ['wwww', 'wwmw', 'wmmm', 'mmhm'], walk: 0, anchor: 4, w: 1.5, name: 'Moss' },
        t: { px: ['wxww', 'wxxw', 'wwxw', 'hxhx'], walk: 0, anchor: 4, name: 'Roots' },
        u: { px: ['r.R.', '.rr.', 'R..r', '.R.r'], walk: 1, spin: 1, w: 1.5, name: 'Rubble' },
        f: { px: ['..f.', '.f..', 'f..f', '....'], walk: 1, spin: 1, name: 'Glowing fungus' },
        c: { px: ['hrhh', 'rRwh', 'hwRr', 'hhrh'], walk: 0, anchor: 15, name: 'Broken pillar' },
        ...quad(['..qqqq..', '.qqQQqq.', 'qqQQQQqq', 'qQQQQQQq', 'qQQQQQQq', 'qqQQQQqq', '.qqQQqq.', '..qqqq..'], 'Pool'),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAmAtBmYAmtBAAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFuKFfFFuFKFFKARRRR',
         'AKFKcKFFuFKcKfKQAAAA',
         'AKfFKFuFFFFKFFFCCCCL',
         'AKFuFFF12FFFFFKQAAQC',
         'AKFFKFF34FfuFFKARRAC',
         'AKFKcKFuFFKPKuKARRAC',
         'AKFFKfFFFFuKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZCKCCCCCCCCCCCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
      ],
    },
    { key: 'foundry', name: 'Foundry works',
      palette: { '.': '#8c4521', ',': '#7c3c1c', ';': '#6a3216', 'k': '#5a2a12', '#': '#1c1e24', 'w': '#5e626b', 'W': '#41444b', 'h': '#9aa0aa', 'd': '#25272c', 'm': '#5e626b', 'M': '#41444b', 'o': '#ffb347', 'O': '#ff7a2f', 'r': '#cdd1d8', 'z': '#2e1a10', 'y': '#e8c547' },
      tiles: {
        f: { px: ['MmmM', 'mOOm', 'mooM', 'zooz'], walk: 0, anchor: 4, strict: 1, w: 1.5, name: 'Furnace' },
        g: { px: ['kkkk', 'zkzk', 'kzkz', 'zkzk'], walk: 1, anchor: FLOOR | 1, strict: 1, name: 'Heat grate' },
        r: { px: ['krrk', 'kzzk', 'krrk', 'kzzk'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.3, name: 'Rails' },
        s: { px: ['.z..', 'zoz.', '.z..', '....'], walk: 1, spin: 1, name: 'Slag' },
        p: { px: ['.zz.', 'z..z', 'z..z', '.zz.'], walk: 1, name: 'Floor plate' },
        y: { px: ['kkkk', 'yzyz', '....', '.,..'], walk: 1, anchor: FLOOR | 1, name: 'Hazard edge' },
        ...quad(['.zzzzzz.', 'zmmmmmmz', 'zmOooOmz', 'zmoOOomz', 'zmoOOomz', 'zmOooOmz', 'zmmmmmmz', '.zzzzzz.'], 'Crucible'),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAffAYffASffAADRRRR',
         'ALKggKyggKyggKLARRRR',
         'AKFFsFFpFFFKsFKARRRR',
         'AKFKPKFFFFKPKFKQAAAA',
         'AKFsKFFFFFFKFFFrrrrL',
         'AKFGFFF12FFFFFKQAAQC',
         'AKFFKFF34FFsFFKARRAC',
         'AKFKPKFpFFKPKGKARRAC',
         'AKFFKsFFFFGKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZrKrrrrrrrrrrCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
      ],
    },
    { key: 'ducts', name: 'Service ducts',
      palette: { '.': '#44508f', ',': '#3c4780', ';': '#333d6e', 'k': '#2c3560', '#': '#1c1e24', 'w': '#30395f', 'W': '#262e4e', 'h': '#5a679e', 'd': '#1b2140', 'p': '#8a93a8', 'P': '#5f6880', 'r': '#d65a5a', 'z': '#232a4a', 'q': '#5db7d6', 'Q': '#3f8fb0' },
      tiles: {
        i: { px: ['wwww', 'pppp', 'PPPP', 'hhhh'], walk: 0, anchor: 4, w: 2, name: 'Pipe run' },
        v: { px: ['wppw', 'prrp', 'PrrP', 'hhhh'], walk: 0, anchor: 4, w: 0.6, name: 'Valve' },
        g: { px: ['z.z.', '....', 'z.z.', '....'], walk: 1, spin: 1, name: 'Grating' },
        d: { px: ['kqQk', 'kqQk', 'kqQk', 'kqQk'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.25, name: 'Drain channel' },
        ...quad(['zzzzzzzz', 'zqqqqqqz', 'zqQQQQqz', 'zqQzzQqz', 'zqQzzQqz', 'zqQQQQqz', 'zqqqqqqz', 'zzzzzzzz'], 'Sump'),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAiivAiiAiivAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFFgFFFFFFgFFKARRRR',
         'AKFKPKFFFFKPKFKQAiiA',
         'AKFgKFFFFFFKFFFddddL',
         'AKFGFFF12FFFFFKQAAQC',
         'AKFFKFF34FFgFFKARRAC',
         'AKFKPKFgFFKPKGKARRAC',
         'AKFFKgFFFFGKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZdKddddddddddCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
      ],
    },
    { key: 'keep', name: 'Reliquary keep',
      palette: { '.': '#4f5e74', ',': '#46546a', ';': '#3e4a5e', 'k': '#363f52', '#': '#1c1e24', 'w': '#414a5b', 'W': '#363e4d', 'h': '#9aa6b8', 'd': '#2a303c', 'm': '#d8e0ec', 'M': '#aab4c4', 'g': '#e6c35c', 'r': '#a33a3a' },
      tiles: {
        b: { px: ['wwww', 'wrrw', 'wrrw', 'hrgh'], walk: 0, anchor: 4, w: 0.8, name: 'Banner' },
        g: { px: ['kkkk', 'gggg', '....', '..,,'], walk: 1, anchor: FLOOR | 1, name: 'Gold trim' },
        c: { px: ['krrk', 'krgk', 'krrk', 'kgrk'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.25, name: 'Carpet' },
        p: { px: ['gggg', 'gmMg', 'gMmg', 'gggg'], walk: 0, anchor: 15, name: 'Gilded pillar' },
        ...quad(['gggggggg', 'g.,..,.g', 'g,gggg,g', 'g.g..g.g', 'g.g..g.g', 'g,gggg,g', 'g.,..,.g', 'gggggggg'], 'Seal'),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAbYAbAYbASbAAADRRR',
         'ALgggggggggggggZARRR',
         'AKFFKFFFFFFKFFKQDRRR',
         'AKFKpKFFFFKpKFKQAbAA',
         'AKFFKFFFFFFKFFFccccL',
         'AKFFFFF12FFFFFKQAAQC',
         'AKFFKFF34FFKFFKARRAC',
         'AKFKpKFFFFKpKFKARRAC',
         'AKFFKFFFFFFKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJcJHHHHHHAAAQC',
         'RRRRAZcKcccccccccccK',
         'RRRRDAAAAAAAAAAAAAQZ'],
      ],
    },
  ];

  const rotPx = px => [0, 1, 2, 3].map(y => [0, 1, 2, 3].map(x => px[3 - x][y]).join(''));
  const rotGrid = g => { const H = g.length, W = g[0].length, out = []; for (let y = 0; y < W; y++) { const row = []; for (let x = 0; x < H; x++) row.push(g[H - 1 - x][y]); out.push(row); } return out; };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

  // ---------- learning from the examples ----------
  function learn(ts, tsIndex) {
    const tiles = { ...KIT, ...ts.tiles };
    const variants = [], index = {};
    Object.entries(tiles).forEach(([L, t]) => {
      let px = t.px; const seen = {};
      for (let r = 0; r < 4; r++) {
        if (r > 0 && t.anchor === undefined) { index[L + r] = index[L + 0]; continue; }
        const cls = t.anchor !== undefined ? rotCls(t.anchor, r) : null;
        const key = px.join('') + '|' + cls;
        if (seen[key] !== undefined) index[L + r] = seen[key];
        else { seen[key] = index[L + r] = variants.length; variants.push({ letter: L, r, px, walk: t.walk, cls, strict: !!t.strict, spin: !!t.spin, name: t.name, ts: tsIndex, bias: t.w || 1 }); }
        px = rotPx(px);
      }
    });
    const n = variants.length, K = Math.ceil(n / 32);
    const learned = [0, 1, 2, 3].map(() => variants.map(() => new Set()));
    const classesOf = variants.map(() => new Set()), weight = new Float64Array(n);
    const exampleIds = [], unplaced = [];
    ts.examples.forEach(ex => {
      // pad with rock so every drawn tile is learned with its full surroundings
      let grid = [Array(ex[0].length + 2).fill('R')].concat(ex.map(r => ['R', ...r.split(''), 'R']), [Array(ex[0].length + 2).fill('R')]);
      for (let k = 0; k < 4; k++) {
        const H = grid.length, W = grid[0].length;
        grid.forEach(row => row.forEach(L => { if (!tiles[L]) throw new Error(`${ts.key}: unknown tile "${L}"`); }));
        const walk = (x, y) => tiles[grid[y][x]].walk;
        const ids = grid.map((row, y) => row.map((L, x) => {
          const t = tiles[L];
          if (t.anchor === undefined) return index[L + 0];
          const c = classAt(walk, W, H, x, y);
          for (let r = 0; r < 4; r++) if (rotCls(t.anchor, r) === c) return index[L + r];
          if (k === 0) unplaced.push(`${L}@${x},${y}`);
          return index[L + 0];
        }));
        if (k === 0) exampleIds.push(ids.slice(1, -1).map(r => r.slice(1, -1)));
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const a = ids[y][x]; weight[a]++;
          if (x > 0 && y > 0 && x < W - 1 && y < H - 1) classesOf[a].add(classAt(walk, W, H, x, y));
          if (x + 1 < W) { const b = ids[y][x + 1]; learned[1][a].add(b); learned[3][b].add(a); }
          if (y + 1 < H) { const b = ids[y + 1][x]; learned[2][a].add(b); learned[0][b].add(a); }
        }
        grid = rotGrid(grid);
      }
    });
    const mask = list => { const m = new Uint32Array(K); list.forEach(t => m[t >> 5] |= 1 << (t & 31)); return m; };
    // adjacency: strict tiles keep exactly their example neighbours; everything else is free to meet
    const loose = variants.map((v, i) => i).filter(i => !variants[i].strict);
    const allow = [0, 1, 2, 3].map(d => variants.map((v, a) => {
      if (v.strict) return mask([...learned[d][a]]);
      const strictOk = variants.map((s, i) => i).filter(i => variants[i].strict && learned[(d + 2) & 3][i].has(a));
      return mask(loose.concat(strictOk));
    }));
    // structural kit tiles are always allowed in the context they are drawn for, so no context is ever
    // left with only strict pieces to choose from
    variants.forEach((v, i) => { if (KIT[v.letter] && v.cls !== null && !v.strict) classesOf[i].add(v.cls); });
    // contexts: which tiles may go in each context
    const byClass = new Map();
    classesOf.forEach((set, t) => set.forEach(c => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(t); }));
    const classMask = new Map(); byClass.forEach((list, c) => classMask.set(c, mask(list)));
    variants.forEach((v, i) => { if (!weight[i]) weight[i] = 0.3; weight[i] *= v.bias; });
    weight[index.F0] *= 3; weight[index.R0] *= 3;
    const pal = {}; Object.entries(ts.palette).forEach(([c, h]) => pal[c] = hexRgb(h));
    variants.forEach(v => {
      v.rgb = v.px.join('').split('').map(c => pal[c] || [255, 0, 255]);
      if (v.spin) { v.spins = [v.rgb]; let p = v.px; for (let r = 1; r < 4; r++) { p = rotPx(p); v.spins.push(p.join('').split('').map(c => pal[c] || [255, 0, 255])); } }
    });
    const fallback = { floor: index.F0, wall: index.E0, rock: index.R0 };
    return { ...ts, tiles, variants, n, K, allow, weight, classMask, fallback, index, exampleIds, unplaced, learned, classesOf };
  }
  const SETS = TILESETS.map(learn);
  const KMAX = Math.max(...SETS.map(s => s.K));
  const GTILES = [null], OFFSET = [];
  SETS.forEach(s => { OFFSET.push(GTILES.length); s.variants.forEach(v => GTILES.push(v)); });

  // ---------- the dressing WFC ----------
  // pass[i]: 1 floor / 0 wall; setOf[i]: tileset per cell. Returns global tile ids.
  function dress(pass, setOf, W, H, seed) {
    const N = W * H, KW = KMAX, dom = new Uint32Array(N * KW), rng = mulberry(seed);
    const walk = (x, y) => pass[y * W + x];
    const cls = new Uint16Array(N);
    const fallbackOf = i => { const s = SETS[setOf[i]]; return pass[i] ? s.fallback.floor : (cls[i] === 0 ? s.fallback.rock : s.fallback.wall); };
    const setSingle = (i, t) => { const o = i * KW; for (let w = 0; w < KW; w++) dom[o + w] = 0; dom[o + (t >> 5)] = 1 << (t & 31); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = classAt(walk, W, H, x, y); cls[i] = c;
      const m = SETS[setOf[i]].classMask.get(c);
      if (m) dom.set(m, i * KW); else setSingle(i, fallbackOf(i));
    }
    const count = i => { let n = 0; for (let w = 0; w < KW; w++) { let b = dom[i * KW + w]; while (b) { b &= b - 1; n++; } } return n; };
    const bits = (i, fn) => { for (let w = 0; w < KW; w++) { let b = dom[i * KW + w]; while (b) { const low = b & -b; fn(w * 32 + 31 - Math.clz32(low)); b ^= low; } } };
    const cache = SETS.map(() => [0, 1, 2, 3].map(() => new Map()));
    const allowedFrom = (s, d, i) => {
      const o = i * KW, key = KW === 1 ? dom[o] : Array.from(dom.subarray(o, o + KW)).join(',');
      let r = cache[s][d].get(key); if (r) return r;
      r = new Uint32Array(KW); const A = SETS[s].allow[d];
      bits(i, t => { const m = A[t]; for (let w = 0; w < m.length; w++) r[w] |= m[w]; });
      cache[s][d].set(key, r); return r;
    };
    let fallbacks = 0, backtracks = 0; const fallbackCells = [];
    let trail = null;
    const heap = [], ver = new Uint32Array(N);
    const entropy = i => {
      const wt = SETS[setOf[i]].weight; let sw = 0, swl = 0;
      bits(i, t => { const w = wt[t]; sw += w; swl += w * Math.log(w); });
      return Math.log(sw) - swl / sw + rng() * 1e-4;
    };
    function push(i) {
      if (count(i) <= 1) return;
      ver[i]++; heap.push([entropy(i), i, ver[i]]);
      let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    }
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
      return top;
    };
    // returns -1, or the cell that ran out of options
    const propagate = q => {
      while (q.length) {
        const i = q.pop(), s = setOf[i], x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (setOf[n] !== s) continue;
          const A = allowedFrom(s, d, i), o = n * KW;
          let changed = false, empty = true;
          for (let w = 0; w < KW; w++) { const nv = (dom[o + w] & A[w]) >>> 0; if (nv !== dom[o + w]) changed = true; if (nv) empty = false; }
          if (!changed) continue;
          if (empty) return n;
          if (trail) { trail.push(n); for (let w = 0; w < KW; w++) trail.push(dom[o + w]); }
          for (let w = 0; w < KW; w++) dom[o + w] &= A[w];
          q.push(n); push(n);
        }
      }
      return -1;
    };
    // first pass: make every cell agree with its neighbours; anything impossible falls back to a plain tile
    for (let guard = 0; guard < N; guard++) {
      const all = []; for (let i = 0; i < N; i++) all.push(i);
      const bad = propagate(all);
      if (bad < 0) break;
      setSingle(bad, fallbackOf(bad)); fallbacks++; fallbackCells.push(bad);
    }
    for (let i = 0; i < N; i++) push(i);
    while (heap.length) {
      const [, i, v] = pop();
      if (v !== ver[i] || count(i) <= 1) continue;
      const wt = SETS[setOf[i]].weight; let sw = 0;
      bits(i, t => { sw += wt[t]; });
      let r = rng() * sw, pick = -1;
      bits(i, t => { if (pick < 0) { r -= wt[t]; if (r <= 0) pick = t; } });
      if (pick < 0) bits(i, t => { pick = t; });
      const saved = Array.from(dom.subarray(i * KW, i * KW + KW));
      trail = [];
      setSingle(i, pick);
      const bad = propagate([i]);
      if (bad >= 0) {
        // undo this choice, rule it out here, and try again later
        backtracks++;
        const KS = KW + 1;
        for (let k = trail.length - KS; k >= 0; k -= KS) for (let w = 0; w < KW; w++) dom[trail[k] * KW + w] = trail[k + 1 + w];
        dom.set(saved, i * KW);
        dom[i * KW + (pick >> 5)] &= ~(1 << (pick & 31));
        trail = null;
        if (count(i) === 0) { setSingle(i, fallbackOf(i)); fallbacks++; }
        else push(i);
        continue;
      }
      trail = null;
    }
    const out = new Uint16Array(N);
    for (let i = 0; i < N; i++) { let t = -1; bits(i, b => { if (t < 0) t = b; }); out[i] = OFFSET[setOf[i]] + (t < 0 ? fallbackOf(i) : t); }
    // neighbouring pairs a strict tile never had in the examples (only possible after a fallback)
    let violations = 0;
    for (let i = 0; i < N; i++) {
      const x = i % W, s = setOf[i], a = out[i] - OFFSET[s], S = SETS[s];
      const ok = (d, b) => { const m = S.allow[d][a]; return (m[b >> 5] >>> (b & 31)) & 1; };
      if (x + 1 < W && setOf[i + 1] === s && !ok(1, out[i + 1] - OFFSET[s])) violations++;
      if (i + W < N && setOf[i + W] === s && !ok(2, out[i + W] - OFFSET[s])) violations++;
    }
    return { tiles: out, fallbacks, backtracks, violations, fallbackCells };
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // cheap per-cell hash for render-time variety (spin of plain floors, slight brightness jitter)
  function cellHash(x, y) { let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; }

  const api = { DRESS_SETS: SETS, DRESS_TILES: GTILES, DRESS_OFFSET: OFFSET, dress, classAt, rotCls, cellHash, DRESS_TILE_PX: 4 };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
