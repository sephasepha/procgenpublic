// ===== Undercroft core: regions -> graph -> style field -> corridors -> WFC -> validate =====
const COLS = 40, ROWS = 52, NC = COLS * ROWS;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const OPP = d => (d + 2) & 3;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const r = mulberry32(seed), S = 64, g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = t => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = g[((yi & 63) * S) + (xi & 63)], b = g[((yi & 63) * S) + ((xi + 1) & 63)];
    const c = g[(((yi + 1) & 63) * S) + (xi & 63)], d = g[(((yi + 1) & 63) * S) + ((xi + 1) & 63)];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y) => (v(x, y) * 0.65 + v(x * 2.1 + 17, y * 2.1 + 31) * 0.35);
}

// ---------- Architecture styles: each is just a weight table over the same socket tileset ----------
const STYLES = [
  { key: 'ossuary', name: 'Ossuary', blurb: 'Straight galleries, small chambers', hub: 2, maze: { k: 1.0, straight: 0.75, braid: 0.25 },
    w: { straight: 7, turn: 1.2, tee: 1.4, cross: 1.6, dead: 0.25, interior: 1.0, edge: 1.4, corner: 1.1, strip: 0.05, door: 0.35, rock: 0.62 } },
  { key: 'caverns', name: 'Fungal Caverns', blurb: 'Wide, irregular open chambers', hub: 4, maze: { k: 0.3, straight: 0.3, braid: 0.6 },
    w: { straight: 0.4, turn: 0.9, tee: 0.4, cross: 0.2, dead: 0.6, interior: 7, edge: 3.5, corner: 2.2, strip: 0.4, door: 0.15, rock: 0.42 } },
  { key: 'forge', name: 'Dwarven Forge', blurb: 'Grand halls linked by straight roads', hub: 4, maze: { k: 0.7, straight: 0.85, braid: 0.5 },
    w: { straight: 4.5, turn: 0.3, tee: 0.9, cross: 1.2, dead: 0.1, interior: 3.5, edge: 4.5, corner: 1.4, strip: 0.15, door: 0.6, rock: 0.58 } },
  { key: 'warrens', name: 'Sunken Warrens', blurb: 'Twisting narrow tunnels, dead ends', hub: 2, maze: { k: 1.0, straight: 0.15, braid: 0.05 },
    w: { straight: 1.2, turn: 4.5, tee: 3, cross: 1.2, dead: 2.2, interior: 0.03, edge: 0.15, corner: 0.25, strip: 0.1, door: 0.2, rock: 0.5 } },
  { key: 'keep', name: 'Reliquary Keep', blurb: 'Symmetric halls, defensive switchbacks', hub: 3, maze: { k: 0.8, straight: 0.9, braid: 0.1 },
    w: { straight: 5, turn: 0.8, tee: 1.2, cross: 1.5, dead: 0.4, interior: 3, edge: 3.5, corner: 1.8, strip: 0.1, door: 0.5, rock: 0.6 } },
];
const NS = STYLES.length;
// ---------- Progression tiers: each style belongs to one tier ----------
// A preset renames the tiers and biomes and decides how regions get their biome. Tier -1 is a wildcard
// (the Arsenal's ruin breaches), which blends with anything.
const PRESETS = {
  generic: {
    tiers: [{ name: 'Easy', short: 'E' }, { name: 'Medium', short: 'M' }, { name: 'Hard', short: 'H' }],
    tierOfStyle: [0, 1, 2, 1, 2],
    names: ['Ossuary', 'Fungal Caverns', 'Dwarven Forge', 'Sunken Warrens', 'Reliquary Keep'],
    used: [0, 1, 2, 3],
  },
  arsenal: {
    tiers: [{ name: 'Outer', short: 'O' }, { name: 'Works', short: 'W' }, { name: 'Keep', short: 'K' }],
    tierOfStyle: [0, -1, 1, 1, 2],
    names: ['Garrison Crypts', 'Breach', 'Foundry Works', 'Service Ducts', 'Reliquary Keep'],
    blurbs: ['Barracks and archives: straight galleries, small cells', 'Collapse and overgrowth: open, irregular, ignores clearance', 'Smelters and foundries: halls on straight haul roads', 'Magazines, cisterns, duct hubs: twisting service tunnels', 'Checkpoints and vaults: symmetric halls, switchbacks'],
    used: [0, 2, 3, 4, 1],
  },
  // the labyrinthine underdark: strata of unknown making, each its own architecture and tileset
  underdark: {
    tiers: [{ name: 'Constellation of Mazes', short: 'M' }, { name: 'Uncontrollable Growth', short: 'G' }, { name: 'Unsealed Shrines', short: 'S' }],
    tierOfStyle: [0, 1, 1, 0, 2],
    names: ['Maze Galleries', 'Overgrowth', 'Grown Halls', 'Star Warrens', 'Shrine Halls'],
    blurbs: ['Engraved galleries under a sky of stars', 'Open caverns swallowed by vines and bloom', 'Old halls the growth has broken into', 'Tight twisting passages, eyes in the walls', 'Candlelit halls around opened pits'],
    used: [0, 3, 1, 4],
    colors: ['#aab8ff', '#8fdc6e', '#eaa65a'],
    tilesets: [5, 6, 6, 5, 7], // dressing tileset for each architecture style
  },
};
let PRESET = 'generic';
let TIERS = PRESETS.generic.tiers;
let TIER_OF_STYLE = PRESETS.generic.tierOfStyle;
function setPreset(name) {
  PRESET = name; const p = PRESETS[name];
  TIERS = p.tiers; TIER_OF_STYLE = p.tierOfStyle;
  STYLES.forEach((s, i) => { s.name = p.names[i]; if (!s._blurb) s._blurb = s.blurb; s.blurb = p.blurbs ? p.blurbs[i] : s._blurb; });
}

