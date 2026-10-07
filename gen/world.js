// Infinite world: an endless grid of sectors, each a full dungeon from core.js, stitched by shared contracts.
//
// Everything here is decided from a sector's own coordinates (plus the world seed), so any sector can be
// generated on its own, in any order, and always comes out the same. The grammar holds globally because:
//   * Every sector links to a parent one step closer to the start, so all sectors form one tree rooted at
//     the starting sector: everything is reachable.
//   * A sector's tier comes from its distance to the start, so it never drops along the way out, and
//     neighbouring sectors differ by at most one tier. Nothing can skip a tier.
//   * Extra (loop) links only join sectors of the same tier, so branch caps between tiers are untouched.
//   * Each shared border has one contract computed from that border's coordinates: the wobbly line that
//     divides the two sectors, whether it has doorways, and where. Both sides compute it independently.
//   * Neighbouring sectors overlap by a few cells and the wobbly line decides who owns each cell, so borders
//     are irregular walls with several doorways rather than long straight edges.
//   * Each sector is validated as it is generated: every hub and doorway inside must connect.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined';
  if (isNode) { Object.assign(globalThis, require('./mazes.js'), require('./core.js'), require('./dressing.js')); Object.assign(globalThis, require('./rooms.js')); }

  const WORLD_DEFAULTS = { seed: 1, preset: 'underdark', band: 2, loops: 70, doors: 3, hubs: 9, maze: 60, algo: 'growing', ruin: 10 };
  // Sector grids are COLS x ROWS cells but sit CW x CH apart, so neighbours overlap by MARGIN cells each side.
  const MARGIN = 5, CW = COLS - 2 * MARGIN, CH = ROWS - 2 * MARGIN;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function h32(a, b, c, d) {
    let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA77) ^ Math.imul(c | 0, 0xC2B2AE3D) ^ Math.imul(d | 0, 0x27D4EB2F);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
    return h >>> 0;
  }

  // ---------- macro level: tree, tiers, contracts ----------
  function sectorInfo(S, sx, sy) {
    const depth = Math.abs(sx) + Math.abs(sy);
    const tierIndex = Math.floor(depth / S.band), type = tierIndex % 3, level = Math.floor(tierIndex / 3) + 1;
    let parent = null;
    const cands = [];
    if (sx !== 0) cands.push([sx - Math.sign(sx), sy]);
    if (sy !== 0) cands.push([sx, sy - Math.sign(sy)]);
    if (cands.length === 1) parent = cands[0];
    else if (cands.length === 2) {
      // prefer a parent off the axes: axis sectors already carry a forced child, so this keeps branching low
      const axis = c => c[0] === 0 || c[1] === 0, a0 = axis(cands[0]), a1 = axis(cands[1]);
      if (Math.abs(sx) === 1 && Math.abs(sy) === 1) {
        // the four diagonal neighbours of the start take their parents in rotation, so each axis sector next to
        // the start has exactly one diagonal child: with tiers two sectors deep, no sector gets three cross-tier branches
        parent = sx * sy > 0 ? [sx, 0] : [0, sy];
      } else parent = a0 && !a1 ? cands[1] : a1 && !a0 ? cands[0] : cands[h32(S.seed, sx, sy, 77) & 1];
    }
    return { sx, sy, depth, tierIndex, type, level, parent, name: tierName(S, type, level) };
  }
  function tierName(S, type, level) {
    const P = PRESETS[S.preset] || PRESETS.generic;
    // the underdark's strata carry their own names; a numeral only once they recur deeper down
    if (S.preset === 'underdark') return level > 1 ? `${P.tiers[type].name} ${ROMAN[level - 1] || level}` : P.tiers[type].name;
    return `${P.tiers[type].name} ${ROMAN[level - 1] || level}`;
  }
  // ---------- geometry: wobbly borders and cell ownership (all in global cell coordinates) ----------
  // Offset of border line k (axis 0 = vertical lines, 1 = horizontal) at position t along it: -4..4 cells,
  // smoothly varying, from the seed and the line's own index only.
  function wobble(S, axis, k, t) {
    const step = 5, t0 = Math.floor(t / step), f = (t - t0 * step) / step, sm = f * f * (3 - 2 * f);
    const v = i => (h32(S.seed, axis * 7919 + k, i, 4421) % 9) - 4;
    return Math.round(v(t0) + (v(t0 + 1) - v(t0)) * sm);
  }
  function colOf(S, cx, cy) { const k = Math.floor(cx / CW); if (cx < k * CW + wobble(S, 0, k, cy)) return k - 1; if (cx >= (k + 1) * CW + wobble(S, 0, k + 1, cy)) return k + 1; return k; }
  function rowOf(S, cx, cy) { const j = Math.floor(cy / CH); if (cy < j * CH + wobble(S, 1, j, cx)) return j - 1; if (cy >= (j + 1) * CH + wobble(S, 1, j + 1, cx)) return j + 1; return j; }
  // which sector owns a global cell
  function ownerOf(S, cx, cy) { return [colOf(S, cx, cy), rowOf(S, cx, cy)]; }
  const originOf = (sx, sy) => [sx * CW - MARGIN, sy * CH - MARGIN]; // global cell of a sector grid's (0,0)
  function ownedMask(S, sx, sy) {
    const [ox, oy] = originOf(sx, sy), own = new Uint8Array(NC);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const o = ownerOf(S, ox + x, oy + y); own[y * COLS + x] = o[0] === sx && o[1] === sy ? 1 : 0; }
    return own;
  }

  // the contract for the border between two neighbouring sectors: is it open, and where are its doorways
  function edgeContract(S, ax, ay, bx, by) {
    const A = sectorInfo(S, ax, ay), B = sectorInfo(S, bx, by);
    const child = A.depth > B.depth ? A : B, par = child === A ? B : A;
    const tree = !!child.parent && child.parent[0] === par.sx && child.parent[1] === par.sy;
    const cross = A.tierIndex !== B.tierIndex;
    const vertical = ay === by; // neighbours side by side share a vertical border line
    const line = vertical ? Math.max(ax, bx) : Math.max(ay, by), along = vertical ? ay : ax;
    const h = h32(S.seed, line * 2 + (vertical ? 0 : 1), along, 913);
    const open = tree || (!cross && (h % 1000) / 1000 < S.loops / 100);
    // doorway positions along the line, kept clear of the corners where borders meet
    const span = vertical ? CH : CW, base = along * span, positions = [];
    if (open) {
      const want = cross ? 1 : 1 + (h32(S.seed, line, along, vertical ? 17 : 29) % ((S.doors | 0) + 1));
      for (let i = 0; positions.length < want && i < 40; i++) {
        const p = base + 7 + (h32(S.seed, line * 3 + (vertical ? 0 : 1), along, 211 + i) % (span - 14));
        if (positions.every(q => Math.abs(q - p) >= 6)) positions.push(p);
      }
    }
    return { open, tree, cross, positions, vertical, line, child: [child.sx, child.sy], parent: [par.sx, par.sy] };
  }
  // the doorways of one sector, each with its border cell (door) and the cell just inside it (hub), local coords
  function sectorPortals(S, sx, sy) {
    const out = [], [ox, oy] = originOf(sx, sy);
    for (let d = 0; d < 4; d++) {
      const nx = sx + DX[d], ny = sy + DY[d], e = edgeContract(S, sx, sy, nx, ny);
      if (!e.open) continue;
      const n = sectorInfo(S, nx, ny);
      const kind = !e.tree ? 'loop' : (e.parent[0] === nx && e.parent[1] === ny ? 'parent' : 'child');
      e.positions.forEach((pos, idx) => {
        let door, hub;
        if (e.vertical) { const x0 = e.line * CW + wobble(S, 0, e.line, pos); door = d === 1 ? [x0 - 1, pos] : [x0, pos]; hub = [door[0] - DX[d], pos]; }
        else { const y0 = e.line * CH + wobble(S, 1, e.line, pos); door = d === 2 ? [pos, y0 - 1] : [pos, y0]; hub = [pos, door[1] - DY[d]]; }
        out.push({ dir: d, pos, idx, kind, cross: e.cross, to: [nx, ny], toType: n.type, toLevel: n.level, toTier: n.tierIndex,
          door: [door[0] - ox, door[1] - oy], hub: [hub[0] - ox, hub[1] - oy], gdoor: door });
      });
    }
    // the parent link uses its first doorway as the sector's way in
    let seen = false; out.forEach(p => { if (p.kind === 'parent') { if (seen) p.kind = 'parent-extra'; seen = true; } });
    return out;
  }
  function portalCells(p) { return { door: p.door, hub: p.hub }; }

  // ---------- functions inside a sector (Arsenal doctrine) ----------
  const PORTAL_FUNCS = { SE: { name: 'Seal', hub: 1 }, PS: { name: 'Passage', hub: 1 },
    // underdark landmarks
    PG: { name: 'Pilgrim camp' }, PT: { name: 'Unsealed pit' }, EY: { name: 'Watching eye' }, BL: { name: 'Bloom heart' }, SH: { name: 'Shrine' } };
  const UD_LANDMARK = ['EY', 'BL', 'SH'];
  const TIER_STYLE = [0, 3, 4]; // default architecture for doorways in each ring: crypts, ducts, keep
  function portalFunction(info, p) {
    const inward = p.kind === 'parent';
    if (!p.cross) return 'PS';
    if (inward) return info.type === 0 ? 'GH' : info.type === 1 ? 'SE' : 'CP'; // arriving from the ring before
    return info.type === 2 ? 'VA' : 'SE'; // leaving outward: the Keep's way down is through its Vault
  }

  function genSector(Sin, sx, sy) {
    const S = { ...WORLD_DEFAULTS, ...Sin };
    setPreset(S.preset);
    const arsenal = S.preset === 'arsenal';
    const t0 = now(), timing = {};
    const info = sectorInfo(S, sx, sy), portals = sectorPortals(S, sx, sy);
    if (PRESETS[S.preset].layout === 'rooms' && S.layout !== 'caverns') return genRoomSector(S, info, portals, sx, sy, t0, timing);
    const origin = sx === 0 && sy === 0;
    let last = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const seed = 1 + (h32(S.seed, sx, sy, 1000 + attempt) % 999983);
      const rng = mulberry32(seed);
      // hubs: the start (origin only), one per doorway, then interior hubs by Poisson sampling
      const own = ownedMask(S, sx, sy);
      const pts = [];
      if (origin) pts.push({ x: COLS / 2, y: ROWS / 2, start: true });
      portals.forEach(p => { const c = portalCells(p); pts.push({ x: c.hub[0], y: c.hub[1], portal: p }); });
      const r = Math.sqrt((COLS - 8) * (ROWS - 8) / S.hubs) * 0.8;
      for (let tries = 0; pts.length < S.hubs + portals.length * 0.5 && tries < 4000; tries++) {
        const x = 4 + rng() * (COLS - 8), y = 4 + rng() * (ROWS - 8);
        const okHere = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([ax, ay]) => own[Math.round(y + ay) * COLS + Math.round(x + ax)]);
        if (okHere && pts.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > r * r)) pts.push({ x, y });
      }
      pts.forEach(p => { p.cx = Math.max(1, Math.min(COLS - 2, Math.round(p.x))); p.cy = Math.max(1, Math.min(ROWS - 2, Math.round(p.y))); p.style = -1; p.tier = -1; });
      const entrance = origin ? 0 : pts.findIndex(p => p.portal && p.portal.kind === 'parent');
      const reg = { pts, entrance };
      // one tier per sector: same-tier links only; the macro tree handles tiers between sectors
      const same = { em: false, mh: false, eh: false, capEM: 9, capMH: 9, esc: 3, ruin: 0 };
      let cand = genCandidates(reg, seed), g = genGrammar(reg, cand, seed, same, 30);
      if (g.tier.some(t => t < 0)) { cand = genCandidates(reg, seed, 1); g = genGrammar(reg, cand, seed, same, 30); }
      if (g.tier.some(t => t < 0)) { last = 'disconnected regions'; continue; }
      const doctrine = assign(S, info, reg, g, cand, rng, arsenal, g.depth);
      const field = genField(reg, seed, 2.5, { em: true, mh: true, eh: false });
      field.excluded = own.map(v => 1 - v); // cells a neighbouring sector owns
      const cor = genCorridors(reg, g, field, seed);
      if (cor.unrouted) { last = 'unrouted corridor'; continue; }
      // pin each doorway: its border cell opens outward into the next sector and inward to its hub
      cor.portalOut = new Uint8Array(NC);
      portals.forEach((p, k) => {
        const c = portalCells(p), b = c.door[1] * COLS + c.door[0], hb = c.hub[1] * COLS + c.hub[0];
        const inward = OPP(p.dir), hubIdx = pts.findIndex(q => q.portal === p);
        cor.req[b] |= (1 << p.dir) | (1 << inward); cor.portalOut[b] |= 1 << p.dir;
        cor.req[hb] |= 1 << p.dir;
        cor.onPath[b] = 1; cor.ownA[b] = hubIdx; cor.ownB[b] = hubIdx;
      });
      const maze = genMaze(field, cor, seed, S.algo);
      const tw = now();
      const wfc = new WFC(field, cor, seed, reg, maze, S.maze / 100, { lazy: true });
      if (S.wasm === false) wfc.noWasm = true;
      wfc.solve(50000);
      if (wfc.kernelMs) { timing.wfcPrepare = wfc.kernelMs.prepare; timing.wfcSolve = wfc.kernelMs.solve; }
      timing.collapses = wfc.collapsedSteps; timing.resets = wfc.resets;
      timing.wfc = now() - tw;
      let unsolved = 0; for (let c = 0; c < NC; c++) if (wfc.cnt[c] !== 1) unsolved++;
      if (unsolved) { last = 'WFC unsolved'; continue; }
      const sub = buildSub(wfc), val = validate(sub, reg);
      const doors = portals.map(p => doorSub(p));
      if (val.hubs !== pts.length || doors.some(i => val.dist[i] < 0)) { last = 'not connected'; continue; }
      // output: walkable floor (unreachable pockets pruned), its architecture, landmarks
      const pass = new Uint8Array(SW * SH), col = new Uint8Array(SW * SH).fill(255);
      for (let i = 0; i < SW * SH; i++) if (val.dist[i] >= 0) { pass[i] = 1; const st = subStyle(sub.tileOf, i); col[i] = st < 0 ? 254 : st; }
      // dressing: example-driven tile WFC over the finished layout (walls take their region's tileset)
      const { deco, dressStats } = dressSector(S, pass, col, c => field.prim[c], pts.filter(p => p.fn && p.fn !== 'SE').map(p => [p.cx * 3, p.cy * 3]), portals, seed, timing);
      const hubs = pts.map((p, i) => ({ i: (p.cy * 3 + 1) * SW + p.cx * 3 + 1, label: p.label, type: info.type, fn: p.fn || null, portal: !!p.portal }));
      const [ox, oy] = originOf(sx, sy);
      timing.total = now() - t0; timing.layout = timing.total - (timing.dress || 0);
      return { sx, sy, ox, oy, own, info, portals, doors, pass, col, deco, dressStats, hubs, doctrine, attempts: attempt + 1, ms: Math.round(timing.total), timing, entranceSub: val.start, ok: true };
    }
    return { sx, sy, info, portals, ok: false, error: last, ms: Math.round(now() - t0) };
  }
  // dressing: example-driven tile WFC over a finished layout. Walls take the tileset of their cell's style;
  // pinAt: sub-cell spots where a landmark's centrepiece should go
  function dressSector(S, pass, col, primOf, pinAt, portals, seed, timing, extra) {
    if (typeof dress !== 'function' || S.dress === false) return { deco: null, dressStats: null };
    const P = PRESETS[S.preset], tsOf = st => P.tilesets ? P.tilesets[st] : st;
    const setOf = new Uint8Array(SW * SH);
    for (let i = 0; i < SW * SH; i++) {
      const c = (((i / SW) | 0) / 3 | 0) * COLS + ((i % SW) / 3 | 0);
      setOf[i] = tsOf(pass[i] && col[i] < 5 ? col[i] : extra && extra.wallOf ? extra.wallOf(i) : primOf(c));
    }
    // strata bleed into each other around the seals between them, so a change of stratum is
    // announced before you reach it: blobs of the neighbouring stratum's tiles, denser near the seal
    if (P.tilesets) {
      const strata = [P.tilesets[0], P.tilesets[1], P.tilesets[4]], R = 10;
      const src = portals.filter(p => p.cross).map(p => ({ x: p.door[0], y: p.door[1], set: strata[p.toType] }));
      if (src.length) {
        const nz = makeNoise(seed ^ 0x5bd1);
        for (let i = 0; i < SW * SH; i++) {
          const cx = (i % SW) / 3, cy = ((i / SW) | 0) / 3;
          let best = null, bd = R;
          src.forEach(q => { const d = Math.hypot(q.x + 0.5 - cx, q.y + 0.5 - cy); if (d < bd) { bd = d; best = q; } });
          if (best && nz(cx * 0.8, cy * 0.8) < 1.25 * Math.pow(1 - bd / R, 1.3)) setOf[i] = best.set;
        }
      }
    }
    // processional halls at the crossings take the Threshold tiles, with a runner and braziers pinned
    const pins = [];
    // halls: corridors and the walls lining them take their stratum's hall tileset
    if (extra && extra.hall) {
      const hallSet = [0, 1, 2].map(t => DRESS_SETS.findIndex(d => d.key === ['mazes', 'growth', 'shrines'][t] + 'Hall'));
      const stratumOfSet = new Map([[P.tilesets[0], 0], [P.tilesets[1], 1], [P.tilesets[4], 2]]);
      for (let i = 0; i < SW * SH; i++) if (extra.hall[i] && stratumOfSet.has(setOf[i])) setOf[i] = hallSet[stratumOfSet.get(setOf[i])];
    }
    if (extra && extra.passage) {
      const th = DRESS_SETS.findIndex(t => t.key === 'threshold');
      for (let i = 0; i < SW * SH; i++) if (extra.passage[i] === 1) setOf[i] = th; else if (extra.passage[i] === 2) setOf[i] = tsOf(col[i] < 5 ? col[i] : primOf(0));
      extra.runner.forEach(([i, o]) => pins.push([i, o === 'h' ? 'N' : 'V']));
      extra.braziers.forEach(i => pins.push([i, 'T']));
    }
    // landmarks show their stratum's centrepiece (star chart, bloom heart, unsealed pit)
    if (P.tilesets) pinAt.forEach(([x, y]) => { const c = centrepieceAt(pass, setOf, SW, SH, x, y, 5); if (c) pins.push(...c); });
    // the WebAssembly kernel when it is loaded (bit-identical to the JS, about 15x faster)
    const useWasm = S.wasm !== false && typeof DRESS_WASM !== 'undefined' && DRESS_WASM;
    const td = now();
    // where areas meet, a WFC over tile corners grows the transition between them (see blend in dressing.js);
    // the cells it mixes take only plain structural tiles, and the renderer draws them as a blend
    const tb = now(), B = P.tilesets && typeof blend === 'function' ? (useWasm && DRESS_WASM.blend ? DRESS_WASM.blend : blend)(setOf, SW, SH, seed * 131 + 17, pins.map(p => p[0])) : null;
    timing.blend = now() - tb;
    const d = (useWasm ? DRESS_WASM.dress : dress)(pass, setOf, SW, SH, seed * 31 + 7, pins, B ? B.mixed : null);
    timing.dress = now() - td; timing.wasm = !!useWasm;
    return { deco: d.tiles, corners: B ? B.corners : null, dressStats: { fallbacks: d.fallbacks, violations: d.violations, blended: B ? B.count : 0 } };
  }

  // ---------- room-based sectors (gen/rooms.js): themes, a room grammar, suites, maze corridors ----------
  const STRATUM_STYLE = [0, 1, 4]; // the Underdark's architecture style (and tileset) for each stratum
  function genRoomSector(S, info, portals, sx, sy, t0, timing) {
    const own = ownedMask(S, sx, sy), [ox, oy] = originOf(sx, sy), origin = sx === 0 && sy === 0;
    let last = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const seed = 1 + (h32(S.seed, sx, sy, 1000 + attempt) % 999983);
      const L = roomsLayout(S, info, portals, own, ox, oy, seed, doorSub);
      if (!L.ok) { last = L.error; continue; }
      const pass = L.pass, style = STRATUM_STYLE[info.type], col = new Uint8Array(SW * SH).fill(255);
      for (let i = 0; i < SW * SH; i++) if (pass[i]) col[i] = STRATUM_STYLE[L.stratumOf[i]];
      // landmarks: the camp at the start, the theme's goal room, seals and pits at the borders between strata
      const hubs = [], pinAt = [];
      if (origin) { hubs.push({ i: L.startSub, label: 'PG', type: info.type, fn: 'PG', portal: false }); pinAt.push([L.startSub % SW, (L.startSub / SW) | 0]); }
      const lm = UD_LANDMARK[info.type];
      hubs.push({ i: L.goal.cy * SW + L.goal.cx, label: lm, type: info.type, fn: lm, portal: false, room: L.goal.name }); pinAt.push([L.goal.cx, L.goal.cy]);
      portals.forEach((p, k) => {
        const cx = Math.max(1, Math.min(COLS - 2, p.hub[0])), cy = Math.max(1, Math.min(ROWS - 2, p.hub[1]));
        const fn = p.cross ? ((info.type === 2 && p.toType === 0) || (info.type === 0 && p.toType === 2) ? 'PT' : 'SE') : null;
        hubs.push({ i: (cy * 3 + 1) * SW + cx * 3 + 1, label: fn, type: info.type, fn, portal: true });
        if (fn === 'PT' && L.halls[k] && !L.halls[k].hallOnly) pinAt.push([L.halls[k].cx, L.halls[k].cy]);
      });
      const doors = portals.map(p => doorSub(p));
      timing.layout = now() - t0;
      const { deco, corners, dressStats } = dressSector(S, pass, col, c => STRATUM_STYLE[L.stratumOf[((c / COLS) | 0) * 3 * SW + 3 * (c % COLS) + SW + 1]], pinAt, portals, seed, timing, { passage: L.passage, runner: L.runner, braziers: L.braziers, hall: L.hall, wallOf: i => STRATUM_STYLE[L.stratumOf[i]] });
      timing.total = now() - t0;
      return { sx, sy, ox, oy, own, info, portals, doors, pass, col, deco, corners, dressStats, hubs, doctrine: null, attempts: attempt + 1, ms: Math.round(timing.total), timing,
        entranceSub: L.startSub, ok: true, layout: 'rooms', theme: L.theme, rooms: L.rooms, roomOf: L.roomOf, mission: L.mission, doorWide: L.doorWide, halls: L.halls, districts: L.districts, distOf: L.distOf, mat: L.mat };
    }
    return { sx, sy, info, portals, ok: false, error: last, ms: Math.round(now() - t0) };
  }

  // the subcell on the sector's edge where a doorway opens
  function doorSub(p) {
    const c = portalCells(p), [x, y] = c.door;
    const k = p.dir === 0 ? 1 : p.dir === 1 ? 5 : p.dir === 2 ? 7 : 3;
    return (y * 3 + ((k / 3) | 0)) * SW + x * 3 + (k % 3);
  }

  function assign(S, info, reg, g, cand, rng, arsenal, depth) {
    if (S.preset === 'underdark') return assignUnderdark(S, info, reg, depth);
    const pts = reg.pts, type = info.type, n = pts.length;
    const border = pts.map(() => new Set()); cand.del.forEach(e => { border[e.a].add(e.b); border[e.b].add(e.a); });
    const fn = new Array(n).fill(null);
    pts.forEach((p, i) => { if (p.start) fn[i] = 'GH'; else if (p.portal) fn[i] = portalFunction(info, p.portal); });
    const interior = pts.map((_, i) => i).filter(i => !fn[i]);
    let report = null;
    if (arsenal) {
      if (type === 0) {
        if (interior.length) { const ar = interior.reduce((a, b) => g.depth[b] > g.depth[a] ? b : a); fn[ar] = 'AR'; }
        const gh = fn.indexOf('GH');
        interior.forEach(i => { if (!fn[i]) fn[i] = gh >= 0 && g.nb[gh].includes(i) && !fn.includes('GA') ? 'GA' : 'DP'; });
      } else if (type === 2) {
        interior.forEach(i => { fn[i] = 'CO'; });
      } else {
        const pool = ['FO', 'SM', 'PW', 'MG', 'CI', 'DH'], nb = g.nb;
        const within2 = (i, f, a) => nb[i].some(v => a[v] === f || nb[v].some(w => a[w] === f));
        const score = a => {
          let v = 0; const cnt = {};
          interior.forEach(i => {
            cnt[a[i]] = (cnt[a[i]] || 0) + 1;
            if (a[i] === 'FO') { if (!within2(i, 'PW', a)) v += 3; if (!nb[i].some(x => a[x] === 'CI')) v += 2; if ([...border[i]].some(x => a[x] === 'MG')) v += 4; }
            if (a[i] === 'SM' && !nb[i].some(x => a[x] === 'FO')) v += 1;
          });
          if (interior.length >= 2 && !cnt.FO) v += 5;
          if (interior.length >= 3 && !cnt.MG) v += 2;
          Object.values(cnt).forEach(k => { if (k > 2) v += 0.4 * (k - 2); });
          return v;
        };
        let best = null, bestS = 1e9;
        for (let r = 0; r < 30 && interior.length; r++) {
          const a = fn.slice(); interior.forEach(i => a[i] = pool[(rng() * pool.length) | 0]);
          let sc = score(a);
          for (let it = 0; it < 50; it++) { const i = interior[(rng() * interior.length) | 0], old = a[i]; a[i] = pool[(rng() * pool.length) | 0]; const s2 = score(a); if (s2 <= sc) sc = s2; else a[i] = old; }
          if (sc < bestS) { bestS = sc; best = a; }
        }
        if (best) interior.forEach(i => fn[i] = best[i]);
        report = {
          power: fn.every((f, i) => f !== 'FO' || within2(i, 'PW', fn)),
          cooling: fn.every((f, i) => f !== 'FO' || nb[i].some(x => fn[x] === 'CI')),
          blast: fn.every((f, i) => f !== 'FO' || ![...border[i]].some(x => fn[x] === 'MG')),
        };
      }
    }
    // ruin: some interior regions have collapsed into breaches (never doorways or the start)
    const ruined = new Uint8Array(n);
    if (arsenal) interior.forEach(i => { if (rng() * 100 < S.ruin) ruined[i] = 1; });
    pts.forEach((p, i) => {
      p.tier = type; p.ruined = !!ruined[i];
      if (arsenal) {
        const f = fn[i];
        p.fn = f;
        p.label = f === 'PS' ? null : f;
        p.style = p.ruined ? 1 : FUNCS[f] ? FUNCS[f].style : TIER_STYLE[type];
        p.hub = p.portal ? 1 : p.ruined ? 4 : FUNCS[f] ? FUNCS[f].hub : undefined;
      } else {
        p.fn = null;
        p.style = type === 0 ? 0 : type === 2 ? 2 : ((h32(S.seed, Math.round(p.x), Math.round(p.y), 5) & 1) ? 1 : 3);
        p.label = p.start ? 'IN' : p.portal ? (p.portal.cross ? 'S' : 'P') : PRESETS.generic.tiers[type].short;
        p.hub = p.portal ? 1 : undefined;
      }
    });
    return report;
  }

  // underdark: one landmark per sector deep inside it, pits where the strata begin again, seals between strata
  function assignUnderdark(S, info, reg, depth) {
    const pts = reg.pts, type = info.type;
    const interior = pts.map((_, i) => i).filter(i => !pts[i].start && !pts[i].portal);
    const mark = interior.length ? interior.reduce((a, b) => depth[b] > depth[a] ? b : a) : -1;
    pts.forEach((p, i) => {
      p.tier = type; p.ruined = false;
      let fn = null;
      if (p.start) fn = 'PG';
      else if (p.portal && p.portal.cross) fn = (type === 2 && p.portal.toType === 0) || (type === 0 && p.portal.toType === 2) ? 'PT' : 'SE';
      else if (i === mark) fn = UD_LANDMARK[type];
      p.fn = fn; p.label = fn;
      const h = h32(S.seed, Math.round(p.x * 7), Math.round(p.y * 7), 5);
      p.style = type === 0 ? (h % 3 ? 0 : 3) : type === 1 ? (h % 4 ? 1 : 2) : 4;
      p.hub = fn === 'PT' ? 1 : p.portal ? 1 : fn ? 4 : undefined;
    });
    return null;
  }

  function funcName(code) { return (FUNCS[code] && FUNCS[code].name) || (PORTAL_FUNCS[code] && PORTAL_FUNCS[code].name) || code; }

  const api = { WORLD_DEFAULTS, sectorInfo, edgeContract, sectorPortals, genSector, tierName, funcName, PORTAL_FUNCS, ownerOf, originOf, ownedMask, WORLD_MARGIN: MARGIN, WORLD_CW: CW, WORLD_CH: CH };
  if (isNode) module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
