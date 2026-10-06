(() => {
const STYLE_COL = ['#d9caa2', '#5db7a3', '#e47c40', '#8b98ea', '#c9d4e3'];
const STYLE_RIM = ['#f3e8c8', '#9be3d0', '#ffb07a', '#c0c8ff', '#eef4fc'];
const STYLE_FLOOR = ['#8f8263', '#2f6e62', '#8c4521', '#44508f', '#4f5e74'];
const TIER_COL = ['#a8d672', '#f0b34b', '#e05a5a'];
const NEUTRAL = '#9b9ca6';
const GATE = '#f3d36b', ROCK = '#0b0c10', ROCK2 = '#14161c', BRASS = '#cfa74e', POCKET = '#ff4fd8';
const KIND = { dead: 'dead end', straight: 'corridor', turn: 'bend', tee: 'T-junction', cross: 'crossroads', interior: 'room interior', edge: 'room wall', corner: 'room corner', strip: 'narrow hall', gate: 'archway', solid: 'solid rock' };
const DIRN = ['N', 'E', 'S', 'W'];
const ESC = ['gentle', 'easy-going', 'even', 'brisk', 'steep'];

const STAGES = [
  { t: 'Regions', l: 'Hubs', d: 'Poisson-disk sampling scatters region hubs with a minimum spacing. The northernmost hub becomes the entrance. Each hub owns the cells nearest to it, measured through noise-warped space so territories have wandering borders.' },
  { t: 'Candidate links', l: 'Graph', d: 'Two hubs are candidates for a connection when their territories share a real border. That keeps every future corridor inside its two regions, so the grammar can trust that a link means exactly one doorway between exactly two places.' },
  { t: 'Progression grammar', l: 'Rules', d: 'A tree grows outward from the entrance, shortest candidate first. Each new region picks a tier the rules allow from its parent, and prefers harder tiers the further it sits from the entrance. Leftover candidates come back as loops only if they are legal too. Each tier then draws a biome from its pool.' },
  { t: 'Style field', l: 'Field', d: 'Every cell takes its region’s biome. Near a border with another biome it joins the transition band (striped). Between two biomes of the same tier the band blends freely. Across tiers it only blends on corridor cells, so tiers meet at designed doorways and solid rock everywhere else.' },
  { t: 'Corridors & maze', l: 'Maze', d: 'Each graph link is routed with A* through its two regions only, and every step pins the cells it crosses to have an opening on that side. WFC cannot remove these, so connectivity is locked in. Then a braided maze grows outward from those corridors through each biome (thin lines). It is not a constraint: it only reweights WFC tiles toward following its passages, which is what gives the result its labyrinth texture.' },
  { t: 'Wave function collapse', l: 'WFC', d: 'WFC collapses the lowest-entropy cell, then propagates socket constraints to its neighbours. Tile weights come from the biome, multiplied by how well each tile follows the maze, so a strongly mazy biome collapses into corridors and thin walls while caverns stay open. Archways between tiers are only legal on pinned corridor cells. On a contradiction, a small area is reset and re-solved.' },
  { t: 'Validate & repair', l: 'Check', d: 'A flood fill from the entrance walks the floor, then every place two regions’ floors actually touch is checked against the rules: legal tier pairs, branch caps, and whether any Hard region can be reached without passing through Medium. Leftover pockets can be pruned or tunnelled to the nearest floor of the same tier.' },
];
const STAGES_ARSENAL = {
  3: { t: 'Clearance & doctrine', d: 'Clearance rings grow outward from the Gatehouse: Outer stores, the Works, the inner Keep. Seals between rings obey the rules below. Then imperial doctrine gives every region a job: archives and garrisons outside, foundries fed by power and cisterns but walled off from magazines, a Keep entered only through Checkpoints. Finally the ruin pass collapses some regions into breaches.' },
  4: { t: 'Style field', d: 'Each region takes the architecture of its function: crypts for the garrison ring, haul-road halls for the foundries, service ducts for the magazines and cisterns, symmetric halls for the Keep. Same-ring borders blend; seals between rings only open on corridor cells. Breaches blend with everything, which is how ruin cuts through clearance.' },
  7: { t: 'Validate & repair', d: 'A flood fill from the Gatehouse walks the floor, then every place two regions’ floors touch is checked. Built links must respect the seals, caps and the rule that the Keep sits behind the Works. Links through breached regions are counted separately: these are the shortcuts the empire never intended.' },
};
function stageInfo(n) { const b = STAGES[n - 1]; return PRESET === 'arsenal' && STAGES_ARSENAL[n] ? { ...b, ...STAGES_ARSENAL[n] } : b; }
const NST = STAGES.length, S_RULES = 3, S_FIELD = 4, S_PINS = 5, S_WFC = 6, S_CHECK = 7;

const P = { seed: 1, regions: 14, loops: 25, band: 2.5, speed: 14, salt: 0, maze: 60, algo: 'growing' };
const R = { em: true, mh: true, eh: false, capEM: 2, capMH: 2, esc: 3, ruin: 15 };
const S = { reg: null, cand: null, graph: null, field: null, cor: null, wfc: null, sub: null, val: null, carved: null, val2: null, gv: null, fix: 'show', heat: false, tint: false };
let stage = 1, playing = false, flood = 0, finalDirty = true;

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let sp = 3, TP = 9;
const layer = document.createElement('canvas'), lctx = layer.getContext('2d');
const fin = document.createElement('canvas'), fctx = fin.getContext('2d');
const heatL = document.createElement('canvas'), hctx = heatL.getContext('2d');
let heatPtr = 0;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function sizeCanvas() {
  const w = cv.parentElement.clientWidth || 360, dpr = Math.min(3, window.devicePixelRatio || 1);
  sp = Math.max(2, Math.floor(w * dpr / (COLS * 3)));
  TP = sp * 3;
  for (const c of [cv, layer, fin, heatL]) { c.width = COLS * TP; c.height = ROWS * TP; }
  if (S.wfc) S.wfc.dirty.fill(1);
  lctx.fillStyle = ROCK; lctx.fillRect(0, 0, layer.width, layer.height);
  finalDirty = true; resetHeat();
}
function resetHeat() { heatPtr = 0; flood = 0; hctx.clearRect(0, 0, heatL.width, heatL.height); }

// ---------- pipeline ----------
function compute(from) {
  if (from <= 1) S.reg = genRegions(P.seed, P.regions);
  if (from <= 2) S.cand = genCandidates(S.reg, P.seed);
  if (from <= 3) S.graph = genGrammar(S.reg, S.cand, P.seed, R, P.loops);
  if (from <= 4) S.field = genField(S.reg, P.seed, P.band, R);
  if (from <= 5) { S.cor = genCorridors(S.reg, S.graph, S.field, P.seed); S.maze = genMaze(S.field, S.cor, P.seed, P.algo); }
  if (from <= 6) { S.wfc = null; S.sub = S.val = S.val2 = S.carved = S.gv = null; }
  if (stage >= S_WFC) ensureWFC();
  if (stage === S_CHECK) finishAndValidate(); else if (stage === S_WFC) playing = true;
}
function ensureWFC() {
  if (!S.wfc) { S.wfc = new WFC(S.field, S.cor, P.seed + P.salt * 1013, S.reg, S.maze, P.maze / 100); lctx.fillStyle = ROCK; lctx.fillRect(0, 0, layer.width, layer.height); }
}
function finishAndValidate() {
  ensureWFC();
  while (S.wfc.step()) {}
  playing = false;
  if (!S.val) {
    S.sub = buildSub(S.wfc);
    S.val = validate(S.sub, S.reg);
    S.carved = connectPockets(S.sub, S.val, S.field, S.reg);
    const f2 = { floor: S.sub.floor.slice(), tileOf: S.sub.tileOf };
    for (let i = 0; i < f2.floor.length; i++) if (S.carved[i]) f2.floor[i] = 1;
    S.f2 = f2;
    S.val2 = validate(f2, S.reg);
    finalDirty = true; resetHeat();
  }
  const v = S.fix === 'connect' ? S.val2 : S.val, fl = S.fix === 'connect' ? S.f2.floor : S.sub.floor;
  S.gv = validateGrammar(fl, S.sub.tileOf, v, S.reg, S.field, R, S.cor);
}

// ---------- drawing helpers ----------
function cellXY(c) { return [(c % COLS) * TP, ((c / COLS) | 0) * TP]; }
function hubCenter(p) { return [(p.cx + 0.5) * TP, (p.cy + 0.5) * TP]; }
function alpha(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function font(px) { return `500 ${Math.round(px)}px "IBM Plex Mono", ui-monospace, monospace`; }

function drawGround(g) {
  g.fillStyle = ROCK; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = 'rgba(207,167,78,0.06)'; g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= COLS; x += 4) { g.moveTo(x * TP + 0.5, 0); g.lineTo(x * TP + 0.5, cv.height); }
  for (let y = 0; y <= ROWS; y += 4) { g.moveTo(0, y * TP + 0.5); g.lineTo(cv.width, y * TP + 0.5); }
  g.stroke();
}
function drawTerritories(g, colorOf, a) {
  const reg = S.cand.region;
  for (let c = 0; c < NC; c++) { const [x, y] = cellXY(c); g.fillStyle = alpha(colorOf(reg[c]), a); g.fillRect(x, y, TP, TP); }
  // borders
  g.fillStyle = 'rgba(230,225,213,0.22)';
  const k = Math.max(1, sp * 0.35);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = y * COLS + x;
    if (x + 1 < COLS && reg[c] !== reg[c + 1]) g.fillRect((x + 1) * TP - k / 2, y * TP, k, TP);
    if (y + 1 < ROWS && reg[c] !== reg[c + COLS]) g.fillRect(x * TP, (y + 1) * TP - k / 2, TP, k);
  }
}
function drawHubs(g, opts) {
  const big = opts && opts.big, tiered = S.reg.pts[0].tier >= 0 && !(opts && opts.neutral);
  const r = TP * (big ? 1.05 : 0.8);
  S.reg.pts.forEach((p, i) => {
    const [x, y] = hubCenter(p);
    g.fillStyle = tiered ? (opts && opts.styleFill ? STYLE_COL[p.style] : TIER_COL[p.tier]) : NEUTRAL;
    g.strokeStyle = ROCK; g.lineWidth = Math.max(1, sp * 0.6);
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
    if (tiered) {
      if (opts && opts.styleFill) { g.strokeStyle = TIER_COL[p.tier]; g.lineWidth = Math.max(1.5, sp * 0.55); g.beginPath(); g.arc(x, y, r + sp * 0.5, 0, 7); g.stroke(); }
      g.fillStyle = ROCK; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (p.fn) { g.font = font(r * 0.85); g.fillText(p.fn, x, y + r * 0.06); } else { g.font = font(r * 1.15); g.fillText(TIERS[p.tier].short, x, y + r * 0.06); }
      if (p.ruined) { g.strokeStyle = STYLE_COL[1]; g.lineWidth = Math.max(1.5, sp * 0.6); g.setLineDash([sp, sp * 0.7]); g.beginPath(); g.arc(x, y, r + sp * 1.2, 0, 7); g.stroke(); g.setLineDash([]); }
    }
    if (i === S.reg.entrance) {
      g.strokeStyle = GATE; g.lineWidth = Math.max(1.5, sp * 0.7);
      g.beginPath(); g.arc(x, y, r + TP * 0.6, 0, 7); g.stroke();
      g.fillStyle = GATE; g.font = font(TP * 1.05); g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText('IN', x, y - r - TP * 0.75);
    }
  });
}
function line(g, e, col, w, dash) {
  const a = hubCenter(S.reg.pts[e.a]), b = hubCenter(S.reg.pts[e.b]);
  g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []);
  g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.setLineDash([]);
}
function drawCandidates(g, col) { S.cand.del.forEach(e => line(g, e, col, Math.max(1, sp * 0.45))); }
function drawGrammar(g, showForbidden) {
  if (showForbidden) S.graph.forbidden.forEach(e => {
    line(g, e, 'rgba(224,90,90,0.55)', Math.max(1, sp * 0.45), [sp * 0.8, sp * 0.8]);
    const a = hubCenter(S.reg.pts[e.a]), b = hubCenter(S.reg.pts[e.b]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = TP * 0.4;
    g.strokeStyle = '#e05a5a'; g.lineWidth = Math.max(1.5, sp * 0.6);
    g.beginPath(); g.moveTo(mx - k, my - k); g.lineTo(mx + k, my + k); g.moveTo(mx + k, my - k); g.lineTo(mx - k, my + k); g.stroke();
  });
  S.graph.edges.forEach(e => {
    const w = Math.max(2, sp * 1.1);
    if (e.type === 'loop') line(g, e, GATE, w, [TP * 0.6, TP * 0.45]);
    else {
      // tree edges fade from the parent's tier colour to the child's
      const a = hubCenter(S.reg.pts[e.a]), b = hubCenter(S.reg.pts[e.b]);
      const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      gr.addColorStop(0, TIER_COL[S.reg.pts[e.a].tier]); gr.addColorStop(1, TIER_COL[S.reg.pts[e.b].tier]);
      g.strokeStyle = gr; g.lineWidth = w; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
  });
}
function drawField(g, a, stripes) {
  const f = S.field;
  for (let c = 0; c < NC; c++) {
    const [x, y] = cellXY(c);
    g.fillStyle = alpha(STYLE_COL[f.prim[c]], a);
    g.fillRect(x, y, TP, TP);
    if (stripes && f.sec[c] >= 0) {
      const k = f.cross[f.prim[c]][f.sec[c]];
      if (k === 1) {
        g.fillStyle = alpha(STYLE_COL[f.sec[c]], Math.min(1, a * 1.7));
        for (let j = 0; j < 3; j++) g.fillRect(x, y + j * sp, TP, Math.max(1, sp * 0.45));
      } else {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        for (let j = 0; j < 3; j++) g.fillRect(x + j * sp, y, Math.max(1, sp * 0.4), TP);
      }
    }
  }
}
function drawTileInto(g, t, x, y) {
  if (t === 0) return;
  const tt = tiles[t], m = tSub[t];
  g.fillStyle = tt.gate ? GATE : STYLE_FLOOR[tt.style];
  for (let k = 0; k < 9; k++) if (m >> k & 1) g.fillRect(x + (k % 3) * sp, y + ((k / 3) | 0) * sp, sp, sp);
}
function drawWFCCell(c) {
  const w = S.wfc, f = S.field, [x, y] = cellXY(c);
  lctx.fillStyle = ROCK; lctx.fillRect(x, y, TP, TP);
  if (w.cnt[c] === 1) {
    const t = w.tileAt(c);
    if (t === 0) { lctx.fillStyle = ROCK2; lctx.fillRect(x, y, TP, TP); }
    else drawTileInto(lctx, t, x, y);
  } else if (w.cnt[c] > 1) {
    const e = Math.min(1, w.ent[c] / 3.2);
    lctx.fillStyle = alpha(STYLE_COL[f.prim[c]], 0.06 + (1 - e) * 0.42);
    lctx.fillRect(x + 1, y + 1, TP - 2, TP - 2);
    if (S.cor.onPath[c] || S.cor.stamp[c]) { lctx.fillStyle = BRASS; lctx.fillRect(x + sp * 1.25, y + sp * 1.25, sp * 0.5, sp * 0.5); }
  }
}

function renderFinal() {
  const g = fctx, sub = S.sub, val = S.val;
  g.fillStyle = ROCK; g.fillRect(0, 0, fin.width, fin.height);
  g.fillStyle = ROCK2;
  for (let i = 0; i < SW * SH; i += 7) { const x = i % SW, y = (i / SW) | 0; if (((x * 73856093) ^ (y * 19349663)) & 4) g.fillRect(x * sp, y * sp, sp * 0.5, sp * 0.5); }
  const pocket = new Uint8Array(SW * SH); val.pockets.forEach(cells => cells.forEach(i => pocket[i] = 1));
  const isFloor = i => (sub.floor[i] && !(S.fix === 'prune' && pocket[i])) || (S.fix === 'connect' && S.carved[i]);
  const styleOf = i => subStyle(sub.tileOf, i);
  for (let i = 0; i < SW * SH; i++) {
    if (!isFloor(i)) continue;
    const x = (i % SW) * sp, y = ((i / SW) | 0) * sp, t = sub.tileOf[i];
    if (t < 0) { g.fillStyle = '#6b5a33'; g.fillRect(x, y, sp, sp); continue; }
    const tt = tiles[t], s = styleOf(i);
    g.fillStyle = tt.gate ? '#7a6a35' : STYLE_FLOOR[s];
    if (s === 1 && !tt.gate) { g.beginPath(); g.arc(x + sp / 2, y + sp / 2, sp * 0.78, 0, 7); g.fill(); }
    else g.fillRect(x, y, sp, sp);
  }
  g.lineWidth = Math.max(1, sp * 0.22);
  for (let i = 0; i < SW * SH; i++) {
    if (!isFloor(i)) continue;
    const sx = i % SW, sy = (i / SW) | 0, x = sx * sp, y = sy * sp, s = styleOf(i);
    const rim = s < 0 ? BRASS : STYLE_RIM[s];
    g.strokeStyle = alpha(rim, s === 1 ? 0.35 : 0.75);
    g.beginPath();
    if (sy === 0 || !isFloor(i - SW)) { g.moveTo(x, y); g.lineTo(x + sp, y); }
    if (sy === SH - 1 || !isFloor(i + SW)) { g.moveTo(x, y + sp); g.lineTo(x + sp, y + sp); }
    if (sx === 0 || !isFloor(i - 1)) { g.moveTo(x, y); g.lineTo(x, y + sp); }
    if (sx === SW - 1 || !isFloor(i + 1)) { g.moveTo(x + sp, y); g.lineTo(x + sp, y + sp); }
    g.stroke();
    if (s === 0 && sp >= 4) { g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, sp - 1, sp - 1); g.lineWidth = Math.max(1, sp * 0.22); }
    if (s === 3) { g.fillStyle = 'rgba(192,200,255,0.18)'; g.fillRect(x + sp * 0.4, y + sp * 0.4, sp * 0.2, sp * 0.2); }
    if (s === 4 && (sx + sy) % 2 === 0) { g.fillStyle = 'rgba(238,244,252,0.28)'; g.fillRect(x + sp * 0.35, y + sp * 0.35, sp * 0.3, sp * 0.3); }
  }
  for (let c = 0; c < NC; c++) {
    const t = S.wfc.tileAt(c); if (t <= 0) continue;
    const tt = tiles[t], cx = c % COLS, cy = (c / COLS) | 0, x = cx * TP, y = cy * TP;
    const i = (cy * 3 + 1) * SW + cx * 3 + 1;
    if (!isFloor(i)) continue;
    if (tt.style === 2 && tt.kind === 'interior' && (cx + cy) % 2 === 0) { g.fillStyle = '#2a140a'; g.fillRect(x + sp * 1.2, y + sp * 1.2, sp * 0.6, sp * 0.6); g.strokeStyle = STYLE_RIM[2]; g.lineWidth = 1; g.strokeRect(x + sp * 1.2, y + sp * 1.2, sp * 0.6, sp * 0.6); }
    if (tt.gate) {
      const crossTier = TIER_OF_STYLE[tt.gate[0]] !== TIER_OF_STYLE[tt.gate[1]];
      g.fillStyle = crossTier ? GATE : alpha(GATE, 0.55);
      const horiz = tt.gateDirs.every(d => d === 1 || d === 3), vert = tt.gateDirs.every(d => d === 0 || d === 2);
      if (horiz) g.fillRect(x + sp * 1.35, y + sp * 0.6, sp * 0.3, sp * 1.8);
      else if (vert) g.fillRect(x + sp * 0.6, y + sp * 1.35, sp * 1.8, sp * 0.3);
      else { g.beginPath(); g.arc(x + sp * 1.5, y + sp * 1.5, sp * 0.55, 0, 7); g.fill(); }
      if (crossTier && sp >= 3) { g.strokeStyle = GATE; g.lineWidth = Math.max(1, sp * 0.25); g.strokeRect(x + sp * 0.25, y + sp * 0.25, TP - sp * 0.5, TP - sp * 0.5); }
    }
  }
  if (S.tint) {
    for (let i = 0; i < SW * SH; i++) {
      if (!isFloor(i)) continue;
      const s = styleOf(i); if (s < 0) continue;
      g.fillStyle = alpha(TIER_COL[TIER_OF_STYLE[s]], 0.5);
      g.fillRect((i % SW) * sp, ((i / SW) | 0) * sp, sp, sp);
    }
  }
  if (S.fix === 'show') {
    g.fillStyle = alpha(POCKET, 0.8);
    val.pockets.forEach(cells => cells.forEach(i => g.fillRect((i % SW) * sp, ((i / SW) | 0) * sp, sp, sp)));
  } else if (S.fix === 'prune') {
    g.fillStyle = '#3a3c44';
    val.pockets.forEach(cells => cells.forEach(i => g.fillRect((i % SW) * sp + sp * 0.3, ((i / SW) | 0) * sp + sp * 0.3, sp * 0.35, sp * 0.35)));
  } else {
    g.fillStyle = BRASS;
    for (let i = 0; i < SW * SH; i++) if (S.carved[i]) g.fillRect((i % SW) * sp + sp * 0.3, ((i / SW) | 0) * sp + sp * 0.3, sp * 0.4, sp * 0.4);
  }
  // tier letters at hubs
  S.reg.pts.forEach(p => {
    const [x, y] = hubCenter(p), r = TP * (p.fn ? 0.75 : 0.62);
    g.fillStyle = alpha('#0b0c10', 0.75); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = TIER_COL[p.tier]; g.lineWidth = Math.max(1, sp * 0.45); g.stroke();
    g.fillStyle = TIER_COL[p.tier]; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p.fn) { g.font = font(r * 0.85); g.fillText(p.fn, x, y + r * 0.06); } else { g.font = font(r * 1.15); g.fillText(TIERS[p.tier].short, x, y + r * 0.06); }
    if (p.ruined) { g.strokeStyle = STYLE_COL[1]; g.lineWidth = Math.max(1, sp * 0.45); g.setLineDash([sp, sp * 0.7]); g.beginPath(); g.arc(x, y, r + sp * 0.9, 0, 7); g.stroke(); g.setLineDash([]); }
  });
  finalDirty = false;
}
function heatColor(f) { return `hsla(${45 + f * 230},85%,${68 - f * 18}%,0.42)`; }
function advanceHeat(limit) {
  const v = S.fix === 'connect' ? S.val2 : S.val, ord = v.order;
  while (heatPtr < ord.length && v.dist[ord[heatPtr]] <= limit) {
    const i = ord[heatPtr++];
    hctx.fillStyle = heatColor(v.dist[i] / Math.max(1, v.maxD));
    hctx.fillRect((i % SW) * sp, ((i / SW) | 0) * sp, sp, sp);
  }
}