// ---------- Arsenal doctrine: what each region is for ----------
const FUNCS = {
  GH: { name: 'Gatehouse', ring: 0, style: 0, hub: 3 }, GA: { name: 'Garrison', ring: 0, style: 0, hub: 2 },
  DP: { name: 'Depot', ring: 0, style: 0, hub: 3 }, AR: { name: 'Archive', ring: 0, style: 0, hub: 2 },
  FO: { name: 'Foundry', ring: 1, style: 2, hub: 4 }, SM: { name: 'Smelter', ring: 1, style: 2, hub: 3 },
  PW: { name: 'Power plant', ring: 1, style: 2, hub: 3 }, MG: { name: 'Magazine', ring: 1, style: 3, hub: 3 },
  CI: { name: 'Cistern', ring: 1, style: 3, hub: 4 }, DH: { name: 'Duct hub', ring: 1, style: 3, hub: 1 },
  CP: { name: 'Checkpoint', ring: 2, style: 4, hub: 2 }, CO: { name: 'Command', ring: 2, style: 4, hub: 4 },
  VA: { name: 'Vault', ring: 2, style: 4, hub: 3 },
};
const DOCTRINE = [
  'The Gatehouse is the only way in',
  'Every Foundry has a Power plant within 2 links',
  'Every Foundry is linked to a Cistern for cooling',
  'No Magazine shares a border with a Foundry',
  'The Keep is entered only through Checkpoints',
  'Seal codes for the Checkpoints lie in an Archive',
];
function assignFunctions(reg, g, cand, rng, ruinPct) {
  const pts = reg.pts, n = pts.length, T_ = g.tier, nb = g.nb, ent = reg.entrance;
  const border = pts.map(() => new Set()); cand.del.forEach(e => { border[e.a].add(e.b); border[e.b].add(e.a); });
  const fn = new Array(n).fill(null);
  const ring = r => pts.map((_, i) => i).filter(i => T_[i] === r);
  // outer ring: gatehouse at the entrance, a garrison beside it, the archive as deep as the ring goes
  fn[ent] = 'GH';
  const outer = ring(0).filter(i => i !== ent);
  if (outer.length) { const ar = outer.reduce((a, b) => g.depth[b] > g.depth[a] ? b : a); fn[ar] = 'AR'; }
  outer.forEach(i => { if (!fn[i]) fn[i] = nb[ent].includes(i) && !outer.some(j => fn[j] === 'GA') ? 'GA' : 'DP'; });
  // keep: anything linked outward is a checkpoint; the deepest inner region is the vault
  const keep = ring(2);
  keep.forEach(i => { fn[i] = nb[i].some(v => T_[v] !== 2) ? 'CP' : 'CO'; });
  const inner = keep.filter(i => fn[i] === 'CO');
  const vaultFrom = inner.length ? inner : keep;
  if (vaultFrom.length) fn[vaultFrom.reduce((a, b) => g.depth[b] > g.depth[a] ? b : a)] = 'VA';
  // works: a small search over functions to satisfy the industrial doctrine
  const works = ring(1), pool = ['FO', 'SM', 'PW', 'MG', 'CI', 'DH'];
  const within2 = (i, f, a) => nb[i].some(v => a[v] === f || nb[v].some(w => a[w] === f));
  const score = a => {
    let v = 0; const cnt = {};
    works.forEach(i => {
      cnt[a[i]] = (cnt[a[i]] || 0) + 1;
      if (a[i] === 'FO') { if (!within2(i, 'PW', a)) v += 3; if (!nb[i].some(x => a[x] === 'CI')) v += 2; if ([...border[i]].some(x => a[x] === 'MG')) v += 4; }
      if (a[i] === 'SM' && !nb[i].some(x => a[x] === 'FO')) v += 1;
    });
    if (works.length >= 2 && !cnt.FO) v += 5;
    if (works.length >= 3 && !cnt.MG) v += 2;
    Object.values(cnt).forEach(k => { if (k > 2) v += 0.4 * (k - 2); });
    return v;
  };
  let best = null, bestS = 1e9;
  for (let r = 0; r < 40 && works.length; r++) {
    const a = fn.slice(); works.forEach(i => a[i] = pool[(rng() * pool.length) | 0]);
    let sc = score(a);
    for (let it = 0; it < 60; it++) {
      const i = works[(rng() * works.length) | 0], old = a[i];
      a[i] = pool[(rng() * pool.length) | 0];
      const s2 = score(a); if (s2 <= sc) sc = s2; else a[i] = old;
    }
    if (sc < bestS) { bestS = sc; best = a; }
  }
  if (best) works.forEach(i => fn[i] = best[i]);
  // ruin pass: some regions have collapsed into breaches
  const ruined = new Uint8Array(n);
  const cands = pts.map((_, i) => i).filter(i => i !== ent);
  const nRuin = Math.round(cands.length * ruinPct / 100);
  for (let k = 0; k < nRuin; k++) { const j = (rng() * cands.length) | 0; ruined[cands.splice(j, 1)[0]] = 1; }
  // doctrine report
  const has = f => fn.some(x => x === f);
  const report = [
    true,
    fn.every((f, i) => f !== 'FO' || within2(i, 'PW', fn)),
    fn.every((f, i) => f !== 'FO' || nb[i].some(x => fn[x] === 'CI')),
    fn.every((f, i) => f !== 'FO' || ![...border[i]].some(x => fn[x] === 'MG')),
    keep.every(i => fn[i] === 'CP' || !nb[i].some(v => T_[v] !== 2)),
    !has('CP') || has('AR'),
  ];
  return { fn, ruined, report };
}
function tierPairOK(rules, a, b) {
  if (a === b) return true;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo === 0 && hi === 1 ? rules.em : lo === 1 && hi === 2 ? rules.mh : rules.eh;
}
const GATE_W = 0.35;

