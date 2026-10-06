// Maze algorithm library.
// Every algorithm works on a W×H grid where only some cells may be used (ok) and only some neighbours
// may be joined (canLink). Optional root cells start out already part of the maze, so a maze can grow
// out of an existing corridor network. Output: Uint8Array of passage bits per cell (1=N, 2=E, 4=S, 8=W).
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const OPP = d => (d + 2) & 3;

  // opts.trace: pass an array to receive every carve as (cell * 4 + direction), in order
  function makeCtx(o) {
    const W = o.W, H = o.H, N = W * H;
    const ok = o.ok || (() => true);
    const canLink = o.canLink || (() => true);
    const straight = o.straight || (() => 0);
    const rng = o.rng;
    const mz = new Uint8Array(N);
    const nbrs = c => {
      const x = c % W, y = (c / W) | 0, out = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (ok(n) && canLink(c, n)) out.push([d, n]);
      }
      return out;
    };
    const trace = o.trace || null; // optional: records carve order for replay
    const carve = (c, d) => { mz[c] |= 1 << d; mz[c + DX[d] + DY[d] * W] |= 1 << OPP(d); if (trace) trace.push(c * 4 + d); };
    const pick = a => a[(rng() * a.length) | 0];
    // prefer continuing in the direction we arrived from, with probability straight(c)
    const choose = (c, opts, last) => {
      if (last >= 0 && rng() < straight(c)) { const s = opts.find(([d]) => d === last); if (s) return s; }
      return pick(opts);
    };
    const visited = new Uint8Array(N);
    const roots = (o.roots || []).filter(c => ok(c));
    roots.forEach(c => visited[c] = 1);
    return { W, H, N, ok, canLink, rng, mz, nbrs, carve, pick, choose, visited, roots, straight };
  }

  // Make sure every connected piece of the usable grid has at least one visited cell to grow from.
  function seedComponents(X) {
    const comp = new Int32Array(X.N).fill(-1), added = [];
    let id = 0;
    for (let s = 0; s < X.N; s++) {
      if (!X.ok(s) || comp[s] >= 0) continue;
      const cells = [s]; comp[s] = id; let has = X.visited[s];
      for (let h = 0; h < cells.length; h++) X.nbrs(cells[h]).forEach(([, n]) => { if (comp[n] < 0) { comp[n] = id; cells.push(n); if (X.visited[n]) has = 1; } });
      if (!has) { const c = X.pick(cells); X.visited[c] = 1; added.push(c); }
      id++;
    }
    return added;
  }

  // Join anything left disconnected (some algorithms cannot cope with masks), Kruskal-style.
  function finish(X) {
    const parent = new Int32Array(X.N); for (let i = 0; i < X.N; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edges = [];
    for (let c = 0; c < X.N; c++) {
      if (!X.ok(c)) continue;
      X.nbrs(c).forEach(([d, n]) => { if (d === 1 || d === 2) { if (X.mz[c] >> d & 1) parent[find(c)] = find(n); else edges.push([c, d, n]); } });
    }
    for (let i = edges.length - 1; i > 0; i--) { const j = (X.rng() * (i + 1)) | 0; [edges[i], edges[j]] = [edges[j], edges[i]]; }
    edges.forEach(([c, d, n]) => { const a = find(c), b = find(n); if (a !== b) { parent[a] = b; X.carve(c, d); } });
  }

  function growing(X, pickIndex) {
    const active = X.roots.slice().concat(seedComponents(X)).filter((c, i, a) => a.indexOf(c) === i);
    const last = new Int8Array(X.N).fill(-1);
    while (active.length) {
      const idx = pickIndex(active);
      const c = active[idx];
      const open = X.nbrs(c).filter(([, n]) => !X.visited[n]);
      if (!open.length) { active.splice(idx, 1); continue; }
      const [d, n] = X.choose(c, open, last[c]);
      X.carve(c, d); X.visited[n] = 1; last[n] = d; active.push(n);
    }
  }

  const ALGOS = {
    backtracker: {
      name: 'Recursive backtracker', short: 'Backtrack',
      blurb: 'Depth-first: long winding corridors, few branches, long dead-end rivers.',
      run: X => growing(X, a => a.length - 1),
    },
    growing: {
      name: 'Growing tree (80/20)', short: 'Growing',
      blurb: 'Mostly newest cell, sometimes random: winding like backtracking but bushier.',
      run: X => growing(X, a => (X.rng() < 0.8 ? a.length - 1 : (X.rng() * a.length) | 0)),
    },
    prim: {
      name: 'Prim (random frontier)', short: 'Prim',
      blurb: 'Grows from a random frontier cell each step: short dead ends, radiating texture.',
      run: X => {
        seedComponents(X);
        const inF = new Uint8Array(X.N), frontier = [];
        const addF = c => X.nbrs(c).forEach(([, n]) => { if (!X.visited[n] && !inF[n]) { inF[n] = 1; frontier.push(n); } });
        for (let c = 0; c < X.N; c++) if (X.visited[c]) addF(c);
        while (frontier.length) {
          const i = (X.rng() * frontier.length) | 0, c = frontier[i];
          frontier[i] = frontier[frontier.length - 1]; frontier.pop();
          const vis = X.nbrs(c).filter(([, n]) => X.visited[n]);
          if (!vis.length) continue;
          const [d] = X.pick(vis); X.carve(c, d); X.visited[c] = 1; addF(c);
        }
      },
    },
    kruskal: {
      name: 'Kruskal', short: 'Kruskal',
      blurb: 'Joins random walls between separate pieces: uniform, many short dead ends.',
      run: X => {
        const parent = new Int32Array(X.N); for (let i = 0; i < X.N; i++) parent[i] = i;
        const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        for (let i = 1; i < X.roots.length; i++) parent[find(X.roots[i])] = find(X.roots[0]);
        const edges = [];
        for (let c = 0; c < X.N; c++) if (X.ok(c)) X.nbrs(c).forEach(([d, n]) => { if (d === 1 || d === 2) edges.push([c, d, n]); });
        for (let i = edges.length - 1; i > 0; i--) { const j = (X.rng() * (i + 1)) | 0; [edges[i], edges[j]] = [edges[j], edges[i]]; }
        edges.forEach(([c, d, n]) => { const a = find(c), b = find(n); if (a !== b) { parent[a] = b; X.carve(c, d); } });
      },
    },
    wilson: {
      name: 'Wilson', short: 'Wilson',
      blurb: 'Loop-erased random walks: an unbiased sample of all possible mazes.',
      run: X => {
        seedComponents(X);
        const order = []; for (let c = 0; c < X.N; c++) if (X.ok(c) && !X.visited[c]) order.push(c);
        for (let i = order.length - 1; i > 0; i--) { const j = (X.rng() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
        const dir = new Int8Array(X.N).fill(-1);
        order.forEach(s => {
          if (X.visited[s]) return;
          let c = s, guard = 0;
          while (!X.visited[c] && guard++ < X.N * 60) { const [d, n] = X.pick(X.nbrs(c)); dir[c] = d; c = n; }
          c = s;
          while (!X.visited[c]) { const d = dir[c]; X.visited[c] = 1; X.carve(c, d); c = c + DX[d] + DY[d] * X.W; }
        });
      },
    },
    aldous: {
      name: 'Aldous-Broder', short: 'Aldous',
      blurb: 'A pure random walk that carves on first visit: unbiased, slow to finish.',
      run: X => {
        seedComponents(X);
        let left = 0; for (let c = 0; c < X.N; c++) if (X.ok(c) && !X.visited[c]) left++;
        const starts = []; for (let c = 0; c < X.N; c++) if (X.visited[c]) starts.push(c);
        let c = X.pick(starts), steps = 0;
        const cap = X.N * 400;
        while (left > 0 && steps++ < cap) {
          const opts = X.nbrs(c);
          if (!opts.length) { c = X.pick(starts); continue; }
          const [d, n] = X.pick(opts);
          if (!X.visited[n]) { X.carve(c, d); X.visited[n] = 1; left--; }
          c = n;
          if (steps % 5000 === 0) c = X.pick(starts); // hop between disconnected pieces
        }
      },
    },
    huntkill: {
      name: 'Hunt-and-kill', short: 'Hunt',
      blurb: 'Random walk until stuck, then hunts for a fresh start: long corridors, few dead ends.',
      run: X => {
        seedComponents(X);
        const last = new Int8Array(X.N).fill(-1);
        const walk = c => {
          for (;;) {
            const open = X.nbrs(c).filter(([, n]) => !X.visited[n]);
            if (!open.length) return;
            const [d, n] = X.choose(c, open, last[c]);
            X.carve(c, d); X.visited[n] = 1; last[n] = d; c = n;
          }
        };
        for (let c = 0; c < X.N; c++) if (X.visited[c]) walk(c);
        let found = true;
        while (found) {
          found = false;
          for (let c = 0; c < X.N; c++) {
            if (!X.ok(c) || X.visited[c]) continue;
            const vis = X.nbrs(c).filter(([, n]) => X.visited[n]);
            if (!vis.length) continue;
            const [d] = X.pick(vis); X.carve(c, d); X.visited[c] = 1; walk(c); found = true;
          }
        }
      },
    },
    binary: {
      name: 'Binary tree', short: 'Binary',
      blurb: 'Each cell opens north or east: fast, but with a strong diagonal bias and open edges.',
      run: X => {
        for (let c = 0; c < X.N; c++) {
          if (!X.ok(c)) continue;
          const opts = X.nbrs(c).filter(([d]) => d === 0 || d === 1);
          if (opts.length) X.carve(c, X.pick(opts)[0]);
        }
      },
    },
    sidewinder: {
      name: 'Sidewinder', short: 'Sidewinder',
      blurb: 'Row by row runs that each break north once: horizontal grain, open top row.',
      run: X => {
        for (let y = 0; y < X.H; y++) {
          let run = [];
          for (let x = 0; x < X.W; x++) {
            const c = y * X.W + x; if (!X.ok(c)) { run = []; continue; }
            run.push(c);
            const nb = X.nbrs(c), east = nb.find(([d]) => d === 1), north = nb.find(([d]) => d === 0);
            const close = !east || (north && X.rng() < 0.5);
            if (!close) { X.carve(c, 1); continue; }
            const cands = run.filter(r => X.nbrs(r).some(([d]) => d === 0));
            if (cands.length) X.carve(X.pick(cands), 0);
            run = [];
          }
        }
      },
    },
  };

  function braid(X, prob) {
    for (let c = 0; c < X.N; c++) {
      if (!X.ok(c)) continue;
      const m = X.mz[c], deg = (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1);
      if (deg !== 1 || X.rng() >= prob(c)) continue;
      const cand = X.nbrs(c).filter(([d]) => !(m >> d & 1));
      if (!cand.length) continue;
      // prefer knocking into another dead end, which removes two at once
      const de = cand.filter(([, n]) => { const k = X.mz[n]; return ((k & 1) + (k >> 1 & 1) + (k >> 2 & 1) + (k >> 3 & 1)) === 1; });
      X.carve(c, X.pick(de.length ? de : cand)[0]);
    }
  }

  // opts: { W, H, rng, algo, ok?, canLink?, roots?, straight?(c), braid?(c) or number }
  function generateMaze(opts) {
    const X = makeCtx(opts);
    const tr = opts.trace;
    (ALGOS[opts.algo] || ALGOS.growing).run(X);
    if (tr) tr.finishAt = tr.length;
    finish(X);
    if (tr) tr.braidAt = tr.length;
    const b = opts.braid;
    if (b) braid(X, typeof b === 'function' ? b : () => b);
    return X.mz;
  }

  // ---------- metrics for comparing algorithms ----------
  function mazeMetrics(mz, W, H) {
    const N = W * H, deg = new Uint8Array(N);
    let dead = 0, junc = 0, straight = 0, turns = 0, links = 0;
    for (let c = 0; c < N; c++) {
      const m = mz[c], k = (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1);
      deg[c] = k; links += k;
      if (k === 1) dead++; else if (k >= 3) junc++;
      else if (k === 2) { if (m === 5 || m === 10) straight++; else turns++; }
    }
    links /= 2;
    const bfs = s => {
      const d = new Int32Array(N).fill(-1), q = [s]; d[s] = 0;
      for (let h = 0; h < q.length; h++) { const c = q[h], x = c % W; for (let k = 0; k < 4; k++) if (mz[c] >> k & 1) { const n = c + DX[k] + DY[k] * W; if (d[n] < 0) { d[n] = d[c] + 1; q.push(n); } } }
      return { d, q };
    };
    const a = bfs(0), far = a.q[a.q.length - 1], b = bfs(far), diam = b.d[b.q[b.q.length - 1]];
    const sol = a.d[N - 1], manhattan = (W - 1) + (H - 1);
    // dead-end "rivers": average corridor length from each dead end back to a junction
    let riverSum = 0;
    for (let c = 0; c < N; c++) {
      if (deg[c] !== 1) continue;
      let prev = -1, cur = c, len = 0;
      while (deg[cur] <= 2 && len < N) {
        let nxt = -1;
        for (let k = 0; k < 4; k++) if (mz[cur] >> k & 1) { const n = cur + DX[k] + DY[k] * W; if (n !== prev) { nxt = n; break; } }
        if (nxt < 0) break;
        prev = cur; cur = nxt; len++;
      }
      riverSum += len;
    }
    return {
      deadEnds: dead / N, junctions: junc / N, straight: straight / N, turns: turns / N,
      loops: links - (N - 1),
      tortuosity: sol > 0 ? sol / manhattan : 0,
      diameter: diam / N,
      river: dead ? riverSum / dead : 0,
    };
  }

  const api = { MAZE_ALGOS: ALGOS, generateMaze, mazeMetrics };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