// ---------- frame ----------
function draw() {
  const g = ctx;
  if (stage < S_WFC) {
    drawGround(g);
    if (stage === 1) {
      drawTerritories(g, () => NEUTRAL, 0.04);
      g.strokeStyle = 'rgba(207,167,78,0.18)'; g.lineWidth = 1; g.setLineDash([3, 4]);
      const r = Math.sqrt((COLS - 4) * (ROWS - 4) / P.regions) * 0.78 * TP / 2;
      S.reg.pts.forEach(p => { const [x, y] = hubCenter(p); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); });
      g.setLineDash([]);
      drawHubs(g, { big: true, neutral: true });
    } else if (stage === 2) {
      drawTerritories(g, () => NEUTRAL, 0.06);
      drawCandidates(g, 'rgba(230,225,213,0.75)');
      drawHubs(g, { big: true, neutral: true });
    } else if (stage === S_RULES) {
      drawTerritories(g, r => TIER_COL[S.reg.pts[r].tier], 0.16);
      drawCandidates(g, 'rgba(230,225,213,0.12)');
      drawGrammar(g, true);
      drawHubs(g, { big: true });
    } else if (stage === S_FIELD) {
      drawField(g, 0.34, true); drawGrammar(g, false); drawHubs(g, { styleFill: true });
    } else {
      drawField(g, 0.13, false);
      const c = S.cor;
      for (let i = 0; i < NC; i++) {
        if (!c.onPath[i] && !c.stamp[i]) continue;
        const [x, y] = cellXY(i), col = STYLE_COL[S.field.prim[i]], m = c.req[i], k = sp;
        g.fillStyle = alpha(col, c.stamp[i] ? 0.55 : 0.3); g.fillRect(x, y, TP, TP);
        g.fillStyle = col;
        g.fillRect(x + k, y + k, k, k);
        if (m & 1) g.fillRect(x + k, y, k, k);
        if (m & 2) g.fillRect(x + 2 * k, y + k, k, k);
        if (m & 4) g.fillRect(x + k, y + 2 * k, k, k);
        if (m & 8) g.fillRect(x, y + k, k, k);
        if (S.field.sec[i] >= 0 && S.field.cross[S.field.prim[i]][S.field.sec[i]] === 2) { g.strokeStyle = GATE; g.lineWidth = Math.max(1, sp * 0.3); g.strokeRect(x + 0.5, y + 0.5, TP - 1, TP - 1); }
      }
      // maze passages
      const mz = S.maze;
      g.lineWidth = Math.max(1, sp * 0.4); g.lineCap = 'round';
      for (let i = 0; i < NC; i++) {
        const k = STYLES[S.field.prim[i]].maze.k * P.maze / 100; if (k <= 0 || c.onPath[i]) continue;
        const [x, y] = cellXY(i), cx = x + TP / 2, cy = y + TP / 2;
        g.strokeStyle = alpha(STYLE_RIM[S.field.prim[i]], 0.2 + 0.6 * k);
        g.beginPath();
        if (mz[i] & 2) { g.moveTo(cx, cy); g.lineTo(cx + TP, cy); }
        if (mz[i] & 4) { g.moveTo(cx, cy); g.lineTo(cx, cy + TP); }
        if (!(mz[i] & 6)) { g.moveTo(cx, cy); g.lineTo(cx + 0.01, cy); }
        g.stroke();
      }
      g.lineCap = 'butt';
      drawHubs(g, { styleFill: true });
    }
  } else if (stage === S_WFC) {
    const w = S.wfc;
    for (let c = 0; c < NC; c++) if (w.dirty[c]) { drawWFCCell(c); w.dirty[c] = 0; }
    g.drawImage(layer, 0, 0);
  } else {
    if (finalDirty) renderFinal();
    g.drawImage(fin, 0, 0);
    if (S.heat) { const v = S.fix === 'connect' ? S.val2 : S.val; advanceHeat(flood * v.maxD); g.drawImage(heatL, 0, 0); }
    const e = S.reg.pts[S.reg.entrance], [x, y] = hubCenter(e);
    g.strokeStyle = GATE; g.lineWidth = Math.max(1.5, sp * 0.6); g.beginPath(); g.arc(x, y, TP * 1.15, 0, 7); g.stroke();
  }
}
let lastStats = '';
function tick() {
  if (stage === S_WFC && playing && S.wfc) {
    for (let k = 0; k < P.speed; k++) if (!S.wfc.step()) { playing = false; updatePanel(true); break; }
    updatePanel(false);
  }
  if (stage === S_CHECK && S.heat && flood < 1) flood = Math.min(1, flood + (reduced ? 1 : 0.012));
  draw();
  requestAnimationFrame(tick);
}

