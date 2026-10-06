// Maze Lab: generate, measure and compare the algorithms in gen/mazes.js
(() => {
  const $ = id => document.getElementById(id);
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const ORDER = ['backtracker', 'growing', 'huntkill', 'prim', 'kruskal', 'wilson', 'aldous', 'binary', 'sidewinder'];
  const COL = { rock: '#0b0c10', floor: '#c9bb93', floorDim: '#6b6250', path: '#f3d36b', dead: '#e5534b', head: '#ffffff', finish: '#8a7136', braid: '#5db7a3' };
  const S = { algo: 'backtracker', w: 20, braid: 0, straight: 0, seed: 1, sol: true, heat: false, dead: false };

  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const H = () => Math.max(6, Math.round(S.w * 4 / 3));

  // ---------- state in the URL, so a maze can be shared or bookmarked ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('a') && MAZE_ALGOS[p.get('a')]) S.algo = p.get('a');
    const num = (k, lo, hi) => { const v = +p.get(k); return p.has(k) && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
    S.w = num('w', 6, 60) ?? S.w; S.braid = num('b', 0, 100) ?? S.braid; S.straight = num('st', 0, 100) ?? S.straight; S.seed = num('s', 1, 1e9) ?? S.seed;
  }
  function writeHash() {
    const h = `a=${S.algo}&w=${S.w}&b=${S.braid}&st=${S.straight}&s=${S.seed}`;
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* ignore */ }
  }

  // ---------- generation ----------
  let cur = null;
  function build() {
    const W = S.w, Hh = H(), trace = [];
    const t0 = performance.now();
    const mz = generateMaze({ W, H: Hh, rng: rng(S.seed), algo: S.algo, braid: S.braid / 100, straight: () => S.straight / 100, trace });
    const ms = performance.now() - t0;
    cur = { W, H: Hh, mz, trace, ms, metrics: mazeMetrics(mz, W, Hh) };
    // distance from the top-left entrance, and the solution path to the bottom-right
    const N = W * Hh, d = new Int32Array(N).fill(-1), prev = new Int32Array(N).fill(-1), q = [0]; d[0] = 0;
    for (let h = 0; h < q.length; h++) { const c = q[h]; for (let k = 0; k < 4; k++) if (mz[c] >> k & 1) { const n = c + DX[k] + DY[k] * W; if (d[n] < 0) { d[n] = d[c] + 1; prev[n] = c; q.push(n); } } }
    const path = []; for (let c = N - 1; c >= 0; c = prev[c]) { path.push(c); if (c === 0) break; }
    cur.dist = d; cur.maxD = d[q[q.length - 1]]; cur.path = path.reverse();
    anim = null;
    sizeCanvas(); draw(cur.mz); panel(); writeHash();
  }

  // ---------- drawing ----------
  const cv = $('cv'), ctx = cv.getContext('2d');
  let cp = 10;
  function sizeCanvas() {
    const w = cv.parentElement.clientWidth || 360, dpr = Math.min(3, window.devicePixelRatio || 1);
    cp = Math.max(4, Math.floor(w * dpr / cur.W));
    cv.width = cur.W * cp; cv.height = cur.H * cp;
  }
  function draw(mz, upto) {
    const { W, H: Hh } = cur, t = Math.max(1, Math.round(cp * 0.2));
    ctx.fillStyle = COL.rock; ctx.fillRect(0, 0, cv.width, cv.height);
    const floorAt = c => {
      if (S.heat && !upto && cur.dist[c] >= 0) { const f = cur.dist[c] / Math.max(1, cur.maxD); return `hsl(${45 + f * 230},70%,${66 - f * 22}%)`; }
      return COL.floor;
    };
    for (let c = 0; c < W * Hh; c++) {
      const m = mz[c]; if (!m) continue;
      const x = (c % W) * cp, y = ((c / W) | 0) * cp;
      ctx.fillStyle = floorAt(c);
      ctx.fillRect(x + t, y + t, cp - 2 * t, cp - 2 * t);
      if (m & 2) ctx.fillRect(x + cp - t, y + t, 2 * t, cp - 2 * t);
      if (m & 4) ctx.fillRect(x + t, y + cp - t, cp - 2 * t, 2 * t);
    }
    // entrance and exit
    ctx.fillStyle = COL.path;
    ctx.fillRect(t, 0, cp - 2 * t, t); ctx.fillRect((W - 1) * cp + t, Hh * cp - t, cp - 2 * t, t);
    if (upto) return;
    if (S.dead) {
      ctx.fillStyle = COL.dead;
      for (let c = 0; c < W * Hh; c++) { const m = mz[c], k = (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1); if (k === 1) { const x = (c % W) * cp, y = ((c / W) | 0) * cp; ctx.beginPath(); ctx.arc(x + cp / 2, y + cp / 2, cp * 0.18, 0, 7); ctx.fill(); } }
    }
    if (S.sol && cur.path.length > 1) {
      ctx.strokeStyle = COL.path; ctx.lineWidth = Math.max(1.5, cp * 0.22); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      cur.path.forEach((c, i) => { const x = (c % W) * cp + cp / 2, y = ((c / W) | 0) * cp + cp / 2; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }

  // ---------- carving replay ----------
  let anim = null;
  function startAnim() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    anim = { mz: new Uint8Array(cur.W * cur.H), i: 0, per: Math.max(1, Math.ceil(cur.trace.length / 150)) };
    $('animBtn').textContent = 'Replaying…';
    requestAnimationFrame(stepAnim);
  }
  function stepAnim() {
    if (!anim) return;
    const { W } = cur, tr = cur.trace;
    let last = -1;
    for (let k = 0; k < anim.per && anim.i < tr.length; k++, anim.i++) {
      const v = tr[anim.i], c = v >> 2, d = v & 3, n = c + DX[d] + DY[d] * W;
      anim.mz[c] |= 1 << d; anim.mz[n] |= 1 << ((d + 2) & 3); last = n;
    }
    draw(anim.mz, true);
    if (last >= 0) {
      const phase = anim.i > (tr.braidAt ?? 1e9) ? COL.braid : anim.i > (tr.finishAt ?? 1e9) ? COL.finish : COL.head;
      ctx.fillStyle = phase; const x = (last % W) * cp, y = ((last / W) | 0) * cp;
      ctx.fillRect(x + cp * 0.2, y + cp * 0.2, cp * 0.6, cp * 0.6);
    }
    if (anim.i < tr.length) requestAnimationFrame(stepAnim);
    else { anim = null; draw(cur.mz); $('animBtn').textContent = 'Replay'; }
  }

  // ---------- panel ----------
  const pct = v => (v * 100).toFixed(1) + '%';
  function panel() {
    const a = MAZE_ALGOS[S.algo], m = cur.metrics;
    $('algoName').textContent = a.name; $('algoBlurb').textContent = a.blurb;
    $('algoEyebrow').textContent = `${cur.W} × ${cur.H} cells`;
    $('seedOut').textContent = S.seed;
    const items = [['Dead ends', pct(m.deadEnds)], ['Junctions', pct(m.junctions)], ['Straight', pct(m.straight)], ['River', m.river.toFixed(1) + ' cells'],
      ['Tortuosity', m.tortuosity.toFixed(2) + '×'], ['Longest path', pct(m.diameter)], ['Loops', m.loops], ['Generated in', cur.ms.toFixed(1) + ' ms']];
    $('metrics').innerHTML = items.map(([k, v]) => `<div class="m"><span>${k}</span><b>${v}</b></div>`).join('');
    [...$('algos').children].forEach(b => b.classList.toggle('on', b.dataset.algo === S.algo));
    document.querySelectorAll('#cmp tr[data-algo]').forEach(r => r.classList.toggle('sel', r.dataset.algo === S.algo));
  }

  // ---------- comparison ----------
  const RUNS = 20;
  $('cmpN').textContent = RUNS;
  function compare() {
    const btn = $('cmpBtn'); btn.disabled = true;
    const W = S.w, Hh = H(), rows = [];
    let i = 0;
    const next = () => {
      if (i >= ORDER.length) { renderTable(rows); btn.disabled = false; btn.textContent = 'Run comparison again'; return; }
      const key = ORDER[i++]; btn.textContent = `Running ${MAZE_ALGOS[key].short}…`;
      setTimeout(() => {
        const agg = { ms: 0 }; let t;
        for (let s = 1; s <= RUNS; s++) {
          const t0 = performance.now();
          const mz = generateMaze({ W, H: Hh, rng: rng(s * 7919), algo: key, braid: S.braid / 100, straight: () => S.straight / 100 });
          agg.ms += performance.now() - t0;
          const m = mazeMetrics(mz, W, Hh); for (const k in m) agg[k] = (agg[k] || 0) + m[k];
        }
        for (const k in agg) agg[k] /= RUNS;
        rows.push({ key, ...agg });
        next();
      }, 16);
    };
    next();
  }
  function renderTable(rows) {
    const cols = [['ms', 'ms', v => v.toFixed(1)], ['deadEnds', 'Dead ends', pct], ['junctions', 'Junct.', pct], ['straight', 'Straight', pct], ['river', 'River', v => v.toFixed(1)], ['tortuosity', 'Tortuosity', v => v.toFixed(2)], ['diameter', 'Longest', pct], ['loops', 'Loops', v => v.toFixed(0)]];
    const max = {}; cols.forEach(([k]) => max[k] = Math.max(...rows.map(r => r[k])));
    $('cmp').innerHTML = `<thead><tr><th>Algorithm</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr data-algo="${r.key}"><td>${MAZE_ALGOS[r.key].short}</td>${cols.map(([k, , f]) => `<td class="${r[k] === max[k] && max[k] > 0 && k !== 'ms' ? 'hi' : ''}">${f(r[k])}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $('cmpWrap').hidden = false;
    $('cmp').querySelectorAll('tr[data-algo]').forEach(r => r.onclick = () => { S.algo = r.dataset.algo; build(); });
    panel();
  }

  // ---------- controls ----------
  $('algos').innerHTML = ORDER.map(k => `<button type="button" data-algo="${k}">${MAZE_ALGOS[k].short}</button>`).join('');
  $('algos').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.algo = b.dataset.algo; build(); startAnim(); });
  const bind = (id, key, fmt) => { const el = $('p' + id), out = $('v' + id); el.value = S[key]; out.textContent = fmt(S[key]); el.addEventListener('input', () => { S[key] = +el.value; out.textContent = fmt(S[key]); build(); }); };
  readHash();
  bind('W', 'w', v => `${v} × ${Math.max(6, Math.round(v * 4 / 3))}`);
  bind('Braid', 'braid', v => v + '%');
  bind('Straight', 'straight', v => v + '%');
  [['oSol', 'sol'], ['oHeat', 'heat'], ['oDead', 'dead']].forEach(([id, k]) => { const el = $(id); el.checked = S[k]; el.onchange = () => { S[k] = el.checked; if (!anim) draw(cur.mz); }; });
  $('reseed').onclick = () => { S.seed = 1 + Math.floor(Math.random() * 999999); build(); startAnim(); };
  $('animBtn').onclick = () => { if (!anim) startAnim(); };
  $('cmpBtn').onclick = compare;

  // ---------- explore: walk the current maze ----------
  // Cells become a block grid: cell (x, y) sits at block (2x+1, 2y+1); passages fill the blocks between.
  function exploreOpts() {
    const { W, H: Hh, mz } = cur, bw = 2 * W + 1, bh = 2 * Hh + 1, pass = new Uint8Array(bw * bh);
    for (let c = 0; c < W * Hh; c++) {
      const x = 2 * (c % W) + 1, y = 2 * ((c / W) | 0) + 1;
      pass[y * bw + x] = 1;
      if (mz[c] & 2) pass[y * bw + x + 1] = 1;
      if (mz[c] & 4) pass[(y + 1) * bw + x] = 1;
    }
    return {
      w: bw, h: bh, pass, step: 2, light: 9,
      start: bw + 1, goal: (bh - 2) * bw + (bw - 2),
      colorOf: () => COL.floor,
      title: `${MAZE_ALGOS[S.algo].short} · ${W}×${Hh} · seed ${S.seed}`,
      optimal: cur.path.length - 1,
      nextLabel: 'Next maze',
      onNext: () => { S.seed = 1 + Math.floor(Math.random() * 999999); build(); return exploreOpts(); },
    };
  }
  $('exploreBtn').onclick = () => { anim = null; draw(cur.mz); Explore.open(exploreOpts()); };
  window.addEventListener('resize', () => { if (cur) { sizeCanvas(); draw(cur.mz); } });
  build();
})();
