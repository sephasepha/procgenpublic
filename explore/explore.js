// Explore mode: walk a generated grid with an on-screen arrow pad, swipes or the keyboard.
// Works on any block grid: pass[i] = 1 for walkable blocks. Used by the Maze Lab and the Workbench.
//
// Explore.open({
//   w, h, pass: Uint8Array, start, goal,        // block indices
//   step: 1,                                   // blocks moved per tap (mazes use 2: cell to cell)
//   colorOf: i => css colour for a walkable block,
//   landmarks: [{ i, label, color }],          // optional labels drawn on the map
//   title, optimal,                            // optimal step count, for the score
//   light: 7,                                  // light radius in blocks (spreads along corridors, not through walls)
//   nextLabel, onNext,                         // optional "another one" button on the finish card
// })
(function (root) {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const WALL = '#2a2e38', DARK = '#07080b', PLAYER = '#ffffff', GOAL = '#f3d36b';
  let el = null, st = null;

  function ui() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'xp';
    el.hidden = true;
    el.innerHTML = `
      <div class="xp-top">
        <button class="xp-btn" data-x="close" type="button" aria-label="Close explore">✕</button>
        <div class="xp-title"></div>
        <div class="xp-stats" aria-live="polite"></div>
      </div>
      <div class="xp-stage"><canvas aria-label="Explore view"></canvas>
        <div class="xp-done" hidden>
          <h3>Found it</h3>
          <div class="xp-score"></div>
          <div class="xp-row"><button class="btn" data-x="again" type="button">Walk it again</button><button class="btn primary" data-x="next" type="button"></button></div>
        </div>
      </div>
      <div class="xp-bottom">
        <div class="xp-toggles">
          <button class="xp-chip" data-x="fog" type="button">Light: on</button>
          <button class="xp-chip" data-x="zoom" type="button">View: close</button>
        </div>
        <div class="xp-pad" role="group" aria-label="Move">
          <button class="xp-key up" data-d="0" type="button" aria-label="Up">▲</button>
          <button class="xp-key left" data-d="3" type="button" aria-label="Left">◀</button>
          <button class="xp-key right" data-d="1" type="button" aria-label="Right">▶</button>
          <button class="xp-key down" data-d="2" type="button" aria-label="Down">▼</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    // controls
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
      if (k === 'fog') { st.fog = !st.fog; x.textContent = 'Light: ' + (st.fog ? 'on' : 'off'); st.dirty = true; }
      if (k === 'zoom') { st.map = !st.map; x.textContent = 'View: ' + (st.map ? 'map' : 'close'); st.dirty = true; }
      if (k === 'again') restart();
      if (k === 'next' && st.onNext) { const o = st.onNext(); if (o) open(o); }
    });
    // swipes on the map
    const cv = el.querySelector('canvas');
    let sx = 0, sy = 0, swiping = false;
    cv.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; swiping = true; });
    cv.addEventListener('pointerup', e => {
      if (!swiping) return; swiping = false;
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
    window.addEventListener('resize', () => { if (!el.hidden) { size(); st.dirty = true; } });
    return el;
  }

  function open(o) {
    ui();
    st = {
      ...o, step: o.step || 1, light: o.light || 7,
      pos: o.start, from: o.start, t: 1, steps: 0, revisits: 0, started: 0, finished: 0,
      seen: new Uint8Array(o.w * o.h), lit: new Uint8Array(o.w * o.h), trail: new Uint8Array(o.w * o.h),
      fog: st ? st.fog : true, map: false, dirty: true,
    };
    let floor = 0; for (let i = 0; i < o.w * o.h; i++) if (o.pass[i]) floor++;
    st.floor = floor;
    st.trail[st.pos] = 1;
    el.querySelector('.xp-title').textContent = o.title || 'Explore';
    el.querySelector('[data-x="next"]').textContent = o.nextLabel || 'Close';
    el.querySelector('[data-x="fog"]').textContent = 'Light: ' + (st.fog ? 'on' : 'off');
    el.querySelector('[data-x="zoom"]').textContent = 'View: close';
    el.querySelector('.xp-done').hidden = true;
    el.hidden = false;
    document.documentElement.classList.add('xp-open');
    size(); light(); stats();
    if (!st.raf) loop();
  }
  function restart() { const o = st; open({ w: o.w, h: o.h, pass: o.pass, start: o.start, goal: o.goal, step: o.step, colorOf: o.colorOf, landmarks: o.landmarks, title: o.title, optimal: o.optimal, light: o.light, nextLabel: o.nextLabel, onNext: o.onNext }); }
  function close() { el.hidden = true; document.documentElement.classList.remove('xp-open'); if (st) { cancelAnimationFrame(st.raf); st.raf = 0; } }

  const passable = (i, d) => {
    const x = i % st.w, y = (i / st.w) | 0, nx = x + DX[d], ny = y + DY[d];
    return nx >= 0 && ny >= 0 && nx < st.w && ny < st.h && st.pass[ny * st.w + nx];
  };
  function stepOnce(d) {
    let i = st.pos;
    for (let k = 0; k < st.step; k++) { if (!passable(i, d)) return false; i += DX[d] + DY[d] * st.w; }
    st.from = st.pos; st.pos = i; st.t = 0; st.steps++;
    if (st.trail[i]) st.revisits++; st.trail[i] = 1;
    return true;
  }
  function move(d) {
    if (!st || st.finished || el.hidden) return;
    if (!st.started) st.started = performance.now();
    if (!stepOnce(d)) { bump(); return; }
    light(); stats();
    if (st.pos === st.goal) finish();
  }
  function bump() { const c = el.querySelector('canvas'); c.classList.remove('xp-bump'); void c.offsetWidth; c.classList.add('xp-bump'); }

  // light spreads along walkable blocks up to the radius, so it never shines through walls
  function light() {
    st.lit.fill(0);
    const R = st.light, q = [st.pos], dist = new Map([[st.pos, 0]]);
    st.lit[st.pos] = 1; st.seen[st.pos] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], dd = dist.get(i), x = i % st.w, y = (i / st.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= st.w || ny >= st.h) continue;
        const n = ny * st.w + nx;
        st.lit[n] = 1; st.seen[n] = 1; // walls next to lit floor are seen too
        if (st.pass[n] && dd + 1 <= R && !dist.has(n)) { dist.set(n, dd + 1); q.push(n); }
      }
    }
    // also catch diagonal wall corners so rooms read cleanly
    for (const i of q) { const x = i % st.w, y = (i / st.w) | 0; for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + ax, ny = y + ay; if (nx >= 0 && ny >= 0 && nx < st.w && ny < st.h && !st.pass[ny * st.w + nx]) { st.lit[ny * st.w + nx] = 1; st.seen[ny * st.w + nx] = 1; } } }
    st.dirty = true;
  }
  function explored() { let k = 0; for (let i = 0; i < st.w * st.h; i++) if (st.pass[i] && st.seen[i]) k++; return k / st.floor; }
  function fmtTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function stats() {
    const t = st.started ? (st.finished || performance.now()) - st.started : 0;
    el.querySelector('.xp-stats').innerHTML = `<span><b>${st.steps}</b> steps</span><span><b>${fmtTime(t)}</b></span><span><b>${Math.round(explored() * 100)}%</b> seen</span>`;
  }
  function finish() {
    st.finished = performance.now(); stats();
    const eff = st.optimal ? Math.min(100, Math.round(st.optimal / Math.max(1, st.steps) * 100)) : null;
    el.querySelector('.xp-score').innerHTML =
      `<div><span>Steps</span><b>${st.steps}</b></div>` +
      (st.optimal ? `<div><span>Shortest route</span><b>${st.optimal}</b></div><div><span>Efficiency</span><b>${eff}%</b></div>` : '') +
      `<div><span>Time</span><b>${fmtTime(st.finished - st.started)}</b></div><div><span>Backtracked</span><b>${st.revisits}</b></div><div><span>Seen</span><b>${Math.round(explored() * 100)}%</b></div>`;
    el.querySelector('.xp-done').hidden = false;
    st.dirty = true;
  }

  // ---------- drawing ----------
  let cv, g, dpr = 1;
  function size() {
    cv = el.querySelector('canvas'); g = cv.getContext('2d');
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const r = cv.parentElement.getBoundingClientRect();
    cv.width = Math.max(1, Math.floor(r.width * dpr)); cv.height = Math.max(1, Math.floor(r.height * dpr));
  }
  function loop() {
    st.raf = requestAnimationFrame(loop);
    if (st.t < 1) { st.t = Math.min(1, st.t + 0.34); st.dirty = true; }
    if (st.started && !st.finished && (performance.now() | 0) % 500 < 17) stats();
    if (!st.dirty) return;
    st.dirty = false;
    draw();
  }
  function draw() {
    const W = cv.width, H = cv.height;
    g.fillStyle = DARK; g.fillRect(0, 0, W, H);
    // camera: follow the player in close view, fit everything in map view
    let bs, cx, cy;
    const px = (st.from % st.w) + ((st.pos % st.w) - (st.from % st.w)) * ease(st.t);
    const py = ((st.from / st.w) | 0) + (((st.pos / st.w) | 0) - ((st.from / st.w) | 0)) * ease(st.t);
    if (st.map) { bs = Math.min(W / st.w, H / st.h); cx = st.w / 2; cy = st.h / 2; }
    else {
      const across = st.step === 2 ? 17 : 27;
      bs = Math.max(4, W / across);
      cx = Math.min(Math.max(px + 0.5, W / bs / 2), st.w - W / bs / 2); cy = Math.min(Math.max(py + 0.5, H / bs / 2), st.h - H / bs / 2);
      if (st.w * bs < W) cx = st.w / 2; if (st.h * bs < H) cy = st.h / 2;
    }
    const ox = W / 2 - cx * bs, oy = H / 2 - cy * bs;
    const x0 = Math.max(0, Math.floor(-ox / bs)), x1 = Math.min(st.w - 1, Math.ceil((W - ox) / bs));
    const y0 = Math.max(0, Math.floor(-oy / bs)), y1 = Math.min(st.h - 1, Math.ceil((H - oy) / bs));
    const b = Math.ceil(bs);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * st.w + x;
      const vis = !st.fog || st.lit[i], mem = !st.fog || st.seen[i];
      if (!mem) continue;
      const sx = Math.floor(ox + x * bs), sy = Math.floor(oy + y * bs);
      if (st.pass[i]) {
        g.fillStyle = st.colorOf ? st.colorOf(i) : '#c9bb93';
        g.globalAlpha = vis ? 1 : 0.38; g.fillRect(sx, sy, b, b);
        if (st.trail[i] && bs >= 5) { g.globalAlpha = vis ? 0.5 : 0.3; g.fillStyle = '#ffffff'; const k = bs * 0.16; g.fillRect(sx + bs / 2 - k / 2, sy + bs / 2 - k / 2, k, k); }
      } else { g.fillStyle = WALL; g.globalAlpha = vis ? 1 : 0.55; g.fillRect(sx, sy, b, b); }
      g.globalAlpha = 1;
    }
    // landmarks and goal
    const at = i => [ox + ((i % st.w) + 0.5) * bs, oy + (((i / st.w) | 0) + 0.5) * bs];
    (st.landmarks || []).forEach(l => {
      if (st.fog && !st.seen[l.i]) return;
      const [x, y] = at(l.i), r = Math.max(7 * dpr, bs * 1.1);
      g.fillStyle = 'rgba(7,8,11,0.8)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.strokeStyle = l.color || GOAL; g.lineWidth = 1.5 * dpr; g.stroke();
      g.fillStyle = l.color || GOAL; g.font = `500 ${Math.round(r * 0.85)}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(l.label, x, y + 1);
    });
    if (st.goal >= 0 && (!st.fog || st.seen[st.goal])) {
      const [x, y] = at(st.goal), r = Math.max(5 * dpr, bs * 0.7);
      g.strokeStyle = GOAL; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.beginPath(); g.arc(x, y, r * 0.45, 0, 7); g.fillStyle = GOAL; g.fill();
    }
    // player
    const ppx = ox + (px + 0.5) * bs, ppy = oy + (py + 0.5) * bs, pr = Math.max(4 * dpr, bs * (st.step === 2 ? 0.75 : 0.6));
    g.fillStyle = 'rgba(243,211,107,0.18)'; g.beginPath(); g.arc(ppx, ppy, pr * 2.2, 0, 7); g.fill();
    g.fillStyle = PLAYER; g.beginPath(); g.arc(ppx, ppy, pr, 0, 7); g.fill();
    g.strokeStyle = DARK; g.lineWidth = 1.5 * dpr; g.stroke();
  }
  const ease = t => 1 - (1 - t) * (1 - t);

  root.Explore = { open, close, state: () => st };
})(window);