// ---------- Tileset: sockets per edge. 0 = wall (style-neutral), 1+2s = narrow passage of style s, 2+2s = wide opening of style s
const tiles = [];
(function buildTiles() {
  tiles.push({ sock: [0, 0, 0, 0], style: -1, kind: 'solid' });
  for (let s = 0; s < NS; s++) {
    for (let code = 1; code < 81; code++) {
      const e = [code % 3, ((code / 3) | 0) % 3, ((code / 9) | 0) % 3, ((code / 27) | 0) % 3];
      const nD = e.filter(x => x === 2).length, nN = e.filter(x => x === 1).length;
      if (nD === 1) continue;
      let kind;
      if (nD === 0) {
        if (nN === 1) kind = 'dead';
        else if (nN === 2) kind = (e[0] && e[2]) || (e[1] && e[3]) ? 'straight' : 'turn';
        else if (nN === 3) kind = 'tee'; else kind = 'cross';
      } else if (nD === 4) kind = 'interior';
      else if (nD === 3) kind = 'edge';
      else kind = (e[0] === 2 && e[2] === 2) || (e[1] === 2 && e[3] === 2) ? 'strip' : 'corner';
      const W = STYLES[s].w;
      const weight = W[kind] * (nD >= 2 && nN > 0 ? W.door : 1);
      tiles.push({ sock: e.map(x => x === 0 ? 0 : x === 1 ? 1 + 2 * s : 2 + 2 * s), style: s, kind, weight, room: nD >= 2 });
    }
  }
  // transition tiles: a narrow archway whose two openings belong to different styles
  for (let a = 0; a < NS; a++) for (let b = 0; b < NS; b++) {
    if (a === b) continue;
    for (let d1 = 0; d1 < 4; d1++) for (let d2 = 0; d2 < 4; d2++) {
      if (d1 === d2) continue;
      const sock = [0, 0, 0, 0]; sock[d1] = 1 + 2 * a; sock[d2] = 1 + 2 * b;
      tiles.push({ sock, style: a, gate: [a, b], gateDirs: [d1, d2], kind: 'gate', weight: GATE_W });
    }
  }
})();
// solid rock weight is set from each style's target rock fraction, relative to its total open weight
STYLES.forEach((st, s) => { const open = tiles.filter(t => t.style === s && !t.gate).reduce((a, t) => a + t.weight, 0); st.w.solid = open * st.w.rock / (1 - st.w.rock); });
const T = tiles.length;
const tSock = new Uint8Array(T * 4);
const tW = new Float32Array(T);
const tSub = new Uint16Array(T); // 3x3 floor mask
tiles.forEach((t, i) => {
  for (let d = 0; d < 4; d++) tSock[i * 4 + d] = t.sock[d];
  tW[i] = t.weight || 0;
  const op = d => t.sock[d] > 0, wide = d => t.sock[d] > 0 && t.sock[d] % 2 === 0;
  let m = 0;
  if (t.sock.some(x => x > 0)) m |= 1 << 4;
  if (op(0)) m |= 1 << 1; if (op(1)) m |= 1 << 5; if (op(2)) m |= 1 << 7; if (op(3)) m |= 1 << 3;
  if (wide(0) && wide(3)) m |= 1 << 0; if (wide(0) && wide(1)) m |= 1 << 2;
  if (wide(2) && wide(1)) m |= 1 << 8; if (wide(2) && wide(3)) m |= 1 << 6;
  tSub[i] = m;
});

// ---------- Stage 1: regions ----------
function genRegions(seed, count) {
  const rng = mulberry32(seed * 7919 + 1);
  const r = Math.sqrt((COLS - 4) * (ROWS - 4) / count) * 0.78;
  const pts = [];
  let tries = 0, rr = r;
  while (pts.length < count && tries < 20000) {
    tries++;
    if (tries % 3000 === 0) rr *= 0.9;
    const x = 2.5 + rng() * (COLS - 5), y = 2.5 + rng() * (ROWS - 5);
    if (pts.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > rr * rr)) pts.push({ x, y });
  }
  pts.forEach(p => {
    p.style = -1; p.tier = -1;
    p.cx = Math.max(1, Math.min(COLS - 2, Math.round(p.x)));
    p.cy = Math.max(1, Math.min(ROWS - 2, Math.round(p.y)));
  });
  let entrance = 0;
  pts.forEach((p, i) => { if (p.y < pts[entrance].y) entrance = i; });
  return { pts, entrance };
}

// ---------- Stage 2: Delaunay -> MST + loops ----------
function delaunay(pts) {
  const P = pts.map(p => [p.x, p.y]);
  const M = 1000;
  P.push([-M, -M], [M * 2, -M], [COLS / 2, M * 2]);
  const n = pts.length;
  let tris = [[n, n + 1, n + 2]];
  const circ = (t) => {
    const [ax, ay] = P[t[0]], [bx, by] = P[t[1]], [cx, cy] = P[t[2]];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
  };
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    tris.forEach(t => { const [ux, uy, r2] = circ(t); ((px - ux) ** 2 + (py - uy) ** 2 < r2 ? bad : keep).push(t); });
    const edges = new Map();
    bad.forEach(t => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; const key = a < b ? a + ',' + b : b + ',' + a; edges.set(key, (edges.get(key) || 0) + 1); } });
    edges.forEach((c, key) => { if (c === 1) { const [a, b] = key.split(',').map(Number); keep.push([a, b, i]); } });
    tris = keep;
  }
  const out = new Map();
  tris.forEach(t => { if (t.some(v => v >= n)) return; for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; const key = a < b ? a + ',' + b : b + ',' + a; out.set(key, [Math.min(a, b), Math.max(a, b)]); } });
  return [...out.values()].map(([a, b]) => ({ a, b, len: Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) }));
}
// Region ownership depends only on hub positions and warp noise, so it is known before styles are chosen.
function warpRegions(reg, seed) {
  const nz = makeNoise(seed * 31 + 3), nz2 = makeNoise(seed * 37 + 4);
  const region = new Int16Array(NC), wxa = new Float32Array(NC), wya = new Float32Array(NC);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = y * COLS + x;
    const wx = x + (nz(x * 0.13, y * 0.13) - 0.5) * 7, wy = y + (nz2(x * 0.13, y * 0.13) - 0.5) * 7;
    let d1 = 1e9, r1 = 0;
    reg.pts.forEach((p, i) => { const d = Math.hypot(p.x - wx, p.y - wy); if (d < d1) { d1 = d; r1 = i; } });
    let hb = 2.3; reg.pts.forEach((p, i) => { const d = Math.hypot(p.cx - x, p.cy - y); if (d < hb) { hb = d; r1 = i; } });
    region[c] = r1; wxa[c] = wx; wya[c] = wy;
  }
  return { region, wx: wxa, wy: wya };
}
// Candidate links: hubs whose regions share a real border (at least 3 cell edges), so a corridor
// between them never has to cross a third region.
function genCandidates(reg, seed, minBorder) {
  const minB = minBorder || 3;
  const { region } = warpRegions(reg, seed), border = new Map();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = y * COLS + x;
    for (const n of [x + 1 < COLS ? c + 1 : -1, y + 1 < ROWS ? c + COLS : -1]) {
      if (n < 0 || region[n] === region[c]) continue;
      const a = Math.min(region[c], region[n]), b = Math.max(region[c], region[n]), k = a + ',' + b;
      border.set(k, (border.get(k) || 0) + 1);
    }
  }
  const del = [];
  border.forEach((cnt, k) => { if (cnt < minB) return; const [a, b] = k.split(',').map(Number); del.push({ a, b, len: Math.hypot(reg.pts[a].x - reg.pts[b].x, reg.pts[a].y - reg.pts[b].y), border: cnt }); });
  return { del: del.sort((x, y) => x.len - y.len), region };
}