// ---------- panel ----------
const $ = id => document.getElementById(id);
function chip(label, val, cls) { return `<span class="stat ${cls || ''}">${label} <b>${val}</b></span>`; }
function statsHTML() {
  const r = S.reg, g = S.graph, f = S.field, c = S.cor;
  if (stage === 1) return chip('hubs', r.pts.length) + chip('grid', COLS + '×' + ROWS);
  if (stage === 2) { const avg = S.cand.del.reduce((a, e) => a + e.border, 0) / Math.max(1, S.cand.del.length); return chip('candidate links', S.cand.del.length) + chip('avg shared border', avg.toFixed(1) + ' cells'); }
  if (stage === S_RULES) {
    let out = `<span class="stat">${[0, 1, 2].map(t => `<b class="t${t}">${g.counts[t]}</b> ${TIERS[t].short}`).join(' · ')}</span>` + chip('tree links', g.mstCount) + chip('loops', g.loopCount) + chip('rejected', g.forbidden.length) + chip('max depth', Math.max(...g.depth));
    if (g.doctrine) { const ok = g.doctrine.report.filter(Boolean).length; out += chip('doctrine', ok + '/' + DOCTRINE.length, ok === DOCTRINE.length ? 'ok' : 'warn') + chip('breached', S.reg.pts.filter(p => p.ruined).length); }
    return out;
  }
  if (stage === S_FIELD) {
    let free = 0, gated = 0; for (let i = 0; i < NC; i++) if (f.sec[i] >= 0) { if (f.cross[f.prim[i]][f.sec[i]] === 1) free++; else gated++; }
    return chip('same-tier band', free) + chip('cross-tier band', gated);
  }
  if (stage === S_PINS) { let st = 0; for (let i = 0; i < NC; i++) if (c.stamp[i]) st++; return chip('corridors', c.paths.length) + chip('pinned cells', c.pinned) + chip('hub room cells', st) + chip('detours', c.detours, c.detours ? 'warn' : 'ok'); }
  if (stage === S_WFC) { const w = S.wfc; return chip('solved', Math.round(w.progress() * 100) + '%') + chip('collapses', w.collapsedSteps) + chip('local resets', w.resets) + chip('restarts', w.restarts); }
  const v = S.fix === 'connect' ? S.val2 : S.val, gv = S.gv;
  const floorTotal = S.fix === 'prune' ? S.val.reach : v.total;
  const pct = Math.round(v.reach / Math.max(1, floorTotal) * 1000) / 10;
  const pockets = S.fix === 'show' ? S.val.pockets.length : S.fix === 'connect' ? v.pockets.length : 0;
  let arch = 0; for (let i = 0; i < NC; i++) { const t = S.wfc.tileAt(i); if (t > 0 && tiles[t].gate && TIER_OF_STYLE[tiles[t].gate[0]] !== TIER_OF_STYLE[tiles[t].gate[1]]) arch++; }
  const via = R.eh ? 'n/a' : gv.skip ? 'no' : 'yes';
  return chip('reachable floor', pct + '%', pct >= 100 ? 'ok' : 'warn') + chip('hubs reached', S.val.hubs + '/' + r.pts.length, S.val.hubs === r.pts.length ? 'ok' : 'warn') + chip('pockets', pockets, pockets ? 'warn' : 'ok') +
    chip('illegal links', gv.illegal, gv.illegal ? 'warn' : 'ok') + chip('cap breaches', gv.capViol, gv.capViol ? 'warn' : 'ok') + chip(`${TIERS[2].name} only via ${TIERS[1].name}`, via, via === 'no' ? 'warn' : 'ok') + chip(PRESET === 'arsenal' ? 'seals' : 'tier doorways', arch) + (PRESET === 'arsenal' ? chip('breach shortcuts', gv.breaches) : '');
}
function keyHTML() {
  const sw = (c, dash) => `<i style="border-top-color:${c};${dash ? 'border-top-style:dashed' : ''}"></i>`;
  if (stage === 2) return `<span>${sw('#e6e1d5')}regions share a border</span>`;
  if (stage === S_RULES) return `<span>${sw(TIER_COL[0])}tree link (parent → child tier)</span><span>${sw(GATE, 1)}loop</span><span>${sw('#e05a5a', 1)}rejected by rules</span>`;
  if (stage === S_FIELD) return `<span>colour stripes: same-tier blend</span><span>dark stripes: tiers meet, rock unless pinned</span><span>hub ring: tier</span>`;
  if (stage === S_PINS) return `<span>${sw(BRASS)}nubs: pinned openings</span><span>${sw(GATE)}outlined: tier doorway allowed</span><span>${sw(STYLE_RIM[0])}thin lines: maze bias (fainter = weaker)</span>`;
  if (stage === S_WFC) return `<span>${sw(BRASS)}dot: pinned, unsolved</span><span>brighter: fewer options</span>`;
  if (stage === S_CHECK) return (S.fix === 'show' ? `<span>${sw(POCKET)}unreachable pocket</span>` : S.fix === 'prune' ? `<span>${sw('#3a3c44')}pruned to rock</span>` : `<span>${sw(BRASS)}tunnel within one tier</span>`) +
    `<span>${sw(GATE)}boxed archway: tier doorway</span>` + (S.heat ? '<span>gold to violet: walking distance</span>' : '');
  return '<span>ring: entrance</span><span>dashed circle: Poisson spacing</span>';
}
function prodsHTML() {
  const t = i => `<b class="t${i}">${TIERS[i].name}</b>`;
  const rows = [`<div>${PRESET === 'arsenal' ? 'Gatehouse' : 'Entrance'} → ${t(0)}</div>`];
  rows.push(`<div>${t(0)} → ${t(0)}*${R.em ? ` | ${t(1)} ≤${R.capEM}` : ''}${R.eh ? ` | ${t(2)}` : ''}</div>`);
  rows.push(`<div>${t(1)} → ${t(1)}*${R.em ? ` | ${t(0)}` : ''}${R.mh ? ` | ${t(2)} ≤${R.capMH}` : ''}</div>`);
  rows.push(`<div>${t(2)} → ${t(2)}*${R.mh ? ` | ${t(1)}` : ''}${R.eh ? ` | ${t(0)}` : ''}</div>`);
  if (PRESET === 'arsenal' && S.graph && S.graph.doctrine) {
    rows.push('<div class="docsep">Doctrine</div>');
    DOCTRINE.forEach((d, i) => { const ok = S.graph.doctrine.report[i]; rows.push(`<div class="doc ${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '✗'}</span> ${d}</div>`); });
  }
  return rows.join('');
}
function stageCtlHTML() {
  if (stage === S_PINS) return `<div class="eyebrow">Maze algorithm</div><div class="algos" role="group" aria-label="Maze algorithm">${['backtracker', 'growing', 'huntkill', 'prim', 'kruskal', 'wilson', 'aldous', 'binary', 'sidewinder'].map(k => `<button type="button" data-algo="${k}" class="${k === P.algo ? 'on' : ''}">${MAZE_ALGOS[k].short}</button>`).join('')}</div><p class="note">${MAZE_ALGOS[P.algo].blurb} Each biome still applies its own straightness and braid. Compare the raw algorithms in the <a href="lab.html#a=${P.algo}">Maze Lab</a>.</p>`;
  if (stage === S_WFC) return `<div class="eyebrow">Collapse</div><div class="row"><button class="btn" id="stepBtn" type="button">Step one cell</button><button class="btn" id="restartBtn" type="button">Re-run collapse</button><button class="btn" id="finishBtn" type="button">Finish now</button></div><p class="note">Same pins, new random choices: the progression stays, the architecture changes.</p>`;
  if (stage === S_CHECK) return `<div class="eyebrow">Leftover pockets</div><div class="seg" role="group" aria-label="Pocket handling"><button type="button" data-fix="show">Show</button><button type="button" data-fix="prune">Prune</button><button type="button" data-fix="connect">Connect</button></div><div class="row"><label class="check"><input type="checkbox" id="tintChk"> Tint floor by tier</label><label class="check"><input type="checkbox" id="heatChk"> Flood-fill heat map</label></div><div class="row"><button class="btn primary" id="exploreBtn" type="button">Explore this dungeon ▸</button><button class="btn" id="rerollBtn" type="button">Re-roll architecture</button></div>`;
  const hint = [
    'Change the hub count or seed below to see a new layout.',
    'Borders shorter than three cells are ignored, so every link has room for a doorway.',
    PRESET === 'arsenal' ? 'Each hub shows its function code (key in the Biomes card). Raise Ruin to collapse regions into breaches; a ✗ in the doctrine list means this seed could not satisfy that rule.' : 'Edit the progression rules below. Try turning off Medium ↔ Hard, or set Medium branches to 1 and watch the tree reshape around the cap.',
    'Widen the transition band to see longer borders. Same-tier borders blend; cross-tier borders stay hard.',
    'Raise or lower Labyrinth strength below, then step to WFC to see how strongly the architecture follows the maze. Each biome scales it by its own factor (see the Biomes card).',
  ][stage - 1];
  return `<div class="eyebrow">Try it</div><p class="note" style="font-size:.86rem">${hint}</p>`;
}
function updatePanel(full) {
  const st = statsHTML();
  if (st !== lastStats) { $('stats').innerHTML = st; lastStats = st; }
  if (!full) return;
  const s = stageInfo(stage);
  $('eyebrow').textContent = `Stage ${stage} of ${NST}`;
  $('stageTitle').textContent = s.t; $('stageDesc').textContent = s.d;
  $('key').innerHTML = keyHTML();
  $('stageCtl').innerHTML = stageCtlHTML();
  $('prods').innerHTML = prodsHTML();
  writeHash();
  [...$('rail').children].forEach((b, i) => { b.classList.toggle('on', i + 1 === stage); b.classList.toggle('done', i + 1 < stage); b.setAttribute('aria-current', i + 1 === stage ? 'step' : 'false'); });
  $('prev').disabled = stage === 1;
  $('next').textContent = stage === S_CHECK ? 'Restart ↺' : stage === S_WFC ? 'Validate ▸' : 'Next ▸';
  $('play').hidden = stage !== S_WFC;
  $('play').textContent = playing ? 'Pause' : (S.wfc && S.wfc.done ? 'Done' : 'Play');
  $('play').disabled = !!(S.wfc && S.wfc.done);
  if (stage === S_PINS) {
    document.querySelectorAll('[data-algo]').forEach(b => b.onclick = () => { P.algo = b.dataset.algo; compute(5); updatePanel(true); });
  }
  if (stage === S_WFC) {
    $('stepBtn').onclick = () => { playing = false; S.wfc.step(); updatePanel(true); };
    $('restartBtn').onclick = () => { P.salt++; S.wfc = null; S.val = null; ensureWFC(); playing = true; updatePanel(true); };
    $('finishBtn').onclick = () => { while (S.wfc.step()) {} playing = false; updatePanel(true); };
  }
  if (stage === S_CHECK) {
    document.querySelectorAll('[data-fix]').forEach(b => { b.classList.toggle('on', b.dataset.fix === S.fix); b.onclick = () => { S.fix = b.dataset.fix; finishAndValidate(); finalDirty = true; resetHeat(); updatePanel(true); }; });
    $('heatChk').checked = S.heat; $('tintChk').checked = S.tint;
    $('heatChk').onchange = e => { S.heat = e.target.checked; resetHeat(); updatePanel(true); };
    $('tintChk').onchange = e => { S.tint = e.target.checked; finalDirty = true; updatePanel(true); };
    $('exploreBtn').onclick = () => Explore.open(exploreOpts());
    $('rerollBtn').onclick = () => { P.salt++; S.wfc = null; S.val = null; finishAndValidate(); updatePanel(true); };
  }
}
// ---------- settings in the URL: share or bookmark an exact generation ----------
const HASH_KEYS = { seed: [P, 'seed'], n: [P, 'regions'], loops: [P, 'loops'], band: [P, 'band'], maze: [P, 'maze'], salt: [P, 'salt'], em: [R, 'em'], mh: [R, 'mh'], eh: [R, 'eh'], ce: [R, 'capEM'], cm: [R, 'capMH'], esc: [R, 'esc'], ruin: [R, 'ruin'] };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  Object.entries(HASH_KEYS).forEach(([k, [o, f]]) => {
    if (!p.has(k)) return;
    const v = p.get(k);
    if (typeof o[f] === 'boolean') o[f] = v === '1'; else if (isFinite(+v)) o[f] = +v;
  });
  if (p.get('algo') && MAZE_ALGOS[p.get('algo')]) P.algo = p.get('algo');
  if (p.get('preset') && PRESETS[p.get('preset')]) setPreset(p.get('preset'));
  const st = +p.get('stage'); return st >= 1 && st <= 7 ? st : 1;
}
function writeHash() {
  const parts = [`preset=${PRESET}`, `algo=${P.algo}`, `stage=${stage}`];
  Object.entries(HASH_KEYS).forEach(([k, [o, f]]) => parts.push(`${k}=${typeof o[f] === 'boolean' ? (o[f] ? 1 : 0) : o[f]}`));
  try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* ignore */ }
}
// ---------- explore: walk the finished dungeon on its 3x3 sub-grid ----------
function exploreOpts() {
  finishAndValidate();
  const sub = S.sub, v = S.fix === 'connect' ? S.val2 : S.val;
  const pocket = new Uint8Array(SW * SH); S.val.pockets.forEach(cells => cells.forEach(i => pocket[i] = 1));
  const pass = new Uint8Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) pass[i] = (sub.floor[i] && !(S.fix === 'prune' && pocket[i])) || (S.fix === 'connect' && S.carved[i]) ? 1 : 0;
  const hubSub = p => (p.cy * 3 + 1) * SW + p.cx * 3 + 1;
  // goal: the Vault in the Arsenal, otherwise the reachable hub farthest from the entrance
  let goalP = S.reg.pts.find(p => p.fn === 'VA' && v.dist[hubSub(p)] >= 0);
  if (!goalP) goalP = S.reg.pts.reduce((a, p) => (v.dist[hubSub(p)] > v.dist[hubSub(a)] ? p : a), S.reg.pts[S.reg.entrance]);
  const goal = hubSub(goalP);
  const colorOf = i => { if (S.fix === 'connect' && S.carved[i] && !sub.floor[i]) return '#6b5a33'; const st = subStyle(sub.tileOf, i); return st >= 0 ? STYLE_FLOOR[st] : '#6b5a33'; };
  const landmarks = S.reg.pts.filter(p => p !== goalP).map(p => ({ i: hubSub(p), label: p.fn || TIERS[p.tier].short, color: TIER_COL[p.tier] }));
  const goalName = goalP.fn ? FUNCS[goalP.fn].name : 'deepest hub';
  return {
    w: SW, h: SH, pass, step: 1, light: 11, start: v.start, goal, colorOf, landmarks,
    title: `Find the ${goalName} · seed ${P.seed}`, optimal: v.dist[goal],
    nextLabel: 'Next dungeon',
    onNext: () => { P.seed = 1 + Math.floor(Math.random() * 99999); P.salt = 0; $('seedOut').textContent = P.seed; compute(1); go(S_CHECK); return exploreOpts(); },
  };
}
function go(n) {
  stage = Math.max(1, Math.min(NST, n));
  if (stage >= S_WFC) ensureWFC();
  if (stage === S_WFC) { playing = !S.wfc.done; S.wfc.dirty.fill(1); lctx.fillStyle = ROCK; lctx.fillRect(0, 0, layer.width, layer.height); }
  else playing = false;
  if (stage === S_CHECK) { finishAndValidate(); resetHeat(); }
  $('inspect').innerHTML = 'Tap the map to inspect a cell.';
  updatePanel(true);
}

