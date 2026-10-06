// Room-based labyrinth layout for a sector (the Underdark's default; the Workbench pipeline's cavernous WFC
// layout remains for the other presets and as an option).
//
//   stratum → sector theme → room grammar → rooms placed as attached suites → corridors → maze → doors
//
// * Each stratum has a few THEMES; a sector's theme comes from its coordinates (Reliquary, Pilgrim Hostel …).
// * A theme is a small grammar over ROOM TYPES: a start room, rules that expand a room into child rooms (with
//   how they are linked: a door in a shared wall or a corridor), a goal room, and public rooms scattered
//   through the maze. Expanding it gives the sector's mission graph.
// * Rooms are placed as suites: each child next to its parent, separated by one wall with a door, or a short
//   corridor away. The spine (start → goal) grows towards the sector's way onward.
// * Progression: the doorways onward to the next stratum (seals and pits) are reached only through the goal
//   room by private corridors; private rooms open only onto their parent. Everything public meets the maze.
// * The rest of the sector is filled with a maze on the odd lattice. Features keep a one-cell margin, so the
//   maze touches a room only where a connector door is cut, and only public rooms get connectors.
// All in sub-cells, in the sector's local grid, deterministic from the seed.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined';
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  // ---------- room types: size range in sub-cells (odd), shape, access ----------
  // shapes: rect, pillars (pillar grid), hall (colonnades along the long axis), octagon, round, cloister (ring
  // around a solid court), cross
  const T = (name, w, h, shape, access, extra) => ({ name, w, h, shape, access, ...extra });
  const ROOM_TYPES = {
    // Constellation of Mazes
    vestibule: T('Vestibule', [5, 7], [5, 7], 'rect', 'public'),
    gallery: T('Star gallery', [13, 19], [7, 9], 'hall', 'public', { long: 1 }),
    alcove: T('Alcove', [3, 5], [3, 5], 'rect', 'private'),
    dome: T('Observatory dome', [11, 13], [11, 13], 'round', 'private', { goal: 1 }),
    orrery: T('Orrery room', [7, 9], [7, 9], 'octagon', 'public'),
    gate: T('Glyph gate', [5, 5], [5, 5], 'rect', 'public'),
    cell: T('Cell', [3, 5], [3, 5], 'rect', 'public'),
    eyeChamber: T('Chamber of the eye', [9, 11], [9, 11], 'octagon', 'private', { goal: 1 }),
    index: T('Index', [7, 9], [7, 9], 'octagon', 'public'),
    stacks: T('Stacks', [11, 15], [7, 9], 'hall', 'public', { long: 1 }),
    reading: T('Reading room', [7, 9], [7, 9], 'pillars', 'private'),
    sealedArchive: T('Sealed archive', [11, 13], [11, 13], 'cloister', 'private', { goal: 1, court: 3 }),
    // Uncontrollable Growth
    pottingShed: T('Potting shed', [5, 7], [5, 7], 'rect', 'public'),
    glasshouse: T('Glasshouse', [13, 17], [11, 13], 'pillars', 'public'),
    bed: T('Planting bed', [5, 9], [5, 7], 'rect', 'private'),
    pond: T('Pond room', [9, 11], [9, 11], 'round', 'public'),
    bloomChamber: T('Bloom chamber', [11, 13], [11, 13], 'round', 'private', { goal: 1 }),
    cellarStair: T('Cellar stair', [5, 5], [5, 7], 'rect', 'public'),
    cellar: T('Root cellar', [5, 7], [5, 7], 'rect', 'public'),
    deepCellar: T('Deep cellar', [5, 7], [5, 7], 'rect', 'private'),
    rootHeart: T('Root heart', [9, 11], [9, 11], 'octagon', 'private', { goal: 1 }),
    porch: T('Porch', [5, 7], [5, 5], 'rect', 'public'),
    greatHall: T('Great hall', [17, 21], [9, 11], 'hall', 'public', { long: 1 }),
    sideRoom: T('Side room', [5, 7], [5, 7], 'rect', 'private'),
    conservatory: T('Conservatory', [11, 13], [11, 13], 'octagon', 'private', { goal: 1 }),
    // Unsealed Shrines
    antechamber: T('Antechamber', [7, 9], [5, 7], 'rect', 'public'),
    nave: T('Nave', [17, 23], [9, 11], 'hall', 'public', { long: 1 }),
    chapel: T('Side chapel', [5, 7], [5, 7], 'octagon', 'private'),
    sanctum: T('Sanctum', [11, 13], [11, 13], 'cloister', 'private', { goal: 1, court: 3 }),
    hostelGate: T('Hostel gate', [5, 7], [5, 5], 'rect', 'public'),
    refectory: T('Refectory', [13, 17], [9, 11], 'pillars', 'public'),
    pilgrimCell: T('Pilgrim cell', [3, 5], [3, 5], 'rect', 'public'),
    wellCourt: T('Well court', [11, 13], [11, 13], 'cloister', 'public'),
    hostelShrine: T('Shrine', [9, 11], [9, 11], 'cross', 'private', { goal: 1 }),
    stairHall: T('Stair hall', [5, 7], [5, 7], 'rect', 'public'),
    charnel: T('Charnel hall', [15, 21], [5, 7], 'hall', 'public', { long: 1 }),
    niche: T('Ossuary niche', [3, 3], [3, 5], 'rect', 'private'),
    boneChapel: T('Bone chapel', [9, 11], [9, 11], 'cross', 'private', { goal: 1 }),
    // small rooms off corridors (doors straight off the hallway)
    study: T('Study', [3, 5], [3, 5], 'rect', 'public'),
    starCloset: T('Star closet', [3, 3], [3, 5], 'rect', 'public'),
    mapRoom: T('Map room', [5, 7], [5, 7], 'octagon', 'public'),
    toolStore: T('Tool store', [3, 5], [3, 3], 'rect', 'public'),
    seedVault: T('Seed vault', [3, 5], [3, 5], 'rect', 'public'),
    sporeRoom: T('Spore room', [5, 7], [5, 7], 'round', 'public'),
    vestry: T('Vestry', [3, 5], [3, 5], 'rect', 'public'),
    candleStore: T('Candle store', [3, 3], [3, 5], 'rect', 'public'),
    reliquaryNiche: T('Reliquary', [5, 7], [5, 7], 'octagon', 'public'),
    // seals and pits at the borders between strata
    sealHall: T('Seal', [5, 5], [5, 5], 'rect', 'public'),
    gateHall: T('Passage', [7, 9], [5, 9], 'rect', 'public'),
  };

  // ---------- themes: each a grammar over room types ----------
  // rules: type → [[child type, min, max, link]], link 'door' (shared wall) or 'corridor'
  // maze: how much of the free space becomes maze (dead ends are trimmed back to this), braid: extra loops
  const C = (type, min, max, link) => [type, min, max, link || 'door'];
  const THEMES = [
    [ // Constellation of Mazes
      { key: 'observatory', name: 'Observatory', start: 'vestibule', goal: 'dome', maze: 0.45, braid: 0.06,
        rules: { vestibule: [C('gallery', 1, 1, 'corridor')], gallery: [C('alcove', 1, 3), C('dome', 1, 1)] }, wings: [['orrery', [C('alcove', 1, 2)]], ['gallery', [C('alcove', 1, 3)]], ['vestibule', [C('cell', 1, 2)]]], wingCount: [10, 16], straight: 0.6, side: ['study', 'starCloset', 'mapRoom'], step: 6, fill: [['orrery', 1, 2]] },
      { key: 'glyphs', name: 'Glyph labyrinth', start: 'gate', goal: 'eyeChamber', maze: 0.8, braid: 0.03,
        rules: { gate: [C('eyeChamber', 1, 1, 'corridor')] }, wings: [['cell', []], ['gate', [C('cell', 1, 2)]], ['orrery', []]], wingCount: [8, 14], straight: 0.2, side: ['cell', 'starCloset'], step: 2, fill: [['cell', 3, 6]] },
      { key: 'archive', name: 'Archive', start: 'index', goal: 'sealedArchive', maze: 0.4, braid: 0.08,
        rules: { index: [C('stacks', 2, 3), C('reading', 1, 1, 'corridor')], reading: [C('sealedArchive', 1, 1)] }, wings: [['stacks', [C('reading', 0, 1)]], ['index', [C('stacks', 1, 2)]], ['cell', []]], wingCount: [10, 16], straight: 0.75, side: ['study', 'mapRoom', 'cell'], step: 6, fill: [['cell', 1, 3]] },
    ],
    [ // Uncontrollable Growth
      { key: 'greenhouse', name: 'Greenhouse', start: 'pottingShed', goal: 'bloomChamber', maze: 0.4, braid: 0.12,
        rules: { pottingShed: [C('glasshouse', 1, 1, 'corridor')], glasshouse: [C('bed', 2, 3), C('bloomChamber', 1, 1)] }, wings: [['glasshouse', [C('bed', 1, 3)]], ['pond', []], ['pottingShed', [C('bed', 1, 2)]]], wingCount: [9, 14], straight: 0.4, side: ['toolStore', 'seedVault', 'sporeRoom'], step: 6, fill: [['pond', 1, 2]] },
      { key: 'cellars', name: 'Root cellars', start: 'cellarStair', goal: 'rootHeart', maze: 0.55, braid: 0.05,
        rules: { cellarStair: [C('cellar', 1, 1, 'corridor')], cellar: [C('deepCellar', 1, 1, 'corridor')], deepCellar: [C('rootHeart', 1, 1)] }, wings: [['cellar', [C('deepCellar', 1, 2, 'corridor')]], ['cellarStair', [C('cellar', 0, 1)]]], wingCount: [12, 18], straight: 0.3, side: ['seedVault', 'toolStore', 'cellar'], step: 6, fill: [['cellar', 3, 5]] },
      { key: 'overgrown', name: 'Overgrown halls', start: 'porch', goal: 'conservatory', maze: 0.4, braid: 0.1,
        rules: { porch: [C('greatHall', 1, 1)], greatHall: [C('sideRoom', 2, 4), C('conservatory', 1, 1, 'corridor')] }, wings: [['greatHall', [C('sideRoom', 2, 4)]], ['pond', []], ['porch', [C('sideRoom', 1, 2)]]], wingCount: [9, 14], straight: 0.5, side: ['sporeRoom', 'toolStore', 'sideRoom'], step: 6, fill: [['pond', 0, 1]] },
    ],
    [ // Unsealed Shrines
      { key: 'reliquary', name: 'Reliquary', start: 'antechamber', goal: 'sanctum', maze: 0.4, braid: 0.06,
        rules: { antechamber: [C('nave', 1, 1)], nave: [C('chapel', 2, 4), C('sanctum', 1, 1)] }, wings: [['nave', [C('chapel', 1, 3)]], ['antechamber', [C('chapel', 1, 2)]], ['pilgrimCell', []]], wingCount: [10, 16], straight: 0.7, side: ['vestry', 'reliquaryNiche', 'candleStore'], step: 6, fill: [['pilgrimCell', 1, 3]] },
      { key: 'hostel', name: 'Pilgrim hostel', start: 'hostelGate', goal: 'hostelShrine', maze: 0.45, braid: 0.08,
        rules: { hostelGate: [C('refectory', 1, 1, 'corridor')], refectory: [C('pilgrimCell', 2, 3), C('wellCourt', 1, 1)], wellCourt: [C('hostelShrine', 1, 1)] }, wings: [['refectory', [C('pilgrimCell', 2, 4)]], ['wellCourt', [C('pilgrimCell', 1, 3)]], ['pilgrimCell', []]], wingCount: [12, 18], straight: 0.65, side: ['pilgrimCell', 'vestry', 'candleStore'], step: 6, fill: [['pilgrimCell', 3, 6]] },
      { key: 'ossuary', name: 'Ossuary', start: 'stairHall', goal: 'boneChapel', maze: 0.5, braid: 0.04,
        rules: { stairHall: [C('charnel', 1, 1)], charnel: [C('niche', 3, 6), C('boneChapel', 1, 1, 'corridor')] }, wings: [['charnel', [C('niche', 2, 5)]], ['stairHall', [C('niche', 1, 2)]]], wingCount: [10, 16], straight: 0.6, side: ['candleStore', 'reliquaryNiche', 'pilgrimCell'], step: 6, fill: [['pilgrimCell', 1, 2]] },
    ],
  ];

  function h32(a, b, c, d) {
    let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA77) ^ Math.imul(c | 0, 0xC2B2AE3D) ^ Math.imul(d | 0, 0x27D4EB2F);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
    return h >>> 0;
  }
  function sectorTheme(S, info) { const list = THEMES[info.type]; return list[h32(S.seed, info.sx, info.sy, 41) % list.length]; }

  // ---------- grammar expansion: the mission graph ----------
  function expand(theme, rng) {
    const nodes = [{ type: theme.start, parent: -1, depth: 0, link: null }];
    for (let k = 0; k < nodes.length && nodes.length < 24; k++) {
      const rules = theme.rules[nodes[k].type] || [];
      rules.forEach(([type, min, max, link]) => {
        const n = min + Math.floor(rng() * (max - min + 1));
        for (let j = 0; j < n; j++) nodes.push({ type, parent: k, depth: nodes[k].depth + 1, link });
      });
    }
    // exactly one goal: extra goal rooms (and anything below them) are dropped
    let goal = nodes.findIndex(n => n.type === theme.goal);
    if (goal < 0) throw new Error(`theme ${theme.key} produced no goal room`);
    const dropped = new Set();
    nodes.forEach((n, k) => { if ((n.type === theme.goal && k !== goal) || dropped.has(n.parent)) dropped.add(k); });
    if (dropped.size) {
      const keep = nodes.map((n, k) => k).filter(k => !dropped.has(k)), remap = new Map(keep.map((k, j) => [k, j]));
      const kept = keep.map(k => ({ ...nodes[k], parent: nodes[k].parent < 0 ? -1 : remap.get(nodes[k].parent) }));
      nodes.length = 0; kept.forEach(n => nodes.push(n)); goal = remap.get(goal);
    }
    // the spine: start → goal; it is placed first and grows towards the way onward
    nodes.forEach(n => { n.spine = false; });
    for (let k = goal; k >= 0; k = nodes[k].parent) nodes[k].spine = true;
    return { nodes, goal };
  }

  // ---------- the layout ----------
  // own: COLS x ROWS cells owned by this sector; portals as from sectorPortals (local cells); ox, oy: sector origin
  function roomsLayout(S, info, portals, own, ox, oy, seed, doorSub, landmark) {
    const W = SW, H = SH, N = W * H, rng = mulberry32(seed * 131 + 7);
    const theme = sectorTheme(S, info);
    const ownSub = i => own[(((i / W) | 0) / 3 | 0) * COLS + ((i % W) / 3 | 0)];
    // allowed: the cell and its 8 neighbours lie in cells this sector owns (so floors of two sectors never touch)
    const allowed = new Uint8Array(N), ownS = new Uint8Array(N);
    for (let i = 0; i < N; i++) ownS[i] = ownSub(i);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      allowed[i] = ownS[i - W - 1] & ownS[i - W] & ownS[i - W + 1] & ownS[i - 1] & ownS[i] & ownS[i + 1] & ownS[i + W - 1] & ownS[i + W] & ownS[i + W + 1];
    }
    const odd = (v, o) => ((v + o) & 1) === 1;              // global odd lattice: same in every sector
    const gox = (ox * 3) & 1, goy = (oy * 3) & 1;
    const node = (x, y) => odd(x, gox) && odd(y, goy);
    // occ: 0 free, 1 carved, 2 margin/solid belonging to a feature (owner in resv)
    const occ = new Uint8Array(N), resv = new Int32Array(N).fill(-1), feat = new Int32Array(N).fill(-1), isDoor = new Uint8Array(N);
    const features = []; // {kind: 'room'|'portal'|'corridor', access, roomIdx?}
    const rooms = [];
    const carve = (i, f) => { occ[i] = 1; feat[i] = f; resv[i] = f; };
    const margin = (i, f) => { if (occ[i] === 0) { occ[i] = 2; resv[i] = f; } };
    const ring = (i, f) => { const x = i % W, y = (i / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) margin(ny * W + nx, f); } };

    // shapes: which cells of a rect are floor
    function shapeCells(t, x0, y0, x1, y1, goal) {
      const w = x1 - x0 + 1, h = y1 - y0 + 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, out = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - x0, dy = y - y0, ex = x1 - x, ey = y1 - y;
        let on = true;
        if (t.shape === 'octagon') { const c = Math.max(1, Math.floor(Math.min(w, h) / 3)); on = Math.min(dx, ex) + Math.min(dy, ey) >= c; }
        else if (t.shape === 'round') { const rx = w / 2, ry = h / 2; on = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.08; }
        else if (t.shape === 'cloister') { const c = t.court || 2; on = !(dx > c && ex > c && dy > c && ey > c); }
        else if (t.shape === 'cross') { const bw = Math.max(1, Math.floor(w / 5)), bh = Math.max(1, Math.floor(h / 5)); on = Math.abs(x - cx) <= bw + 0.5 || Math.abs(y - cy) <= bh + 0.5 || (Math.min(dx, ex) >= 2 && Math.min(dy, ey) >= 2 && !(Math.min(dx, ex) <= bw + 1 && Math.min(dy, ey) <= bh + 1)); }
        else if (t.shape === 'pillars') { if (dx >= 2 && ex >= 2 && dy >= 2 && ey >= 2 && dx % 4 === 2 && dy % 4 === 2 && !(goal && Math.abs(x - cx) < 2.5 && Math.abs(y - cy) < 2.5)) on = false; }
        else if (t.shape === 'hall') { const horiz = w >= h; const a = horiz ? dy : dx, b = horiz ? ey : ex, along = horiz ? dx : dy, alongE = horiz ? ex : ey; if ((a === 2 || b === 2) && along >= 2 && alongE >= 2 && along % 2 === 0 && (horiz ? h : w) >= 7) on = false; }
        if (on) out.push(y * W + x);
      }
      return out;
    }
    // shape masks cached by type and size, so candidate positions are checked without building cell lists
    const maskCache = new Map();
    function shapeMask(type, w, h) {
      const key = type + ':' + w + 'x' + h; let m = maskCache.get(key); if (m) return m;
      const t = ROOM_TYPES[type], cells = shapeCells(t, 0, 0, w - 1, h - 1, t.goal); m = new Uint8Array(w * h);
      cells.forEach(i => { m[((i / W) | 0) * w + (i % W)] = 1; }); maskCache.set(key, m); return m;
    }
    const inShape = (type, x0, y0, x1, y1) => { const w = x1 - x0 + 1, m = shapeMask(type, w, y1 - y0 + 1); return i => { const x = i % W - x0, y = ((i / W) | 0) - y0; return x >= 0 && y >= 0 && x < w && y <= y1 - y0 && m[y * w + x] === 1; }; };
    // can a rect (plus its one-cell margin) go here? cells reserved by `except` (the parent) may be shared
    function fits(x0, y0, x1, y1, except, absorb) {
      if (x0 < 2 || y0 < 2 || x1 > W - 3 || y1 > H - 3) return false;
      for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
        const i = y * W + x;
        if (!allowed[i]) return false;
        if (absorb !== undefined && resv[i] === absorb) continue; // the room may take over its own portal's path
        if (occ[i] === 1) return false;
        if (occ[i] === 2 && resv[i] !== except) return false;
        if (y >= y0 && y <= y1 && x >= x0 && x <= x1 && occ[i] !== 0) return false;
      }
      return true;
    }
    function addRoom(type, x0, y0, x1, y1, extra) {
      const t = ROOM_TYPES[type], f = features.length, r = rooms.length;
      features.push({ kind: 'room', access: t.access, room: r });
      const cells = shapeCells(t, x0, y0, x1, y1, t.goal);
      cells.forEach(i => carve(i, f));
      for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) margin(y * W + x, f);
      const room = { type, name: t.name, x0, y0, x1, y1, f, cells, cx: (x0 + x1) >> 1, cy: (y0 + y1) >> 1, ...extra };
      rooms.push(room); return room;
    }
    const randOdd = (lo, hi) => { const n = Math.floor((hi - lo) / 2) + 1; return lo + 2 * Math.floor(rng() * n); };
    const alignUp = (v, o) => (odd(v, o) ? v : v + 1);
    // a door through the wall between two carved cells a (inside room A) and b (inside room B), wall cell between
    const floorAt = i => occ[i] === 1;

    // ---------- portals: the path in from each doorway; seals and pits get a small hall ----------
    const portalInfo = portals.map((p, k) => {
      const d = p.dir, inward = (d + 2) & 3, ds = doorSub(p);
      let x = ds % W, y = (ds / W) | 0;
      const path = [y * W + x];
      // walk inward until clear of the border margin, then onto the lattice
      for (let s = 0; s < 12; s++) {
        x += DX[inward]; y += DY[inward]; path.push(y * W + x);
        if (s >= 2 && allowed[y * W + x] && node(x, y)) break;
      }
      if (!node(x, y)) { // side-step onto an odd column/row
        const side = DX[inward] ? [0, 2] : [1, 3];
        for (const sd of side) { const nx = x + DX[sd], ny = y + DY[sd]; if (node(nx, ny) && allowed[ny * W + nx]) { x = nx; y = ny; path.push(y * W + x); break; } }
        if (!node(x, y)) { x += DX[inward]; y += DY[inward]; path.push(y * W + x); }
      }
      const forward = p.cross && p.kind !== 'parent' && p.kind !== 'parent-extra';
      const entrance = p.kind === 'parent';
      const f = features.length;
      features.push({ kind: 'portal', access: forward ? 'private' : 'public', portal: k });
      path.forEach(i => carve(i, f));
      path.forEach(i => { if (allowed[i]) ring(i, f); });
      return { p, path, end: path[path.length - 1], f, forward, entrance, hall: null };
    });
    // gate halls: every crossing into another sector is a processional hall three cells wide through the
    // border, opening into a gate room. Both sectors derive its size from the same border key, so the two
    // halves mirror each other and read as one hall. The door and hub cells are carved whole (they are this
    // sector's, and the neighbour's matching cells lie straight across), so the hall can be wider than a door.
    const passage = new Uint8Array(N), runner = [], braziers = [];
    portalInfo.forEach(pi => {
      const p = pi.p, d = p.dir, inward = (d + 2) & 3, horizAxis = d === 1 || d === 3; // travel along x for east/west doors
      const key = h32(S.seed, 2 * p.gdoor[0] + DX[d], 2 * p.gdoor[1] + DY[d], 5501);
      const sizes = [[7 + 2 * (key % 2), 5 + 2 * ((key >>> 1) % 3)], [7, 5], [5, 5], [5, 3], [3, 3]];
      const cells = [];
      for (const [cx, cy] of [p.door, p.hub]) {
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || !own[cy * COLS + cx]) return;
        for (let k = 0; k < 9; k++) cells.push((cy * 3 + ((k / 3) | 0)) * W + cx * 3 + (k % 3));
      }
      // the gate room beyond the hub cell, centred on the hall; the hall runs further in (three wide) until it fits
      const hx = p.hub[0] * 3 + 1, hy = p.hub[1] * 3 + 1; // centre sub-cell of the hub cell
      let room = null;
      for (const ext of [0, 1, 2, 3, 4, 6, 9]) {
        // the extra stretch of hall, all in cells this sector owns and free
        const more = [];
        let okExt = true;
        for (let k = 0; k < ext && okExt; k++) for (let a = -1; a <= 1; a++) {
          const x = horizAxis ? hx + DX[inward] * (2 + k) : hx + a, y = horizAxis ? hy + a : hy + DY[inward] * (2 + k), i = y * W + x;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || !ownSub(i) || (occ[i] === 1 && feat[i] !== pi.f)) { okExt = false; break; }
          more.push(i);
        }
        if (!okExt) break;
        for (const [across, depth] of sizes) {
          let x0, y0, x1, y1;
          const off = 2 + ext;
          if (horizAxis) { y0 = hy - (across >> 1); y1 = y0 + across - 1; if (inward === 1) { x0 = hx + off; x1 = x0 + depth - 1; } else { x1 = hx - off; x0 = x1 - depth + 1; } }
          else { x0 = hx - (across >> 1); x1 = x0 + across - 1; if (inward === 2) { y0 = hy + off; y1 = y0 + depth - 1; } else { y1 = hy - off; y0 = y1 - depth + 1; } }
          if (!fits(x0, y0, x1, y1, -2, pi.f)) continue;
          const name = p.cross ? landmarkName(info, p) : 'Passage';
          room = addRoom('gateHall', x0, y0, x1, y1, { gate: true, portal: p, name, threshold: !(p.cross && name === 'Unsealed pit') });
          cells.push(...more);
          break;
        }
        if (room) break;
      }
      if (!room) {
        // no space for a gate room (two crossings crowd a corner): the processional hall alone, then the path in
        const free = cells.filter(i => occ[i] !== 1 || feat[i] === pi.f);
        if (free.length < cells.length) return;
        cells.forEach(i => { carve(i, pi.f); passage[i] = 1; for (let e = 0; e < 4; e++) passage[i + DX[e] + DY[e] * W] = 1; });
        cells.forEach(i => { if (allowed[i]) ring(i, pi.f); });
        pi.hallOnly = true;
        const ds = doorSub(p); let x = ds % W, y = (ds / W) | 0;
        for (let k = 0; k < 6; k++) { runner.push([y * W + x, horizAxis ? 'h' : 'v']); x += DX[inward]; y += DY[inward]; }
        return;
      }
      const f = room.f;
      features[f].access = pi.forward ? 'private' : 'public';
      cells.forEach(i => { carve(i, f); }); cells.forEach(i => { if (allowed[i]) ring(i, f); });
      pi.path.forEach(i => { if (feat[i] === pi.f) feat[i] = f; }); pi.f = f; pi.hall = room;
      // the processional: a runner down the middle from the border to the far wall of the gate room, braziers flanking
      const along = horizAxis ? [room.x0, room.x1] : [room.y0, room.y1];
      if (!room.threshold) for (let y = room.y0 - 1; y <= room.y1 + 1; y++) for (let x = room.x0 - 1; x <= room.x1 + 1; x++) passage[y * W + x] = 2; // a pit room keeps its stratum's tiles
      cells.forEach(i => { passage[i] = 1; for (let e = 0; e < 4; e++) if (passage[i + DX[e] + DY[e] * W] !== 2) passage[i + DX[e] + DY[e] * W] = 1; }); // the hall is always a threshold
      if (room.threshold) {
        for (let y = room.y0 - 1; y <= room.y1 + 1; y++) for (let x = room.x0 - 1; x <= room.x1 + 1; x++) passage[y * W + x] = 1;
        // the hall's side walls too, so the tiles change at the threshold
        cells.forEach(i => { for (let e = 0; e < 4; e++) passage[i + DX[e] + DY[e] * W] = 1; });
      }
      const ds = doorSub(p); let x = ds % W, y = (ds / W) | 0;
      for (let s2 = 0; s2 < 40; s2++) {
        const i = y * W + x; if (!floorAt(i)) break;
        runner.push([i, horizAxis ? 'h' : 'v']);
        if (horizAxis ? (inward === 1 ? x >= along[1] - 1 : x <= along[0] + 1) : (inward === 2 ? y >= along[1] - 1 : y <= along[0] + 1)) break;
        x += DX[inward]; y += DY[inward];
      }
      if (room.threshold) {
        const bx = [room.x0 + 1, room.x1 - 1], by = [room.y0 + 1, room.y1 - 1];
        if (room.x1 - room.x0 >= 4 && room.y1 - room.y0 >= 4) bx.forEach(xx => by.forEach(yy => braziers.push(yy * W + xx)));
      }
    });

    // ---------- districts: regions of the sector with their own theme ----------
    // district 0 is the sector's theme (it holds the spine); the others pick other themes of the stratum, and a
    // district next to a seal or pit may belong to the neighbouring stratum, so the change of stratum is felt
    // a region before it is reached.
    const districts = [{ x: W / 2, y: H / 2, theme, stratum: info.type }];
    {
      const nd = 1 + Math.floor(rng() * 2), others = THEMES[info.type].filter(t => t !== theme);
      const crossing = portalInfo.filter(pi => pi.p.cross);
      for (let k = 0; k < nd; k++) {
        const near = crossing[k];
        if (near && rng() < 0.7) { // a borrowed district around a seal
          const list = THEMES[near.p.toType], hx = near.end % W, hy = (near.end / W) | 0;
          districts.push({ x: hx * 0.6 + W / 2 * 0.4, y: hy * 0.6 + H / 2 * 0.4, theme: list[Math.floor(rng() * list.length)], stratum: near.p.toType, borrowed: true });
        } else {
          districts.push({ x: W * (0.15 + rng() * 0.7), y: H * (0.15 + rng() * 0.7), theme: others[Math.floor(rng() * others.length)] || theme, stratum: info.type });
        }
      }
      // the sector's own district sits away from the others
      if (districts.length > 1) { const ax = districts.slice(1).reduce((a, d) => a + d.x, 0) / (districts.length - 1), ay = districts.slice(1).reduce((a, d) => a + d.y, 0) / (districts.length - 1); districts[0].x = Math.max(W * 0.2, Math.min(W * 0.8, W - ax)); districts[0].y = Math.max(H * 0.2, Math.min(H * 0.8, H - ay)); }
    }
    const nzd = makeNoise(seed ^ 0x2d17);
    const districtAt = (x, y) => { let b = 0, bd = 1e9; districts.forEach((d, k) => { const dd = Math.hypot(x - d.x, y - d.y) * (0.85 + 0.3 * nzd(x * 0.05 + k * 7, y * 0.05)); if (dd < bd) { bd = dd; b = k; } }); return b; };

    // ---------- the mission graph, placed as suites ----------
    const { nodes, goal } = expand(theme, rng);
    const target = (() => { // where the spine should head: the way onward, else away from the entrance
      const fw = portalInfo.filter(q => q.forward);
      if (fw.length) return [fw.reduce((a, q) => a + q.end % W, 0) / fw.length, fw.reduce((a, q) => a + ((q.end / W) | 0), 0) / fw.length];
      const en = portalInfo.find(q => q.entrance);
      if (en) return [W - en.end % W, H - ((en.end / W) | 0)];
      return [W / 2 + (rng() - 0.5) * W * 0.6, H / 2 + (rng() - 0.5) * H * 0.6];
    })();
    // the start room: at the centre of the starting sector, else near the entrance (linked by corridor later)
    const start = nodes[0], st0 = ROOM_TYPES[start.type];
    {
      const en = portalInfo.find(q => q.entrance), anchor = en ? (en.hall || null) : null;
      const ax = en ? (anchor ? anchor.cx : en.end % W) : W >> 1, ay = en ? (anchor ? anchor.cy : (en.end / W) | 0) : H >> 1;
      let best = null, bs = 1e9;
      for (let tries = 0; tries < 160; tries++) {
        const w = randOdd(st0.w[0], st0.w[1]), h = randOdd(st0.h[0], st0.h[1]);
        const r = en ? 6 + rng() * 14 : rng() * 6, a = rng() * 6.283;
        const x0 = alignUp(Math.round(ax + Math.cos(a) * r - w / 2), gox), y0 = alignUp(Math.round(ay + Math.sin(a) * r - h / 2), goy);
        const x1 = x0 + w - 1, y1 = y0 + h - 1;
        if (!fits(x0, y0, x1, y1, -2)) continue;
        const sc = Math.hypot((x0 + x1) / 2 - ax, (y0 + y1) / 2 - ay) * 0.5 + Math.hypot((x0 + x1) / 2 - target[0], (y0 + y1) / 2 - target[1]) * 0.15;
        if (sc < bs) { bs = sc; best = [x0, y0, x1, y1]; }
      }
      if (!best) return { ok: false, error: 'no room for the start' };
      start.room = addRoom(start.type, ...best, { depth: 0 });
    }
    // place a room of `type` next to room P, joined by a door in a shared wall or a straight corridor;
    // scored towards `toward` when given (the spine), else the first fit. Returns the room or null.
    function attach(P, type, link, toward, tries, extra) {
      const t = ROOM_TYPES[type];
      let best = null, bs = 1e9;
      for (let tr = 0; tr < tries; tr++) {
        let w = randOdd(t.w[0], t.w[1]), h = randOdd(t.h[0], t.h[1]);
        if (t.long && rng() < 0.5) [w, h] = [h, w];
        const d = Math.floor(rng() * 4), gap = link === 'corridor' ? 3 + 2 * Math.floor(rng() * 4) : 1;
        let x0, y0;
        if (d === 1 || d === 3) {
          x0 = d === 1 ? P.x1 + 1 + gap : P.x0 - gap - w;
          const lo = P.y0 - h + 3, hi = P.y1 - 2; if (hi < lo) continue;
          y0 = alignUp(lo + Math.floor(rng() * (hi - lo + 1)), goy);
        } else {
          y0 = d === 2 ? P.y1 + 1 + gap : P.y0 - gap - h;
          const lo = P.x0 - w + 3, hi = P.x1 - 2; if (hi < lo) continue;
          x0 = alignUp(lo + Math.floor(rng() * (hi - lo + 1)), gox);
        }
        const x1 = x0 + w - 1, y1 = y0 + h - 1;
        if (!node(x0, y0) || !fits(x0, y0, x1, y1, link === 'door' ? P.f : -2)) continue;
        const spots = linkSpots(P, { x0, y0, x1, y1, has: inShape(type, x0, y0, x1, y1) }, d);
        if (!spots.length) continue;
        const sc = toward ? Math.hypot((x0 + x1) / 2 - toward[0], (y0 + y1) / 2 - toward[1]) : 0;
        if (sc < bs) { bs = sc; best = { x0, y0, x1, y1, d, spots }; }
        if (!toward) break;
      }
      if (!best) return null;
      const R = addRoom(type, best.x0, best.y0, best.x1, best.y1, extra || {});
      linkRooms(P, R, best.d, best.spots);
      links.push([P, R, link]);
      return R;
    }
    // children: the spine first (towards the target), then branches; a branch that cannot fit is dropped
    const order = nodes.map((n, k) => k).filter(k => k > 0).sort((a, b) => (nodes[b].spine - nodes[a].spine) || (nodes[a].depth - nodes[b].depth));
    const links = []; // [roomA, roomB, kind]
    for (const k of order) {
      const n = nodes[k], par = nodes[n.parent];
      if (!par.room) continue;
      n.room = attach(par.room, n.type, n.link, n.spine ? target : null, n.spine ? 140 : 50, { depth: n.depth, spine: n.spine, goal: k === goal });
      if (!n.room && n.spine) return { ok: false, error: `no room for ${n.type}` };
    }
    // where a door (or straight corridor) can join room P to a rect R placed on side d: positions along the
    // shared span where both rooms have floor and the cells between are free; returns the wall/corridor cells
    function linkSpots(P, R, d, gap) {
      const out = [], horiz = d === 1 || d === 3, s = d === 1 || d === 2 ? 1 : -1;
      const isR = i => R.has ? R.has(i) : floorAt(i);
      const lo = horiz ? Math.max(P.y0, R.y0) + 1 : Math.max(P.x0, R.x0) + 1, hi = horiz ? Math.min(P.y1, R.y1) - 1 : Math.min(P.x1, R.x1) - 1;
      for (let v = lo; v <= hi; v++) {
        const a = horiz ? v * W + (d === 1 ? P.x1 : P.x0) : (d === 2 ? P.y1 : P.y0) * W + v;
        const b = horiz ? v * W + (d === 1 ? R.x0 : R.x1) : (d === 2 ? R.y0 : R.y1) * W + v;
        if (!floorAt(a) || !isR(b)) continue;
        const cells = []; let ok = true;
        for (let c = a + (horiz ? s : s * W); c !== b; c += horiz ? s : s * W) {
          if (!allowed[c] || occ[c] === 1 || (occ[c] === 2 && resv[c] !== P.f && !(R.f !== undefined && resv[c] === R.f))) { ok = false; break; }
          cells.push(c);
        }
        if (ok && cells.length) out.push({ cells, lattice: horiz ? odd(v, goy) : odd(v, gox) });
      }
      return out;
    }
    function linkRooms(P, R, d, spots) {
      spots = spots.filter(sp => sp.cells.every(c => occ[c] !== 1 && (occ[c] !== 2 || resv[c] === P.f || resv[c] === R.f)));
      const on = spots.filter(sp => sp.lattice), pool = on.length ? on : spots, sp = pool[Math.floor(rng() * pool.length)];
      sp.cells.forEach(c => { carve(c, R.f); isDoor[c] = 1; });
      if (sp.cells.length > 1) sp.cells.forEach(c => ring(c, R.f));
    }

    // ---------- corridors routed through free space (start ← entrance, goal → ways onward) ----------
    // BFS over free cells; may enter cells reserved by the two endpoints; succeeds next to a carved cell of `to`
    function route(fromF, toF, f) {
      const prev = new Int32Array(N).fill(-2), q = [];
      for (let i = 0; i < N; i++) {
        if (occ[i] !== 2 || resv[i] !== fromF || !allowed[i]) continue;
        // a margin cell straight off a floor cell of `from` (not a corner)
        let nearDoor = false; for (let d = 0; d < 4; d++) if (isDoor[i + DX[d] + DY[d] * W]) nearDoor = true;
        if (nearDoor) continue;
        for (let d = 0; d < 4; d++) { const j = i + DX[d] + DY[d] * W; if (feat[j] === fromF && occ[j] === 1 && !isDoor[j]) { prev[i] = -1; q.push(i); break; } }
      }
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d], j = ny * W + nx;
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || prev[j] !== -2) continue;
          if (occ[j] === 1) { if (feat[j] === toF) return finish(i, prev, f); continue; }
          if (!allowed[j]) continue;
          if (occ[j] === 2 && resv[j] !== fromF && resv[j] !== toF) continue;
          // stay clear of every other feature: no neighbour carved by someone else
          let clear = true;
          for (let e = 0; e < 4; e++) { const k = j + DX[e] + DY[e] * W; if ((occ[k] === 1 && feat[k] !== fromF && feat[k] !== toF) || isDoor[k]) { clear = false; break; } }
          if (!clear) continue;
          prev[j] = i; q.push(j);
        }
      }
      return false;
    }
    function finish(i, prev, f) {
      const cells = []; for (let c = i; c !== -1; c = prev[c]) cells.push(c);
      cells.forEach(c => carve(c, f));
      cells.forEach(c => ring(c, f));
      return true;
    }
    const goalRoom = nodes[goal].room;
    const newFeature = access => { features.push({ kind: 'corridor', access }); return features.length - 1; };
    for (const pi of portalInfo) {
      const from = pi.hall ? pi.hall.f : pi.f;
      if (pi.entrance) { if (!route(start.room.f, from, newFeature('public'))) return { ok: false, error: 'entrance unreachable' }; }
      else if (pi.forward) { if (!route(goalRoom.f, from, newFeature('private'))) return { ok: false, error: 'way onward unreachable from the goal' }; }
    }

    // ---------- wings: more small suites from the theme, packed into the sector ----------
    // half grow off an existing public room (building complexes), half stand alone and meet the maze
    {
      const [wmin, wmax] = theme.wingCount || [0, 0], wn = wmin + Math.floor(rng() * (wmax - wmin + 1));
      for (let w = 0; w < wn; w++) {
        // a spot first, then the wing that its district's theme builds there
        const pub = rooms.filter(r => ROOM_TYPES[r.type].access === 'public' && !r.gate);
        const host = pub.length && rng() < 0.5 ? pub[Math.floor(rng() * pub.length)] : null;
        const px = host ? host.cx : 2 + rng() * (W - 4), py = host ? host.cy : 2 + rng() * (H - 4), dk = districtAt(px, py), dth = districts[dk].theme;
        const [rootType, kids] = dth.wings[Math.floor(rng() * dth.wings.length)], t = ROOM_TYPES[rootType];
        let root = null;
        if (host && districtAt(host.cx, host.cy) === dk) root = attach(host, rootType, rng() < 0.6 ? 'door' : 'corridor', null, 40, { depth: -1, wing: w, district: dk });
        for (let tr = 0; !root && tr < 80; tr++) {
          let ww = randOdd(t.w[0], t.w[1]), hh = randOdd(t.h[0], t.h[1]); if (t.long && rng() < 0.5) [ww, hh] = [hh, ww];
          const x0 = alignUp(Math.round(px - ww / 2 + (rng() - 0.5) * 24), gox), y0 = alignUp(Math.round(py - hh / 2 + (rng() - 0.5) * 24), goy);
          if (districtAt(x0 + ww / 2, y0 + hh / 2) !== dk) continue;
          if (fits(x0, y0, x0 + ww - 1, y0 + hh - 1, -2)) root = addRoom(rootType, x0, y0, x0 + ww - 1, y0 + hh - 1, { depth: -1, wing: w, district: dk });
        }
        if (!root) continue;
        kids.forEach(([type, min, max, link]) => { const n = min + Math.floor(rng() * (max - min + 1)); for (let j = 0; j < n; j++) attach(root, type, link, null, 40, { depth: -1, wing: w, district: dk }); });
      }
    }

    // ---------- public rooms scattered through the maze ----------
    (theme.fill || []).forEach(([type, min, max]) => {
      const t = ROOM_TYPES[type], n = min + Math.floor(rng() * (max - min + 1));
      for (let j = 0; j < n; j++) for (let tr = 0; tr < 60; tr++) {
        const w = randOdd(t.w[0], t.w[1]), h = randOdd(t.h[0], t.h[1]);
        const x0 = alignUp(2 + Math.floor(rng() * (W - w - 4)), gox), y0 = alignUp(2 + Math.floor(rng() * (H - h - 4)), goy);
        if (fits(x0, y0, x0 + w - 1, y0 + h - 1, -2)) { addRoom(type, x0, y0, x0 + w - 1, y0 + h - 1, { depth: -1 }); break; }
      }
    });

    // ---------- the corridors: growing tree on a lattice through free space ----------
    // the theme sets the spacing: 2 is a dense labyrinth; 4-6 leaves room between hallways for rooms off them
    const MAZE = newFeature('public');
    const free = i => occ[i] === 0 && allowed[i];
    const K = theme.step || 2, onGrid = (v, o) => ((((v + o - 1) % K) + K) % K) === 0;
    const lattice = [], lastDir = new Int8Array(N).fill(-1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (onGrid(x, ox * 3) && onGrid(y, oy * 3) && free(y * W + x)) lattice.push(y * W + x);
    for (let k = lattice.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [lattice[k], lattice[j]] = [lattice[j], lattice[k]]; }
    for (const s0 of lattice) {
      if (occ[s0] !== 0) continue;
      carve(s0, MAZE); const stack = [s0];
      while (stack.length) {
        const pick = rng() < 0.75 ? stack.length - 1 : Math.floor(rng() * stack.length), c = stack[pick], x = c % W, y = (c / W) | 0;
        const dirs = [0, 1, 2, 3].filter(d => { const nx = x + K * DX[d], ny = y + K * DY[d]; if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) return false; for (let k = 1; k <= K; k++) if (!free((y + k * DY[d]) * W + x + k * DX[d])) return false; return true; });
        if (!dirs.length) { stack.splice(pick, 1); continue; }
        const ld = lastDir[c], d = ld >= 0 && dirs.includes(ld) && rng() < (theme.straight || 0) ? ld : dirs[Math.floor(rng() * dirs.length)];
        for (let k = 1; k < K; k++) carve((y + k * DY[d]) * W + x + k * DX[d], MAZE);
        const nn = (y + K * DY[d]) * W + x + K * DX[d]; carve(nn, MAZE); lastDir[nn] = d; stack.push(nn);
      }
    }

    // ---------- connectors: open walls between regions, as the grammar allows ----------
    // components of the carved floor
    const comp = new Int32Array(N).fill(-1); let ncomp = 0;
    for (let i = 0; i < N; i++) {
      if (occ[i] !== 1 || comp[i] >= 0) continue;
      const q = [i]; comp[i] = ncomp;
      for (let h = 0; h < q.length; h++) { const c = q[h]; for (let d = 0; d < 4; d++) { const j = c + DX[d] + DY[d] * W; if (occ[j] === 1 && comp[j] < 0) { comp[j] = ncomp; q.push(j); } } }
      ncomp++;
    }
    const isPublic = i => occ[i] === 1 && features[feat[i]].access === 'public';
    const cand = [];
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x; if (occ[i] === 1 || !allowed[i]) continue;
      for (const d of [1, 2]) {
        const a = i - DX[d] - DY[d] * W, b = i + DX[d] + DY[d] * W;
        if (!isPublic(a) || !isPublic(b) || comp[a] === comp[b]) continue;
        // never cut the side walls of the cell: the two cells across must not be floor (keeps walls one cell thick)
        const s1 = i + DX[(d + 1) & 3] + DY[(d + 1) & 3] * W, s2 = i + DX[(d + 3) & 3] + DY[(d + 3) & 3] * W;
        if (occ[s1] === 1 || occ[s2] === 1) continue;
        // room connectors prefer the middle of a wall (on the lattice)
        cand.push([i, comp[a], comp[b], feat[a] === MAZE && feat[b] === MAZE ? 1 : 0]);
      }
    }
    for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
    const parent = Array.from({ length: ncomp }, (_, k) => k), findc = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const openWall = i => carve(i, MAZE);
    cand.forEach(([i, a, b, mm]) => {
      const ra = findc(a), rb = findc(b);
      if (ra !== rb) { parent[ra] = rb; openWall(i); }
      else if (rng() < theme.braid * (mm ? 1 : 0.5)) openWall(i);
    });

    // ---------- trim the maze's dead ends back, so rooms stand out and density follows the theme ----------
    {
      const keep = theme.maze, passes = Math.round((1 - keep) * 90);
      const deg = i => (occ[i - 1] === 1) + (occ[i + 1] === 1) + (occ[i - W] === 1) + (occ[i + W] === 1);
      let layer = [];
      for (let i = W; i < N - W; i++) if (occ[i] === 1 && feat[i] === MAZE && deg(i) <= 1) layer.push(i);
      for (let p = 0; p < passes && layer.length; p++) {
        layer.forEach(i => { occ[i] = 0; feat[i] = -1; });
        const next = [];
        layer.forEach(i => { for (const j of [i - 1, i + 1, i - W, i + W]) if (occ[j] === 1 && feat[j] === MAZE && deg(j) <= 1 && !next.includes(j)) next.push(j); });
        layer = next;
      }
    }

    // ---------- validate: reach, and the gate ----------
    const pass = new Uint8Array(N); for (let i = 0; i < N; i++) pass[i] = occ[i] === 1 ? 1 : 0;
    const startSub = info.sx === 0 && info.sy === 0 ? (start.room.cy * W + start.room.cx) : doorSub(portalInfo.find(q => q.entrance).p);
    const bfs = (block) => {
      const dist = new Int32Array(N).fill(-1), q = [startSub]; dist[startSub] = 0;
      for (let h = 0; h < q.length; h++) { const c = q[h]; for (let d = 0; d < 4; d++) { const j = c + DX[d] + DY[d] * W; if (pass[j] && dist[j] < 0 && !(block && block.has(j))) { dist[j] = dist[c] + 1; q.push(j); } } }
      return dist;
    };
    let dist = bfs(null);
    const doors = portals.map(p => doorSub(p));
    // link-up: a public crossing (gate room or path) the maze could not reach gets a corridor to the nearest
    // reachable public floor, through free cells and public margins only (never past private rooms)
    // public rooms the corridors did not reach get the same treatment (wider corridor spacing leaves some)
    const lostRooms = () => rooms.find(r => features[r.f].access === 'public' && !r.gate && !r.cells.some(i => dist[i] >= 0) && !r.linkTried);
    for (let round = 0; round < portals.length + rooms.length; round++) {
      const lostP = portalInfo.find((pi, k) => !pi.forward && dist[doors[k]] < 0 && !pi.linkTried), lostR = lostP ? null : lostRooms();
      if (!lostP && !lostR) break;
      if (lostP) lostP.linkTried = true; else lostR.linkTried = true;
      const f = lostP ? lostP.f : lostR.f, prev = new Int32Array(N).fill(-2), q = [];
      for (let i = 0; i < N; i++) if (pass[i] && feat[i] === f) { prev[i] = -1; q.push(i); }
      let hit = -1;
      for (let h = 0; h < q.length && hit < 0; h++) {
        const c = q[h], x = c % W, y = (c / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d], j = ny * W + nx;
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || prev[j] !== -2) continue;
          if (pass[j] && dist[j] >= 0 && features[feat[j]] && features[feat[j]].access === 'public') { prev[j] = c; hit = j; break; }
          if (pass[j] || !allowed[j]) continue;
          if (occ[j] === 2 && resv[j] >= 0 && features[resv[j]].access === 'private') continue;
          let clear = true; for (let e = 0; e < 4; e++) { const k = j + DX[e] + DY[e] * W; if (pass[k] && feat[k] >= 0 && features[feat[k]].access === 'private') clear = false; }
          if (!clear) continue;
          prev[j] = c; q.push(j);
        }
      }
      if (hit < 0) continue;
      const added = [];
      for (let c = prev[hit]; c >= 0 && feat[c] !== f; c = prev[c]) { carve(c, MAZE); pass[c] = 1; added.push(c); }
      // extend the reach from the new link only, instead of flooding the whole sector again
      const q2 = added.filter(c => dist[c] < 0); q2.forEach(c => { dist[c] = 1; });
      for (let h = 0; h < q2.length; h++) { const c = q2[h]; for (let d = 0; d < 4; d++) { const j = c + DX[d] + DY[d] * W; if (pass[j] && dist[j] < 0) { dist[j] = dist[c] + 1; q2.push(j); } } }
    }
    // ---------- rooms off the corridors (after link-up, so its corridors get rooms too) ----------
    // A long hallway in a real building has doors along it: along every straight run of corridor, small rooms
    // from the district's theme open straight off it every few cells, alternating sides; and a corridor that
    // ends blind ends in a room instead.
    {
      const isCorr = i => occ[i] === 1 && feat[i] >= 0 && features[feat[i]].kind !== 'room';
      const offCorridor = (cx, cy, d) => { // a room beyond one wall on side d of corridor cell (cx, cy); returns success
        const dk = districtAt(cx, cy), th = districts[dk].theme, list = th.side || ['cell'];
        const type = list[Math.floor(rng() * list.length)], t = ROOM_TYPES[type];
        for (let tr = 0; tr < 4; tr++) {
          let w = randOdd(t.w[0], t.w[1]), h = randOdd(t.h[0], t.h[1]);
          if (tr >= 2) { w = 3; h = 3; }
          let x0, y0;
          if (d === 0 || d === 2) { x0 = cx - 1 - Math.floor(rng() * Math.max(1, w - 2)); y0 = d === 0 ? cy - 1 - h : cy + 2; }
          else { y0 = cy - 1 - Math.floor(rng() * Math.max(1, h - 2)); x0 = d === 3 ? cx - 1 - w : cx + 2; }
          const x1 = x0 + w - 1, y1 = y0 + h - 1, door = (cy + DY[d]) * W + cx + DX[d];
          if (!fits(x0, y0, x1, y1, feat[cy * W + cx])) continue; // may share the corridor's own margin
          if (!inShape(type, x0, y0, x1, y1)(door + DX[d] + DY[d] * W)) continue; // the door must open onto floor
          if (occ[door] === 1 || [1, 3].some(e => occ[door + DX[(d + e) & 3] + DY[(d + e) & 3] * W] === 1)) continue;
          const R = addRoom(type, x0, y0, x1, y1, { depth: -1, district: dk, off: true });
          carve(door, R.f); isDoor[door] = 1;
          return true;
        }
        return false;
      };
      // a public room already across the wall gets a door onto the hallway
      const doorInto = (x, y, d) => {
        const w = (y + DY[d]) * W + x + DX[d], r = w + DX[d] + DY[d] * W;
        if (occ[w] === 1 || occ[r] !== 1 || feat[r] < 0) return false;
        const fr = features[feat[r]];
        if (fr.kind !== 'room' || fr.access !== 'public' || rooms[fr.room].gate) return false;
        const s1 = w + DX[(d + 1) & 3] + DY[(d + 1) & 3] * W, s2 = w + DX[(d + 3) & 3] + DY[(d + 3) & 3] * W;
        if (occ[s1] === 1 || occ[s2] === 1) return false;
        carve(w, feat[r]); isDoor[w] = 1; return true;
      };
      // straight runs, both orientations: each stretch of about eight cells gets a door, into a room that is
      // already across the wall if there is one, else into a new room built off the hallway
      for (const horiz of [true, false]) {
        const A = horiz ? H : W, B = horiz ? W : H, at = (a, b) => horiz ? a * W + b : b * W + a;
        const runs = [];
        for (let a = 2; a < A - 2; a++) {
          let run = [];
          for (let b = 1; b < B - 1; b++) {
            const i = at(a, b), straight = isCorr(i) && (horiz ? occ[i - W] !== 1 && occ[i + W] !== 1 : occ[i - 1] !== 1 && occ[i + 1] !== 1);
            if (straight) run.push(i); else { if (run.length >= 4) runs.push(run); run = []; }
          }
          if (run.length >= 4) runs.push(run);
        }
        runs.forEach(run => {
          for (let k = 0; k < run.length; k += 8) {
            const stretch = run.slice(k, k + 8), order = stretch.map((_, j) => j).sort(() => rng() - 0.5), sides = horiz ? [0, 2] : [1, 3];
            if (rng() < 0.5) sides.reverse();
            let done = false;
            for (const j of order) { const x = stretch[j] % W, y = (stretch[j] / W) | 0; if (doorInto(x, y, sides[0]) || doorInto(x, y, sides[1])) { done = true; break; } }
            for (const j of order) { if (done) break; const x = stretch[j] % W, y = (stretch[j] / W) | 0; if (offCorridor(x, y, sides[0]) || offCorridor(x, y, sides[1])) done = true; }
            // now and then a second door on the other side
            if (done && rng() < 0.3) { const j = order[order.length - 1], x = stretch[j] % W, y = (stretch[j] / W) | 0; offCorridor(x, y, sides[1]); }
          }
        });
      }
      // blind ends finish in a room
      for (let i = W; i < N - W; i++) {
        if (!isCorr(i)) continue;
        const nb = [0, 1, 2, 3].filter(d => occ[i + DX[d] + DY[d] * W] === 1);
        if (nb.length !== 1) continue;
        offCorridor(i % W, (i / W) | 0, (nb[0] + 2) & 3);
      }
    }

    for (let i = 0; i < N; i++) pass[i] = occ[i] === 1 ? 1 : 0;
    dist = bfs(null);
    if (doors.some(i => dist[i] < 0)) return { ok: false, error: 'a doorway is unreachable' };
    if (dist[goalRoom.cy * W + goalRoom.cx] < 0 && !goalRoom.cells.some(i => dist[i] >= 0)) return { ok: false, error: 'goal unreachable' };
    // progression: with the goal room closed, no way onward to the next stratum can be reached
    const gated = bfs(new Set(goalRoom.cells));
    const leak = portalInfo.some(pi => pi.forward && gated[doors[portals.indexOf(pi.p)]] >= 0);
    if (leak) return { ok: false, error: 'the way onward bypasses the goal room' };
    // prune what cannot be reached (maze pockets cut off by private corridors)
    for (let i = 0; i < N; i++) if (dist[i] < 0) pass[i] = 0;

    // stratum (for tiles) per sub-cell: rooms by their district (the spine and gate rooms by the sector's own),
    // corridors and rock by the district they lie in
    const stratumOf = new Uint8Array(N), distOf = new Uint8Array(N);
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
      const k = districtAt(cx * 3 + 1, cy * 3 + 1);
      for (let e = 0; e < 9; e++) { const i = (cy * 3 + ((e / 3) | 0)) * W + cx * 3 + (e % 3); distOf[i] = k; stratumOf[i] = districts[k].stratum; }
    }
    rooms.forEach(r => {
      const k = r.district !== undefined ? r.district : 0, st = r.district !== undefined ? districts[k].stratum : info.type;
      for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) { stratumOf[y * W + x] = st; distOf[y * W + x] = k; }
    });
    // materials (rendered over the tiles): low nibble floor, high nibble walls; 0 = the tileset's own surface.
    // A district has one masonry for its corridors and rock; a building (a wing, or the spine) one masonry for
    // all its rooms; each room one floor, big rooms favouring patterned floors.
    const mat = new Uint8Array(N);
    const dWall = districts.map((d, k) => 1 + (h32(seed, k, 3, 71) % 3));
    for (let i = 0; i < N; i++) if (!pass[i]) mat[i] = dWall[distOf[i]] << 4;
    rooms.forEach((r, k) => {
      if (r.gate) return;
      const bldg = r.wing !== undefined ? 100 + r.wing : r.spine || r.depth === 0 ? 1 : 200 + k;
      const wm = 1 + (h32(seed, bldg, 5, 73) % 3), area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
      const hf = h32(seed, k, 7, 79), fm = (hf % 100) < (area >= 35 || r.goal ? 85 : 35) ? 1 + ((hf >>> 8) % 4) : 0;
      for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) { const i = y * W + x; if (!pass[i]) mat[i] = wm << 4; }
      r.cells.forEach(i => { mat[i] = fm; });
    });
    const roomOf = new Int16Array(N).fill(-1);
    rooms.forEach((r, k) => r.cells.forEach(i => { if (pass[i]) roomOf[i] = k; }));
    // halls: corridor floors (in no room, not a crossing) and the walls lining them that are not a room's own walls
    const hall = new Uint8Array(N), roomWall = new Uint8Array(N);
    rooms.forEach(r => { for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) roomWall[y * W + x] = 1; });
    for (let i = 0; i < N; i++) if (pass[i] && roomOf[i] < 0 && !passage[i] && !isDoor[i]) hall[i] = 1;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (pass[i] || roomWall[i] || passage[i]) continue;
      for (let dy = -1; dy <= 1 && !hall[i]; dy++) for (let dx = -1; dx <= 1; dx++) if (hall[i + dy * W + dx] === 1) { hall[i] = 2; break; }
    }
    return {
      ok: true, pass, roomOf, mat, hall, startSub, theme: { key: theme.key, name: theme.name }, stratumOf, distOf,
      districts: districts.map(d => ({ name: d.theme.name, key: d.theme.key, stratum: d.stratum, borrowed: !!d.borrowed })),
      rooms: rooms.map(r => ({ type: r.type, name: r.name, gate: !!r.gate, district: r.district !== undefined ? r.district : 0, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, cx: r.cx, cy: r.cy, goal: !!r.goal, spine: !!r.spine, depth: r.depth, access: ROOM_TYPES[r.type].access, portal: r.portal ? r.portal.dir : undefined })),
      goal: { cx: goalRoom.cx, cy: goalRoom.cy, name: goalRoom.name },
      halls: portalInfo.map(pi => pi.hall ? { cx: pi.hall.cx, cy: pi.hall.cy, threshold: !!pi.hall.threshold } : pi.hallOnly ? { hallOnly: true } : null),
      passage, runner, braziers,
      doorWide: portals.map(p => { const ds = doorSub(p), x = ds % W, y = (ds / W) | 0; return p.dir === 1 || p.dir === 3 ? [ds - W, ds, ds + W] : [ds - 1, ds, ds + 1]; }),
      mission: nodes.map(n => ({ type: n.type, parent: n.parent, link: n.link, placed: !!n.room, spine: n.spine })),
      links: links.length,
    };
  }
  function landmarkName(info, p) {
    const lvl = (info.type === 2 && p.toType === 0) || (info.type === 0 && p.toType === 2);
    return lvl ? 'Unsealed pit' : 'Seal';
  }

  const api = { roomsLayout, ROOM_TYPES, THEMES, sectorTheme };
  if (isNode) module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
