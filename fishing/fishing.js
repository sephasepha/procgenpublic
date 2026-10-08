// Fishing: the screen. A ledge over a black pool, the pilgrim, a line. Cast (hold to throw further), wait for the dip,
// hook it, then fight what is on the line (hold to reel, ease off when it surges, mind the strain) and, because what is
// on the line is not a fish, fight it again on the ledge (strike, brace, or cut loose). The rules are in
// fishing/sim.js and its data in fishing/data.js; this file draws and sends the player's actions.
// The hour (a bell the pilgrims keep) and the bait change what bites. What you kill goes to your stock as food;
// what it does to you goes to the body screen as wounds with a cause.
(function (root) {
  const F = root.FishSim, CR = root.FISH_CREATURES, ZONES = root.FISH_ZONES, T = root.FISH_TUNING;
  const ING = root.CAMP_INGREDIENTS;
  const BAIT_TAGS = ['grub', 'meat', 'fish', 'fungus', 'sweet', 'fruit', 'egg', 'bone', 'eye', 'fat'];
  const SAVE = 'undercroft-fishing-v1';
  let el = null, cv, g, LW = 480, LH = 270, raf = 0, last = 0, st = null, onLeave = null, bar = '';

  const camp = () => root.Camp && Camp.shared();
  const level = () => (root.Skills ? Skills.all().angling.level : 1);
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.tally) return s; } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ tally: st.f.tally })); } catch (e) { /* storage unavailable */ } }
  function state() {
    if (!st) { const f = F.createAngler(Date.now() % 100000), s = load(); if (s) f.tally = s.tally; st = { f, bait: null, charge: 0, charging: false, pressed: '', shake: 0, flash: 0, hurtAt: -9, lastEvent: 0 }; }
    return st;
  }
  const hourNow = () => { const c = camp(); return root.fishHourOf(c ? c.t : 0); };
  const period = () => root.fishPeriodOf(hourNow());
  // what the player brings to the rules
  function ctx() {
    const c = camp();
    return { stats: c.stats, stock: c.stock, level: level(), hour: hourNow(), earn: (k, n) => { if (root.Skills) Skills.earn(k, n); }, injure: cause => (root.Body && Body.injure ? Body.injure(cause) : null) };
  }
  const baits = () => { const c = camp(); return Object.keys(ING).filter(k => !ING[k].water && (c.stock[k] || 0) > 0 && (ING[k].tags || []).some(t => BAIT_TAGS.includes(t))); };

  // ---------- the screen ----------
  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'camp fish-screen'; el.hidden = true;
    el.innerHTML = `<canvas aria-label="Fishing: cast, wait for the dip, hook it, reel it in, and fight what comes up"></canvas>
      <div class="bx-needs" role="group" aria-label="Your health and soul">
        <div class="need big" data-s="health"><b>HP</b><div class="bar" role="meter" aria-label="HP" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="v"></span></div>
        <div class="need big" data-s="soul"><b>Soul</b><div class="bar" role="meter" aria-label="Soul" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="v"></span></div>
        <span class="fx-hour" aria-live="off"></span></div>
      <div class="fx-bait" role="group" aria-label="Bait" hidden></div>
      <div class="fx-bar" role="group" aria-label="Actions"></div>`;
    document.body.appendChild(el);
    cv = el.querySelector('canvas'); g = cv.getContext('2d');
    el.querySelector('.fx-bar').addEventListener('pointerdown', barDown); el.querySelector('.fx-bar').addEventListener('pointerup', barUp); el.querySelector('.fx-bar').addEventListener('pointercancel', barUp);
    el.querySelector('.fx-bait').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) { st.bait = b.dataset.b || null; paintBait(true); } });
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    window.addEventListener('keydown', key); window.addEventListener('keyup', keyUp);
  }
  function size() {
    const r = el.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    LH = 270; LW = Math.max(300, Math.min(760, Math.round(LH * aspect)));
    if (aspect < 1) { LW = 360; LH = Math.round(LW / aspect); }
    cv.width = LW; cv.height = LH; g.imageSmoothingEnabled = false;
    st.top = Math.ceil((el.querySelector('.bx-needs').getBoundingClientRect().bottom - r.top) * LH / Math.max(1, r.height)) + 4;
    st.ui = Math.round((el.querySelector('.fx-bar').getBoundingClientRect().top - r.top) * LH / Math.max(1, r.height)) - 34; // above the buttons and the bait
    st.portrait = aspect < 1;
  }
  function open(leaveFn) {
    ui(); state(); onLeave = leaveFn; el.hidden = false; document.documentElement.classList.add('xp-open');
    size(); bar = ''; paintBar(); paintBait(true); needs();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  function leave(silent) { if (!el) return; el.hidden = true; cancelAnimationFrame(raf); raf = 0; if (st.f.phase !== 'idle' && st.f.phase !== 'result') { const f = st.f; f.phase = 'idle'; f.reel = false; f.combat = null; } if (st) save(); if (root.Camp) Camp.save(); if (onLeave && silent !== true) onLeave(); }

  // ---------- buttons: what you can do now ----------
  const BUTTONS = {
    idle: [['cast', 'Cast', 'Hold to throw further, let go to cast']],
    waiting: [['hook', 'Hook!', 'Strike at the dip'], ['wind', 'Wind in', 'Take the line back']],
    bite: [['hook', 'Hook!', 'Now']],
    fight: [['reel', 'Reel', 'Hold to reel; let go when it surges']],
    combat: [['strike', 'Strike', ''], ['brace', 'Brace', 'Take its attack on your guard'], ['flee', 'Cut loose', 'Cut the line and back off']],
    result: [['next', 'Cast again', '']],
  };
  function paintBar() {
    const f = st.f, key = f.phase; if (key === bar) return; bar = key;
    el.querySelector('.fx-bar').innerHTML = BUTTONS[key].map(([k, label, tip]) => `<button type="button" data-k="${k}" title="${tip}">${label}</button>`).join('');
    el.querySelector('.fx-bait').hidden = key !== 'idle';
    if (key === 'idle') paintBait(true);
  }
  let baitKey = '';
  function paintBait(force) {
    const bx = el.querySelector('.fx-bait'), c = camp(), list = baits(), key = list.map(k => k + c.stock[k]).join() + '|' + st.bait;
    if (!force && key === baitKey) return; baitKey = key;
    if (st.bait && !list.includes(st.bait)) st.bait = null;
    bx.innerHTML = `<button type="button" data-b="" class="${st.bait ? '' : 'on'}" aria-pressed="${!st.bait}">No bait</button>` + list.map(k => `<button type="button" data-b="${k}" class="${st.bait === k ? 'on' : ''}" aria-pressed="${st.bait === k}" title="${ING[k].name}: ${(ING[k].tags || []).join(', ')}">${ING[k].name} <i>${c.stock[k]}</i></button>`).join('');
  }
  function press(k, down) {
    const f = st.f, c = ctx();
    if (k === 'cast') { if (down && f.phase === 'idle') { st.charging = true; st.charge = 0; } else if (!down && st.charging) { st.charging = false; const bk = st.bait ? { id: st.bait, tags: ING[st.bait].tags } : null; F.cast(f, Math.max(0.05, st.charge), bk, c); st.shake = 0.15; } }
    else if (k === 'reel') F.setReel(f, down);
    else if (!down) return;
    else if (k === 'hook') { const was = f.phase; if (F.hook(f, c) && was === 'bite') st.flash = 0.3; }
    else if (k === 'wind') F.reelIn(f);
    else if (k === 'strike') { const r = F.strike(f, c); if (r && r.hit) st.shake = 0.2; }
    else if (k === 'brace') F.brace(f);
    else if (k === 'flee') F.retreat(f);
    else if (k === 'next') { F.nextCast(f); if (root.Camp) Camp.save(); }
  }
  function barDown(e) { const b = e.target.closest('button'); if (!b || b.disabled) return; e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); st.pressed = b.dataset.k; press(b.dataset.k, true); }
  function barUp(e) { if (!st || !st.pressed) return; const k = st.pressed; st.pressed = ''; if (k === 'cast' || k === 'reel') press(k, false); }
  const KEYS = { ' ': { idle: 'cast', waiting: 'hook', bite: 'hook', fight: 'reel', combat: 'strike', result: 'next' }, b: { combat: 'brace' }, x: { combat: 'flee' } };
  function key(e) {
    if (!el || el.hidden || e.repeat) return;
    if (e.key === 'Escape') { const p = st.f.phase; if (p === 'idle' || p === 'result') leave(); return; }
    const k = (KEYS[e.key.toLowerCase()] || {})[st.f.phase]; if (k) { e.preventDefault(); st.keyDown = k; press(k, true); }
  }
  function keyUp(e) { if (!st || !st.keyDown) return; if (e.key === ' ' || e.key.toLowerCase() === 'b') { const k = st.keyDown; st.keyDown = ''; if (k === 'cast' || k === 'reel') press(k, false); } }

  function needs() {
    const c = camp(); if (!c) return;
    ['health', 'soul'].forEach(k => { const n = el.querySelector(`.need[data-s="${k}"]`), v = Math.round(c.stats[k]); n.querySelector('i').style.width = v + '%'; n.querySelector('.v').textContent = v; n.querySelector('.bar').setAttribute('aria-valuenow', v); n.classList.toggle('low', v < 25); });
    const p = period(), h = hourNow(); el.querySelector('.fx-hour').textContent = `${p.name} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  // ---------- the loop ----------
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t; const f = st.f, c = ctx();
    if (st.charging) st.charge = Math.min(1, st.charge + dt / 1.2);
    const phase = f.phase, hp = c.stats.health;
    F.step(f, dt, c);
    if (c.stats.health < hp - 0.4) { st.hurtAt = t; st.shake = 0.3; }
    if (root.Body && Body.tick) Body.tick(dt); if (root.Camp && Camp.advance) Camp.advance(dt); // time passes, and so do your wounds
    if (f.phase === 'result' && phase !== 'result') { save(); if (root.Camp) Camp.save(); }
    st.shake = Math.max(0, st.shake - dt); st.flash = Math.max(0, st.flash - dt);
    paintBar(); if (el.querySelector('.fx-bait').hidden === false) paintBait(false);
    // buttons that wait: strike and brace show their cooldowns
    if (f.phase === 'combat') { const s = el.querySelector('[data-k="strike"]'), b = el.querySelector('[data-k="brace"]'); if (s) s.classList.toggle('cool', f.cd > 0); if (b) { b.classList.toggle('cool', f.braceCd > 0); b.classList.toggle('on', f.brace > 0); } }
    needs(); draw(t / 1000);
  }

  // ---------- drawing ----------
  const hash = (a, b) => { let h = Math.imul(a * 374761393 + b * 668265263, 0x9e3779b1); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  const layout = () => { const wy = Math.round(LH * (st.portrait ? 0.36 : 0.4)); return { wy, rx: Math.round(LW * (st.portrait ? 0.2 : 0.17)), ry: Math.round(wy + LH * 0.08), px: Math.round(LW * 0.08) }; };
  const bobberAt = (L, d) => ({ x: L.rx + 14 + d * (LW - L.rx - 40), y: L.wy + (LH - L.wy) * (0.72 - d * 0.55) });
  function scene(time, per) {
    const L = layout(), wy = L.wy;
    let gr = g.createLinearGradient(0, 0, 0, wy); gr.addColorStop(0, '#0a0912'); gr.addColorStop(1, '#262338'); g.fillStyle = gr; g.fillRect(0, 0, LW, wy);
    g.fillStyle = '#14121e'; for (let i = 0; i < 14; i++) { const x = i * LW / 13 + hash(i, 1) * 14, h = 14 + hash(i, 2) * 40; g.beginPath(); g.moveTo(x - 7, 0); g.lineTo(x + 7, 0); g.lineTo(x + (hash(i, 3) - 0.5) * 4, h); g.fill(); }
    g.fillStyle = 'rgba(111,224,160,0.05)'; for (let i = 0; i < 5; i++) g.fillRect(LW * (0.2 + i * 0.17), wy - 22 - hash(i, 5) * 20, 2 + hash(i, 6) * 5, 1); // far glints on the wall
    gr = g.createLinearGradient(0, wy, 0, LH); gr.addColorStop(0, '#1a3448'); gr.addColorStop(1, '#07121c'); g.fillStyle = gr; g.fillRect(0, wy, LW, LH - wy);
    g.fillStyle = 'rgba(160,200,220,0.14)'; for (let i = 0; i < 26; i++) { const y = wy + 4 + hash(i, 9) * (LH - wy - 6), x = ((hash(i, 11) * LW + time * (6 + i % 5) * (y - wy) * 0.02 * 3) % (LW + 40)) - 20, w = 6 + (y - wy) * 0.12; g.fillRect(Math.round(x), Math.round(y), w, 1); }
    if (per.k === 'night' || per.k === 'dusk') { g.fillStyle = 'rgba(111,224,160,0.22)'; for (let i = 0; i < 18; i++) { const x = hash(i, 21) * LW, y = wy + 8 + hash(i, 22) * (LH - wy - 12), a = 0.5 + 0.5 * Math.sin(time * 1.5 + i); if (a > 0.6) g.fillRect(Math.round(x), Math.round(y), 1, 1); } } // the water has its own lights at night
    // the ledge and the pilgrim
    g.fillStyle = '#2e2836'; g.beginPath(); g.moveTo(0, L.ry - 6); g.lineTo(L.rx - 6, L.ry + 4); g.lineTo(L.rx + 8, LH); g.lineTo(0, LH); g.fill();
    g.fillStyle = '#463e50'; g.fillRect(0, L.ry - 6, L.rx - 4, 2);
    const x = L.px, y = L.ry - 6, bob = Math.sin(time * 1.6) * 0.6;
    g.fillStyle = '#17131c'; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 4, y - 24 + bob); g.lineTo(x + 4, y - 24 + bob); g.lineTo(x + 10, y); g.fill(); // cloak
    g.fillStyle = '#2a2430'; g.beginPath(); g.arc(x, y - 27 + bob, 5, 0, 7); g.fill(); g.fillStyle = '#0a080d'; g.beginPath(); g.arc(x + 1, y - 27 + bob, 3, 0, 7); g.fill();
    g.strokeStyle = '#6a5438'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 5, y - 14); g.lineTo(L.rx, L.ry - 14); g.stroke(); // the rod
    const lx = x - 12, ly = y - 8; gr = g.createRadialGradient(lx, ly, 1, lx, ly, 46 + 10 * (1 - per.light)); gr.addColorStop(0, 'rgba(255,190,100,0.38)'); gr.addColorStop(1, 'rgba(255,190,100,0)'); g.fillStyle = gr; g.fillRect(lx - 60, ly - 60, 120, 120);
    g.fillStyle = '#ffd890'; g.fillRect(lx - 1, ly - 2, 3, 4);
    return L;
  }
  // a creature, from a chain of segments from its head; pose: 'swim' | 'rear' | 'slump'
  function creature(id, hx, hy, sc, ang, time, pose, extra) {
    const c = CR[id], K = c.look, n = Math.max(6, Math.round(K.len / 4)), seg = K.len / n * sc, pts = [], wave = pose === 'swim' ? 1 : pose === 'rear' ? 0.6 : 0.2;
    let a = ang, px = hx, py = hy;
    for (let i = 0; i < n; i++) { pts.push([px, py]); a += (pose === 'rear' ? 0.18 : pose === 'slump' ? 0.05 : 0) + Math.sin(time * 5 - i * 0.7) * 0.18 * wave; px -= Math.cos(a) * seg; py -= Math.sin(a) * seg; }
    g.save(); g.lineCap = 'round';
    for (let i = n - 1; i >= 0; i--) {
      const taper = Math.sin(Math.PI * (0.25 + 0.75 * (1 - i / n))) , w = Math.max(1, K.w * sc * (0.35 + 0.65 * taper) * (i < 2 ? 0.8 : 1)) ;
      if (K.bones) { g.fillStyle = i % 2 ? K.belly : K.color; g.fillRect(Math.round(pts[i][0] - w / 2), Math.round(pts[i][1] - w / 2), Math.max(2, Math.round(w)), Math.max(2, Math.round(w * 0.7))); g.fillStyle = K.belly; if (i % 2 === 0 && i > 1) { g.fillRect(Math.round(pts[i][0] - w * 0.9), Math.round(pts[i][1] - 0.5), Math.round(w * 1.8), 1); } }
      else { g.fillStyle = i % 3 === 0 ? K.belly : K.color; g.beginPath(); g.ellipse(pts[i][0], pts[i][1], w * 0.85, w * 0.62, a, 0, 7); g.fill(); }
      if (K.spikes && i > 1 && i % Math.ceil(n / K.spikes) === 0) { g.fillStyle = K.belly; g.beginPath(); g.moveTo(pts[i][0], pts[i][1] - w * 0.5); g.lineTo(pts[i][0] - 2 * sc, pts[i][1] - w * 0.5 - 4 * sc); g.lineTo(pts[i][0] + 2 * sc, pts[i][1] - w * 0.5); g.fill(); }
    }
    const [hx2, hy2] = pts[0], hw = K.w * sc;
    if (K.glow) { const gr = g.createRadialGradient(hx2 + Math.cos(ang) * hw * 1.4, hy2 - hw * 1.2, 1, hx2, hy2 - hw, hw * 3); gr.addColorStop(0, K.glow + 'cc'); gr.addColorStop(1, K.glow + '00'); g.fillStyle = gr; g.fillRect(hx2 - hw * 3, hy2 - hw * 4, hw * 6, hw * 6); }
    g.fillStyle = '#e8e2d0'; for (let t = 0; t < Math.min(K.teeth, 10); t++) { const u = (t / Math.max(1, Math.min(K.teeth, 10) - 1) - 0.5) * hw * 1.1; g.fillRect(Math.round(hx2 + Math.cos(ang) * hw * 0.9 + u * -Math.sin(ang)), Math.round(hy2 + Math.sin(ang) * hw * 0.9 + u * Math.cos(ang)), Math.max(1, Math.round(sc)), Math.max(1, Math.round(2 * sc))); }
    for (let e = 0; e < K.eyes; e++) { const ex = hx2 + Math.cos(ang - 0.5 + e) * hw * 0.5, ey = hy2 + Math.sin(ang - 0.5 + e) * hw * 0.5 - hw * 0.3; g.fillStyle = K.glow || '#f0e8c0'; g.fillRect(Math.round(ex), Math.round(ey), Math.max(2, Math.round(2 * sc)), Math.max(2, Math.round(2 * sc))); g.fillStyle = '#0a0a10'; g.fillRect(Math.round(ex + sc * 0.5), Math.round(ey + sc * 0.5), 1, 1); }
    g.strokeStyle = (K.glow || K.belly) + '99'; g.lineWidth = Math.max(1, sc * 0.6);
    for (let t = 0; t < K.tendrils; t++) { g.beginPath(); const bx = hx2 + (t - K.tendrils / 2) * hw * 0.25; g.moveTo(bx, hy2 + hw * 0.4); g.quadraticCurveTo(bx + Math.sin(time * 3 + t) * 5 * sc, hy2 + hw * 1.2, bx + Math.sin(time * 2 + t * 2) * 7 * sc, hy2 + hw * 2.2 + 3 * sc); g.stroke(); }
    g.restore();
    return { x: hx2, y: hy2 };
  }
  const bar0 = (x, y, w, h, v, col, back) => { g.fillStyle = back || 'rgba(255,255,255,0.12)'; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, v))), h); };
  const text = (s, x, y, size, col, align) => { g.font = `${Math.max(10, size)}px "IM Fell English SC", serif`; g.textAlign = align || 'left'; g.fillStyle = col || '#e6e1d5'; g.fillText(s, Math.round(x), Math.round(y)); };

  function draw(time) {
    const f = st.f, per = period(), L = scene(time, per), wy = L.wy, sh = st.shake > 0 ? (Math.random() - 0.5) * 4 * st.shake / 0.3 : 0;
    g.save(); g.translate(sh, sh * 0.5);
    const c = f.creature && CR[f.creature];
    // the line, the bobber, what is under it
    if (f.phase === 'waiting' || f.phase === 'bite' || f.phase === 'fight') {
      const b = bobberAt(L, f.dist), bite = f.phase === 'bite', dip = bite ? 3 + Math.sin(time * 30) * 1.5 : Math.sin(time * 2 + f.dist * 5) * 0.8;
      if (f.omen || bite) { const sz = F.shadow(f) * 26 + 6; g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(b.x, b.y + 8, sz, sz * 0.3, 0, 0, 7); g.fill(); if (bite) { g.strokeStyle = 'rgba(200,230,255,0.5)'; g.lineWidth = 1; for (let r = 0; r < 3; r++) { g.beginPath(); g.ellipse(b.x, b.y + 2, 6 + r * 6 + (time * 14) % 6, 2 + r * 2, 0, 0, 7); g.stroke(); } } }
      let tip = { x: L.rx, y: L.ry - 14 }, bx = b.x, by = b.y + dip;
      if (f.phase === 'fight') { const cp = creatureAt(L, f); bx = cp.x; by = cp.y; }
      g.strokeStyle = f.phase === 'fight' && f.tension > T.tension.danger ? '#ff6a5a' : 'rgba(230,225,210,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tip.x, tip.y);
      const sag = f.phase === 'fight' ? Math.max(0, 1 - f.tension * 2) * 14 : 8; g.quadraticCurveTo((tip.x + bx) / 2, Math.max(tip.y, by) + sag - 4, bx, by); g.stroke();
      if (f.phase !== 'fight') { g.fillStyle = bite ? '#ff7a50' : '#e8e2d0'; g.fillRect(Math.round(b.x - 1.5), Math.round(b.y + dip - 3), 3, 3); g.fillStyle = '#d8402a'; g.fillRect(Math.round(b.x - 1.5), Math.round(b.y + dip - 1), 3, 2); }
      if (f.phase === 'fight') { const cp = creatureAt(L, f), sc = 0.9 - f.dist * 0.45 + 0.35; creature(f.creature, cp.x, cp.y, sc * 1.5, Math.PI * 0.95 + Math.sin(time * 4) * 0.2, time, 'swim'); }
    }
    if (f.phase === 'combat') combatScene(L, f, c, time);
    g.restore();
    // darkness, by the bell
    const dark = 1 - per.light; if (dark > 0) { g.fillStyle = `rgba(2,2,10,${(dark * 0.45).toFixed(3)})`; g.fillRect(0, 0, LW, LH); }
    if (st.flash > 0) { g.fillStyle = `rgba(255,255,255,${st.flash})`; g.fillRect(0, 0, LW, LH); }
    const vg = g.createRadialGradient(LW / 2, LH / 2, Math.min(LW, LH) * 0.4, LW / 2, LH / 2, Math.max(LW, LH) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = vg; g.fillRect(0, 0, LW, LH);
    if (performance.now() / 1000 - st.hurtAt < 0.35 || (f.phase === 'combat' && time - st.hurtAt < 0.35)) { g.fillStyle = 'rgba(200,20,30,0.25)'; g.fillRect(0, 0, LW, LH); }
    hud(f, c, L, time);
  }
  const creatureAt = (L, f) => { const b = bobberAt(L, f.dist); return { x: b.x, y: b.y - 2 + Math.sin(performance.now() / 300) * 1.5 }; };

  function combatScene(L, f, c, time) {
    const k = f.combat, K = c.look, wind = k.ph === 'windup' ? 1 - k.t / (k.atk.windup * (c.flies ? T.flyWindup : 1)) : 0, base = { x: LW * 0.58, y: L.ry + 10 };
    if (c.flies) {
      const th = time * 1.1, orb = { x: LW * 0.58 + Math.cos(th) * LW * 0.24, y: LH * 0.3 + Math.sin(th * 1.7) * LH * 0.1 }, strike = { x: L.px + 36, y: L.ry - 22 };
      const q = k.ph === 'windup' ? Math.pow(wind, 2.2) : k.ph === 'recover' ? Math.max(0, k.t / T.recover) * 0.9 : 0, x = orb.x + (strike.x - orb.x) * q, y = orb.y + (strike.y - orb.y) * q;
      const vel = Math.atan2(Math.cos(th * 1.7) * LH * 0.1 * 1.7 * 1.1, -Math.sin(th) * LW * 0.24 * 1.1), toward = Math.atan2(strike.y - y, strike.x - x); // facing: where it is flying, then at you
      creature(f.creature, x, y, 2.8 - 0.8 * (1 - q), q > 0.15 ? toward : vel, time, k.ph === 'recover' ? 'slump' : 'swim');
      k.pos = { x, y }; bars(f, c, x, y - 26);
    } else {
      const pose = k.ph === 'windup' ? 'rear' : k.ph === 'recover' ? 'slump' : 'swim', lunge = k.ph === 'windup' ? wind * 18 : 0;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(base.x - lunge * 0.5, base.y + 16, 40 + lunge, 8, 0, 0, 7); g.fill();
      creature(f.creature, base.x - lunge, base.y - (pose === 'rear' ? 18 : 0) + (pose === 'slump' ? 8 : 0), 2.2, Math.PI * (pose === 'rear' ? 1.25 : 1) + Math.sin(time * 6) * 0.05, time, pose);
      k.pos = { x: base.x - lunge, y: base.y }; bars(f, c, base.x - lunge, base.y - 44);
    }
    if (f.brace > 0) { g.strokeStyle = 'rgba(160,240,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(L.px + 10, L.ry - 20, 20, -1.2, 1.2); g.stroke(); }
    if (k.ph === 'windup') { // what it is about to do, and the moment to answer it
      text(`It ${k.atk.name.replace(/ you$/, '')}…`, LW / 2, st.top + 56, 12, k.t < 0.35 ? '#ff8a6a' : '#e8c872', 'center');
      if (k.t < 0.4 && !f.brace) { g.strokeStyle = `rgba(255,120,90,${0.4 + 0.4 * Math.sin(time * 40)})`; g.lineWidth = 2; g.strokeRect(2, 2, LW - 4, LH - 4); }
    }
    if (k.ph === 'recover' && k.parried) text('Open!', k.pos.x, k.pos.y - 52, 12, '#a0f0b0', 'center');
  }
  function bars(f, c, x, y) { const k = f.combat; text(c.name, x, y - 5, 10, '#e6e1d5', 'center'); bar0(Math.round(x - 30), Math.round(y), 60, 4, k.hp / k.max, '#c0404a', 'rgba(255,255,255,0.15)'); }

  function hud(f, c, L, time) {
    const top = st.top, W = Math.min(150, LW * 0.4), X = LW - W - 10;
    // the line's strain, while it fights
    if (f.phase === 'fight') {
      const tz = T.tension, y = top + 6;
      text('STRAIN', X, y - 2, 10, '#c8c0b0'); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(X, y + 2, W, 7);
      g.fillStyle = 'rgba(100,200,120,0.5)'; g.fillRect(X + W * T.tire.band[0], y + 2, W * (T.tire.band[1] - T.tire.band[0]), 7); g.fillStyle = 'rgba(230,70,60,0.55)'; g.fillRect(X + W * tz.danger, y + 2, W * (1 - tz.danger), 7); g.fillStyle = 'rgba(120,150,230,0.4)'; g.fillRect(X, y + 2, W * tz.slack, 7);
      g.fillStyle = '#fff'; g.fillRect(Math.round(X + W * Math.min(1, f.tension) - 1), y, 3, 11);
      text('LINE', X, y + 22, 10, '#c8c0b0'); bar0(X + 36, y + 15, W - 36, 5, f.line.hp / f.line.max, f.line.hp / f.line.max < 0.35 ? '#e0504a' : '#d8d0b8');
      text('TIRES', X, y + 35, 10, '#c8c0b0'); bar0(X + 46, y + 28, W - 46, 5, 1 - f.stamina / c.stamina, '#c0a0e0');
      text('NEARER', X, y + 48, 10, '#c8c0b0'); bar0(X + 46, y + 41, W - 46, 5, 1 - Math.min(1, f.dist), '#8fb8e8');
      if (f.m && f.m.kind) text(({ thrash: 'It thrashes: ease off', dive: 'It dives: let it run', gnaw: 'It gnaws the line: keep reeling' })[f.m.kind], LW / 2, top + 52, 11, '#ff9a6a', 'center');
      if (f.tension < T.tension.slack * 1.5) text('slack: reel!', LW / 2, top + 66, 9, '#9ab8f0', 'center');
    }
    if (f.phase === 'idle' && st.charging || (f.phase === 'idle' && st.charge > 0 && st.charging)) { const x = L.rx + 10, y = L.ry - 36; bar0(x, y, 60, 5, st.charge, '#e8c872'); text('CAST', x, y - 3, 10, '#c8c0b0'); }
    if (f.phase === 'idle') text(`${period().name}. ${st.bait ? ING[st.bait].name + ' on the hook.' : 'No bait.'}`, LW / 2, st.ui - 28, 10, 'rgba(230,225,210,0.7)', 'center');
    if (f.phase === 'waiting') text(f.omen ? 'Something is under the bobber…' : 'Waiting…', LW / 2, st.ui - 8, 11, f.omen ? '#e8a070' : 'rgba(230,225,210,0.6)', 'center');
    if (f.phase === 'bite') text('NOW!', LW / 2, top + 40, 18, '#ff8a5a', 'center');
    if (f.phase === 'result') result(f);
    // the last thing that happened
    const ev = f.events[f.events.length - 1]; if (ev && f.t - ev.t < 4 && f.phase !== 'result' && !(f.phase === 'combat' && f.combat.ph === 'windup')) text(ev.text, LW / 2, st.ui - 22, 10, ev.kind === 'bad' ? '#f09a8a' : ev.kind === 'good' ? '#a0f0b0' : ev.kind === 'warn' ? '#e8c872' : '#e6e1d5', 'center');
  }
  function result(f) {
    const r = f.result, c = CR[r.creature], cx = LW / 2, cy = LH * 0.42;
    g.fillStyle = 'rgba(6,5,10,0.82)'; g.fillRect(cx - 120, cy - 52, 240, 104); g.strokeStyle = 'rgba(232,200,114,0.5)'; g.strokeRect(cx - 120.5, cy - 52.5, 241, 105);
    if (r.kind === 'caught') {
      text(`${c.name} slain`, cx, cy - 32, 14, '#e8c872', 'center'); text(r.items.map(i => `${i.n} × ${ING[i.id].name}`).join(', ') + ' taken', cx, cy - 14, 10, '#a0f0b0', 'center');
      text(c.note.length > 60 ? c.note.slice(0, 57) + '…' : c.note, cx, cy + 8, 10, 'rgba(230,225,210,0.75)', 'center'); text(r.hurt ? `It hurt you ${r.hurt} time${r.hurt > 1 ? 's' : ''}.` : 'It never touched you.', cx, cy + 22, 8, 'rgba(230,225,210,0.6)', 'center');
    } else {
      const why = { snapped: 'The line snapped.', spat: 'It spat the hook.', fled: 'You cut loose and backed off.', collapsed: 'You went down. The water took it.' }[r.kind === 'lost' ? r.why : r.kind];
      text(why, cx, cy - 20, 14, '#f09a8a', 'center'); text(c ? `It was a ${c.name}.` : '', cx, cy, 10, 'rgba(230,225,210,0.7)', 'center'); text('Nothing to show for it.', cx, cy + 18, 9, 'rgba(230,225,210,0.5)', 'center');
    }
  }

  root.Fishing = { open, leave, state, hourNow };
})(typeof window !== 'undefined' ? window : globalThis);