// ---------- inspect ----------
cv.addEventListener('click', ev => {
  const rc = cv.getBoundingClientRect();
  const cx = Math.floor((ev.clientX - rc.left) / rc.width * COLS), cy = Math.floor((ev.clientY - rc.top) / rc.height * ROWS);
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
  const c = cy * COLS + cx, f = S.field, ri = S.cand.region[c], p = S.reg.pts[ri];
  let line = `<b>cell ${cx},${cy}</b> · region ${ri}`;
  if (stage >= S_RULES) line += `${p.fn ? ` · <b>${FUNCS[p.fn].name}${p.ruined ? ' (breached)' : ''}</b>` : ''} · <b class="t${p.tier}">${TIERS[p.tier].name}</b> · depth ${S.graph.depth[ri]}`;
  if (stage >= S_FIELD) line += ` · ${STYLES[f.prim[c]].name}${f.sec[c] >= 0 ? ' / ' + STYLES[f.sec[c]].name + (f.cross[f.prim[c]][f.sec[c]] === 1 ? ' blend' : ' border') : ''}`;
  const rq = S.cor.req[c];
  if (stage >= S_PINS && (rq || S.cor.stamp[c])) line += ` · pinned${rq ? ' open ' + DIRN.filter((_, d) => rq >> d & 1).join('') : ''}${S.cor.stamp[c] ? ' (hub room)' : ''}`;
  if (stage >= S_WFC && S.wfc) {
    const w = S.wfc;
    if (w.cnt[c] === 1) { const t = tiles[w.tileAt(c)]; line += ` · <b>${KIND[t.kind]}</b>${t.gate ? ' ' + STYLES[t.gate[0]].name + '→' + STYLES[t.gate[1]].name : ''}`; }
    else line += ` · <b>${w.cnt[c]}</b> of ${T} tiles possible`;
  }
  if (stage === S_CHECK && S.val) {
    const i = (cy * 3 + 1) * SW + cx * 3 + 1, v = S.fix === 'connect' ? S.val2 : S.val;
    if (S.sub.floor[i] || (S.fix === 'connect' && S.carved[i])) line += v.dist[i] >= 0 ? ` · ${v.dist[i]} steps from entrance` : ' · <b style="color:var(--pocket)">unreachable</b>';
  }
  $('inspect').innerHTML = line;
});

