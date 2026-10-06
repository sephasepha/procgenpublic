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

  // split a 2N x 2N drawing into four N x N tiles: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right
  function quad(rows, names, extra) {
    const out = {}, N = rows.length / 2;
    [[0, 0], [N, 0], [0, N], [N, N]].forEach(([ox, oy], k) => {
      out[String(k + 1)] = { px: rows.slice(oy, oy + N).map(r => r.slice(ox, ox + N)), walk: 1, strict: 1, name: names, ...extra };
    });
    return out;
  }

  // ---------- the 8x8 structural kit (palette roles: . , : floor tones, ; floor crack, k K floor shadow,
  // x wall top, w wall top joints, W wall face, h lit edge, H contact shadow, d crack,
  // # rock or void, + and * faint and bright specks in the void) ----------
  const KIT8 = {
    F: { px: ['........', '.,......', '......:.', '...,....', '........', '.:....,.', '........', '....,...'], walk: 1, spin: 1, name: 'Floor' },
    G: { px: ['..,,....', '.,......', '........', '.....::.', '........', ',.......', '.......,', '...,....'], walk: 1, spin: 1, name: 'Floor, worn' },
    X: { px: ['...;....', '...;;...', '....;...', '...;.;..', '..;...;.', '........', '.,......', '......,.'], walk: 1, spin: 1, w: 0.6, name: 'Floor, cracked' },
    K: { px: ['KKKKKKKK', 'kkkkkkkk', '.k.k.k.k', '........', '.,......', '......:.', '........', '...,....'], walk: 1, anchor: FLOOR | 1, name: 'Wall shadow' },
    L: { px: ['KKKKKKKK', 'Kkkkkkkk', 'Kk.k.k.k', 'Kk......', 'Kk.,....', 'Kk....:.', 'Kk......', 'Kk..,...'], walk: 1, anchor: FLOOR | 9, name: 'Corner shadow' },
    C: { px: ['Kk....kK', 'Kk.,..kK', 'Kk....kK', 'Kk..:.kK', 'Kk....kK', 'Kk.,..kK', 'Kk....kK', 'Kk...,kK'], walk: 1, anchor: FLOOR | 10, name: 'Corridor' },
    Z: { px: ['Kk....kK', 'Kk.,..kK', 'Kk....kK', 'Kk..:.kK', 'Kk....kK', 'Kk.,..kK', 'Kkkkkkkk', 'KKKKKKKK'], walk: 1, anchor: FLOOR | 14, name: 'Dead end' },
    I: { px: ['Kk......', 'k.......', '........', '...,....', '........', '.:....,.', '........', '....,...'], walk: 1, anchor: FLOOR | 128, name: 'Inner corner' },
    R: { px: ['########', '#+######', '#####*##', '########', '###+####', '########', '######+#', '#*######'], walk: 0, spin: 1, name: 'Void' },
    E: { px: ['xxwxxxwx', 'xwxxwxxx', 'wxxxxxwx', 'xxxwxxxx', 'xwxxxwxx', 'xxxxwxxx', 'wxwxxxxw', 'xxxxxwxx'], walk: 0, name: 'Masonry' },
    A: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxxwxxxw', 'hhhhhhhh', 'WWdWWWWW', 'WWWWWdWW', 'WdWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 4, name: 'Wall face' },
    Y: { px: ['xxxxxxxx', 'xxwxxxxx', 'xxxxxwxx', 'hhhhhhhh', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 4, name: 'Wall face, plain' },
    S: { px: ['xwxxwxxw', 'xxxxxxxx', 'wxxwxxwx', 'hhhhhhhh', 'WdWWdWWd', 'WWWWWWWW', 'dWWdWWdW', 'HHHHHHHH'], walk: 0, anchor: 4, w: 0.7, name: 'Wall face, coursed' },
    B: { px: ['xwxxxwxx', 'xxwxdxwx', 'wxxddxxw', 'hhhdhhhh', 'WWWdWWWW', 'WWdWdWWW', 'WdWWWdWW', 'HHHHHHHH'], walk: 0, anchor: 4, w: 0.5, name: 'Wall face, cracked' },
    Q: { px: ['xxxxxhWH', 'xwxxxhWH', 'xxxwxhWH', 'xxxxxhWH', 'xwxxxhWH', 'hhhhhhWH', 'WWWWWWWH', 'HHHHHHHH'], walk: 0, anchor: 6, name: 'Outer corner' },
    H: { px: ['hhhhhhhh', 'xxwxxxwx', 'xwxxwxxx', 'hhhhhhhh', 'WWWWWWWW', 'WdWWWWdW', 'WWWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 5, name: 'Thin wall' },
    J: { px: ['hhhhhhhH', 'xxwxxxhW', 'xwxxxxhW', 'hhhhhhhW', 'WWWWWWWW', 'WWdWWWWW', 'WWWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 7, name: 'Wall end' },
    P: { px: ['KhhhhhhK', 'hxxwxxxh', 'hxwxxwxh', 'hxxxxxxh', 'hhhhhhhh', 'WWWdWWWW', 'WWWWWWWW', 'KHHHHHHK'], walk: 0, anchor: 15, name: 'Pillar' },
    D: { px: ['########', '########', '########', '########', '####xxxx', '####xwxx', '####xxhh', '####xxhW'], walk: 0, anchor: 32, name: 'Inner corner' },
  };

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
    // ---------- the Labyrinthine Underdark: 8x8 strata ----------
    { key: 'mazes', name: 'Constellation of Mazes', size: 8,
      palette: { '.': '#8c93a8', ',': '#7e859b', ':': '#a3aabd', ';': '#5f6680', 'k': '#6d7389', 'K': '#565c72', 'w': '#6b7894', 'x': '#8a97b3', 'W': '#4a5571', 'h': '#b4c0da', 'H': '#2c3349', 'd': '#353d56', '#': '#10142a', '+': '#3a4470', '*': '#cfd8ff', 'g': '#6fe0a0', 'G': '#2f8f5f', 'o': '#d9a441', 'O': '#a8742a', 'm': '#a9b2cb', 'n': '#5c6684', 'b': '#c9b37a', 'c': '#e9e2ff', 'e': '#8fb4ff', 'u': '#4f6fd0', 'f': '#2f3f8f', 'i': '#ffd86b', 'y': '#fff2b0', 'l': '#ccd3e6', 's': '#7a819a', 't': '#4b516b' },
      tiles: {
        r: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxxwxxxw', 'hhhhhhhh', 'WnnnWnnW', 'WnWnnnWW', 'WnnWWnnW', 'HHHHHHHH'], walk: 0, anchor: 4, w: 3, name: 'Maze relief' },
        e: { px: ['xwxxxwxx', 'xxWWWWxx', 'xWnggnWx', 'hWgGGgWh', 'WWnggnWW', 'WWWWWWWW', 'WdWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 4, w: 0.6, glow: '#6fe0a0', name: 'Watching eye' },
        u: { px: ['Kk.mm.kK', 'Kk.n..kK', 'Kk.mm.kK', 'Kk..n.kK', 'Kk.mm.kK', 'Kk.n..kK', 'Kk.mm.kK', 'Kk..n.kK'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.3, name: 'Engraved path' },
        l: { px: ['........', '..o.....', '.oO.....', '......o.', '.....Oo.', '........', '..o.....', '........'], walk: 1, spin: 1, name: 'Gold leaves' },
        c: { px: ['..mmmm..', '.m....m.', 'm..nn..m', 'm.n..n.m', 'm.n..n.m', 'm..nn..m', '.m....m.', '..mmmm..'], walk: 1, name: 'Engraved ring' },
        // set dressing: like-tiles go wherever their source tile was learned
        q: { px: ['........', '.nnnnnn.', '.n....n.', '.n.,..n.', '.n....n.', '.n..:.n.', '.nnnnnn.', '........'], walk: 1, like: 'F', share: 0.08, spin: 1, name: 'Inlaid square' },
        j: { px: ['........', '....m...', '...mnm..', '..mn*nm.', '...mnm..', '....m...', '.,......', '......:.'], walk: 1, like: 'F', share: 0.06, spin: 1, name: 'Star inlay' },
        z: { px: ['........', '.s......', '.t..l...', '....st..', '.l......', '......s.', '..st..t.', '........'], walk: 1, like: 'F', share: 0.1, spin: 1, name: 'Pebbles' },
        a: { px: ['..obbo..', '.o.ll.o.', 'o.lssl.o', 'o.sllt.o', '.o.tt.o.', '..oOOo..', '..tsst..', '.KKKKKK.'], walk: 1, like: 'F', share: 0.025, name: 'Orrery' },
        b: { px: ['........', '..llls..', '.lslsst.', '.lnlnst.', '.lsssst.', '..ltst..', '.KKKKK..', '........'], walk: 1, like: 'F', share: 0.03, name: 'Fallen head' },
        v: { px: ['........', '....c...', '..c.ce..', '.cec.ec.', '.eeu.ue.', '..uuuu..', '.KKKKKK.', '........'], walk: 1, like: 'F', share: 0.03, glow: '#9fd0ff', name: 'Crystal cluster' },
        t: { px: ['...ii...', '..iyyi..', '..iyyi..', '...tt...', '...st...', '...st...', '..tsst..', '..KKKK..'], walk: 1, like: 'F', share: 0.02, glow: '#ffd86b', name: 'Lantern' },
        f: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxxwxxxw', 'hhhhhhhh', 'WnnnnnnW', 'WnWWWWnW', 'WnnnWnnW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.35, name: 'Glyph relief' },
        i: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxfffxxw', 'hhfofhhh', 'WWfffWWW', 'WWfofWWW', 'WWfffWWW', 'HHHfHHHH'], walk: 0, like: 'A', share: 0.12, name: 'Star banner' },
        k: { px: ['xwxxxwxx', 'xxwx*xwx', 'wxxw*xxw', 'hhhh*hhh', 'WWW*WWWW', 'WW*cWWWW', 'WWW*WWWW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.08, glow: '#cfd8ff', name: 'Starlit crack' },
        w: { px: ['KKKKKKKK', 'kbbkkllk', '.bob.ls.', '.bbb.ll.', '..,..t..', '......:.', '........', '...,....'], walk: 1, like: 'K', share: 0.12, name: 'Scroll pile' },
        h: { px: ['KKKKKKKK', 'ktttttts', '.lllllls', '.t....t.', '........', '.,......', '........', '...,....'], walk: 1, like: 'K', share: 0.1, name: 'Stone bench' },
        o: { px: ['########', '#*######', '##+#####', '###++*##', '#####+##', '######+#', '#######*', '########'], walk: 0, like: 'R', share: 0.15, spin: 1, name: 'Constellation' },
        ...quad(['....mmmmmmmm....', '..mm..*.....mm..', '.m..........*.m.', '.m..mmmmmmmm..m.', 'm..m........m..m', 'm.m...nnnn...m.m', 'm.m..n....n..m.m', 'm.m.n..gg..n.m.m', 'm.m.n..gg..n.m.m', 'm.m..n....n..m.m', 'm.m...nnnn...m.m', 'm..m........m..m', '.m..mmmmmmmm..m.', '.m.*..........m.', '..mm.....*..mm..', '....mmmmmmmm....'], 'Star chart', { glow: '#9fb4ff' }),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAArrYArArrYAAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFFlFFGFFFlFFKARRRR',
         'AKFKPKFFFFKPKFKQAAAA',
         'AKFlKFFFFFFKFFFuuuuL',
         'AKFGFFF12FFFFFKQAAQC',
         'AKFFKFF34FFlFFKARRAC',
         'AKFKPKFcFFKPKGKARRAC',
         'AKFFKlFFFFGKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZCKCCCCCCCCCCCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
        ['RRRRRRRRRRRRR',
         'DrYArArAYAEeD',
         'ALuuuuuKCZHZA',
         'ACJHHHJCJHACA',
         'AKuuuuuKuLHCA',
         'ACQAAAAAQCJCA',
         'AZARRRRRALCLA',
         'DADRRRRRDAAAD'],
      ],
    },
    { key: 'growth', name: 'Uncontrollable Growth', size: 8,
      palette: { '.': '#3f7a3a', ',': '#346a33', ':': '#5f9a45', ';': '#2a5229', 'k': '#2b5530', 'K': '#1f4026', 'x': '#5b6b4e', 'w': '#4a5940', 'W': '#34412f', 'h': '#8fb86a', 'H': '#1b2a1c', 'd': '#263322', '#': '#0f1d16', '+': '#16301f', '*': '#1d3d29', 'f': '#f4f0d0', 'y': '#f2d35b', 'v': '#8fd14f', 'V': '#c8f07a', 'r': '#6b4e2e', 'p': '#d77fa1', 'm': '#2f6b2a', 'M': '#5ea040', 'b': '#2d5f7a', 'B': '#6fb3c9', 'l': '#7a5a2e', 'L': '#b9792f', 'a': '#c95a5a', 'A': '#f08a7a', 's': '#e8dcc0', 'c': '#9cffd0', 'C': '#3fae8a', 'e': '#5a3d22', 'E': '#8a6236', 'n': '#3a2716', 'g': '#6f7a66', 'G': '#98a28c' },
      tiles: {
        v: { px: ['xvxxwxvx', 'xVvxxvVx', 'wvxwvxvw', 'hvhhvhvh', 'WvWWvWvW', 'WVWWWWvW', 'WvWWWWVW', 'HvHHHHvH'], walk: 0, anchor: 4, w: 1.6, name: 'Vines' },
        t: { px: ['..v.....', '.vV..v..', '.v..vV..', '....v...', '.v......', 'vV...v..', '.v..vV..', '......v.'], walk: 1, spin: 1, w: 1.4, name: 'Tall grass' },
        f: { px: ['........', '..f.....', '.fyf..v.', '..f..vV.', '.....f..', '..v.fyf.', '.vV..f..', '........'], walk: 1, spin: 1, name: 'Flowers' },
        o: { px: ['KvhhhhvK', 'vxVxwxxh', 'hxwvxwxh', 'hxxxvxxv', 'hvhhhhvh', 'WWvWWWvW', 'WvWWWWWW', 'KHvHHHHK'], walk: 0, anchor: 15, name: 'Overgrown pillar' },
        u: { px: ['Kk.rr.kK', 'Kk..r.kK', 'Kk.rr.kK', 'Kkr...kK', 'Kk.rr.kK', 'Kk..rrkK', 'Kk.r..kK', 'Kk.rr.kK'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.3, name: 'Root run' },
        // set dressing: like-tiles go wherever their source tile was learned
        m: { px: ['........', '.mm.....', 'mMmm..,.', '.mm.....', '.....mm.', '....mMmm', '..,..mm.', '........'], walk: 1, like: 'F', share: 0.12, spin: 1, name: 'Moss' },
        g: { px: ['........', '..v.....', '.vVv....', '..v...v.', '.....vVv', '.v....v.', 'vVv.....', '.v......'], walk: 1, like: 'F', share: 0.1, spin: 1, name: 'Clover' },
        l: { px: ['........', '.L......', '..l..L..', '.....l..', '.l......', '....L...', '..L...l.', '........'], walk: 1, like: 'F', share: 0.08, spin: 1, name: 'Leaf litter' },
        d: { px: ['........', '..bbbb..', '.bbBbbb.', '.bbbBbb.', '.bbbbbb.', '..bbbb..', '........', '........'], walk: 1, like: 'F', share: 0.03, spin: 1, name: 'Puddle' },
        a: { px: ['..aaaa..', '.aAAaaa.', 'aaAaaaaa', '.aaaaaa.', '...ss...', '...ss...', '..ssss..', '.KKKKKK.'], walk: 1, like: 'F', share: 0.03, name: 'Giant mushroom' },
        c: { px: ['........', '.c...c..', 'cCc.cCc.', '.s...s..', '.s.c.s..', '...Cc...', '..KsK...', '..KKK...'], walk: 1, like: 'F', share: 0.035, glow: '#9cffd0', name: 'Glowcaps' },
        e: { px: ['........', '........', '.nEEEEEn', 'nEeeeeEe', 'neeeeeee', '.nnnnnnn', '.KKKKKKK', '........'], walk: 1, like: 'F', share: 0.02, name: 'Fallen log' },
        s: { px: ['..gGGg..', '.gGvGgg.', '.gvVggg.', '.gGvgvg.', '..gggv..', '.vgggg..', '.KKKKKK.', '........'], walk: 1, like: 'F', share: 0.02, name: 'Overgrown statue' },
        h: { px: ['xwxxnxwx', 'xxwnxxwx', 'wxnwxxxw', 'hhnhhhhh', 'WWnWWnWW', 'WnWWnWWW', 'WnWWWnWW', 'HnHHHnHH'], walk: 0, like: 'A', share: 0.25, name: 'Roots through wall' },
        i: { px: ['xMxxmxMx', 'xmMxxmMx', 'mxxmMxxm', 'hMhhmhhM', 'WWmWWWmW', 'WmWWWWWW', 'WWWmWWWW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.25, name: 'Moss-covered face' },
        n: { px: ['xvxxxwvx', 'xvwxxxvx', 'wvxwvxvw', 'hvhhvhvh', 'WfWWvWfW', 'WvWWfWvW', 'WWWWvWWW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.15, name: 'Hanging flowers' },
        k: { px: ['KKKKKKKK', 'kvVvvVvk', '.vVvVvv.', '..vvvv..', '........', '.,......', '........', '...,....'], walk: 1, like: 'K', share: 0.15, name: 'Bush against wall' },
        x: { px: ['########', '#nn#####', '###n####', '####nn##', '##n###n#', '#n#####n', '########', '###nn###'], walk: 0, like: 'R', share: 0.15, spin: 1, name: 'Roots in the dark' },
        ...quad(['......vv........', '....vVvvv.......', '...vv.pppp.vv...', '..v..pppppp.Vv..', '.vV.pppffppp..v.', '.v.ppffyyffpp.v.', 'v..ppfyyyyfpp..v', 'v.pppfyyyyfppp.v', 'v.pppfyyyyfppp.v', 'v..ppfyyyyfpp..v', '.v.ppffyyffpp.v.', '.v..pppffppp.Vv.', '..vV.pppppp..v..', '...vv.pppp.vv...', '.......vvvVv....', '........vv......'], 'Bloom heart', { glow: '#ffd36a' }),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAvvYAvAvvYAAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFFtFFtFFFfFFKARRRR',
         'AKFKoKFFFFKoKFKQAAAA',
         'AKFfKFFFFFFKFFFuuuuL',
         'AKFtFFF12FFFFFKQAAQC',
         'AKFFKFF34FFfFFKARRAC',
         'AKFKoKFfFFKoKtKARRAC',
         'AKFFKfFFFFtKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZCKCCCCCCCCCCCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
        ['RRRRRRRRRRRRR',
         'DvYAvAvAYAEvD',
         'ALuuuuuKCZHZA',
         'ACJHHHJCJHACA',
         'AKuuuuuKuLHCA',
         'ACQAAAAAQCJCA',
         'AZARRRRRALCLA',
         'DADRRRRRDAAAD'],
      ],
    },
    { key: 'shrines', name: 'Unsealed Shrines', size: 8,
      palette: { '.': '#b07a3a', ',': '#9e6c33', ':': '#c48a42', ';': '#7f5428', 'k': '#8c5f2c', 'K': '#6e4a24', 'x': '#b8ae98', 'w': '#9a917d', 'W': '#6f675a', 'h': '#ddd3bc', 'H': '#3e3830', 'd': '#4e473d', '#': '#2a1d14', '+': '#33241a', '*': '#3d2b1f', 'p': '#8a7aa8', 'P': '#6e5a8c', 'g': '#7f9a3f', 's': '#c9c2b0', 'S': '#a39c8a', 'c': '#f0d080', 'v': '#1a1620', 'm': '#8c8476', 'b': '#3a3530', 'o': '#ffb040', 'O': '#fff0a0', 'u': '#a0522d', 'U': '#cd7f4f', 't': '#8f2a2a', 'T': '#c0443a', 'e': '#e8e0c8', 'r': '#d49a52', 'y': '#e0b84a' },
      tiles: {
        a: { px: ['xwxxxwxx', 'xxWWWWxx', 'xWHccHWx', 'hWHcHHWh', 'WWHHHHWW', 'WWWWWWWW', 'WdWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 4, glow: '#ffc457', name: 'Candle alcove' },
        u: { px: ['Kk.ss.kK', 'Kk.SS.kK', 'Kk....kK', 'Kk.ss.kK', 'Kk.SS.kK', 'Kk....kK', 'Kk.ss.kK', 'Kk.SS.kK'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.35, name: 'Stepping stones' },
        p: { px: ['........', '..p.....', '.pPp..g.', '..p.....', '.....g..', '..g..pP.', '....pPp.', '........'], walk: 1, spin: 1, w: 2.6, name: 'Heather' },
        g: { px: ['..g.....', '.g......', '......g.', '.....g..', '..g.....', '.g......', '......g.', '...g....'], walk: 1, spin: 1, w: 2.2, name: 'Grass tufts' },
        z: { px: ['........', '.sss....', '.sSs.ss.', '.sss.sSs', '.....ss.', '..ss....', '..sS....', '........'], walk: 1, spin: 1, w: 1.6, name: 'Path stones' },
        o: { px: ['KhhhhhhK', 'hxcxxwxh', 'hxwxxxxh', 'hxxxwxxh', 'hhhhhhhh', 'WWWdWWWW', 'WWWWWWWW', 'KHHHHHHK'], walk: 0, anchor: 15, name: 'Shrine pillar' },
        // set dressing: like-tiles go wherever their source tile was learned
        f: { px: ['.;....;.', '.;....;.', ';;;;;;;;', '....;...', '....;...', '....;...', ';;;;;;;;', '.;....;.'], walk: 1, like: 'F', share: 0.12, spin: 1, name: 'Flagstones' },
        r: { px: ['........', '.rr.....', '...rr...', '.....rr.', '........', 'rr......', '..rr....', '....rr..'], walk: 1, like: 'F', share: 0.12, spin: 1, name: 'Sand ripples' },
        l: { px: ['........', '.e......', '..e..ee.', '...e....', '.....e..', '.ee...e.', '........', '........'], walk: 1, like: 'F', share: 0.03, spin: 1, name: 'Old bones' },
        q: { px: ['........', '..T.....', '.T.t....', '....T...', '.t......', '.....tT.', '..T.....', '........'], walk: 1, like: 'F', share: 0.04, spin: 1, name: 'Offered petals' },
        b: { px: ['..oOo...', '.oOOOo..', '.bobob..', 'bbbbbbb.', '.bSSSb..', '..bbb...', '.b...b..', 'KKKKKKK.'], walk: 1, like: 'F', share: 0.025, glow: '#ffb040', name: 'Brazier' },
        d: { px: ['...uu...', '..UUuu..', '.UUuuuu.', '.Uuuuuu.', '.uuuuuu.', '..uuuu..', '..KKKK..', '........'], walk: 1, like: 'F', share: 0.035, name: 'Urn' },
        e: { px: ['..mmmm..', '.mSSSSm.', '.mSddSm.', '.mSSSSm.', '.mSddSm.', '.mSSSSm.', '.mmmmmm.', 'KKKKKKKK'], walk: 1, like: 'F', share: 0.02, name: 'Prayer stele' },
        i: { px: ['...SS...', '..SssS..', '...ss...', '..SsssS.', '.SsssssS', '.ssssss.', '.mmmmmm.', '.KKKKKK.'], walk: 1, like: 'F', share: 0.015, name: 'Kneeling statue' },
        j: { px: ['........', '.O...O..', '.c...c..', '.s.O.s..', '.s.c.s..', '...s....', '.K.s.K..', '...K....'], walk: 1, like: 'F', share: 0.03, glow: '#ffc457', name: 'Floor candles' },
        t: { px: ['........', '........', '..yyyy..', '.yTtTty.', '.yyyyyy.', '..yyyy..', '..KKKK..', '........'], walk: 1, like: 'F', share: 0.02, name: 'Offering bowl' },
        h: { px: ['xwxxxwxx', 'xxmmmmwx', 'wxmddmxw', 'hhmddmhh', 'WWmddmWW', 'WWmddmWW', 'WWmddmWW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.12, name: 'Sealed doorway' },
        n: { px: ['xwxxxwxx', 'xtttttwx', 'wtTtTtxw', 'htttttth', 'WtTyTtWW', 'WtttttWW', 'WWtWtWWW', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.06, name: 'Tapestry' },
        w: { px: ['xwxxxwxx', 'xxwxdxwx', 'wxxddxxw', 'hhhdhhhh', 'WWWdrWWW', 'WWdrr.WW', 'Wdr....W', 'Hr......'], walk: 0, like: 'A', share: 0.1, name: 'Sand spill' },
        k: { px: ['KKKKKKKK', 'kOkkOkOk', '.c.Oc.c.', '.s.cs.s.', '.s.ss.s.', '......:.', '........', '...,....'], walk: 1, like: 'K', share: 0.12, glow: '#ffc457', name: 'Wall candles' },
        x: { px: ['KKKKKKKK', 'kmmmmmmk', '.SSSSSS.', '.m....m.', '........', '.,......', '........', '...,....'], walk: 1, like: 'K', share: 0.1, name: 'Bench' },
        ...quad(['....mmmmmmmm....', '..mmhhhhhhhhmm..', '.mhhmmmmmmmmhhm.', '.mhmWWWWWWWWmhm.', 'mhmWWvvvvvvWWmhm', 'mhmWvvvvvvvvWmhm', 'mhWvvvvvvvvvvWhm', 'mhWvvvvvvvvvvWhm', 'mhWvvvvvvvvvvWhm', 'mhWvvvvvvvvvvWhm', 'mhmWvvvvvvvvWmhm', 'mhmWWvvvvvvWWmhm', '.mhmWWWWWWWWmhm.', '.mhhmmmmmmmmhhm.', '..mmhhhhhhhhmm..', '....mmmmmmmm....'], 'Unsealed pit', { glow: '#a77cff' }),
      },
      examples: [
        ['RRRRRRRRRRRRRRRRRRRR',
         'DAAaaYAaASaYAAADRRRR',
         'ALKKKKKKKKKKKKLARRRR',
         'AKFFpFFzFFFgFFKARRRR',
         'AKFKoKFFFFKoKFKQAAAA',
         'AKFgKFFFFFFKFFFuuuuL',
         'AKFzFFF12FFFFFKQAAQC',
         'AKFFKFF34FFgFFKARRAC',
         'AKFKoKFzFFKoKzKARRAC',
         'AKFFKgFFFFzKFFKARRAC',
         'ALKKKKKFKKKKKKLARRAC',
         'DAAAAHJCJHHHHHHAAAQC',
         'RRRRAZCKCCCCCCCCCCCK',
         'RRRRDAAAAAAAAAAAAAQZ'],
        ['RRRRRRRRRRRRR',
         'DaYAaAaAYAESD',
         'ALuuuuuKCZHZA',
         'ACJHHHJCJHACA',
         'AKuuuuuKuLHCA',
         'ACQAAAAAQCJCA',
         'AZARRRRRALCLA',
         'DADRRRRRDAAAD'],
      ],
    },
  ];

  const rotPx = px => { const N = px.length; return px.map((_, y) => px.map((__, x) => px[N - 1 - x][y]).join('')); };
  const rotGrid = g => { const H = g.length, W = g[0].length, out = []; for (let y = 0; y < W; y++) { const row = []; for (let x = 0; x < H; x++) row.push(g[H - 1 - x][y]); out.push(row); } return out; };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

  // ---------- learning from the examples ----------
  function learn(ts, tsIndex) {
    const size = ts.size || 4;
    const tiles = { ...(size === 8 ? KIT8 : KIT), ...ts.tiles };
    // a tile with like: 'X' goes wherever X was learned (same contexts, same turning), at a share of X's weight;
    // that is how set dressing is added without drawing new example rooms
    Object.entries(tiles).forEach(([L, t]) => {
      if (!t.like) return;
      const src = tiles[t.like]; if (!src) throw new Error(`${ts.key}: tile ${L} is like unknown tile ${t.like}`);
      if (src.strict) throw new Error(`${ts.key}: tile ${L} cannot be like a strict tile`);
      if (src.anchor !== undefined && t.anchor === undefined) tiles[L] = { ...t, anchor: src.anchor };
    });
    const variants = [], index = {};
    Object.entries(tiles).forEach(([L, t]) => {
      let px = t.px; const seen = {};
      for (let r = 0; r < 4; r++) {
        if (r > 0 && t.anchor === undefined) { index[L + r] = index[L + 0]; continue; }
        const cls = t.anchor !== undefined ? rotCls(t.anchor, r) : null;
        const key = px.join('') + '|' + cls;
        if (seen[key] !== undefined) index[L + r] = seen[key];
        else { seen[key] = index[L + r] = variants.length; variants.push({ letter: L, r, px, walk: t.walk, cls, strict: !!t.strict, spin: !!t.spin, name: t.name, ts: tsIndex, bias: t.w || 1, size, glow: t.glow || null }); }
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
        // a strict tile without an anchor (a centrepiece quarter) does not turn with the example, so its
        // neighbours are learned from the example as drawn only, or rotated copies would teach broken assemblies
        const fixed = id => k > 0 && variants[id].strict && tiles[variants[id].letter].anchor === undefined;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const a = ids[y][x]; weight[a]++;
          if (x > 0 && y > 0 && x < W - 1 && y < H - 1) classesOf[a].add(classAt(walk, W, H, x, y));
          if (x + 1 < W) { const b = ids[y][x + 1]; if (!fixed(a) && !fixed(b)) { learned[1][a].add(b); learned[3][b].add(a); } }
          if (y + 1 < H) { const b = ids[y + 1][x]; if (!fixed(a) && !fixed(b)) { learned[2][a].add(b); learned[0][b].add(a); } }
        }
        grid = rotGrid(grid);
      }
    });
    const mask = list => { const m = new Uint32Array(K); list.forEach(t => m[t >> 5] |= 1 << (t & 31)); return m; };
    // adjacency: strict tiles keep exactly their example neighbours; everything else is free to meet
    const loose = variants.map((v, i) => i).filter(i => !variants[i].strict);
    // a centrepiece quarter is strict only towards its other quarters: its outer edges meet any loose tile
    const quarter = i => variants[i].strict && tiles[variants[i].letter].anchor === undefined;
    const outer = (i, d) => quarter(i) && ![...learned[d][i]].some(j => variants[j].strict);
    // like-tiles meet strict tiles wherever their source does
    Object.entries(tiles).forEach(([L, t]) => {
      if (!t.like) return;
      for (let r = 0; r < 4; r++) {
        const v = index[L + r], src = index[t.like + r];
        if (v === undefined || src === undefined || (r > 0 && v === index[L + 0])) continue;
        for (let d = 0; d < 4; d++) {
          learned[d][v] = new Set(learned[d][src]);
          variants.forEach((sv, i) => { if (sv.strict && learned[d][i].has(src)) learned[d][i].add(v); });
        }
      }
    });
    const allow = [0, 1, 2, 3].map(d => variants.map((v, a) => {
      if (v.strict) return outer(a, d) ? mask(loose.concat([...learned[d][a]])) : mask([...learned[d][a]]);
      const strictOk = variants.map((s, i) => i).filter(i => variants[i].strict && (learned[(d + 2) & 3][i].has(a) || outer(i, (d + 2) & 3)));
      return mask(loose.concat(strictOk));
    }));
    // structural kit tiles are always allowed in the context they are drawn for, so no context is ever
    // left with only strict pieces to choose from
    variants.forEach((v, i) => { if (KIT[v.letter] && v.cls !== null && !v.strict) classesOf[i].add(v.cls); });
    // like-tiles take their source's contexts, weight share and strict neighbours, rotation by rotation
    Object.entries(tiles).forEach(([L, t]) => {
      if (!t.like) return;
      for (let r = 0; r < 4; r++) {
        const v = index[L + r], src = index[t.like + r];
        if (v === undefined || src === undefined || (r > 0 && v === index[L + 0])) continue;
        classesOf[v] = new Set(classesOf[src]);
        weight[v] = weight[src] * (t.share || 0.1);
      }
    });
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
    // per-spin character grids and materials, for the renderer's material pass
    variants.forEach(v => { let px = v.px; v.pxs = [px]; for (let r = 1; r < 4; r++) { px = rotPx(px); v.pxs.push(px); } });
    const M = MATERIALS[ts.key], rgbOf = c => pal[c] || [255, 0, 255];
    const materials = M ? {
      floor: M.floor.map(([name, f]) => ({ name, rgb: grid(f).join('').split('').map(rgbOf) })),
      wall: M.wall.map(([name, face, top]) => ({ name, face: grid(face).join('').split('').map(rgbOf), top: top ? grid(top).join('').split('').map(rgbOf) : null })),
    } : null;
    const fallback = { floor: index.F0, wall: index.E0, rock: index.R0 };
    return { ...ts, size, tiles, variants, n, K, allow, weight, classMask, fallback, index, exampleIds, unplaced, learned, classesOf, materials, pal };
  }

  // Threshold: the processional halls where one sector opens into the next, the same in every stratum so a
  // crossing is unmistakable. It learns from the Constellation of Mazes example rooms (same letters, its own art).
  TILESETS.push({ key: 'threshold', name: 'Threshold', size: 8, examplesFrom: 'mazes',
    palette: { '.': '#4a3a5c', ',': '#433452', ':': '#57466b', ';': '#2e2440', 'k': '#3a2d4a', 'K': '#2a2036', 'x': '#6a5a7e', 'w': '#5a4b6e', 'W': '#3b2f4d', 'h': '#8f7fa6', 'H': '#1e1828', 'd': '#2a2036', '#': '#100c18', '+': '#2a2040', '*': '#b9b2d8', 'o': '#e0b84a', 'O': '#fff0a0', 'q': '#8a2a3a', 'Q': '#b8434f', 'v': '#b9b2d8', 'f': '#ffb040', 'F': '#fff0a0', 'n': '#6e5a8c' },
    tiles: {
      r: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxQQQQxw', 'hhQoQQhh', 'WWQQQQWW', 'WWQoQQWW', 'WWQQQQWW', 'HHHQQHHH'], walk: 0, anchor: 4, w: 2, name: 'Processional banner' },
      e: { px: ['xwxxxwxx', 'xxWWWWxx', 'xWHfFHWx', 'hWHffHWh', 'WWHooHWW', 'WWWWWWWW', 'WdWWWWWW', 'HHHHHHHH'], walk: 0, anchor: 4, w: 0.8, glow: '#ffb040', name: 'Brazier niche' },
      u: { px: ['Kk.qq.kK', 'Kk.qQ.kK', 'Kk.qq.kK', 'Kk.qo.kK', 'Kk.qq.kK', 'Kk.Qq.kK', 'Kk.qq.kK', 'Kk.oq.kK'], walk: 1, anchor: FLOOR | 10, strict: 1, w: 0.3, name: 'Runner, corridor' },
      l: { px: ['........', '...o....', '..ovo...', '.ovOvo..', '..ovo...', '...o....', '.,......', '......:.'], walk: 1, spin: 1, name: 'Inlaid star' },
      c: { px: ['..vvvv..', '.v....v.', 'v..oo..v', 'v.o..o.v', 'v.o..o.v', 'v..oo..v', '.v....v.', '..vvvv..'], walk: 1, name: 'Sigil' },
      ...quad(['.......vv.......', '....vvvvvvvv....', '...vv..oo..vv...', '..v..o.qq.o..v..', '.vv.o..qq..o.vv.', '.v.o.v.qq.v.o.v.', '.v.....qq.....v.', 'vvoqqqqqqqqqqovv', 'vvoqqqqqqqqqqovv', '.v.....qq.....v.', '.v.o.v.qq.v.o.v.', '.vv.o..qq..o.vv.', '..v..o.qq.o..v..', '...vv..oo..vv...', '....vvvvvvvv....', '.......vv.......'], 'Great sigil', { glow: '#b9b2d8' }),
      V: { px: ['.oqqqqo.', '.oqQqqo.', '.oqqqqo.', '.oqqQqo.', '.oqqqqo.', '.oQqqqo.', '.oqqqqo.', '.oqqqQo.'], walk: 1, like: 'F', share: 0.0001, name: 'Runner (north-south)' },
      N: { px: ['........', 'oooooooo', 'qqqqQqqq', 'qQqqqqqq', 'qqqqqqQq', 'qqQqqqqq', 'oooooooo', '........'], walk: 1, like: 'F', share: 0.0001, name: 'Runner (east-west)' },
      T: { px: ['..fFf...', '.fFFFf..', '.ofofo..', 'ooooooo.', '.oOOOo..', '..ooo...', '.o...o..', 'KKKKKKK.'], walk: 1, like: 'F', share: 0.0001, glow: '#ffb040', name: 'Brazier' },
      M: { px: ['xwxxxwxx', 'xxwxxxwx', 'wxxwxxxw', 'hhhhhhhh', 'WnWnWnWn', 'nWnWnWnW', 'WnWnWnWn', 'HHHHHHHH'], walk: 0, like: 'A', share: 0.5, name: 'Chequered face' },
    },
  });

  TILESETS.forEach(ts => { if (ts.examplesFrom) ts.examples = TILESETS.find(t => t.key === ts.examplesFrom).examples; });

  // ---------- materials: structured floor and wall surfaces laid per room and district ----------
  // A material is a 16x16 pattern (2x2 tiles, aligned to the world) in palette characters. At render time it
  // replaces the floor tones (. , :) of walkable tiles, or the faces (W) and tops (x w) of walls, so shadows,
  // props and details stay on top. Patterns are structure (slabs, courses, herringbone), never noise.
  const PAT = {
    slabs: (n, grout, a, b) => (x, y) => (x % n === 0 || y % n === 0) ? grout : (((x / n | 0) + (y / n | 0)) % 2 ? a : b),
    offsetSlabs: (w, h, grout, a, b) => (x, y) => { const row = y / h | 0, xx = x + (row % 2) * (w >> 1); return (y % h === 0 || xx % w === 0) ? grout : ((xx / w | 0) + row) % 3 ? a : b; },
    herringbone: (grout, a, b) => (x, y) => { const k = ((x >> 1) + (y >> 1)) & 3, v = ((x >> 1) - (y >> 1)) & 3; return (k === 0 && (x & 1) === 0) || (v === 0 && (y & 1) === 0) ? grout : ((x >> 2) + (y >> 2)) & 1 ? a : b; },
    squares: (a, b, c) => (x, y) => { const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) | 0; return m === 7 ? c : m % 3 === 0 ? b : a; },
    checker: (n, a, b) => (x, y) => (((x / n | 0) + (y / n | 0)) & 1) ? a : b,
    rings: (a, b, c) => (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5) | 0; return d > 7 ? c : d % 3 === 0 ? b : a; },
    bricks: (w, h, mortar, a, b) => (x, y) => { const row = y / h | 0, xx = x + (row % 2) * (w >> 1); return (y % h === h - 1 || xx % w === w - 1) ? mortar : ((xx / w | 0) * 7 + row * 3) % 5 ? a : b; },
    bands: (n, a, b) => (x, y) => ((y / n | 0) % 2) ? a : b,
    blocks: (mortar, a) => (x, y) => (y % 8 === 7 || ((x + (y / 8 | 0) * 4) % 8) === 7) ? mortar : a,
  };
  const grid = f => Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => f(x, y)).join(''));
  const MATERIALS = {
    mazes: {
      floor: [['Star paving', PAT.slabs(8, ';', '.', ':')], ['Concentric tiles', PAT.squares('.', 'm', 'n')], ['Herringbone', PAT.herringbone(';', '.', ',')], ['Chequer', PAT.checker(4, ':', ',')]],
      wall: [['Ashlar', PAT.blocks('d', 'W'), null], ['Coursed', PAT.bricks(4, 2, 'd', 'W', 'n'), PAT.bricks(4, 2, 'w', 'x', 'h')], ['Banded', PAT.bands(1, 'n', 'W'), null]],
    },
    growth: {
      floor: [['Mossy flags', PAT.offsetSlabs(8, 4, 'm', '.', 'M')], ['Old paving', PAT.slabs(4, 'G', 'g', ',')], ['Leaf mould', PAT.checker(2, '.', 'm')], ['Root weave', PAT.herringbone('l', '.', ',')]],
      wall: [['Ashlar', PAT.blocks('d', 'W'), null], ['Green courses', PAT.bricks(4, 2, 'm', 'W', 'W'), PAT.bricks(4, 2, 'M', 'x', 'w')], ['Banded', PAT.bands(1, 'W', 'd'), null]],
    },
    shrines: {
      floor: [['Temple flags', PAT.offsetSlabs(8, 4, ';', 's', 'S')], ['Mosaic', PAT.squares('r', 'y', 'm')], ['Herringbone', PAT.herringbone(';', '.', 'r')], ['Chequer', PAT.checker(4, 's', 'm')]],
      wall: [['Ashlar', PAT.blocks('d', 'W'), null], ['Coursed', PAT.bricks(4, 2, 'd', 'W', 'm'), PAT.bricks(4, 2, 'w', 'x', 'h')], ['Banded', PAT.bands(2, 'm', 'W'), null]],
    },
  };
  const SETS = TILESETS.map(learn);
  const KMAX = Math.max(...SETS.map(s => s.K));
  const GTILES = [null], OFFSET = [];
  SETS.forEach(s => { OFFSET.push(GTILES.length); s.variants.forEach(v => GTILES.push(v)); });

  // ---------- the dressing WFC ----------
  // pass[i]: 1 floor / 0 wall; setOf[i]: tileset per cell; pins: optional [[cell, letter], ...] tiles that
  // must go in a cell (landmarks), honoured when the tile fits that cell's context. Returns global tile ids.
  function dress(pass, setOf, W, H, seed, pins) {
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
    (pins || []).forEach(([i, L]) => { const t = SETS[setOf[i]].index[L + '0']; if (t !== undefined && (dom[i * KW + (t >> 5)] >>> (t & 31)) & 1) setSingle(i, t); });
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
    const fell = new Uint8Array(N);
    for (let guard = 0; guard < N; guard++) {
      const all = []; for (let i = 0; i < N; i++) all.push(i);
      const bad = propagate(all);
      if (bad < 0) break;
      if (fell[bad]) { // already a plain tile: the conflict comes from a neighbour (a pin), so free those too
        const x = bad % W, y = (bad / W) | 0;
        for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (!fell[n]) { fell[n] = 1; setSingle(n, fallbackOf(n)); fallbacks++; fallbackCells.push(n); } }
        continue;
      }
      fell[bad] = 1; setSingle(bad, fallbackOf(bad)); fallbacks++; fallbackCells.push(bad);
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

    // where a 2x2 centrepiece (tiles 1-4) can go near a cell: every quarter must fit its context and share one tileset
  function centrepieceAt(pass, setOf, W, H, cx, cy, rad) {
    const walk = (x, y) => pass[y * W + x];
    for (let r = 0; r <= rad; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x + 2 >= W || y + 2 >= H) continue;
      const cells = [y * W + x, y * W + x + 1, (y + 1) * W + x, (y + 1) * W + x + 1], set = SETS[setOf[cells[0]]];
      if (set.index['10'] === undefined || cells.some(i => setOf[i] !== setOf[cells[0]] || !pass[i])) continue;
      const ok = cells.every((i, k) => {
        const m = set.classMask.get(classAt(walk, W, H, i % W, (i / W) | 0)), t = set.index[(k + 1) + '0'];
        if (!m || !((m[t >> 5] >>> (t & 31)) & 1)) return false;
        // every outside neighbour must have some tile its context allows that this quarter accepts
        for (let d = 0; d < 4; d++) {
          const nx = i % W + DX[d], ny = ((i / W) | 0) + DY[d], n = ny * W + nx;
          if (cells.includes(n)) continue;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || setOf[n] !== setOf[i]) return false;
          const nm = set.classMask.get(classAt(walk, W, H, nx, ny)), A = set.allow[d][t];
          if (!nm || !nm.some((w, j) => (w & A[j]) !== 0)) return false;
        }
        return true;
      });
      if (ok) return cells.map((i, k) => [i, String(k + 1)]);
    }
    return null;
  }

  const api = { centrepieceAt, DRESS_SETS: SETS, DRESS_TILES: GTILES, DRESS_OFFSET: OFFSET, dress, classAt, rotCls, cellHash, DRESS_TILE_PX: 4 };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
