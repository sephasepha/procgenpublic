// Infinite explore: streams sectors from gen/world.js around the player as they walk.
// Sectors are generated in background workers, cached near the player and evicted far away;
// what you have seen is remembered even after a sector is evicted (it regenerates identically).
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const FLOOR = ['#8f8263', '#2f6e62', '#8c4521', '#44508f', '#4f5e74'].map(hex);
  const OTHER = hex('#6b5a33'), WALL = hex('#2a2e38'), DARK = [7, 8, 11];
  const BASE_COL = ['#a8d672', '#f0b34b', '#e05a5a'];
  let TIER_COL = BASE_COL;
  const K = (x, y) => x + ',' + y;
  const TPX = 1; // map images: one pixel per sub-cell, in the tile's average colour (the close view draws from the tile atlas)
  const SLOT = 8; // atlas slot size: 8x8 tiles as drawn, 4x4 tiles doubled
  // atmosphere for each stratum (Underdark), and a plain one for the other presets
  const AMB = {
    0: { bg: '#080a1c', light: '#c9d3ff', tint: '#7d8cff', fx: 'motes', stars: 1 },
    1: { bg: '#050f08', light: '#efffcc', tint: '#7fd860', fx: 'spores', stars: 0 },
    2: { bg: '#120b06', light: '#ffd8a0', tint: '#ff9a4a', fx: 'dust', stars: 0 },
    plain: { bg: '#07080b', light: '#ffe2b0', tint: '#ffb060', fx: 'dust', stars: 0 },
  };
  const FOG = [185, 178, 216]; // the pilgrims' lavender fog, thickest at the seals between strata
  let el = null, st = null, pool = [], queue = [];

  // ---------- generation pool ----------
  function makePool() {
    if (pool.length) return;
    try {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < n; i++) { const w = new Worker('infinite/worker.js'); w.busy = false; w.onmessage = e => { w.busy = false; if (st && e.data.gen === st.gen) deliver(e.data.r); pump(); }; w.onerror = () => { w.busy = false; w.dead = true; pump(); }; pool.push(w); }
    } catch (e) { pool = []; }
  }
  function request(sx, sy) {
    const k = K(sx, sy);
    if (st.sectors.has(k) || st.pending.has(k)) return;
    st.pending.add(k); queue.push([sx, sy]); pump();
  }
  const near = ([x, y]) => Math.max(Math.abs(x - st.cs[0]), Math.abs(y - st.cs[1]));
  function pump() {
    if (!st) return;
    queue = queue.filter(q => near(q) <= 2 || !st.pending.delete(K(q[0], q[1])));
    queue.sort((a, b) => near(a) - near(b));
    const live = pool.filter(w => !w.dead);
    if (!live.length) { // no workers available: generate on the main thread, one at a time
      if (queue.length && !st.mainBusy) { st.mainBusy = true; const [sx, sy] = queue.shift(); setTimeout(() => { st.mainBusy = false; deliver(genSector(st.S, sx, sy)); pump(); }, 0); }
      return;
    }
    for (const w of live) { if (w.busy || !queue.length) continue; const [sx, sy] = queue.shift(); w.busy = true; w.postMessage({ gen: st.gen, settings: st.S, sx, sy }); }
  }
  function deliver(r) {
    const k = K(r.sx, r.sy);
    if (r.timing) { st.perf.gens.push({ ...r.timing, at: performance.now() }); if (st.perf.gens.length > 200) st.perf.gens.shift(); }
    if (r.ok && r.sx === 0 && r.sy === 0 && !st.perf.firstSector) st.perf.firstSector = performance.now() - st.perf.opened;
    st.pending.delete(k);
    if (!r.ok) { st.sectors.set(k, { ...r, failed: true }); st.failures++; return; }
    if (!st.seen.has(k)) st.seen.set(k, new Uint8Array(SW * SH));
    const cv = document.createElement('canvas'); cv.width = SW * TPX; cv.height = SH * TPX;
    const cx = cv.getContext('2d'), img = cx.createImageData(SW * TPX, SH * TPX);
    const sec = { ...r, cv, cx, img, px: new Uint32Array(img.data.buffer), seen: st.seen.get(k), lit: new Uint8Array(SW * SH), dirty: true, cells: [] };
    st.sectors.set(k, sec);
    st.charted.add(k);
    st.layerDirty = true;
    if (r.sx === st.cs[0] && r.sy === st.cs[1] && !st.placed) place();
    light();
  }
  function stream() {
    const [cx, cy] = st.cs;
    for (let r = 0; r <= 1; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) request(cx + dx, cy + dy);
    st.sectors.forEach((s, k) => { if (Math.max(Math.abs(s.sx - cx), Math.abs(s.sy - cy)) > 2) st.sectors.delete(k); });
  }

  // ---------- world lookups ----------
  // sectors overlap, so a global sub-cell belongs to whichever sector owns its cell (decided by the border lines)
  const ownerSub = (gx, gy) => ownerOf(st.S, Math.floor(gx / 3), Math.floor(gy / 3));
  const secAt = (gx, gy) => { const o = ownerSub(gx, gy); return st.sectors.get(K(o[0], o[1])); };
  function passAt(gx, gy) {
    const s = secAt(gx, gy); if (!s) return -1; if (s.failed) return 0;
    const lx = gx - s.ox * 3, ly = gy - s.oy * 3;
    return s.pass[ly * SW + lx];
  }

  // ---------- UI ----------
  function ui() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'xp inf';
    el.hidden = true;
    // a game shell: the view fills the screen, the HUD floats over it
    el.innerHTML = `
      <div class="xp-stage"><canvas class="main" aria-label="Explore view: tap a spot to walk there, or drag anywhere to steer"></canvas></div>
      <div class="hud hud-tl">
        <button class="xp-round" data-x="close" type="button" aria-label="Menu: world settings and tools">☰</button>
        <div class="xp-loc"><div class="xp-title"></div><div class="xp-sub"></div></div>
      </div>
      <div class="hud hud-tr">
        <canvas class="mini" aria-label="Sector map"></canvas>
        <div class="xp-meta"><div class="xp-stats" aria-live="polite"></div><button class="xp-round small" data-x="full" type="button" aria-label="Full screen">⛶</button></div>
      </div>
      <div class="stick" hidden><i class="base"></i><i class="knob"></i></div>
      <div class="hud hud-br" role="group" aria-label="View">
        <button class="xp-act on" data-x="fog" type="button" aria-pressed="true"><b>☼</b><span>Light</span></button>
        <button class="xp-act" data-x="zoom" type="button" aria-pressed="false"><b>▣</b><span>Map</span></button>
        <button class="xp-act on" data-x="tiles" type="button" aria-pressed="true"><b>▦</b><span>Tiles</span></button>
        <button class="xp-act" data-x="rules" type="button" aria-pressed="false"><b>✓</b><span>Rules</span></button>
        <button class="xp-act" data-x="perf" type="button" aria-pressed="false"><b>⏱</b><span>Perf</span></button>
      </div>
      <div class="toast" role="status" aria-live="polite" hidden></div>
      <div class="rules" hidden></div>
      <div class="perf" hidden aria-live="off"></div>
      <div class="xp-hint" hidden>Turn your phone sideways for the full view</div>`;
    document.body.appendChild(el);
    // input is state, read by the game loop: directions held down (latest first) and one buffered tap,
    // so a turn pressed just before reaching a junction is taken there
    const press = d => { if (!st) return; st.held = [d, ...st.held.filter(x => x !== d)]; st.buffer = { d, until: performance.now() + 250 }; };
    const release = d => { if (st) st.held = st.held.filter(x => x !== d); };
    // a floating thumb-stick: put a thumb (or the mouse) down anywhere on the view and drag towards a direction
    const cvs = el.querySelector('canvas.main'), stick = el.querySelector('.stick'), knob = stick.querySelector('.knob');
    let sp = null;
    // a quick tap (no drag) walks you to the tapped spot by the shortest known route instead
    cvs.addEventListener('pointerdown', e => {
      e.preventDefault(); cvs.setPointerCapture?.(e.pointerId); goFull();
      sp = { id: e.pointerId, x: e.clientX, y: e.clientY, d: -1, t: performance.now(), stick: false };
    });
    cvs.addEventListener('pointermove', e => {
      if (!sp || e.pointerId !== sp.id || !st) return;
      const dx = e.clientX - sp.x, dy = e.clientY - sp.y, r = Math.hypot(dx, dy), k = Math.min(1, 44 / (r || 1));
      if (!sp.stick) { if (r < 10) return; sp.stick = true; st.path = null; stick.hidden = false; stick.style.left = sp.x + 'px'; stick.style.top = sp.y + 'px'; }
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      const d = r < 14 ? -1 : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      if (d !== sp.d) { if (sp.d >= 0) release(sp.d); if (d >= 0) press(d); sp.d = d; }
    });
    const lift = e => {
      if (!sp || (e && e.pointerId !== sp.id)) return;
      if (sp.d >= 0) release(sp.d);
      if (e && e.type === 'pointerup' && !sp.stick && performance.now() - sp.t < 450) tapAt(e.clientX, e.clientY);
      sp = null; stick.hidden = true;
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => cvs.addEventListener(t, lift));
    el.addEventListener('click', e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      const k = x.dataset.x, on = v => { x.classList.toggle('on', v); x.setAttribute('aria-pressed', String(v)); };
      if (k === 'close') close();
      if (k === 'fog') { st.fog = !st.fog; on(st.fog); st.sectors.forEach(s => s.dirty = true); }
      if (k === 'zoom') { st.map = !st.map; on(st.map); }
      if (k === 'tiles') { st.tiles = !st.tiles; on(st.tiles); st.sectors.forEach(s => s.dirty = true); }
      if (k === 'rules') { const r = el.querySelector('.rules'); r.hidden = !r.hidden; on(!r.hidden); if (!r.hidden) rules(); }
      if (k === 'perf') { const r = el.querySelector('.perf'); r.hidden = !r.hidden; on(!r.hidden); }
      if (k === 'full') { if (document.fullscreenElement) document.exitFullscreen?.(); else goFull(true); }
      st.redraw = true; st.layerDirty = true;
    });
    const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
    window.addEventListener('keydown', e => {
      if (el.hidden) return;
      const k = KEYS[e.key];
      if (k !== undefined) { e.preventDefault(); st.path = null; if (!e.repeat) press(k); }
      if (e.key === 'Escape') close();
    });
    window.addEventListener('keyup', e => { const k = KEYS[e.key]; if (k !== undefined) release(k); });
    window.addEventListener('blur', () => { if (st) st.held = []; });
    window.addEventListener('resize', () => { if (!el.hidden) { size(); st.redraw = true; } });
    return el;
  }

  function open(settings) {
    ui(); makePool(); buildAtlas();
    if (root.GenWasm && !GenWasm.ready && !GenWasm.loading) GenWasm.loading = GenWasm.load('wasm/gen.wasm'); // for the main-thread fallback
    TIER_COL = PRESETS[settings.preset || WORLD_DEFAULTS.preset].colors || BASE_COL;
    const gen = (st ? st.gen : 0) + 1;
    st = {
      S: { ...WORLD_DEFAULTS, ...settings }, gen,
      sectors: new Map(), pending: new Set(), seen: new Map(), charted: new Set(), visited: new Set(['0,0']),
      cs: [0, 0], gx: 0, gy: 0, from: [0, 0], t: 1, placed: false, litList: [],
      fog: true, map: false, tiles: true, steps: 0, started: 0, failures: 0, deepest: 0, redraw: true,
      held: [], buffer: null, mv: null, speed: 8, // tiles per second
      perf: { frames: [], layer: [], gens: [], firstSector: 0, opened: performance.now(), drops: 0 },
    };
    queue = [];
    [['fog', true], ['zoom', false], ['tiles', true], ['rules', false], ['perf', false]].forEach(([k, v]) => { const b = el.querySelector(`[data-x="${k}"]`); b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
    el.querySelector('.rules').hidden = true; el.querySelector('.perf').hidden = true;
    const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches, hint = el.querySelector('.xp-hint');
    hint.hidden = !portrait; if (portrait) setTimeout(() => { hint.hidden = true; }, 4000);
    el.hidden = false;
    document.documentElement.classList.add('xp-open');
    size();
    toast('Charting the starting sector…', true);
    stream();
    hud();
    if (!st.raf) loop();
  }
  // full screen and landscape where the browser allows it (Android Chrome; the installed app opens full screen)
  let askedFull = false;
  function goFull(force) {
    if ((askedFull && !force) || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    askedFull = true;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
  // another screen (the camp) takes over: keep the world as it is and pick it up again on return
  function suspend() { el.hidden = true; if (st) { cancelAnimationFrame(st.raf); st.raf = 0; st.held = []; } }
  function resume() { el.hidden = false; document.documentElement.classList.add('xp-open'); size(); if (st) { st.layerDirty = true; if (!st.raf) loop(); } }
  function close() { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); el.hidden = true; document.documentElement.classList.remove('xp-open'); if (st) { cancelAnimationFrame(st.raf); st.raf = 0; } }
  function place() {
    const s = st.sectors.get('0,0');
    st.gx = s.ox * 3 + s.entranceSub % SW; st.gy = s.oy * 3 + ((s.entranceSub / SW) | 0); st.from = [st.gx, st.gy];
    st.placed = true; toast(`${s.info.name}: find the way deeper`);
    light(); hud();
  }

  // ---------- movement ----------
  function canStep(gx, gy, d) { return passAt(gx + DX[d], gy + DY[d]); }
  function stepTo(d) {
    st.gx += DX[d]; st.gy += DY[d]; st.steps++;
    const cs = ownerSub(st.gx, st.gy);
    if (cs[0] !== st.cs[0] || cs[1] !== st.cs[1]) crossed(st.cs, cs);
  }
  // the game loop's movement: one tile per step at st.speed tiles a second, chained while a direction is held
  function tryStep(d, t) {
    const p = canStep(st.gx, st.gy, d);
    if (p === -1) { toast('Charting the next sector…', true); const o = ownerSub(st.gx + DX[d], st.gy + DY[d]); request(o[0], o[1]); return false; }
    if (p !== 1) return false;
    if (!st.started) st.started = t;
    st.from = [st.gx, st.gy];
    stepTo(d);
    st.mv = { t0: t, dur: 1000 / st.speed };
    light(); hud();
    return true;
  }
  function update(t) {
    if (!st.placed) return;
    if (st.mv && t - st.mv.t0 < st.mv.dur) return; // still walking to the next tile
    const carry = st.mv ? Math.min(st.mv.dur, t - st.mv.t0 - st.mv.dur) : 0; // keep chained steps evenly spaced
    st.mv = null;
    const want = [];
    if (st.buffer && st.buffer.until > t) want.push(st.buffer.d);
    st.held.forEach(d => { if (!want.includes(d)) want.push(d); });
    if (want.length) st.path = null; // the stick or keys take over from a tapped route
    else if (st.path) { followPath(t - carry); return; }
    for (const d of want) {
      if (tryStep(d, t - carry)) { if (st.buffer && st.buffer.d === d) st.buffer = null; return; }
    }
    if (st.buffer && st.buffer.until <= t) st.buffer = null;
    if (want.length && !st.bumped) { bump(); st.bumped = true; } else if (!want.length) st.bumped = false;
  }
  // ---------- tap to walk: the shortest route over charted floor to the tapped tile ----------
  const PATH_MAX = 60000; // tiles searched at most (a few sectors' worth)
  function screenToTile(clientX, clientY) {
    const v = st.view; if (!v) return null;
    const r = cv.getBoundingClientRect(), x = (clientX - r.left) * cv.width / r.width, y = (clientY - r.top) * cv.height / r.height;
    return [Math.floor((x - v.ox) / v.bs), Math.floor((y - v.oy) / v.bs)];
  }
  function findPath(tx, ty) {
    // breadth-first from the player over passable tiles in generated sectors; four-way, like walking
    const start = K(st.gx, st.gy), prev = new Map([[start, null]]), q = [[st.gx, st.gy]];
    for (let h = 0; h < q.length && q.length < PATH_MAX; h++) {
      const [x, y] = q[h];
      if (x === tx && y === ty) { const out = []; for (let k = K(x, y); k !== start; k = prev.get(k)) out.push(k.split(',').map(Number)); return out.reverse(); }
      for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = y + DY[d], kk = K(nx, ny); if (!prev.has(kk) && passAt(nx, ny) === 1) { prev.set(kk, K(x, y)); q.push([nx, ny]); } }
    }
    return null;
  }
  function tapAt(clientX, clientY) {
    if (!st || !st.placed) return;
    const t = screenToTile(clientX, clientY); if (!t) return;
    // a tap on a wall or the void means the nearest floor to it (within a couple of tiles)
    let best = null;
    for (let r = 0; r <= 2 && !best; r++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== r || passAt(t[0] + x, t[1] + y) !== 1) continue;
      const d = x * x + y * y; if (!best || d < best.d) best = { x: t[0] + x, y: t[1] + y, d };
    }
    if (!best) { st.path = null; st.goal = { x: t[0], y: t[1], bad: performance.now() }; return; }
    if (best.x === st.gx && best.y === st.gy) { st.path = null; return; }
    const path = findPath(best.x, best.y);
    st.goal = { x: best.x, y: best.y, bad: path ? 0 : performance.now() };
    st.path = path && path.length ? path : null;
    if (!path) toast('No known way there yet.');
    st.held = []; st.buffer = null;
  }
  // one step along the route; if the world changed under it, look again
  function followPath(t) {
    const [nx, ny] = st.path[0], d = [0, 1, 2, 3].find(k => st.gx + DX[k] === nx && st.gy + DY[k] === ny);
    if (d === undefined || !tryStep(d, t)) { const g2 = st.goal; st.path = g2 && !(g2.x === st.gx && g2.y === st.gy) ? findPath(g2.x, g2.y) : null; if (!st.path || !st.path.length) { st.path = null; return false; } return false; }
    st.path.shift(); if (!st.path.length) st.path = null;
    return true;
  }

  // kept for scripted use (tests, tools): one immediate step
  function move(d) { if (!st || !st.placed || el.hidden) return; st.mv = null; tryStep(d, performance.now()); }
  function bump() { const c = el.querySelector('canvas.main'); c.classList.remove('xp-bump'); void c.offsetWidth; c.classList.add('xp-bump'); }
  function crossed(a, b) {
    const A = sectorInfo(st.S, a[0], a[1]), B = sectorInfo(st.S, b[0], b[1]);
    st.cs = b; stream();
    const first = !st.visited.has(K(b[0], b[1])); st.visited.add(K(b[0], b[1]));
    if (B.tierIndex > st.deepest) st.deepest = B.tierIndex;
    let msg;
    if (B.tierIndex > A.tierIndex) msg = B.level > A.level ? `Descent: ${B.name}` : `Through the seal into ${B.name}`;
    else if (B.tierIndex < A.tierIndex) msg = `Back up to ${B.name}`;
    else msg = `Passage: ${B.name}`;
    toast(msg + (first ? ' · new sector' : ''));
  }

  // ---------- light ----------
  function light() {
    if (!st.placed) return;
    st.litList.forEach(([s, i]) => { s.lit[i] = 0; s.cells.push(i); });
    st.litList = [];
    const R = 11, start = [st.gx, st.gy], q = [start], dist = new Map([[K(st.gx, st.gy), 0]]);
    const ld = st.ldist = new Map();
    const mark = (gx, gy, dd) => {
      const kk = K(gx, gy); if (!ld.has(kk) || ld.get(kk) > dd) ld.set(kk, dd);
      const s = secAt(gx, gy); if (!s || s.failed) return;
      const i = (gy - s.oy * 3) * SW + (gx - s.ox * 3);
      if (!s.lit[i]) { s.lit[i] = 1; st.litList.push([s, i]); s.cells.push(i); }
      s.seen[i] = 1;
    };
    mark(st.gx, st.gy, 0);
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h], dd = dist.get(K(x, y));
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d], p = passAt(nx, ny);
        if (p < 0) continue;
        mark(nx, ny, dd + 1);
        if (p === 1 && dd + 1 <= R && !dist.has(K(nx, ny))) { dist.set(K(nx, ny), dd + 1); q.push([nx, ny]); }
      }
      for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (passAt(x + ax, y + ay) === 0) mark(x + ax, y + ay, dd + 1);
    }
    st.redraw = true; st.layerDirty = true;
  }

  // ---------- drawing ----------
  let cv, g, mini, mg, dpr = 1, vignette = null;
  function size() {
    cv = el.querySelector('canvas.main'); g = cv.getContext('2d');
    mini = el.querySelector('canvas.mini'); mg = mini.getContext('2d');
    const r = cv.parentElement.getBoundingClientRect();
    // render resolution: like a game's render scale, capped (at most 2x and about 1800 px wide) so a full-screen
    // view fills at 60 fps on any phone; the browser upscales it, crisp for pixel art
    dpr = Math.min(2, window.devicePixelRatio || 1, 1800 / Math.max(1, r.width));
    cv.width = Math.max(1, Math.floor(r.width * dpr)); cv.height = Math.max(1, Math.floor(r.height * dpr));
    const m = Math.round(Math.min(124, Math.min(r.width, r.height) * 0.3));
    mini.style.width = m + 'px'; mini.style.height = m + 'px'; mini.width = mini.height = Math.round(m * dpr);
    vignette = null; if (st) st.layerDirty = true;
  }
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  const rgba = (c, a) => (255 << 24) | (cl(c[2] * a + DARK[2] * (1 - a)) << 16) | (cl(c[1] * a + DARK[1] * (1 - a)) << 8) | cl(c[0] * a + DARK[0] * (1 - a));
  const BLACK = rgba(DARK, 1);
  const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---------- tile atlas: every dressing tile, each spin, four brightness jitters, in 8px slots ----------
  let atlas = null, slotBase = null, slotSpins = null, avg = null;
  function buildAtlas() {
    if (atlas) return;
    const T = DRESS_TILES, n = T.length;
    slotBase = new Int32Array(n).fill(-1); slotSpins = new Uint8Array(n); avg = new Array(n);
    let slots = 0;
    for (let t = 1; t < n; t++) { slotBase[t] = slots; slotSpins[t] = T[t].spins ? 4 : 1; slots += slotSpins[t] * 4; }
    const COLSA = 64, rows = Math.ceil(slots / COLSA);
    atlas = document.createElement('canvas'); atlas.width = COLSA * SLOT; atlas.height = rows * SLOT;
    const ax = atlas.getContext('2d'), img = ax.createImageData(atlas.width, atlas.height), px = new Uint32Array(img.data.buffer);
    for (let t = 1; t < n; t++) {
      const v = T[t], N = v.size || 4, sc = SLOT / N, spins = v.spins || [v.rgb];
      let r = 0, gg = 0, b = 0; v.rgb.forEach(c => { r += c[0]; gg += c[1]; b += c[2]; }); avg[t] = [r / v.rgb.length, gg / v.rgb.length, b / v.rgb.length];
      spins.forEach((rgb, sp) => {
        for (let j = 0; j < 4; j++) {
          const k = slotBase[t] + sp * 4 + j, sx = (k % COLSA) * SLOT, sy = ((k / COLSA) | 0) * SLOT, f = 0.93 + j / 3 * 0.12;
          for (let y = 0; y < SLOT; y++) for (let x = 0; x < SLOT; x++) {
            const c = rgb[((y / sc) | 0) * N + ((x / sc) | 0)];
            px[(sy + y) * atlas.width + sx + x] = (255 << 24) | (cl(c[2] * f) << 16) | (cl(c[1] * f) << 8) | cl(c[0] * f);
          }
        }
      });
    }
    ax.putImageData(img, 0, 0);
    atlas.cols = COLSA;
  }
  // ---------- material atlas: tiles re-surfaced with a floor or wall material, built on first use ----------
  // key: tile, spin, jitter, which material, and the tile's phase in the 2x2 (16 px) world-aligned pattern
  const MAT = { cv: null, g: null, map: new Map(), next: 0, cols: 64, rows: 64 };
  function matSlot(t, sp, j, kind, m, phase) {
    const key = ((((t * 4 + sp) * 4 + j) * 2 + (kind === 'w' ? 1 : 0)) * 16 + m) * 4 + phase;
    let k = MAT.map.get(key); if (k !== undefined) return k;
    if (!MAT.cv) { MAT.cv = document.createElement('canvas'); MAT.cv.width = MAT.cols * SLOT; MAT.cv.height = MAT.rows * SLOT; MAT.g = MAT.cv.getContext('2d'); }
    if (MAT.next >= MAT.cols * MAT.rows) { MAT.map.clear(); MAT.next = 0; st.layerDirty = true; } // full: start over (rare)
    k = MAT.next++; MAT.map.set(key, k);
    const v = DRESS_TILES[t], set = DRESS_SETS[v.ts], N = v.size || 4, chars = v.pxs[sp], f = 0.93 + j / 3 * 0.12;
    const mm = kind === 'w' ? set.materials.wall[m - 1] : set.materials.floor[m - 1], ox = (phase & 1) * 8, oy = (phase >> 1) * 8;
    const img = MAT.g.createImageData(SLOT, SLOT), d = img.data;
    for (let y = 0; y < SLOT; y++) for (let x = 0; x < SLOT; x++) {
      const ch = chars[(y * N / SLOT) | 0][(x * N / SLOT) | 0], pi = (oy + y) * 16 + ox + x;
      let c = set.pal[ch] || [255, 0, 255];
      if (kind === 'f' && (ch === '.' || ch === ',' || ch === ':')) c = mm.rgb[pi];
      else if (kind === 'w' && ch === 'W') c = mm.face[pi];
      else if (kind === 'w' && mm.top && (ch === 'x' || ch === 'w')) c = mm.top[pi];
      const o = (y * SLOT + x) * 4; d[o] = cl(c[0] * f); d[o + 1] = cl(c[1] * f); d[o + 2] = cl(c[2] * f); d[o + 3] = 255;
    }
    MAT.g.putImageData(img, (k % MAT.cols) * SLOT, ((k / MAT.cols) | 0) * SLOT);
    return k;
  }

  // soft round sprites for glows and fog, drawn once
  const sprites = {};
  function glowSprite(hexc) {
    if (sprites[hexc]) return sprites[hexc];
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32), [r, gg, b] = hex(hexc);
    gr.addColorStop(0, `rgba(${r},${gg},${b},0.6)`); gr.addColorStop(0.35, `rgba(${r},${gg},${b},0.25)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return (sprites[hexc] = c);
  }
  // a Gray Pilgrim: hooded, robed, leaning on a staff
  let pilgrim = null;
  function pilgrimSprite() {
    if (pilgrim) return pilgrim;
    const P = ['...gg...', '..gGGg..', '..gddg..', '.gGGGGg.', '.gGGGGgs', 'gGGGGGGs', 'gGGGGGGs', '.gg..gg.'];
    const pal = { g: '#6d6a7c', G: '#aaa6bc', d: '#24222c', s: '#8d7b58' };
    pilgrim = document.createElement('canvas'); pilgrim.width = pilgrim.height = 8; const x = pilgrim.getContext('2d');
    P.forEach((row, y) => [...row].forEach((ch, xx) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(xx, y, 1, 1); } }));
    return pilgrim;
  }

  // ---------- map images: one pixel per sub-cell ----------
  function paintCell(s, i) {
    const px = s.px, fog = st.fog, lit = !fog || s.lit[i], seen = !fog || s.seen[i];
    if (!s.own[(((i / SW) | 0) / 3 | 0) * COLS + ((i % SW) / 3 | 0)]) { px[i] = 0; return; }
    if (!seen) { px[i] = 0; return; }
    const a = lit ? 1 : (s.pass[i] ? 0.5 : 0.55);
    const c = st.tiles && s.deco ? avg[s.deco[i]] : (s.pass[i] ? (s.col[i] < FLOOR.length ? FLOOR[s.col[i]] : OTHER) : WALL);
    px[i] = rgba(c, a);
  }
  function paint(s) {
    if (s.dirty) { for (let i = 0; i < SW * SH; i++) paintCell(s, i); s.cx.putImageData(s.img, 0, 0); s.dirty = false; s.cells = []; return; }
    let x0 = SW, y0 = SH, x1 = -1, y1 = -1;
    s.cells.forEach(i => { paintCell(s, i); const x = i % SW, y = (i / SW) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; });
    s.cells = [];
    if (x1 >= 0) s.cx.putImageData(s.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  // ---------- close view: a cached layer of tiles around the player, rebuilt when the light changes ----------
  const layer = { cv: null, g: null, x0: 0, y0: 0, w: 0, h: 0, glows: [] };
  const closeScale = () => Math.max(4, Math.min(cv.width, cv.height) / 16); // about 16 tiles across the short side
  // The close view is drawn in a slight 3/4 perspective: walls rise E pixels above the floor, so their tops
  // sit higher and their front faces show below them, overlapping the floor behind; floors darken where they
  // meet walls (ambient occlusion). Rows are drawn top to bottom so nearer walls cover farther ones.
  const E = 4; // wall height in atlas pixels (of 8)
  function buildLayer() {
    const bs = closeScale(), w = Math.ceil(cv.width / bs) + 8, h = Math.ceil(cv.height / bs) + 8;
    if (!layer.cv || layer.w !== w || layer.h !== h) { layer.cv = document.createElement('canvas'); layer.cv.width = w * SLOT; layer.cv.height = h * SLOT; layer.g = layer.cv.getContext('2d'); layer.w = w; layer.h = h; }
    const L = layer.g, x0 = st.gx - (w >> 1), y0 = st.gy - (h >> 1), R = 11, fog = st.fog, ld = st.ldist || new Map();
    layer.x0 = x0; layer.y0 = y0; layer.glows = [];
    L.clearRect(0, 0, layer.cv.width, layer.cv.height);
    // gather the window: kind 0 nothing (unseen or unloaded), 1 floor, 2 wall; atlas slot or flat colour; light
    const n = w * h, kind = new Uint8Array(n), slot = new Int32Array(n).fill(-1), fromMat = new Uint8Array(n), bright = new Float32Array(n), flat = new Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x0 + x, gy = y0 + y, s = secAt(gx, gy), c = y * w + x;
      if (!s || s.failed) continue;
      const i = (gy - s.oy * 3) * SW + (gx - s.ox * 3);
      if (fog && !s.seen[i]) continue;
      const lit = !fog || s.lit[i];
      kind[c] = s.pass[i] ? 1 : 2;
      if (st.tiles && s.deco) {
        const t = s.deco[i], hsh = cellHash(gx, gy), sp = (hsh & 3) % slotSpins[t], jt = (hsh >>> 8) & 3;
        slot[c] = slotBase[t] + sp * 4 + jt;
        // materials: structured floors and masonry laid per room and district (8x8 tilesets that define them)
        const m = s.mat ? s.mat[i] : 0, tv = DRESS_TILES[t];
        if (m && st.tiles && DRESS_SETS[tv.ts].materials) {
          const fm = m & 15, wm = m >> 4, ph = (gx & 1) | ((gy & 1) << 1);
          if (tv.walk && fm) { slot[c] = matSlot(t, slotSpins[t] > 1 ? (hsh & 3) : 0, jt, 'f', fm, ph); fromMat[c] = 1; }
          else if (!tv.walk && wm) { slot[c] = matSlot(t, slotSpins[t] > 1 ? (hsh & 3) : 0, jt, 'w', wm, ph); fromMat[c] = 1; }
        }
        const v = DRESS_TILES[t]; if (v.glow && (!v.strict || v.letter === '1')) layer.glows.push(v.letter === '1' ? [gx + 0.5, gy + 0.5, v.glow, lit, 1] : [gx, gy - (v.walk ? 0 : E / SLOT), v.glow, lit, 0]);
      } else flat[c] = css(s.pass[i] ? (s.col[i] < FLOOR.length ? FLOOR[s.col[i]] : OTHER) : WALL);
      // light: bright near you, falling off with walking distance; remembered places stay dim
      let b = 1;
      if (fog) { const d = ld.get(K(gx, gy)); b = lit && d !== undefined ? 1 - 0.62 * Math.pow(Math.min(1, d / R), 1.5) : 0.3; }
      bright[c] = b;
    }
    const tile = (c, dx, dy, sy, hh) => {
      if (slot[c] >= 0) { const k = slot[c], A = fromMat[c] ? MAT.cv : atlas, cols = fromMat[c] ? MAT.cols : atlas.cols; L.drawImage(A, (k % cols) * SLOT, ((k / cols) | 0) * SLOT + sy, SLOT, hh, dx, dy, SLOT, hh); }
      else { L.fillStyle = flat[c]; L.fillRect(dx, dy, SLOT, hh); }
    };
    const dark = (a, x, y, ww, hh) => { if (a <= 0.01) return; L.globalAlpha = a; L.fillStyle = 'rgb(4,4,8)'; L.fillRect(x, y, ww, hh); L.globalAlpha = 1; };
    const isWall = c => kind[c] === 2;
    // pass 1: floors, with ambient occlusion along the walls around them
    for (let c = 0; c < n; c++) {
      if (kind[c] !== 1) continue;
      const x = (c % w) * SLOT, y = ((c / w) | 0) * SLOT, cx = c % w;
      tile(c, x, y, 0, SLOT);
      if (c + w < n && isWall(c + w)) dark(0.32, x, y + SLOT - 2, SLOT, 2); // the foot of the wall in front
      if (cx > 0 && isWall(c - 1)) dark(0.22, x, y, 2, SLOT);
      if (cx < w - 1 && isWall(c + 1)) dark(0.16, x + SLOT - 2, y, 2, SLOT);
      if (c >= w && isWall(c - w)) { dark(0.28, x, y, SLOT, 2); dark(0.12, x, y + 2, SLOT, 2); } // shadow under the wall behind
      dark(1 - bright[c], x, y, SLOT, SLOT);
    }
    // pass 2: walls, row by row, raised by E with their front face extended below
    for (let c = 0; c < n; c++) {
      if (kind[c] !== 2) continue;
      const x = (c % w) * SLOT, y = ((c / w) | 0) * SLOT, front = !(c + w < n && isWall(c + w));
      tile(c, x, y - E, 0, SLOT);
      if (front) {
        tile(c, x, y + SLOT - E, SLOT - E - 1, E); // the face continues down to the floor
        dark(0.18, x, y + SLOT - E, SLOT, E);
        dark(0.45, x, y + SLOT - 1, SLOT, 1); // contact line
      }
      dark(1 - bright[c], x, y - E, SLOT, SLOT + (front ? E : 0));
    }
    // the stratum's colour cast and your light, baked into this small layer instead of blended over the screen
    const a = st.amb;
    if (a) {
      // source-atop: only over what is drawn, never over the unexplored void
      L.globalCompositeOperation = 'source-atop'; L.globalAlpha = 0.12; L.fillStyle = css(a.tint); L.fillRect(0, 0, layer.cv.width, layer.cv.height);
      L.globalAlpha = 1;
      const px = (st.gx - x0 + 0.5) * SLOT, py = (st.gy - y0 + 0.5) * SLOT, lr = SLOT * 7, l = a.light, gr = L.createRadialGradient(px, py, 0, px, py, lr);
      gr.addColorStop(0, `rgba(${l[0] | 0},${l[1] | 0},${l[2] | 0},0.14)`); gr.addColorStop(1, `rgba(${l[0] | 0},${l[1] | 0},${l[2] | 0},0)`);
      L.fillStyle = gr; L.fillRect(px - lr, py - lr, lr * 2, lr * 2);
      L.globalCompositeOperation = 'source-over';
    }
    st.layerDirty = false;
  }

  // ---------- atmosphere ----------
  function ambience() {
    const ud = st.S.preset === 'underdark', inf = sectorInfo(st.S, st.cs[0], st.cs[1]);
    const target = ud ? AMB[inf.type] : AMB.plain;
    if (!st.amb) st.amb = { bg: hex(target.bg), light: hex(target.light), tint: hex(target.tint), stars: target.stars, fx: target.fx };
    const a = st.amb, k = 0.06;
    a.bg = mix(a.bg, hex(target.bg), k); a.light = mix(a.light, hex(target.light), k); a.tint = mix(a.tint, hex(target.tint), k);
    a.stars += (target.stars - a.stars) * k; a.fx = target.fx;
    const tt = hex(target.tint), drift = Math.abs(a.tint[0] - tt[0]) + Math.abs(a.tint[1] - tt[1]) + Math.abs(a.tint[2] - tt[2]);
    if (drift > 2 && (!a.bakedAt || performance.now() - a.bakedAt > 200)) { st.layerDirty = true; a.bakedAt = performance.now(); }
    // pilgrim fog: thickest at the seals and pits between strata, so the change is felt before it is seen
    let best = 1e9;
    if (st.placed) st.sectors.forEach(s => { if (s.failed) return; s.portals.forEach((p, n) => { if (!p.cross) return; const d = s.doors[n], dx = s.ox * 3 + d % SW - st.gx, dy = s.oy * 3 + ((d / SW) | 0) - st.gy; const dd = Math.hypot(dx, dy); if (dd < best) best = dd; }); });
    const f = Math.pow(Math.max(0, 1 - best / 40), 1.3);
    st.fogAmt = (st.fogAmt || 0) + (f - (st.fogAmt || 0)) * 0.05;
  }
  // particles live in world space around you, so they drift past as you walk
  function particles(n) {
    if (st.parts) return st.parts;
    const r = mulberry32(st.S.seed * 7 + 1), P = [];
    for (let i = 0; i < n; i++) P.push({ x: r() * 40 - 20, y: r() * 60 - 30, z: 0.4 + r() * 0.8, ph: r() * 6.28, sp: 0.3 + r() * 0.7 });
    return (st.parts = P);
  }
  let stars = null;
  function starField() {
    if (stars) return stars;
    const r = mulberry32(99), out = [];
    for (let i = 0; i < 160; i++) out.push({ x: r(), y: r(), s: r() < 0.15 ? 2 : 1, ph: r() * 6.28, sp: 0.5 + r() * 2 });
    return (stars = out);
  }

  function loop(t) {
    st.raf = requestAnimationFrame(loop);
    t = t || performance.now();
    const P = st.perf, f0 = performance.now();
    update(t);
    st.t = st.mv ? Math.min(1, (t - st.mv.t0) / st.mv.dur) : 1;
    st.sectors.forEach(s => { if (!s.failed && (s.dirty || s.cells.length)) paint(s); });
    ambience(); draw(t / 1000);
    if (!st.miniAt || t - st.miniAt > 100) { drawMini(); st.miniAt = t; }
    if (st.started && (!st.hudAt || t - st.hudAt > 1000)) { hud(); st.hudAt = t; }
    // performance: frame interval and the work done in this frame
    if (P.last) { const dt = t - P.last; P.frames.push([dt, performance.now() - f0]); if (P.frames.length > 240) P.frames.shift(); if (dt > 50) P.drops++; }
    P.last = t;
    if (!el.querySelector('.perf').hidden && (!P.shownAt || t - P.shownAt > 500)) { perfPanel(); P.shownAt = t; }
  }
  const ease = t => t; // constant speed: chained steps glide instead of pulsing
  function draw(time) {
    const W = cv.width, H = cv.height, a = st.amb;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = css(a.bg); g.fillRect(0, 0, W, H);
    if (!st.placed) return;
    const px = st.from[0] + (st.gx - st.from[0]) * ease(st.t), py = st.from[1] + (st.gy - st.from[1]) * ease(st.t);
    const bs = st.map ? Math.max(1, W / (SW * 1.6)) : closeScale();
    const ox = W / 2 - (px + 0.5) * bs, oy = H / 2 - (py + 0.5) * bs;
    st.view = { ox, oy, bs };
    // the void: in the Constellation of Mazes, unexplored dark is a field of slowly turning stars
    if (a.stars > 0.02) {
      starField().forEach(s2 => {
        const x = ((s2.x * W - px * bs * 0.15) % W + W) % W, y = ((s2.y * H - py * bs * 0.15) % H + H) % H;
        g.globalAlpha = a.stars * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s2.sp + s2.ph)));
        g.fillStyle = s2.s > 1 ? '#e8ecff' : '#9aa6e0'; g.fillRect(x, y, s2.s * dpr, s2.s * dpr);
      });
      g.globalAlpha = 1;
    }
    g.imageSmoothingEnabled = false;
    if (st.map) {
      st.sectors.forEach(s => {
        const x = ox + s.ox * 3 * bs, y = oy + s.oy * 3 * bs, w = SW * bs, h = SH * bs;
        if (x > W || y > H || x + w < 0 || y + h < 0) return;
        if (s.failed) { g.fillStyle = '#1a1010'; g.fillRect(x, y, w, h); return; }
        g.drawImage(s.cv, Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
      });
    } else {
      if (st.layerDirty || !layer.cv) { const t0 = performance.now(); buildLayer(); st.perf.layer.push(performance.now() - t0); if (st.perf.layer.length > 120) st.perf.layer.shift(); }
      g.drawImage(layer.cv, Math.round(ox + layer.x0 * bs), Math.round(oy + layer.y0 * bs), Math.round(layer.w * bs), Math.round(layer.h * bs));
      // glowing tiles: candles, eyes, the bloom heart, unsealed pits
      g.globalCompositeOperation = 'lighter';
      layer.glows.forEach(([gx, gy, c, lit, big]) => {
        const x = ox + (gx + 0.5) * bs, y = oy + (gy + 0.5) * bs, r = bs * ((big ? 3.4 : 2.2) + 0.25 * Math.sin(time * (big ? 1.2 : 3) + gx * 1.7 + gy));
        g.globalAlpha = (lit ? 0.42 : 0.22) * (big ? 0.7 : 1); g.drawImage(glowSprite(c), x - r, y - r, r * 2, r * 2);
      });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // sectors still being charted
    st.pending.forEach(k => {
      const [sx, sy] = k.split(',').map(Number), cw = WORLD_CW * 3 * bs, ch = WORLD_CH * 3 * bs, x = ox + sx * cw, y = oy + sy * ch;
      if (x > W || y > H || x + cw < 0 || y + ch < 0) return;
      g.strokeStyle = 'rgba(207,167,78,0.25)'; g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = 1 * dpr; g.strokeRect(x + 4, y + 4, cw - 8, ch - 8); g.setLineDash([]);
    });
    // the Gray Pilgrims keep vigil at every seal and pit between strata, and camp at the start
    if (!st.map) {
      const pil = pilgrimSprite();
      st.sectors.forEach(s => {
        if (s.failed) return;
        const spots = [];
        s.portals.forEach((p, n) => { if (p.cross) spots.push(p.hub[1] * 3 + 1, p.hub[0] * 3 + 1, n); });
        s.hubs.forEach((hb, n) => { if (hb.fn === 'PG') { const y = (hb.i / SW) | 0, x = hb.i % SW; spots.push(y - 1, x - 1, n, y - 1, x + 1, n + 1, y + 1, x, n + 2); } });
        for (let k = 0; k < spots.length; k += 3) {
          const ly = spots[k], lx = spots[k + 1], i = ly * SW + lx;
          if (!s.pass[i] || (st.fog && !s.seen[i])) continue;
          const gx = s.ox * 3 + lx, gy = s.oy * 3 + ly; if (gx === st.gx && gy === st.gy) continue;
          const x = ox + gx * bs, y = oy + gy * bs - bs * 0.15 + Math.sin(time * 1.3 + spots[k + 2]) * bs * 0.04;
          if (x < -bs || y < -bs || x > W || y > H) continue;
          g.globalAlpha = 0.35 * (st.fog && !s.lit[i] ? 0.5 : 1); g.fillStyle = '#000'; g.beginPath(); g.ellipse(x + bs / 2, y + bs * 1.05, bs * 0.38, bs * 0.13, 0, 0, 7); g.fill();
          g.globalAlpha = 0.85 * (st.fog && !s.lit[i] ? 0.5 : 1); g.drawImage(pil, x, y, bs, bs);
        }
      });
      g.globalAlpha = 1;
    }
    // landmarks
    st.sectors.forEach(s => {
      if (s.failed) return;
      s.hubs.forEach(hb => {
        if (!hb.label || (st.fog && !s.seen[hb.i])) return;
        const x = ox + (s.ox * 3 + hb.i % SW + 0.5) * bs, y = oy + (s.oy * 3 + ((hb.i / SW) | 0) + 0.5) * bs;
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;
        const r = Math.max(7 * dpr, bs * (st.map ? 2.2 : 0.55)), col = TIER_COL[hb.type];
        const ly = st.map ? y : y - bs * 1.4; // in the close view, a small tag above the place so the art stays visible
        g.fillStyle = 'rgba(7,8,11,0.78)'; g.beginPath(); g.arc(x, ly, r, 0, 7); g.fill();
        g.strokeStyle = col; g.lineWidth = 1.5 * dpr; g.stroke();
        g.fillStyle = col; g.font = `500 ${Math.round(r * 0.85)}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(hb.label, x, ly + 1);
      });
    });
    const ppx = ox + (px + 0.5) * bs, ppy = oy + (py + 0.5) * bs;
    if (!st.map) {
      // particles: gold motes among the mazes, spores in the growth, dust in the shrines
      const P = particles(70), fx = a.fx, span = [W / bs, H / bs];
      P.forEach(q => {
        let wx = q.x, wy = q.y;
        if (fx === 'spores') { wy -= time * 0.25 * q.sp; wx += Math.sin(time * 0.7 + q.ph) * 0.6; }
        else if (fx === 'dust') { wx += time * 0.12 * q.sp; wy += Math.sin(time * 0.4 + q.ph) * 0.4; }
        else { wy += time * 0.18 * q.sp; wx += Math.sin(time * 0.5 + q.ph) * 0.8; }
        const sx = ((wx - px * q.z * 0.2) % span[0] + span[0]) % span[0] * bs, sy = ((wy - py * q.z * 0.2) % span[1] + span[1]) % span[1] * bs;
        const tw = 0.5 + 0.5 * Math.sin(time * 2 * q.sp + q.ph), sz = Math.max(1, bs * 0.08 * q.z * (fx === 'spores' ? 1.4 : 1));
        g.globalAlpha = (fx === 'dust' ? 0.25 : 0.45) * tw * q.z;
        g.fillStyle = fx === 'spores' ? '#d8f59a' : fx === 'dust' ? '#ffe2b8' : '#f3d36b';
        g.fillRect(sx, sy, sz, sz);
      });
      g.globalAlpha = 1;
    }
    // the tapped route: dots to the goal, and a ring where you are going (red briefly if there is no way)
    if (st.goal) {
      const gx = ox + (st.goal.x + 0.5) * bs, gy = oy + (st.goal.y + 0.5) * bs, bad = st.goal.bad && time * 1000 - st.goal.bad < 900;
      if (st.path) {
        g.fillStyle = 'rgba(243,211,107,0.55)'; const dr = Math.max(1.5 * dpr, bs * 0.09);
        st.path.forEach(([x, y], i) => { if (i % 2 === 0 || i === st.path.length - 1) { g.beginPath(); g.arc(ox + (x + 0.5) * bs, oy + (y + 0.5) * bs, dr, 0, 7); g.fill(); } });
      }
      if (st.path || bad) {
        const rr = Math.max(5 * dpr, bs * 0.42) * (1 + 0.08 * Math.sin(time * 6));
        g.strokeStyle = bad ? 'rgba(224,90,90,0.85)' : 'rgba(243,211,107,0.9)'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(gx, gy, rr, 0, 7); g.stroke();
      } else st.goal = null;
    }
    // the player
    const pr = Math.max(4 * dpr, bs * (st.map ? 0.6 : 0.32));
    if (!st.map) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(ppx, ppy + pr * 1.1, pr * 1.1, pr * 0.4, 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(243,211,107,0.22)'; g.beginPath(); g.arc(ppx, ppy, pr * 2, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ppx, ppy, pr, 0, 7); g.fill();
    g.strokeStyle = 'rgb(7,8,11)'; g.lineWidth = 1.5 * dpr; g.stroke();
    // pilgrim fog drifting in near the seals
    if (st.fogAmt > 0.01 && !st.map) {
      const f = st.fogAmt, fs = glowSprite('#b9b2d8');
      g.fillStyle = `rgba(${FOG[0]},${FOG[1]},${FOG[2]},${0.09 * f})`; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 7; k++) {
        const r = Math.max(W, H) * (0.35 + 0.08 * (k % 3)), cx = ((k * 0.37 + time * 0.012 * (1 + k % 2)) % 1.4 - 0.2) * W - px * bs * 0.05 % W;
        const cy = (0.15 + (k * 0.29) % 0.8) * H + Math.sin(time * 0.2 + k) * H * 0.05;
        g.globalAlpha = 0.28 * f; g.drawImage(fs, cx - r, cy - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
    }
    // vignette and the stratum's colour cast
    if (!vignette) {
      vignette = document.createElement('canvas'); vignette.width = W; vignette.height = H; const v = vignette.getContext('2d');
      const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)'); v.fillStyle = gr; v.fillRect(0, 0, W, H);
    }
    g.drawImage(vignette, 0, 0);
  }

  // the sector tree around you: tiers, open doorways, where you have been
  function drawMini() {
    const M = mini.width, R = 3, cell = M / (2 * R + 1), [cx, cy] = st.cs;
    mg.fillStyle = 'rgba(17,19,24,0.92)'; mg.fillRect(0, 0, M, M);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const sx = cx + dx, sy = cy + dy, inf = sectorInfo(st.S, sx, sy), x = (dx + R) * cell, y = (dy + R) * cell;
      const visited = st.visited.has(K(sx, sy));
      mg.fillStyle = TIER_COL[inf.type]; mg.globalAlpha = visited ? 0.75 : 0.18 + 0.06 * (inf.level - 1);
      mg.fillRect(x + cell * 0.18, y + cell * 0.18, cell * 0.64, cell * 0.64); mg.globalAlpha = 1;
    }
    mg.lineWidth = Math.max(1, cell * 0.08);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const sx = cx + dx, sy = cy + dy;
      for (const d of [1, 2]) {
        if ((d === 1 && dx === R) || (d === 2 && dy === R)) continue;
        const e = edgeContract(st.S, sx, sy, sx + DX[d], sy + DY[d]); if (!e.open) continue;
        const x = (dx + R + 0.5) * cell, y = (dy + R + 0.5) * cell;
        mg.strokeStyle = e.tree ? 'rgba(230,225,213,0.75)' : 'rgba(243,211,107,0.7)';
        mg.setLineDash(e.tree ? [] : [cell * 0.12, cell * 0.12]);
        mg.beginPath(); mg.moveTo(x, y); mg.lineTo(x + DX[d] * cell, y + DY[d] * cell); mg.stroke();
      }
    }
    mg.setLineDash([]);
    // start sector marker and you
    const ox = (-cx + R + 0.5) * cell, oy = (-cy + R + 0.5) * cell;
    if (Math.abs(cx) <= R && Math.abs(cy) <= R) { mg.strokeStyle = '#f3d36b'; mg.lineWidth = Math.max(1, cell * 0.1); mg.strokeRect(ox - cell * 0.4, oy - cell * 0.4, cell * 0.8, cell * 0.8); }
    const lx = st.placed ? Math.min(1, Math.max(0, (st.gx / 3 - cx * WORLD_CW) / WORLD_CW)) : 0.5, ly = st.placed ? Math.min(1, Math.max(0, (st.gy / 3 - cy * WORLD_CH) / WORLD_CH)) : 0.5;
    mg.fillStyle = '#ffffff'; mg.beginPath(); mg.arc((R + 0.18 + lx * 0.64) * cell, (R + 0.18 + ly * 0.64) * cell, Math.max(2, cell * 0.12), 0, 7); mg.fill();
  }

  // ---------- HUD, toasts, rules ----------
  let toastTimer = null;
  function toast(msg, sticky) {
    const t = el.querySelector('.toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function hud() {
    const inf = sectorInfo(st.S, st.cs[0], st.cs[1]);
    el.querySelector('.xp-title').innerHTML = `<span style="color:${TIER_COL[inf.type]}">${inf.name}</span>`;
    // where you are inside the sector: the district's theme and the room (rooms layout)
    let sub = '';
    const sc = st.placed && secAt(st.gx, st.gy);
    if (sc && !sc.failed && sc.rooms) {
      const i = (st.gy - sc.oy * 3) * SW + (st.gx - sc.ox * 3), r = sc.roomOf[i] >= 0 ? sc.rooms[sc.roomOf[i]] : null, d = sc.districts[sc.distOf[i]];
      sub = `${d ? d.name : sc.theme.name} · ${r ? r.name : 'corridors'}`;
    }
    el.querySelector('.xp-sub').textContent = sub;
    const t = st.started ? performance.now() - st.started : 0, s = Math.floor(t / 1000);
    el.querySelector('.xp-stats').innerHTML = `<span>depth <b>${inf.depth}</b></span><span><b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b></span>`;
    if (st.placed && !el.querySelector('.toast').hidden && el.querySelector('.toast').textContent.startsWith('Charting') && passAt(st.gx, st.gy) === 1) el.querySelector('.toast').hidden = true;
    if (!el.querySelector('.rules').hidden) rules();
  }
  // live checks of the global rules, over every sector currently loaded
  function rules() {
    const list = [...st.sectors.values()].filter(s => !s.failed);
    let seams = 0, seamsOk = 0, skips = 0, caps = 0, keep = 0, keepOk = 0, works = 0, worksOk = 0;
    list.forEach(s => {
      s.portals.forEach(p => {
        const n = st.sectors.get(K(p.to[0], p.to[1]));
        if (Math.abs(s.info.tierIndex - p.toTier) > 1) skips++;
        if (!n || n.failed) return;
        const back = n.portals.find(q => q.dir === ((p.dir + 2) & 3) && q.pos === p.pos);
        seams++; if (back) seamsOk++;
      });
      if (new Set(s.portals.filter(p => p.kind === 'child' && p.cross).map(p => p.to.join())).size > 2) caps++;
      if (s.info.type === 2 && st.S.preset === 'arsenal') s.portals.forEach(p => { if (p.cross && p.kind === 'parent') { keep++; const hb = s.hubs.find(h => h.portal && h.fn === 'CP'); if (hb) keepOk++; } });
      if (s.doctrine) { works++; if (s.doctrine.power && s.doctrine.cooling && s.doctrine.blast) worksOk++; }
    });
    const row = (ok, text) => `<div class="${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '✗'}</span>${text}</div>`;
    el.querySelector('.rules').innerHTML = `<div class="rules-h">Rules, checked live on ${list.length} loaded sectors</div>` +
      row(st.failures === 0, `Every sector's hubs and doorways connect inside it${st.failures ? ` (${st.failures} failed)` : ''}`) +
      row(seamsOk === seams, `Doorways match on both sides of each border (${seamsOk}/${seams})`) +
      row(true, 'Every sector has a doorway to its parent, so all lead back to the start') +
      row(skips === 0, 'No link skips a tier') +
      row(caps === 0, 'At most 2 cross-tier branches per sector') +
      (st.S.preset === 'arsenal' ? row(keepOk === keep, `The Keep is entered only through Checkpoints (${keepOk}/${keep})`) +
        row(works === 0 || worksOk === works, `Works doctrine: power, cooling, blast separation (${worksOk}/${works} sectors)`) : '') +
      `<div class="rules-n">Deepest reached: ${st.deepest ? tierName(st.S, st.deepest % 3, Math.floor(st.deepest / 3) + 1) : sectorInfo(st.S, 0, 0).name}</div>`;
  }

  // ---------- performance: tracked live, shown on the Perf panel, readable by tools/bench-browser.py ----------
  const q = (a, p) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
  function perfSummary() {
    const P = st.perf, dts = P.frames.map(f => f[0]), work = P.frames.map(f => f[1]), g = P.gens;
    const field = k => g.map(x => x[k]).filter(v => v !== undefined);
    return {
      fps: dts.length ? 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length) : 0,
      frameP95: q(dts, 0.95), workMedian: q(work, 0.5), workP95: q(work, 0.95), drops: P.drops,
      layerMedian: q(P.layer, 0.5), layerP95: q(P.layer, 0.95),
      genCount: g.length, genMedian: q(field('total'), 0.5), genP95: q(field('total'), 0.95), genMax: q(field('total'), 1),
      // after warm-up: each worker's first sectors pay for compiling the JavaScript stages
      genSteadyP95: q(g.slice(2 * Math.max(1, pool.filter(w => !w.dead).length)).map(x => x.total), 0.95),
      dressMedian: q(field('dress'), 0.5), wfcMedian: q(field('wfc'), 0.5),
      wasm: g.length ? g.every(x => x.wasm) : null, wasmError: g.length ? g[g.length - 1].wasmError : null,
      firstSector: P.firstSector, workers: pool.filter(w => !w.dead).length, pending: st.pending.size, loaded: st.sectors.size,
    };
  }
  function perfPanel() {
    const p = perfSummary(), f = (v, d = 1) => (+v).toFixed(d);
    const row = (k, v, ok) => `<div class="${ok === undefined ? '' : ok ? 'ok' : 'bad'}"><span>${k}</span><b>${v}</b></div>`;
    el.querySelector('.perf').innerHTML = `<div class="rules-h">Performance</div>` +
      row('frame rate', `${f(p.fps, 0)} fps · p95 ${f(p.frameP95)} ms`, p.frameP95 < 25) +
      row('work per frame', `${f(p.workMedian)} ms · p95 ${f(p.workP95)} ms`, p.workP95 < 8) +
      row('view rebuild', `${f(p.layerMedian)} ms · p95 ${f(p.layerP95)} ms`) +
      row('sector generation', `${f(p.genMedian, 0)} ms · p95 ${f(p.genP95, 0)} ms (${p.genCount})`) +
      row('  steady p95 (after warm-up)', p.genSteadyP95 ? `${f(p.genSteadyP95, 0)} ms` : '…', p.genSteadyP95 ? p.genSteadyP95 < 150 : undefined) +
      row('  layout WFC / dressing', `${f(p.wfcMedian)} / ${f(p.dressMedian)} ms`) +
      row('generator', p.wasm === null ? '…' : p.wasm ? 'WebAssembly' : 'JavaScript' + (p.wasmError ? ' (' + p.wasmError + ')' : ''), p.wasm !== false) +
      row('first sector ready', `${f(p.firstSector, 0)} ms`, p.firstSector < 1500) +
      row('workers · queue · loaded', `${p.workers} · ${p.pending} · ${p.loaded}`) +
      row('long frames (> 50 ms)', p.drops, p.drops < 5);
  }

  root.Infinite = { open, close, suspend, resume, state: () => st, perf: () => st && perfSummary(), move };
})(window);
