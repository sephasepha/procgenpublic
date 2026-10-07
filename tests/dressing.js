// Dressing WFC tests: node tests/dressing.js
// Every tileset learns cleanly; dressing always respects the floor/wall layout; pairs follow the examples;
// output is deterministic; real sectors come back dressed.
const D = require('../gen/dressing.js');
const M = require('../gen/mazes.js');
const W = require('../gen/world.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const t0 = Date.now();

console.log('Tilesets');
D.DRESS_SETS.forEach(s => {
  check(s.K <= 8, `${s.key}: ${s.n} variants exceed the 256 the engines support`);
  ['F', 'E', 'R'].forEach(L => check(s.index[L + '0'] !== undefined, `${s.key}: missing base tile ${L}`));
  // every variant that can actually be placed (it has a context) must have somewhere for its neighbours to go
  s.variants.forEach((v, i) => { if (!s.classesOf[i].size) return; for (let d = 0; d < 4; d++) check(s.allow[d][i].some(w => w !== 0), `${s.key}: tile ${v.letter}${v.r} has no allowed neighbour ${d}`); });
  check(s.unplaced.length === 0, `${s.key}: example tiles that do not fit their context: ${s.unplaced.join(' ')}`);
  ['F', 'C', 'K', 'A', 'R'].forEach(L => check(s.classesOf[s.index[L + '0']].size > 0, `${s.key}: ${L} learned no context`));
});

console.log('Dressing random layouts');
let fallbacks = 0, cells = 0;
D.DRESS_SETS.forEach((s, si) => {
  for (let seed = 1; seed <= 6; seed++) {
    const Wd = 41, Hd = 51, r = rng(seed * 13 + si), cw = 20, ch = 25;
    const mz = M.generateMaze({ W: cw, H: ch, rng: r, algo: ['growing', 'prim', 'kruskal'][seed % 3], braid: 0.3 });
    const pass = new Uint8Array(Wd * Hd);
    for (let c = 0; c < cw * ch; c++) { const x = 2 * (c % cw) + 1, y = 2 * ((c / cw) | 0) + 1; pass[y * Wd + x] = 1; if (mz[c] & 2) pass[y * Wd + x + 1] = 1; if (mz[c] & 4) pass[(y + 1) * Wd + x] = 1; }
    for (let k = 0; k < 4; k++) { const x0 = 2 + (r() * 30 | 0), y0 = 2 + (r() * 40 | 0); for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 7; x++) pass[y * Wd + x] = 1; }
    const setOf = new Uint8Array(Wd * Hd).fill(si);
    const out = D.dress(pass, setOf, Wd, Hd, seed);
    let bad = 0; for (let i = 0; i < Wd * Hd; i++) if (D.DRESS_TILES[out.tiles[i]].walk !== pass[i]) bad++;
    check(bad === 0, `${s.key} seed ${seed}: ${bad} tiles disagree with the floor/wall layout`);
    check(out.violations <= out.fallbacks * 4, `${s.key} seed ${seed}: ${out.violations} unlearned pairs from ${out.fallbacks} fallbacks`);
    // structure follows context: every floor with a wall directly north gets a shadow-type tile, every wall facing a floor a face-type tile
    let wrongFace = 0;
    for (let y = 1; y < Hd - 1; y++) for (let x = 1; x < Wd - 1; x++) { const i = y * Wd + x, v = D.DRESS_TILES[out.tiles[i]]; if (!pass[i] && pass[i + Wd] && !pass[i - Wd] && !pass[i - 1] && !pass[i + 1] && v.cls !== 4) wrongFace++; }
    check(wrongFace === 0, `${s.key} seed ${seed}: ${wrongFace} south-facing walls without a face tile`);
    // centrepieces (tiles 1-4) only ever appear as whole 2x2 assemblies
    let broken = 0;
    const L = j => { const v = D.DRESS_TILES[out.tiles[j]]; return v.strict && /[1-4]/.test(v.letter) ? v.letter : ''; };
    for (let i = 0; i < Wd * Hd; i++) { const l = L(i); if (!l) continue; const tl = l === '1' ? i : l === '2' ? i - 1 : l === '3' ? i - Wd : i - Wd - 1; if (L(tl) !== '1' || L(tl + 1) !== '2' || L(tl + Wd) !== '3' || L(tl + Wd + 1) !== '4') broken++; }
    check(broken === 0, `${s.key} seed ${seed}: ${broken} centrepiece quarters outside a whole 2x2`);
    const again = D.dress(pass, setOf, Wd, Hd, seed);
    check(again.tiles.every((t, i) => t === out.tiles[i]), `${s.key} seed ${seed}: not deterministic`);
    fallbacks += out.fallbacks; cells += Wd * Hd;
  }
});
console.log(`  fallbacks: ${fallbacks} in ${cells} cells (${(fallbacks / cells * 100).toFixed(3)}%)`);

