// WebAssembly parity and speed: node tests/wasm.js
// The wasm kernels must produce exactly what the JavaScript produces, so either can run anywhere.
const D = require('../gen/dressing.js');
const M = require('../gen/mazes.js');
const GW = require('../gen/wasm.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
check(GW.ready, 'wasm did not load: ' + GW.error);
if (!GW.ready) { console.log(`${checks} checks\n1 FAILED`); process.exit(1); }
const WD = globalThis.DRESS_WASM;

console.log('log() matches Math.log');
{ const r = rng(1); let bad = 0; for (let k = 0; k < 200000; k++) { const x = k < 1000 ? k + 1 : Math.exp((r() - 0.3) * 40) * r(); if (WD.log(x) !== Math.log(x)) bad++; } check(bad === 0, `${bad} of 200000 log values differ`); }

console.log('Dressing: wasm vs JS on random layouts');
const tJ = [], tW = [];
D.DRESS_SETS.forEach((s, si) => {
  for (let seed = 1; seed <= 4; seed++) {
    const Wd = 61, Hd = 81, r = rng(seed * 7 + si), cw = 30, ch = 40;
    const mz = M.generateMaze({ W: cw, H: ch, rng: r, algo: ['growing', 'prim', 'kruskal'][seed % 3], braid: 0.3 });
    const pass = new Uint8Array(Wd * Hd);
    for (let c = 0; c < cw * ch; c++) { const x = 2 * (c % cw) + 1, y = 2 * ((c / cw) | 0) + 1; pass[y * Wd + x] = 1; if (mz[c] & 2) pass[y * Wd + x + 1] = 1; if (mz[c] & 4) pass[(y + 1) * Wd + x] = 1; }
    for (let k = 0; k < 5; k++) { const x0 = 2 + (r() * 50 | 0), y0 = 2 + (r() * 70 | 0); for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 8; x++) pass[y * Wd + x] = 1; }
    // mix in a second tileset so set borders are exercised
    const setOf = new Uint8Array(Wd * Hd).fill(si); for (let i = 0; i < Wd * Hd; i++) if ((i % Wd) > 40) setOf[i] = (si + 3) % D.DRESS_SETS.length;
    const pins = D.centrepieceAt(pass, setOf, Wd, Hd, 30, 40, 8) || [];
    let t = process.hrtime.bigint(); const a = D.dress(pass, setOf, Wd, Hd, seed, pins); tJ.push(Number(process.hrtime.bigint() - t) / 1e6);
    t = process.hrtime.bigint(); const b = WD.dress(pass, setOf, Wd, Hd, seed, pins); tW.push(Number(process.hrtime.bigint() - t) / 1e6);
    let diff = 0; for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) diff++;
    check(diff === 0, `${s.key} seed ${seed}: ${diff} tiles differ`);
    check(a.fallbacks === b.fallbacks && a.backtracks === b.backtracks && a.violations === b.violations, `${s.key} seed ${seed}: stats differ (js ${a.fallbacks}/${a.backtracks}/${a.violations}, wasm ${b.fallbacks}/${b.backtracks}/${b.violations})`);
  }
});
const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
console.log(`  dress ${81 * 61} cells: JS median ${med(tJ).toFixed(1)} ms, wasm median ${med(tW).toFixed(1)} ms (${(med(tJ) / med(tW)).toFixed(1)}x)`);
console.log('Transition WFC: wasm vs JS');
{
  const D = require('../gen/dressing.js'), GW = require('../gen/wasm.js');
  const Wd = 120, Hd = 156, ma = D.DRESS_SETS.findIndex(s => s.key === 'mazes'), gr = D.DRESS_SETS.findIndex(s => s.key === 'growth'), sh = D.DRESS_SETS.findIndex(s => s.key === 'shrines'), th = D.DRESS_SETS.findIndex(s => s.key === 'threshold');
  const tj = [], tw = [];
  for (let k = 0; k < 6; k++) {
    const setOf = new Uint8Array(Wd * Hd);
    for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) { const v = Math.sin(x / (7 + k) + k) + Math.cos(y / (9 - k / 2)) + 0.3 * Math.sin((x + y) / 3); setOf[y * Wd + x] = v > 0.9 ? gr : v < -0.9 ? sh : (x > 80 && y < 20) ? th : ma; }
    const fixed = [500 + k, 3000 + k * 7];
    let t = performance.now(); const a = D.blend(setOf, Wd, Hd, 99 + k, fixed); tj.push(performance.now() - t);
    t = performance.now(); const b = DRESS_WASM.blend(setOf, Wd, Hd, 99 + k, fixed); tw.push(performance.now() - t);
    let dc = 0, dm = 0; for (let i = 0; i < a.corners.length; i++) if (a.corners[i] !== b.corners[i]) dc++; for (let i = 0; i < a.mixed.length; i++) if (a.mixed[i] !== b.mixed[i]) dm++;
    check(a.count === b.count && dc === 0 && dm === 0, `pattern ${k}: corners differ in ${dc}, mixed in ${dm} (${a.count} vs ${b.count})`);
  }
  console.log(`  blend: JS median ${med(tj).toFixed(1)} ms, wasm median ${med(tw).toFixed(1)} ms`);
}
console.log('Whole sectors: wasm vs JS (layout WFC and dressing)');
{
  const W = require('../gen/world.js');
  const tj = [], tw = [];
  for (const preset of ['underdark', 'arsenal', 'generic']) {
    for (const [x, y] of [[0, 0], [1, 2], [-2, 1], [3, 3], [0, -4]]) {
      const S = { ...W.WORLD_DEFAULTS, preset, seed: 11 };
      const a = W.genSector({ ...S, wasm: false }, x, y), b = W.genSector(S, x, y);
      tj.push(a.timing ? a.timing.total : a.ms); tw.push(b.timing ? b.timing.total : b.ms);
      check(a.ok === b.ok && a.attempts === b.attempts, `${preset} ${x},${y}: different outcome (js ${a.ok}/${a.attempts}, wasm ${b.ok}/${b.attempts})`);
      if (!a.ok || !b.ok) continue;
      let dp = 0, dd = 0; for (let i = 0; i < a.pass.length; i++) { if (a.pass[i] !== b.pass[i] || a.col[i] !== b.col[i]) dp++; if (a.deco[i] !== b.deco[i]) dd++; }
      check(dp === 0, `${preset} ${x},${y}: layout differs in ${dp} sub-cells`);
      check(dd === 0, `${preset} ${x},${y}: dressing differs in ${dd} sub-cells`);
      let dc = 0; if (!!a.corners !== !!b.corners) dc = -1; else if (a.corners) for (let i = 0; i < a.corners.length; i++) if (a.corners[i] !== b.corners[i]) dc++;
      check(dc === 0, `${preset} ${x},${y}: transition corners differ (${dc})`);
      check(b.timing.wasm, `${preset} ${x},${y}: wasm was not used`);
    }
  }
  console.log(`  sector: JS median ${med(tj).toFixed(0)} ms, wasm median ${med(tw).toFixed(0)} ms (${(med(tj) / med(tw)).toFixed(1)}x)`);
}
console.log(`\n${checks} checks`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
