// Loads wasm/gen.wasm (built from wasm/*.c by wasm/build.sh) and exposes the generator kernels with the
// same signatures as their JavaScript versions. The WebAssembly output is bit-identical to the JS
// (tests/wasm.js checks it), so either can run at any time; JS remains the fallback where wasm can't load.
//   GenWasm.load(url)        async, for pages and workers
//   GenWasm.fromBytes(bytes) sync, for Node and workers
// Once ready, DRESS_WASM.dress(pass, setOf, W, H, seed, pins) replaces dress().
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined' && typeof importScripts === 'undefined';
  const D = isNode ? require('./dressing.js') : root;
  const NCLS = 512;

  function setup(instance) {
    const X = instance.exports, mem = () => X.memory.buffer;
    const SETS = D.DRESS_SETS, KW = Math.max(...SETS.map(s => s.K));
    X.ds_init(SETS.length, KW);
    // upload each tileset's learned tables once, into the permanent region
    SETS.forEach((s, si) => {
      const n = s.n;
      const wp = X.rt_alloc(n * 8); new Float64Array(mem(), wp, n).set(s.weight);
      const ap = X.rt_alloc(4 * n * KW * 4), A = new Uint32Array(mem(), ap, 4 * n * KW);
      for (let d = 0; d < 4; d++) for (let t = 0; t < n; t++) { const m = s.allow[d][t]; for (let w = 0; w < m.length; w++) A[(d * n + t) * KW + w] = m[w]; }
      const cp = X.rt_alloc(NCLS * KW * 4), hp = X.rt_alloc(NCLS);
      const C = new Uint32Array(mem(), cp, NCLS * KW), Hs = new Uint8Array(mem(), hp, NCLS);
      s.classMask.forEach((m, c) => { Hs[c] = 1; for (let w = 0; w < m.length; w++) C[c * KW + w] = m[w]; });
      const pl = X.rt_alloc(KW * 4); new Uint32Array(mem(), pl, KW).set(Array.from({ length: KW }, (_, w) => s.plainMask[w] || 0));
      X.ds_set(si, n, D.DRESS_OFFSET[si], s.fallback.floor, s.fallback.wall, s.fallback.rock, wp, ap, cp, hp, pl);
    });
    // the transition WFC's tables: each tileset's area (group) and whether it blends
    const gp = X.rt_alloc(SETS.length), bp = X.rt_alloc(SETS.length);
    new Uint8Array(mem(), gp, SETS.length).set(D.DRESS_GROUP_OF); new Uint8Array(mem(), bp, SETS.length).set(SETS.map(s => s.size === 8 ? 1 : 0));
    X.bl_init(Math.max(...D.DRESS_GROUP_OF) + 1, gp, bp);
    function blend(setOf, W, H, seed, fixed) {
      const N = W * H, NC = (W + 1) * (H + 1), nf = (fixed || []).length;
      X.rt_reset();
      const sp = X.rt_scratch(N), fp = X.rt_scratch(nf * 4 + 4), cp = X.rt_scratch(NC), mp = X.rt_scratch(N);
      new Uint8Array(mem(), sp, N).set(setOf); if (nf) new Int32Array(mem(), fp, nf).set(fixed);
      const count = X.bl_blend(sp, W, H, seed | 0, fp, nf, cp, mp);
      if (count <= 0) return null;
      return { corners: new Uint8Array(mem(), cp, NC).slice(), mixed: new Uint8Array(mem(), mp, N).slice(), count, wasm: true };
    }
    // core.js's tables are top-level consts: global bindings in a page or worker, not properties of window
    // eslint-disable-next-line no-undef
    const C = isNode ? require('./core.js') : { NC, T, COLS, ROWS, tiles, tSock, tW, STYLES };
    function dress(pass, setOf, W, H, seed, pins, plain) {
      const N = W * H;
      pins = (pins || []).map(([i, L]) => [i, SETS[setOf[i]].index[L + '0']]).filter(p => p[1] !== undefined);
      const np = pins.length;
      X.rt_reset();
      const pp = X.rt_scratch(N), sp = X.rt_scratch(N), pinp = X.rt_scratch(np * 8 + 8), op = X.rt_scratch(N * 2), stp = X.rt_scratch(16), plp = plain ? X.rt_scratch(N) : 0;
      new Uint8Array(mem(), pp, N).set(pass); new Uint8Array(mem(), sp, N).set(setOf); if (plain) new Uint8Array(mem(), plp, N).set(plain);
      if (np) { const P = new Int32Array(mem(), pinp, np * 2); pins.forEach(([i, t], k) => { P[2 * k] = i; P[2 * k + 1] = t; }); }
      X.ds_dress(pp, sp, W, H, seed | 0, pinp, np, op, stp, plp);
      const tiles = new Uint16Array(mem(), op, N).slice(), st = new Int32Array(mem(), stp, 3);
      return { tiles, fallbacks: st[0], backtracks: st[1], violations: st[2], fallbackCells: [], wasm: true };
    }
    // layout WFC: domains, weights and the solve all run here; the result is copied back into the WFC object
    let tileTables = null;
    function tables() {
      if (tileTables) return tileTables;
      const T = C.T, tiles = C.tiles, NS = C.STYLES.length;
      const tp = X.rt_alloc(T), gap = X.rt_alloc(T), gbp = X.rt_alloc(T), skp = X.rt_alloc(T * 4), twp = X.rt_alloc(T * 4);
      const st = new Int8Array(mem(), tp, T), ga = new Int8Array(mem(), gap, T), gb = new Int8Array(mem(), gbp, T);
      tiles.forEach((t, i) => { st[i] = t.style; ga[i] = t.gate ? t.gate[0] : -1; gb[i] = t.gate ? t.gate[1] : -1; });
      new Uint8Array(mem(), skp, T * 4).set(C.tSock); new Float32Array(mem(), twp, T).set(C.tW);
      return (tileTables = { tp, gap, gbp, skp, twp, NS });
    }
    // the tile tables are permanent, so they are uploaded before the scratch mark
    function solve(wfc, maxSteps) {
      const NC = C.NC, T = C.T, n = NC * T, COLS = C.COLS, f = wfc.field, cor = wfc.cor, tb = tileTables;
      X.rt_reset();
      const cell = () => X.rt_scratch(NC), u8 = (p, src) => { const a = new Uint8Array(mem(), p, NC); if (src) a.set(src); else a.fill(0); };
      const setp = cell(), primp = cell(), secp = cell(), reqp = cell(), widep = cell(), stampp = cell(), onp = cell(), pop = cell(), exp = cell(), mzp = cell();
      const S8 = new Uint8Array(mem(), setp, NC); for (let c = 0; c < NC; c++) S8[c] = wfc.styleSet(c);
      u8(primp, f.prim); new Int8Array(mem(), secp, NC).set(f.sec); u8(reqp, cor.req); u8(widep, cor.wide); u8(stampp, cor.stamp); u8(onp, cor.onPath);
      u8(pop, cor.portalOut); u8(exp, f.excluded); u8(mzp, wfc.maze ? wfc.maze.map(v => v & 255) : null);
      const NS = tb.NS, crp = X.rt_scratch(NS * NS), solp = X.rt_scratch(NS * 8), mkp = X.rt_scratch(NS * 8);
      const CR = new Int8Array(mem(), crp, NS * NS); for (let a = 0; a < NS; a++) for (let b = 0; b < NS; b++) CR[a * NS + b] = f.cross[a][b];
      const SO = new Float64Array(mem(), solp, NS), MK = new Float64Array(mem(), mkp, NS); C.STYLES.forEach((s, i) => { SO[i] = s.w.solid; MK[i] = s.maze.k; });
      const ip = X.rt_scratch(n), wp = X.rt_scratch(n * 4), dp = X.rt_scratch(n), cp = X.rt_scratch(NC * 2), stp = X.rt_scratch(16);
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), t0 = now();
      X.wfc_prepare(COLS, C.ROWS, T, NS, setp, primp, secp, reqp, widep, stampp, onp, pop, exp, mzp, wfc.maze ? 1 : 0,
        tb.tp, tb.gap, tb.gbp, tb.skp, tb.twp, crp, solp, mkp, wfc.strength, ip, wp);
      const t1 = now();
      X.wfc_solve(COLS, C.ROWS, T, ip, wp, tb.skp, exp, (wfc.seed * 7 + 99) | 0, maxSteps, dp, cp, stp);
      wfc.kernelMs = { prepare: t1 - t0, solve: now() - t1 };
      wfc.dom.set(new Uint8Array(mem(), dp, n)); wfc.cnt.set(new Int16Array(mem(), cp, NC));
      const st = new Int32Array(mem(), stp, 4);
      wfc.resets = st[0]; wfc.restarts = st[1]; wfc.done = !!st[2]; wfc.collapsedSteps = st[3];
      wfc.ent.fill(0); wfc.dirty.fill(1); // solved cells have no entropy left
    }
    tables();
    X.rt_mark(); // everything above is permanent; each call's scratch starts here
    const api = { dress, blend, log: X.rt_log, exports: X };
    root.DRESS_WASM = api;
    root.WFC_WASM = { solve };
    return api;
  }

  const GenWasm = {
    ready: false,
    fromBytes(bytes) { const api = setup(new WebAssembly.Instance(new WebAssembly.Module(bytes), {})); GenWasm.ready = true; return api; },
    async load(url) {
      try {
        const res = await fetch(url);
        const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
        const api = setup(instance); GenWasm.ready = true; return api;
      } catch (e) { GenWasm.error = String(e); return null; } // the JS generator keeps working
    },
  };
  root.GenWasm = GenWasm;
  if (isNode) {
    module.exports = GenWasm;
    try { GenWasm.fromBytes(require('fs').readFileSync(require('path').join(__dirname, '../wasm/gen.wasm'))); } catch (e) { GenWasm.error = String(e); }
  }
})(typeof window !== 'undefined' ? window : globalThis);