// ---------- Stage 3: progression grammar over the candidate graph ----------
// Grow a tree outward from the entrance (Prim-style, shortest frontier edge first). Each new region picks a
// tier allowed by the rules: same tier always links; cross-tier pairs must be enabled and respect branch caps.
// The tier it prefers rises with distance from the entrance, shaped by the escalation setting.
function genGrammar(reg, cand, seed, rules, loopPct) {
  const rng = mulberry32(seed * 104729 + 2);
  const pts = reg.pts, n = pts.length, ent = reg.entrance;
  const tier = new Int8Array(n).fill(-1), nb = pts.map(() => []), inTree = new Uint8Array(n);
  const ok = (a, b) => tierPairOK(rules, a, b);
  const cross = (u, t) => nb[u].reduce((k, v) => k + (tier[v] === t ? 1 : 0), 0);
  const capOK = (u, tu, t) => (tu === 0 && t === 1) ? cross(u, 1) < rules.capEM : (tu === 1 && t === 2) ? cross(u, 2) < rules.capMH : true;
  const canLink = (u, tu, v, tv) => ok(tu, tv) && capOK(u, tu, tv) && capOK(v, tv, tu);
  const E = pts[ent];
  const far = Math.max(...pts.map(p => Math.hypot(p.x - E.x, p.y - E.y))) || 1;
  const pw = [2.4, 1.7, 1.1, 0.75, 0.5][rules.esc - 1];
  const intend = i => 3 * Math.pow(Math.hypot(pts[i].x - E.x, pts[i].y - E.y) / far, pw);
  const jitter = cand.del.map(() => 0.8 + rng() * 0.4);
  const used = new Uint8Array(cand.del.length), edges = [];
  tier[ent] = 0; inTree[ent] = 1;
  for (;;) {
    let best = -1, bl = 1e9;
    cand.del.forEach((e, k) => { if (used[k] || inTree[e.a] === inTree[e.b]) return; const l = e.len * jitter[k]; if (l < bl) { bl = l; best = k; } });
    if (best < 0) break;
    const e = cand.del[best]; used[best] = 1;
    const u = inTree[e.a] ? e.a : e.b, v = u === e.a ? e.b : e.a, tu = tier[u];
    const want = intend(v), w = [0, 0, 0];
    for (let t = 0; t < 3; t++) if (canLink(u, tu, v, t)) w[t] = Math.exp(-Math.pow(t + 0.5 - want, 2) * 1.6) * (t === tu ? 1.3 : 1) + 1e-6;
    let r = rng() * (w[0] + w[1] + w[2]), tv = tu;
    for (let t = 0; t < 3; t++) { r -= w[t]; if (w[t] > 0 && r <= 0) { tv = t; break; } }
    tier[v] = tv; inTree[v] = 1; nb[u].push(v); nb[v].push(u);
    edges.push({ ...e, type: 'mst' });
  }
  const treeCount = edges.length;
  const avg = edges.reduce((s, e) => s + e.len, 0) / Math.max(1, treeCount);
  const forbidden = [];
  cand.del.forEach((e, k) => {
    if (used[k] || e.len > avg * 2.2) return;
    const legal = canLink(e.a, tier[e.a], e.b, tier[e.b]);
    if (!legal) { forbidden.push({ ...e, why: ok(tier[e.a], tier[e.b]) ? 'cap' : 'pair' }); return; }
    if (rng() < loopPct / 100) { edges.push({ ...e, type: 'loop' }); nb[e.a].push(e.b); nb[e.b].push(e.a); }
  });
  // graph depth from entrance
  const depth = new Int16Array(n).fill(-1); depth[ent] = 0; const q = [ent];
  for (let h = 0; h < q.length; h++) nb[q[h]].forEach(v => { if (depth[v] < 0) { depth[v] = depth[q[h]] + 1; q.push(v); } });
  const counts = [0, 0, 0]; tier.forEach(t => counts[t]++);
  let doctrine = null;
  if (PRESET === 'arsenal') {
    doctrine = assignFunctions(reg, { tier, nb, depth }, cand, rng, rules.ruin || 0);
    pts.forEach((p, i) => {
      p.tier = tier[i]; p.fn = doctrine.fn[i]; p.ruined = !!doctrine.ruined[i];
      p.style = p.ruined ? 1 : FUNCS[p.fn].style; p.hub = p.ruined ? 4 : FUNCS[p.fn].hub;
    });
  } else {
    // styles from tier pools; Medium splits between two styles by nearest of two seeds so each forms a zone
    const s1 = { x: rng() * COLS, y: rng() * ROWS }, s2 = { x: rng() * COLS, y: rng() * ROWS };
    pts.forEach((p, i) => {
      p.tier = tier[i]; p.fn = null; p.ruined = false; p.hub = undefined;
      const near1 = Math.hypot(p.x - s1.x, p.y - s1.y) < Math.hypot(p.x - s2.x, p.y - s2.y);
      if (PRESET === 'underdark') p.style = tier[i] === 0 ? (near1 ? 0 : 3) : tier[i] === 1 ? 1 : 4; // mazes split into galleries and warrens
      else p.style = tier[i] === 0 ? 0 : tier[i] === 2 ? 2 : (near1 ? 1 : 3);
    });
  }
  return { del: cand.del, edges, forbidden, mstCount: treeCount, loopCount: edges.length - treeCount, tier, nb, depth, counts, doctrine };
}