console.log('Dressed sectors');
const S = { ...W.WORLD_DEFAULTS, seed: 4 };
[[0, 0], [1, 2], [0, 6], [3, 1]].forEach(([x, y]) => {
  const r = W.genSector(S, x, y);
  check(r.ok && !!r.deco, `sector ${x},${y} not dressed`);
  if (!r.ok || !r.deco) return;
  let bad = 0; for (let i = 0; i < r.pass.length; i++) if (D.DRESS_TILES[r.deco[i]].walk !== r.pass[i]) bad++;
  check(bad === 0, `sector ${x},${y}: ${bad} dressing tiles disagree with walkability`);
});

console.log('Distinct kits and transitions');
{ // each stratum's structural kit is its own drawing, not a recolour: the same letter's shape differs
  const shape = (key, L) => { const s = D.DRESS_SETS.find(x => x.key === key); const m = new Map(); return s.variants[s.index[L + '0']].px.join('').split('').map(ch => { if (!m.has(ch)) m.set(ch, m.size); return m.get(ch); }).join(','); }; // the drawing's structure, whatever its colours
  ['F', 'A', 'E', 'P', 'C'].forEach(L => {
    check(shape('mazes', L) !== shape('growth', L) && shape('growth', L) !== shape('shrines', L) && shape('mazes', L) !== shape('shrines', L), `the strata draw ${L} with different shapes`);
  });
  check(shape('growth', 'A') === shape('growthHall', 'A'), 'halls keep their stratum\'s kit');
}
{ // a synthetic boundary: the corner WFC grows a front with no saddles, only near the boundary
  const Wd = 60, Hd = 40, setOf = new Uint8Array(Wd * Hd), ma = D.DRESS_SETS.findIndex(s => s.key === 'mazes'), gr = D.DRESS_SETS.findIndex(s => s.key === 'growth');
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) setOf[y * Wd + x] = x + 5 * Math.sin(y / 5) > 30 ? gr : ma;
  const pinned = [5 * Wd + 30, 20 * Wd + 31];
  const B = D.blend(setOf, Wd, Hd, 7, pinned), CW = Wd + 1, G = D.DRESS_GROUP_OF;
  check(B && B.count > 0, `the boundary is blended (${B && B.count} cells)`);
  let saddles = 0, far = 0, wrongSide = 0;
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    const c = y * CW + x, k = [B.corners[c], B.corners[c + 1], B.corners[c + CW + 1], B.corners[c + CW]].map(s => G[s]);
    if (k[0] === k[2] && k[1] === k[3] && k[0] !== k[1]) saddles++;
    const bx = 30 - 5 * Math.sin(y / 5); if (B.mixed[y * Wd + x] && Math.abs(x + 0.5 - bx) > 4) far++;
  }
  check(saddles === 0, `no saddle corners (${saddles})`);
  check(far === 0, `blending stays within reach of the boundary (${far} far)`);
  check(pinned.every(i => !B.mixed[i]), 'pinned cells keep their own area');
  const single = new Uint8Array(Wd * Hd).fill(ma); check(D.blend(single, Wd, Hd, 7, []) === null, 'one area: nothing to blend');
  // mixed cells are dressed with the plain kit only
  const pass = new Uint8Array(Wd * Hd); for (let y = 2; y < Hd - 2; y++) for (let x = 2; x < Wd - 2; x++) pass[y * Wd + x] = 1;
  const d = D.dress(pass, setOf, Wd, Hd, 3, [], B.mixed);
  let props = 0; for (let i = 0; i < Wd * Hd; i++) if (B.mixed[i]) { const v = D.DRESS_TILES[d.tiles[i]], set = D.DRESS_SETS[v.ts]; if (set.tiles[v.letter].like || v.strict) props++; }
  check(props === 0, `no props or strict pieces in blended cells (${props})`);
}
{ // real sectors: transitions appear where strata meet, and never in a saddle
  let blended = 0, saddles = 0;
  for (const [x, y] of [[0, 0], [1, 0], [-1, -1], [2, 1]]) {
    const s = W.genSector({ ...W.WORLD_DEFAULTS, seed: 4 }, x, y); if (!s.ok || !s.corners) continue;
    blended += s.dressStats.blended; const CW = 121;
    for (let i = 0; i < s.pass.length; i++) { const lx = i % 120, ly = (i / 120) | 0, c = ly * CW + lx, k = [s.corners[c], s.corners[c + 1], s.corners[c + CW + 1], s.corners[c + CW]].map(q => D.DRESS_GROUP_OF[q]); if (k[0] === k[2] && k[1] === k[3] && k[0] !== k[1]) saddles++; }
  }
  check(blended > 0, `sectors blend where areas meet (${blended} cells)`);
  check(saddles === 0, `no saddles in sectors (${saddles})`);
}

console.log(`\n${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