// ---------- controls ----------
const startStage = readHash();
$('seedOut').textContent = P.seed;
function bind(id, obj, key, fmt, from) {
  const el = $('p' + id), out = $('o' + id);
  el.value = obj[key]; out.textContent = fmt(obj[key]);
  el.addEventListener('input', () => { obj[key] = +el.value; out.textContent = fmt(obj[key]); if (from) { compute(from); updatePanel(true); } });
}
bind('Regions', P, 'regions', v => v, 1);
bind('Loops', P, 'loops', v => v + '%', 3);
bind('Band', P, 'band', v => v.toFixed(1), 4);
bind('Maze', P, 'maze', v => v + '%', 6);
bind('Speed', P, 'speed', v => v + '/frame', 0);
bind('CapEM', R, 'capEM', v => '≤ ' + v, 3);
bind('CapMH', R, 'capMH', v => '≤ ' + v, 3);
bind('Esc', R, 'esc', v => ESC[v - 1], 3);
[['rEM', 'em'], ['rMH', 'mh'], ['rEH', 'eh']].forEach(([id, k]) => {
  const el = $(id); el.checked = R[k];
  el.addEventListener('change', () => { R[k] = el.checked; compute(3); updatePanel(true); });
});
$('reseed').onclick = () => { P.seed = 1 + Math.floor(Math.random() * 99999); P.salt = 0; $('seedOut').textContent = P.seed; compute(1); updatePanel(true); };
$('prev').onclick = () => go(stage - 1);
// one tap: run the whole pipeline, including the full WFC collapse, then walk the result
$('exploreNow').onclick = () => { go(S_CHECK); Explore.open(exploreOpts()); };
$('next').onclick = () => go(stage === S_CHECK ? 1 : stage + 1);
$('play').onclick = () => { if (S.wfc && !S.wfc.done) { playing = !playing; updatePanel(true); } };