// ---------- Stage 3: style field (noise-warped Voronoi + transition band) ----------
function genField(reg, seed, band, rules) {
  const W = warpRegions(reg, seed);
  const region = new Int16Array(NC), region2 = new Int16Array(NC).fill(-1), prim = new Int8Array(NC), sec = new Int8Array(NC).fill(-1);
  let bandCells = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const ci = y * COLS + x, wx = W.wx[ci], wy = W.wy[ci], r1 = W.region[ci];
    const d1 = Math.hypot(reg.pts[r1].x - wx, reg.pts[r1].y - wy);
    const s1 = reg.pts[r1].style;
    let d2 = 1e9, s2 = -1, r2 = -1;
    reg.pts.forEach((p, i) => { if (p.style === s1) return; const d = Math.hypot(p.x - wx, p.y - wy); if (d < d2) { d2 = d; s2 = p.style; r2 = i; } });
    const c = y * COLS + x;
    region[c] = r1; prim[c] = s1; region2[c] = r2;
    if (s2 >= 0 && d2 - d1 < band) { sec[c] = s2; bandCells++; }
  }
  // warped space can fold, so two pure cells of different styles may touch: force both into the band
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = y * COLS + x;
    for (let d = 1; d <= 2; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (nx >= COLS || ny >= ROWS) continue;
      const n = ny * COLS + nx;
      if (prim[c] === prim[n]) continue;
      if (sec[c] < 0) { sec[c] = prim[n]; region2[c] = region[n]; bandCells++; }
      if (sec[n] < 0) { sec[n] = prim[c]; region2[n] = region[c]; bandCells++; }
    }
  }
  // cross[a][b]: 0 = styles may never open into each other, 1 = same tier (archways anywhere in the band),
  // 2 = allowed cross-tier pair (archways only on pinned corridor cells, so every crossing is a designed link)
  const cross = [];
  for (let a = 0; a < NS; a++) { cross.push([]); for (let b = 0; b < NS; b++) { const ta = TIER_OF_STYLE[a], tb = TIER_OF_STYLE[b]; cross[a].push(a === b || ta === tb || ta < 0 || tb < 0 ? 1 : tierPairOK(rules, ta, tb) ? 2 : 0); } }
  return { region, region2, prim, sec, bandCells, cross };
}

// ---------- Stage 4: corridors routed along graph edges with A*, pinned as required openings ----------
function genCorridors(reg, graph, field, seed) {
  const nz = makeNoise(seed * 53 + 5);
  const req = new Uint8Array(NC), onPath = new Uint8Array(NC), ownA = new Int16Array(NC).fill(-1), ownB = new Int16Array(NC).fill(-1);
  const cost = c => {
    const x = c % COLS, y = (c / COLS) | 0;
    let k = 1 + nz(x * 0.25, y * 0.25) * 3;
    if (field.sec[c] >= 0) k += 0.6;
    if (onPath[c]) k = 0.45;
    return k;
  };
  const paths = []; let unrouted = 0, detours = 0;
  // route shorter edges first so later ones can merge into them
  [...graph.edges].sort((a, b) => a.len - b.len).forEach(e => {
    const A = reg.pts[e.a], B = reg.pts[e.b];
    const s = A.cy * COLS + A.cx, g = B.cy * COLS + B.cx;
    const dist = new Float32Array(NC).fill(Infinity), prev = new Int32Array(NC).fill(-1), closed = new Uint8Array(NC);
    const heap = []; const push = (c, f) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const gx = B.cx, gy = B.cy;
    for (let strict = 1; strict >= 0; strict--) {
    if (!strict) { dist.fill(Infinity); prev.fill(-1); closed.fill(0); heap.length = 0; detours++; }
    dist[s] = 0; push(s, 0);
    while (heap.length) {
      const [, c] = pop(); if (closed[c]) continue; closed[c] = 1; if (c === g) break;
      const x = c % COLS, y = (c / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 1 || ny < 1 || nx >= COLS - 1 || ny >= ROWS - 1) continue;
        if (field.excluded && field.excluded[ny * COLS + nx]) continue; // owned by a neighbouring sector
        const n = ny * COLS + nx;
        const pc = field.prim[c], pn = field.prim[n];
        if (pc !== pn && (!field.cross[pc][pn] || !(field.sec[c] === pn || field.sec[n] === pc))) continue;
        if (onPath[n] && field.sec[n] >= 0 && n !== g) continue; // never merge corridors inside a transition band
        const rn = field.region[n];
        if (strict && rn !== e.a && rn !== e.b) continue;
        const nd = dist[c] + cost(n) + (rn !== e.a && rn !== e.b ? 14 : 0);
        if (nd < dist[n]) { dist[n] = nd; prev[n] = c; push(n, nd + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.45); }
      }
    }
    if (g === s || prev[g] >= 0) { if (!strict) {} break; }
    }
    if (g !== s && prev[g] < 0) { unrouted++; return; }
    const path = []; for (let c = g; c !== -1; c = prev[c]) path.push(c);
    path.reverse();
    for (let i = 0; i < path.length; i++) {
      onPath[path[i]] = 1; ownA[path[i]] = e.a; ownB[path[i]] = e.b;
      if (i + 1 < path.length) {
        const a = path[i], b = path[i + 1];
        const d = b === a - COLS ? 0 : b === a + 1 ? 1 : b === a + COLS ? 2 : 3;
        req[a] |= 1 << d; req[b] |= 1 << OPP(d);
      }
    }
    paths.push({ edge: e, cells: path });
  });
  // hub rooms stamped at each region centre: inner edges must be wide openings
  const wide = new Uint8Array(NC), stamp = new Uint8Array(NC);
  reg.pts.forEach(p => {
    const k = p.hub !== undefined ? p.hub : STYLES[p.style].hub, x0 = Math.max(1, Math.min(COLS - 1 - k, p.cx - (k >> 1))), y0 = Math.max(1, Math.min(ROWS - 1 - k, p.cy - (k >> 1)));
    for (let y = y0; y < y0 + k; y++) for (let x = x0; x < x0 + k; x++) {
      const c = y * COLS + x; if (field.sec[c] >= 0 || (field.excluded && field.excluded[c])) continue; stamp[c] = 1;
      for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = y + DY[d], nn = ny * COLS + nx; if (nx >= x0 && nx < x0 + k && ny >= y0 && ny < y0 + k && field.sec[nn] < 0 && !(field.excluded && field.excluded[nn])) wide[c] |= 1 << d; }
    }
  });
  let pinned = 0; for (let c = 0; c < NC; c++) if (onPath[c] || stamp[c]) pinned++;
  return { req, wide, stamp, onPath, ownA, ownB, paths, pinned, unrouted, detours };
}

