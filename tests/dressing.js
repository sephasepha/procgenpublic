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
  check(s.K <= 3, `${s.key}: ${s.n} variants exceed the 96 the engine supports`);
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

console.log(`\n${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
