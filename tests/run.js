// Generator test suite: node tests/run.js   (QUICK=1 for a short run)
// Checks the guarantees the pipeline promises, across presets, rule sets, maze algorithms and seeds.
const M = require('../gen/mazes.js');
const C = require('../gen/core.js');

const quick = !!process.env.QUICK;
let failures = 0, checks = 0;
const fail = msg => { failures++; console.log('  FAIL ' + msg); };
const check = (cond, msg) => { checks++; if (!cond) fail(msg); };
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const t0 = Date.now();

// ---------- 1. maze algorithms produce perfect mazes (spanning trees) ----------
console.log('Maze algorithms');
const ALG = Object.keys(M.MAZE_ALGOS);
for (const algo of ALG) {
  for (let s = 1; s <= (quick ? 2 : 6); s++) {
    const W = 15 + s, H = 20 + s;
    const mz = M.generateMaze({ W, H, rng: rng(s), algo });
    let links = 0; for (let c = 0; c < W * H; c++) for (let d = 0; d < 4; d++) if (mz[c] >> d & 1) links++;
    check(links / 2 === W * H - 1, `${algo} seed ${s}: ${links / 2} links, expected ${W * H - 1}`);
    // symmetric passages
    let asym = 0; for (let c = 0; c < W * H; c++) { if ((mz[c] & 2) && !(mz[c + 1] & 8)) asym++; if ((mz[c] & 4) && !(mz[c + W] & 1)) asym++; }
    check(asym === 0, `${algo} seed ${s}: ${asym} one-way passages`);
    const m = M.mazeMetrics(mz, W, H);
    check(m.tortuosity >= 1, `${algo} seed ${s}: maze not connected corner to corner`);
  }
  // masked grid with a wall down the middle and a root: one tree per side
  const W = 20, H = 20, ok = c => c % W !== 10;
  const mz = M.generateMaze({ W, H, rng: rng(9), algo, ok, roots: [3 * W + 3] });
  let links = 0, n = 0, leak = 0;
  for (let c = 0; c < W * H; c++) { if (!ok(c)) { if (mz[c]) leak++; continue; } n++; for (let d = 0; d < 4; d++) if (mz[c] >> d & 1) links++; }
  check(leak === 0, `${algo}: carved into masked cells`);
  check(links / 2 === n - 2, `${algo}: masked grid gave ${links / 2} links, expected ${n - 2}`);
}
// braid adds loops
{
  const W = 20, H = 26, mz = M.generateMaze({ W, H, rng: rng(3), algo: 'backtracker', braid: 1 });
  check(M.mazeMetrics(mz, W, H).loops > 0, 'braid 100% added no loops');
}

// ---------- 2. full pipeline guarantees ----------
console.log('Dungeon pipeline');
const ruleSets = [
  { em: true, mh: true, eh: false, capEM: 2, capMH: 2, esc: 3, ruin: 0 },
  { em: true, mh: true, eh: false, capEM: 1, capMH: 1, esc: 5, ruin: 0 },
  { em: true, mh: true, eh: true, capEM: 3, capMH: 3, esc: 1, ruin: 0 },
  { em: true, mh: true, eh: false, capEM: 2, capMH: 2, esc: 3, ruin: 20 },
];
const sizes = quick ? [10, 18] : [8, 14, 24];
const algos = quick ? ['growing', 'kruskal'] : ['growing', 'backtracker', 'prim', 'wilson', 'binary'];
const seeds = quick ? 2 : 4;
let runs = 0, breaches = 0;
for (const preset of ['generic', 'arsenal']) {
  C.setPreset(preset);
  for (const rules of ruleSets) {
    if (preset === 'generic' && rules.ruin) continue;
    for (const n of sizes) for (const algo of algos) for (let seed = 1; seed <= seeds; seed++) {
      const tag = `${preset} n=${n} ${algo} seed=${seed} rules=${JSON.stringify(rules)}`;
      const reg = C.genRegions(seed, n), cand = C.genCandidates(reg, seed);
      const g = C.genGrammar(reg, cand, seed, rules, 25), f = C.genField(reg, seed, 2.5, rules);
      const cor = C.genCorridors(reg, g, f, seed), maze = C.genMaze(f, cor, seed, algo);
      const w = new C.WFC(f, cor, seed, reg, maze, 0.6);
      let guard = 0; while (w.step() && guard++ < 50000) {}
      let unsolved = 0; for (let c = 0; c < C.NC; c++) if (w.cnt[c] !== 1) unsolved++;
      check(unsolved === 0, `${tag}: ${unsolved} unsolved cells`);
      // graph obeys the rules
      g.edges.forEach(e => check(C.PRESETS && (g.tier[e.a] === g.tier[e.b] || rulesAllow(rules, g.tier[e.a], g.tier[e.b])), `${tag}: graph edge breaks tier rules`));
      check(cor.unrouted === 0, `${tag}: ${cor.unrouted} corridors could not be routed`);
      // map obeys the rules
      const sub = C.buildSub(w), v = C.validate(sub, reg), gv = C.validateGrammar(sub.floor, sub.tileOf, v, reg, f, rules, cor);
      check(v.hubs === reg.pts.length, `${tag}: only ${v.hubs}/${reg.pts.length} hubs reachable`);
      check(gv.illegal === 0, `${tag}: ${gv.illegal} illegal built links`);
      check(gv.capViol === 0, `${tag}: ${gv.capViol} branch-cap breaches`);
      if (!rules.eh) check(gv.skip === 0, `${tag}: inner tier reachable without the middle tier`);
      // socket consistency
      let mm = 0;
      for (let y = 0; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
        const a = C.tiles[w.tileAt(y * C.COLS + x)];
        if (x < C.COLS - 1 && a.sock[1] !== C.tiles[w.tileAt(y * C.COLS + x + 1)].sock[3]) mm++;
        if (y < C.ROWS - 1 && a.sock[2] !== C.tiles[w.tileAt((y + 1) * C.COLS + x)].sock[0]) mm++;
      }
      check(mm === 0, `${tag}: ${mm} socket mismatches`);
      breaches += gv.breaches || 0; runs++;
    }
  }
}
function rulesAllow(r, a, b) { const lo = Math.min(a, b), hi = Math.max(a, b); return lo === 0 && hi === 1 ? r.em : lo === 1 && hi === 2 ? r.mh : r.eh; }

// ---------- 3. determinism: same inputs, same map ----------
console.log('Determinism');
C.setPreset('generic');
const sig = () => {
  const r = { em: true, mh: true, eh: false, capEM: 2, capMH: 2, esc: 3 };
  const reg = C.genRegions(7, 14), cand = C.genCandidates(reg, 7), g = C.genGrammar(reg, cand, 7, r, 25), f = C.genField(reg, 7, 2.5, r), cor = C.genCorridors(reg, g, f, 7);
  const w = new C.WFC(f, cor, 7, reg, C.genMaze(f, cor, 7, 'wilson'), 0.6); while (w.step()) {}
  let h = 0; for (let c = 0; c < C.NC; c++) h = (h * 31 + w.tileAt(c)) | 0; return h;
};
check(sig() === sig(), 'same seed produced different maps');

console.log(`\n${checks} checks, ${runs} full generations, ${breaches} intended breach shortcuts, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