// ---------- Stage 5: constrained WFC with local-reset backtracking ----------
// ---------- Maze layer: a braided maze (any algorithm from mazes.js) that sprouts from the pinned corridors ----------
// It never constrains WFC; it only reweights tiles so their openings tend to follow the maze's passages.
// Passages stay inside one biome (same primary style), so the maze never argues with the tier rules.
function genMaze(field, cor, seed, algo) {
  const gm = typeof generateMaze === 'function' ? generateMaze : require('./mazes.js').generateMaze;
  const roots = [];
  for (let c = 0; c < NC; c++) if (cor.onPath[c] || cor.stamp[c]) roots.push(c);
  const mz = gm({
    W: COLS, H: ROWS, rng: mulberry32(seed * 7717 + 11), algo: algo || 'growing',
    ok: c => !(field.excluded && field.excluded[c]),
    canLink: (a, b) => field.prim[a] === field.prim[b],
    roots,
    straight: c => STYLES[field.prim[c]].maze.straight,
    braid: c => STYLES[field.prim[c]].maze.braid,
  });
  for (let c = 0; c < NC; c++) mz[c] |= cor.req[c];
  return mz;
}

class WFC {
  constructor(field, cor, seed, reg, maze, strength) {
    this.field = field; this.cor = cor; this.maze = maze; this.strength = strength || 0;
    this.styleOfRegion = reg.pts.map(p => p.style);
    this.rng = mulberry32(seed * 7 + 99);
    this.init = new Uint8Array(NC * T);
    this.dom = new Uint8Array(NC * T);
    this.cnt = new Int16Array(NC);
    this.ent = new Float32Array(NC);
    this.dirty = new Uint8Array(NC);
    this.resets = 0; this.restarts = 0; this.done = false; this.collapsedSteps = 0;
    this.buildInit();
    this.buildWeights();
    this.restart();
  }
  styleSet(c) {
    // a cell may use its own style and its band partner; a pinned corridor cell may also take the style of the
    // corridor cells it must open into, so a corridor can change style at whichever cell suits the solver
    // across a tier boundary only corridor cells may change style, so tiers meet exclusively at designed links
    const f = this.field, cor = this.cor, rq = cor.req[c], x = c % COLS, y = (c / COLS) | 0;
    let m = 1 << f.prim[c];
    if (f.sec[c] >= 0 && f.cross[f.prim[c]][f.sec[c]] === 1) m |= 1 << f.sec[c];
    if (cor.onPath[c] && cor.ownA[c] >= 0) {
      const sa = this.styleOfRegion[cor.ownA[c]], sb = this.styleOfRegion[cor.ownB[c]];
      m |= (1 << sa) | (1 << sb);
      if (rq) for (let d = 0; d < 4; d++) if (rq >> d & 1) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue; const p = f.prim[ny * COLS + nx]; if (p === sa || p === sb) m |= 1 << p; }
    }
    return m;
  }
  allowed(t, c) {
    const ex = this.field.excluded;
    if (ex && ex[c]) return t === 0;
    const f = this.field, tt = tiles[t], x = c % COLS, y = (c / COLS) | 0, rq = this.cor.req[c], set = this.styleSet(c);
    if (tt.style === -1) { if (rq || this.cor.stamp[c]) return false; }
    else if (tt.gate) {
      const a = tt.gate[0], b = tt.gate[1];
      if (!(set >> a & 1) || !(set >> b & 1)) return false;
      const k = f.cross[a][b]; if (!k || (k === 2 && !this.cor.onPath[c])) return false;
      if (k === 1 && !rq && !(f.sec[c] >= 0)) return false;
    } else if (!(set >> tt.style & 1)) return false;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d], so = tSock[t * 4 + d];
      // the map edge is solid, except where a portal (a doorway into the next sector) is declared
      const edge = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || (ex && ex[ny * COLS + nx]);
      if (edge && so !== 0 && !(this.cor.portalOut && (this.cor.portalOut[c] >> d & 1))) return false;
      if (this.cor.portalOut && (this.cor.portalOut[c] >> d & 1) && so % 2 !== 1) return false; // doorways into the next sector are narrow
      if ((rq >> d & 1) && so === 0) return false;
      if ((this.cor.wide[c] >> d & 1) && !(so > 0 && so % 2 === 0)) return false;
    }
    return true;
  }
  buildInit() { for (let c = 0; c < NC; c++) for (let t = 0; t < T; t++) this.init[c * T + t] = this.allowed(t, c) ? 1 : 0; }
  buildWeights() {
    // per-cell tile weights: the biome's table, scaled by how well each tile's openings follow the maze
    const W = this.W = new Float32Array(NC * T), mz = this.maze, S0 = this.strength;
    for (let c = 0; c < NC; c++) {
      const st = STYLES[this.field.prim[c]], k = mz ? S0 * st.maze.k : 0, m = mz ? mz[c] : 0, b = c * T;
      for (let t = 0; t < T; t++) {
        if (!this.init[b + t]) continue;
        let w = t === 0 ? st.w.solid : tW[t];
        if (k > 0) {
          for (let d = 0; d < 4; d++) {
            const to = tSock[t * 4 + d] > 0, mo = (m >> d & 1) === 1;
            if (to && mo) w *= 1 + 5 * k;
            else if (to && !mo) w *= Math.max(0.03, 1 - 0.9 * k);
            else if (!to && mo) w *= Math.max(0.03, 1 - 0.85 * k);
          }
        }
        W[b + t] = Math.max(1e-6, w);
      }
    }
  }
  w(t, c) { return this.W[c * T + t]; }
  recalc(c) {
    let n = 0, sw = 0, swl = 0; const b = c * T;
    for (let t = 0; t < T; t++) if (this.dom[b + t]) { n++; const w = this.w(t, c); sw += w; swl += w * Math.log(w); }
    this.cnt[c] = n; this.ent[c] = n > 1 ? Math.log(sw) - swl / sw : 0;
    this.dirty[c] = 1;
  }
  restart() {
    this.dom.set(this.init);
    for (let c = 0; c < NC; c++) this.recalc(c);
    const q = []; for (let c = 0; c < NC; c++) q.push(c);
    this.propagate(q);
    this.done = false; this.collapsedSteps = 0;
  }
  sideMask(c, d) { let m = 0; const b = c * T; for (let t = 0; t < T; t++) if (this.dom[b + t]) m |= 1 << tSock[t * 4 + d]; return m; }
  propagate(q) {
    const inQ = new Uint8Array(NC); q.forEach(c => inQ[c] = 1);
    while (q.length) {
      const c = q.pop(); inQ[c] = 0;
      const x = c % COLS, y = (c / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ex = this.field.excluded;
        if (ex && (ex[c] || ex[ny * COLS + nx])) continue; // no constraints across a sector border
        const n = ny * COLS + nx, m = this.sideMask(c, d), od = OPP(d), b = n * T;
        let changed = false;
        for (let t = 0; t < T; t++) if (this.dom[b + t] && !(m & (1 << tSock[t * 4 + od]))) { this.dom[b + t] = 0; changed = true; }
        if (changed) {
          this.recalc(n);
          if (this.cnt[n] === 0) return n;
          if (!inQ[n]) { inQ[n] = 1; q.push(n); }
        }
      }
    }
    return -1;
  }
  area(c, r, fn) {
    const x0 = c % COLS, y0 = (c / COLS) | 0;
    for (let y = Math.max(0, y0 - r); y <= Math.min(ROWS - 1, y0 + r); y++)
      for (let x = Math.max(0, x0 - r); x <= Math.min(COLS - 1, x0 + r); x++) fn(y * COLS + x);
  }
  fix(fail) {
    let r = 2;
    while (fail >= 0) {
      this.resets++;
      if (this.resets > 400) { this.restarts++; this.resets = 0; this.restart(); return; }
      this.area(fail, r, c => { this.dom.set(this.init.subarray(c * T, c * T + T), c * T); this.recalc(c); });
      const q = []; this.area(fail, r + 1, c => q.push(c));
      fail = this.propagate(q);
      r = Math.min(r + 1, 8);
    }
  }
  step() {
    if (this.done) return false;
    let best = -1, be = 1e9;
    for (let c = 0; c < NC; c++) if (this.cnt[c] > 1) { const e = this.ent[c] + this.rng() * 1e-3; if (e < be) { be = e; best = c; } }
    if (best < 0) { this.done = true; return false; }
    const b = best * T; let sw = 0;
    for (let t = 0; t < T; t++) if (this.dom[b + t]) sw += this.w(t, best);
    let r = this.rng() * sw, pick = -1;
    for (let t = 0; t < T; t++) if (this.dom[b + t]) { r -= this.w(t, best); pick = t; if (r <= 0) break; }
    for (let t = 0; t < T; t++) this.dom[b + t] = t === pick ? 1 : 0;
    this.recalc(best); this.collapsedSteps++;
    const fail = this.propagate([best]);
    if (fail >= 0) this.fix(fail);
    return true;
  }
  tileAt(c) { if (this.cnt[c] !== 1) return -1; const b = c * T; for (let t = 0; t < T; t++) if (this.dom[b + t]) return t; return -1; }
  progress() { let k = 0; for (let c = 0; c < NC; c++) if (this.cnt[c] === 1) k++; return k / NC; }
}