$('rail').innerHTML = STAGES.map((s, i) => `<button type="button" data-s="${i + 1}"><span class="n">${i + 1}</span><span class="l">${s.l}</span></button>`).join('');
$('rail').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(+b.dataset.s); });
function refreshPresetUI() {
  const used = PRESETS[PRESET].used, rows = [0, 1, 2];
  if (used.some(i => TIER_OF_STYLE[i] < 0)) rows.push(-1);
  const mazeTxt = s => `maze ${Math.round(s.maze.k * 100)}%, ${s.maze.straight >= 0.6 ? 'straight' : 'winding'}, ${s.maze.braid >= 0.4 ? 'many loops' : s.maze.braid >= 0.2 ? 'some loops' : 'few loops'}`;
  $('legend').innerHTML = rows.map(t => {
    const fns = PRESET === 'arsenal' && t >= 0 ? Object.entries(FUNCS).filter(([, f]) => f.ring === t).map(([k, f]) => `<span class="fn"><b>${k}</b> ${f.name}</span>`).join('') : '';
    return `<div class="tierrow"><span class="tiertag ${t >= 0 ? 't' + t : 'tr'}">${t >= 0 ? TIERS[t].name : 'Ruin'}</span><div class="legend">${used.filter(i => TIER_OF_STYLE[i] === t).map(i => { const s = STYLES[i]; return `<div class="lg"><i style="background:${STYLE_COL[i]}"></i><span>${s.name}</span><small>${s.blurb} · ${mazeTxt(s)}</small></div>`; }).join('')}${fns ? `<div class="fns">${fns}</div>` : ''}</div></div>`;
  }).join('');
  const sh = i => `<b class="t${i}">${TIERS[i].short}</b>`;
  $('lEM').innerHTML = sh(0) + '↔' + sh(1); $('lMH').innerHTML = sh(1) + '↔' + sh(2); $('lEH').innerHTML = sh(0) + '↔' + sh(2);
  $('lCapEM').textContent = `${TIERS[1].name} branches per ${TIERS[0].name} region`;
  $('lCapMH').textContent = `${TIERS[2].name} branches per ${TIERS[1].name} region`;
  $('ruinCtl').hidden = PRESET !== 'arsenal';
  $('subtitle').textContent = PRESET === 'arsenal' ? 'A dead empire’s arsenal: clearance rings, doctrine and ruin, with wave function collapse for the architecture' : 'A progression grammar on the region graph, wave function collapse for the architecture';
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === PRESET));
}
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
  if (b.dataset.preset === PRESET) return;
  setPreset(b.dataset.preset); refreshPresetUI(); compute(3); updatePanel(true);
});
bind('Ruin', R, 'ruin', v => v + '%', 3);
refreshPresetUI();
$('tileCount').textContent = T;

window.addEventListener('resize', () => { const old = cv.width; sizeCanvas(); if (cv.width !== old && S.wfc) S.wfc.dirty.fill(1); });
sizeCanvas();
compute(1);
if (startStage > 1) go(startStage); else updatePanel(true);
requestAnimationFrame(tick);
})();
