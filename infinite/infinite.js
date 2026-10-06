// Infinite explore: streams sectors from gen/world.js around the player as they walk.
// Sectors are generated in background workers, cached near the player and evicted far away;
// what you have seen is remembered even after a sector is evicted (it regenerates identically).
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const FLOOR = ['#8f8263', '#2f6e62', '#8c4521', '#44508f', '#4f5e74'].map(hex);
  const OTHER = hex('#6b5a33'), WALL = hex('#2a2e38'), DARK = [7, 8, 11];
  const TIER_COL = ['#a8d672', '#f0b34b', '#e05a5a'];
  const K = (x, y) => x + ',' + y;
  const TPX = 4; // pixels per tile: each walkable/solid sub-cell is one 4x4 dressing tile
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
    st.pending.delete(k);
    if (!r.ok) { st.sectors.set(k, { ...r, failed: true }); st.failures++; return; }
    if (!st.seen.has(k)) st.seen.set(k, new Uint8Array(SW * SH));
    const cv = document.createElement('canvas'); cv.width = SW * TPX; cv.height = SH * TPX;
    const cx = cv.getContext('2d'), img = cx.createImageData(SW * TPX, SH * TPX);
    const sec = { ...r, cv, cx, img, px: new Uint32Array(img.data.buffer), seen: st.seen.get(k), lit: new Uint8Array(SW * SH), dirty: true, cells: [] };
    st.sectors.set(k, sec);
    st.charted.add(k);
    if (r.sx === st.cs[0] && r.sy === st.cs[1] && !st.placed) place();
    light();
  }
  function stream() {
    const [cx, cy] = st.cs;
    for (let r = 0; r <= 1; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) request(cx + dx, cy + dy);
    st.sectors.forEach((s, k) => { if (Math.max(Math.abs(s.sx - cx), Math.abs(s.sy - cy)) > 2) st.sectors.delete(k); });
  }

  // ---------- world lookups ----------
  const secAt = (gx, gy) => st.sectors.get(K(Math.floor(gx / SW), Math.floor(gy / SH)));
  function passAt(gx, gy) {
    const s = secAt(gx, gy); if (!s) return -1; if (s.failed) return 0;
    const lx = gx - s.sx * SW, ly = gy - s.sy * SH;
    return s.pass[ly * SW + lx];
  }

  // ---------- UI ----------
  function ui() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'xp inf';
    el.hidden = true;
    el.innerHTML = `
      <div class="xp-top">
        <button class="xp-btn" data-x="close" type="button" aria-label="Menu: world settings and tools">☰</button>
        <div class="xp-title"></div>
        <div class="xp-stats" aria-live="polite"></div>
      </div>
      <div class="xp-stage"><canvas class="main" aria-label="Explore view"></canvas>
        <canvas class="mini" aria-label="Sector map"></canvas>
        <div class="toast" role="status" aria-live="polite" hidden></div>
        <div class="rules" hidden></div>
      </div>
      <div class="xp-bottom">
        <div class="xp-toggles">
          <button class="xp-chip" data-x="fog" type="button">Light: on</button>
          <button class="xp-chip" data-x="zoom" type="button">View: close</button>
          <button class="xp-chip" data-x="tiles" type="button">Tiles: on</button>
          <button class="xp-chip" data-x="rules" type="button">Rules</button>
        </div>
        <div class="xp-pad" role="group" aria-label="Move">
          <button class="xp-key up" data-d="0" type="button" aria-label="Up">▲</button>
          <button class="xp-key left" data-d="3" type="button" aria-label="Left">◀</button>
          <button class="xp-key right" data-d="1" type="button" aria-label="Right">▶</button>
          <button class="xp-key down" data-d="2" type="button" aria-label="Down">▼</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    let hold = null;
    const press = d => { move(d); clearInterval(hold); hold = setInterval(() => move(d), 110); };
    const release = () => { clearInterval(hold); hold = null; };
    el.querySelectorAll('.xp-key').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); press(+b.dataset.d); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, release));
    });
    el.addEventListener('click', e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      const k = x.dataset.x;
      if (k === 'close') close();
      if (k === 'fog') { st.fog = !st.fog; x.textContent = 'Light: ' + (st.fog ? 'on' : 'off'); st.sectors.forEach(s => s.dirty = true); }
      if (k === 'zoom') { st.map = !st.map; x.textContent = 'View: ' + (st.map ? 'map' : 'close'); }
      if (k === 'tiles') { st.tiles = !st.tiles; x.textContent = 'Tiles: ' + (st.tiles ? 'on' : 'off'); st.sectors.forEach(s => s.dirty = true); }
      if (k === 'rules') { const r = el.querySelector('.rules'); r.hidden = !r.hidden; if (!r.hidden) rules(); }
      st.redraw = true;
    });
    const cv = el.querySelector('canvas.main');
    let sx = 0, sy = 0, sw = false;
    cv.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; sw = true; });
    cv.addEventListener('pointerup', e => {
      if (!sw) return; sw = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    });
    window.addEventListener('keydown', e => {
      if (el.hidden) return;
      const k = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 }[e.key];
      if (k !== undefined) { e.preventDefault(); move(k); }
      if (e.key === 'Escape') close();
    });
    window.addEventListener('resize', () => { if (!el.hidden) { size(); st.redraw = true; } });
    return el;
  }

  function open(settings) {
    ui(); makePool();
    const gen = (st ? st.gen : 0) + 1;
    st = {
      S: { ...WORLD_DEFAULTS, ...settings }, gen,
      sectors: new Map(), pending: new Set(), seen: new Map(), charted: new Set(), visited: new Set(['0,0']),
      cs: [0, 0], gx: 0, gy: 0, from: [0, 0], t: 1, placed: false, litList: [],
      fog: true, map: false, tiles: true, steps: 0, started: 0, failures: 0, deepest: 0, redraw: true,
    };
    queue = [];
    el.querySelector('[data-x="fog"]').textContent = 'Light: on';
    el.querySelector('[data-x="zoom"]').textContent = 'View: close';
    el.querySelector('[data-x="tiles"]').textContent = 'Tiles: on';
    el.querySelector('.rules').hidden = true;
    el.hidden = false;
    document.documentElement.classList.add('xp-open');
    size();
    toast('Charting the starting sector…', true);
    stream();
    hud();
    if (!st.raf) loop();
  }
  function close() { el.hidden = true; document.documentElement.classList.remove('xp-open'); if (st) { cancelAnimationFrame(st.raf); st.raf = 0; } }
  function place() {
    const s = st.sectors.get('0,0');
    st.gx = s.entranceSub % SW; st.gy = (s.entranceSub / SW) | 0; st.from = [st.gx, st.gy];
    st.placed = true; toast(`${s.info.name}: find the way deeper`);
    light(); hud();
  }

  // ---------- movement ----------
  function canStep(gx, gy, d) { return passAt(gx + DX[d], gy + DY[d]); }
  function stepTo(d) {
    st.gx += DX[d]; st.gy += DY[d]; st.steps++;
    const cs = [Math.floor(st.gx / SW), Math.floor(st.gy / SH)];
    if (cs[0] !== st.cs[0] || cs[1] !== st.cs[1]) crossed(st.cs, cs);
  }
  function move(d) {
    if (!st || !st.placed || el.hidden) return;
    const p = canStep(st.gx, st.gy, d);
    if (p === -1) { toast('Charting the next sector…', true); request(Math.floor((st.gx + DX[d]) / SW), Math.floor((st.gy + DY[d]) / SH)); return; }
    if (p !== 1) { bump(); return; }
    if (!st.started) st.started = performance.now();
    st.from = [st.gx, st.gy]; st.t = 0;
    stepTo(d); // always exactly one tile per move
    light(); hud();
  }
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
    const mark = (gx, gy) => {
      const s = secAt(gx, gy); if (!s || s.failed) return;
      const i = (gy - s.sy * SH) * SW + (gx - s.sx * SW);
      if (!s.lit[i]) { s.lit[i] = 1; st.litList.push([s, i]); s.cells.push(i); }
      s.seen[i] = 1;
    };
    mark(st.gx, st.gy);
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h], dd = dist.get(K(x, y));
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d], p = passAt(nx, ny);
        if (p < 0) continue;
        mark(nx, ny);
        if (p === 1 && dd + 1 <= R && !dist.has(K(nx, ny))) { dist.set(K(nx, ny), dd + 1); q.push([nx, ny]); }
      }
      for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (passAt(x + ax, y + ay) === 0) mark(x + ax, y + ay);
    }
    st.redraw = true;
  }

  // ---------- drawing ----------
  let cv, g, mini, mg, dpr = 1;
  function size() {
    cv = el.querySelector('canvas.main'); g = cv.getContext('2d');
    mini = el.querySelector('canvas.mini'); mg = mini.getContext('2d');
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const r = cv.parentElement.getBoundingClientRect();
    cv.width = Math.max(1, Math.floor(r.width * dpr)); cv.height = Math.max(1, Math.floor(r.height * dpr));
    const m = Math.round(Math.min(132, r.width * 0.34));
    mini.style.width = m + 'px'; mini.style.height = m + 'px'; mini.width = mini.height = Math.round(m * dpr);
  }
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  const rgba = (c, a) => (255 << 24) | (cl(c[2] * a + DARK[2] * (1 - a)) << 16) | (cl(c[1] * a + DARK[1] * (1 - a)) << 8) | cl(c[0] * a + DARK[0] * (1 - a));
  const BLACK = rgba(DARK, 1);
  // paint one sub-cell as a 4x4 tile: the dressing tile if dressing is on, else the flat layout colour
  function paintCell(s, i) {
    const px = s.px, fog = st.fog, lit = !fog || s.lit[i], seen = !fog || s.seen[i];
    const x = (i % SW) * TPX, y = ((i / SW) | 0) * TPX, row = SW * TPX;
    if (!seen) { for (let py = 0; py < TPX; py++) px.fill(BLACK, (y + py) * row + x, (y + py) * row + x + TPX); return; }
    const a = lit ? 1 : (s.pass[i] ? 0.4 : 0.5);
    const tile = st.tiles && s.deco ? DRESS_TILES[s.deco[i]] : null;
    if (tile) {
      // render-time variety: plain floors take a random quarter turn, and every tile a slight brightness jitter
      const h = cellHash(s.sx * SW + (i % SW), s.sy * SH + ((i / SW) | 0));
      const rgb = tile.spins ? tile.spins[h & 3] : tile.rgb, j = a * (0.93 + ((h >>> 8) & 15) / 15 * 0.12);
      for (let k = 0; k < 16; k++) px[(y + (k >> 2)) * row + x + (k & 3)] = rgba(rgb[k], j);
      return;
    }
    const c = rgba(s.pass[i] ? (s.col[i] < FLOOR.length ? FLOOR[s.col[i]] : OTHER) : WALL, a);
    for (let py = 0; py < TPX; py++) px.fill(c, (y + py) * row + x, (y + py) * row + x + TPX);
  }
  function paint(s) {
    if (s.dirty) { for (let i = 0; i < SW * SH; i++) paintCell(s, i); s.cx.putImageData(s.img, 0, 0); s.dirty = false; s.cells = []; return; }
    // only repaint what the light touched, within its bounding box
    let x0 = SW, y0 = SH, x1 = -1, y1 = -1;
    s.cells.forEach(i => { paintCell(s, i); const x = i % SW, y = (i / SW) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; });
    s.cells = [];
    if (x1 >= 0) s.cx.putImageData(s.img, 0, 0, x0 * TPX, y0 * TPX, (x1 - x0 + 1) * TPX, (y1 - y0 + 1) * TPX);
  }
  function loop() {
    st.raf = requestAnimationFrame(loop);
    if (st.t < 1) { st.t = Math.min(1, st.t + 0.34); st.redraw = true; }
    st.sectors.forEach(s => { if (!s.failed && (s.dirty || s.cells.length)) { paint(s); st.redraw = true; } });
    if (st.started && (performance.now() | 0) % 1000 < 17) hud();
    if (!st.redraw) return;
    st.redraw = false;
    draw(); drawMini();
  }
  const ease = t => 1 - (1 - t) * (1 - t);
  function draw() {
    const W = cv.width, H = cv.height;
    g.fillStyle = 'rgb(7,8,11)'; g.fillRect(0, 0, W, H);
    if (!st.placed) return;
    const px = st.from[0] + (st.gx - st.from[0]) * ease(st.t), py = st.from[1] + (st.gy - st.from[1]) * ease(st.t);
    const bs = st.map ? Math.max(1, W / (SW * 1.6)) : Math.max(4, W / 27);
    const ox = W / 2 - (px + 0.5) * bs, oy = H / 2 - (py + 0.5) * bs;
    g.imageSmoothingEnabled = false;
    st.sectors.forEach(s => {
      const x = ox + s.sx * SW * bs, y = oy + s.sy * SH * bs, w = SW * bs, h = SH * bs;
      if (x > W || y > H || x + w < 0 || y + h < 0) return;
      if (s.failed) { g.fillStyle = '#1a1010'; g.fillRect(x, y, w, h); return; }
      g.drawImage(s.cv, Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    });
    // sectors still being charted
    st.pending.forEach(k => {
      const [sx, sy] = k.split(',').map(Number), x = ox + sx * SW * bs, y = oy + sy * SH * bs;
      if (x > W || y > H || x + SW * bs < 0 || y + SH * bs < 0) return;
      g.strokeStyle = 'rgba(207,167,78,0.25)'; g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = 1 * dpr; g.strokeRect(x + 4, y + 4, SW * bs - 8, SH * bs - 8); g.setLineDash([]);
    });
    // landmarks
    st.sectors.forEach(s => {
      if (s.failed) return;
      s.hubs.forEach(hb => {
        if (!hb.label || (st.fog && !s.seen[hb.i])) return;
        const x = ox + (s.sx * SW + hb.i % SW + 0.5) * bs, y = oy + (s.sy * SH + ((hb.i / SW) | 0) + 0.5) * bs;
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;
        const r = Math.max(7 * dpr, bs * (st.map ? 2.2 : 1.1)), col = TIER_COL[hb.type];
        g.fillStyle = 'rgba(7,8,11,0.82)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        g.strokeStyle = col; g.lineWidth = 1.5 * dpr; g.stroke();
        g.fillStyle = col; g.font = `500 ${Math.round(r * 0.85)}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(hb.label, x, y + 1);
      });
    });
    // player
    const ppx = ox + (px + 0.5) * bs, ppy = oy + (py + 0.5) * bs, pr = Math.max(4 * dpr, bs * 0.6);
    g.fillStyle = 'rgba(243,211,107,0.2)'; g.beginPath(); g.arc(ppx, ppy, pr * 2.2, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ppx, ppy, pr, 0, 7); g.fill();
    g.strokeStyle = 'rgb(7,8,11)'; g.lineWidth = 1.5 * dpr; g.stroke();
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
    const lx = st.placed ? (st.gx - cx * SW) / SW : 0.5, ly = st.placed ? (st.gy - cy * SH) / SH : 0.5;
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
    const t = st.started ? performance.now() - st.started : 0, s = Math.floor(t / 1000);
    el.querySelector('.xp-stats').innerHTML = `<span>sector <b>${st.cs[0]}, ${st.cs[1]}</b></span><span>depth <b>${inf.depth}</b></span><span><b>${st.visited.size}</b> visited</span><span><b>${st.steps}</b> steps</span><span><b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b></span>`;
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
        const back = n.portals.find(q => q.dir === ((p.dir + 2) & 3));
        seams++; if (back && back.pos === p.pos) seamsOk++;
      });
      if (s.portals.filter(p => p.kind === 'child' && p.cross).length > 2) caps++;
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

  root.Infinite = { open, close, state: () => st };
})(window);