// ---------- Stage 6: connectivity validation on the 3x3 sub-grid ----------
const SW = COLS * 3, SH = ROWS * 3, NSUB = SW * SH;
function buildSub(wfc) {
  const floor = new Uint8Array(NSUB), tileOf = new Int32Array(NSUB).fill(-1);
  for (let c = 0; c < NC; c++) {
    const t = wfc.tileAt(c); if (t < 0) continue;
    const x = c % COLS, y = (c / COLS) | 0, m = tSub[t];
    for (let k = 0; k < 9; k++) if (m >> k & 1) { const i = (y * 3 + ((k / 3) | 0)) * SW + x * 3 + k % 3; floor[i] = 1; tileOf[i] = t; }
  }
  return { floor, tileOf };
}
function validate(sub, reg) {
  const { floor } = sub;
  const e = reg.pts[reg.entrance];
  const start = (e.cy * 3 + 1) * SW + e.cx * 3 + 1;
  const dist = new Int32Array(NSUB).fill(-1);
  const q = [start]; dist[start] = 0; let maxD = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % SW, y = (i / SW) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= SW || ny >= SH) continue;
      const n = ny * SW + nx; if (floor[n] && dist[n] < 0) { dist[n] = dist[i] + 1; if (dist[n] > maxD) maxD = dist[n]; q.push(n); }
    }
  }
  // unreachable components
  const comp = new Int32Array(NSUB).fill(-1), pockets = [];
  let total = 0, reach = q.length;
  for (let i = 0; i < NSUB; i++) if (floor[i]) total++;
  for (let i = 0; i < NSUB; i++) {
    if (!floor[i] || dist[i] >= 0 || comp[i] >= 0) continue;
    const id = pockets.length, cells = [i]; comp[i] = id;
    for (let h = 0; h < cells.length; h++) {
      const j = cells[h], x = j % SW, y = (j / SW) | 0;
      for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= SW || ny >= SH) continue; const n = ny * SW + nx; if (floor[n] && comp[n] < 0 && dist[n] < 0) { comp[n] = id; cells.push(n); } }
    }
    pockets.push(cells);
  }
  // regions whose hub is reachable
  let hubs = 0; reg.pts.forEach(p => { if (dist[(p.cy * 3 + 1) * SW + p.cx * 3 + 1] >= 0) hubs++; });
  return { dist, maxD, pockets, total, reach, hubs, start, order: q };
}
function connectPockets(sub, val, field, reg) {
  const tierAt = i => reg.pts[field.region[(((i / SW) | 0) / 3 | 0) * COLS + ((i % SW) / 3 | 0)]].tier;
  // carve the shortest tunnel from each pocket to the reachable network
  const carved = new Uint8Array(NSUB);
  const reachable = new Uint8Array(NSUB);
  for (let i = 0; i < NSUB; i++) if (val.dist[i] >= 0) reachable[i] = 1;
  val.pockets.forEach(cells => {
    const pt = tierAt(cells[0]);
    const prev = new Int32Array(NSUB).fill(-2), q = [];
    cells.forEach(c => { prev[c] = -1; q.push(c); });
    let hit = -1;
    for (let h = 0; h < q.length && hit < 0; h++) {
      const i = q[h], x = i % SW, y = (i / SW) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d]; if (nx < 1 || ny < 1 || nx >= SW - 1 || ny >= SH - 1) continue;
        const n = ny * SW + nx; if (prev[n] !== -2 || tierAt(n) !== pt) continue; prev[n] = i;
        if (reachable[n]) { hit = n; break; }
        q.push(n);
      }
    }
    if (hit < 0) return;
    for (let c = prev[hit]; c >= 0 && prev[c] !== -1; c = prev[c]) { if (!sub.floor[c]) carved[c] = 1; }
    cells.forEach(c => reachable[c] = 1);
    for (let c = prev[hit]; c >= 0; c = prev[c]) { reachable[c] = 1; if (prev[c] === -1) break; }
  });
  return carved;
}

// Which regions does the walkable floor actually join? Check those links against the rules.
function subStyle(tileOf, i) {
  const t = tileOf[i]; if (t <= 0) return -1;
  const tt = tiles[t]; if (!tt.gate) return tt.style;
  const k = (((i / SW) | 0) % 3) * 3 + (i % SW) % 3, d = k === 1 ? 0 : k === 5 ? 1 : k === 7 ? 2 : k === 3 ? 3 : -1;
  return d >= 0 && tt.sock[d] ? (tt.sock[d] - 1) >> 1 : tt.style;
}
function validateGrammar(floor, tileOf, val, reg, field, rules, cor) {
  // floor belongs to the region whose style it was built in: a corridor cell credits its own edge's endpoints
  const regOf = i => {
    const c = (((i / SW) | 0) / 3 | 0) * COLS + ((i % SW) / 3 | 0), st = subStyle(tileOf, i);
    if (st < 0 || st === field.prim[c]) return field.region[c];
    if (cor.ownA[c] >= 0) {
      const A = cor.ownA[c], B = cor.ownB[c];
      if (reg.pts[A].style === st) return A; if (reg.pts[B].style === st) return B;
      if (reg.pts[A].tier === TIER_OF_STYLE[st]) return A; if (reg.pts[B].tier === TIER_OF_STYLE[st]) return B;
    }
    return st === field.sec[c] && field.region2[c] >= 0 ? field.region2[c] : field.region[c];
  };
  const links = new Set();
  for (let i = 0; i < NSUB; i++) {
    if (val.dist[i] < 0) continue;
    const x = i % SW, r = regOf(i);
    for (const j of [x + 1 < SW ? i + 1 : -1, i + SW < NSUB ? i + SW : -1]) {
      if (j < 0 || !floor[j] || val.dist[j] < 0) continue;
      const r2 = regOf(j); if (r2 === r) continue;
      links.add(r < r2 ? r + ',' + r2 : r2 + ',' + r);
    }
  }
  const T_ = reg.pts.map(p => p.tier), n = reg.pts.length, adj = reg.pts.map(() => new Set());
  // links touching a ruined region are breaches: reported, but outside the built doctrine
  let illegal = 0, cross = 0, breaches = 0;
  links.forEach(k => {
    const [a, b] = k.split(',').map(Number);
    const bad = !tierPairOK(rules, T_[a], T_[b]);
    if (reg.pts[a].ruined || reg.pts[b].ruined) { if (bad) breaches++; return; }
    adj[a].add(b); adj[b].add(a); if (T_[a] !== T_[b]) cross++; if (bad) illegal++;
  });
  let capViol = 0;
  for (let u = 0; u < n; u++) {
    const m = [...adj[u]].filter(v => T_[v] === 1).length, h = [...adj[u]].filter(v => T_[v] === 2).length;
    if (T_[u] === 0 && m > rules.capEM) capViol++;
    if (T_[u] === 1 && h > rules.capMH) capViol++;
  }
  // can a Hard region be reached from the entrance without passing through a Medium one?
  const seen = new Uint8Array(n), q = [reg.entrance]; seen[reg.entrance] = 1; let skip = 0;
  for (let h = 0; h < q.length; h++) adj[q[h]].forEach(v => { if (seen[v] || T_[v] === 1) return; seen[v] = 1; if (T_[v] === 2) skip++; else q.push(v); });
  return { links: links.size, linkList: [...links], cross, illegal, capViol, skip, breaches };
}

if (typeof module !== 'undefined') module.exports = { subStyle, assignFunctions, mulberry32, makeNoise, tierPairOK, OPP, DX, DY, setPreset, PRESETS, FUNCS, DOCTRINE, genMaze, COLS, ROWS, NC, T, tiles, STYLES, TIERS, genRegions, genCandidates, genGrammar, validateGrammar, genField, genCorridors, WFC, buildSub, validate, connectPockets, SW, SH };
