// Camp: the fire and cooking screen. A fixed first-person view down at a fire pit on the cavern floor.
// The scene is the pit, the vessels and the fire; what you can use is a tray of buttons along the bottom (fire kit,
// a Blow button, vessels, the larder drawer, foraging), and a gauge shows how the fire is doing. Pick a button and
// tap the floor (or a vessel) to use it, or drag it straight there. Your hands take what you eat; the five charms
// show how you are. Touch anything in the scene for a note about it.
(function (root) {
  const S = root.CampSim, FIRE = root.CAMP_FIRE, STRIKER = root.CAMP_STRIKER, VES = root.CAMP_VESSELS, ING = root.CAMP_INGREDIENTS, STATS = root.CAMP_STATS;
  const PIT = S.CAMP_PIT, H_CAM = 1.3;
  let el = null, cv, g, LW = 480, LH = 270, H0, F, CX, st = null, raf = 0, last = 0, floorImg = null, sprites = {}, onLeave = null;

  // ---------- projection: floor (x, z) in metres to the low-resolution screen ----------
  const sy = z => H0 + F * H_CAM / z, sx = (x, z) => CX + F * x / z, sc = z => F / z;
  const toFloor = (px, py) => { if (py <= H0 + 2) return null; const z = F * H_CAM / (py - H0); return { x: (px - CX) * z / F, z }; };

  // ---------- sprites: 8x8 art from the data, drawn once ----------
  function sprite(key, art) {
    if (sprites[key]) return sprites[key];
    const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
    art.px.forEach((row, y) => [...row].forEach((ch, i) => { if (art.pal[ch]) { x.fillStyle = art.pal[ch]; x.fillRect(i, y, 1, 1); } }));
    return (sprites[key] = c);
  }
  // a tinted copy (cooking browns things; burning blackens them; flames redden)
  function tinted(key, art, color, amount) {
    const k = key + '|' + color + '|' + Math.round(amount * 8);
    if (sprites[k]) return sprites[k];
    const base = sprite(key, art), c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
    x.drawImage(base, 0, 0); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = Math.round(amount * 8) / 8; x.fillStyle = color; x.fillRect(0, 0, 8, 8);
    return (sprites[k] = c);
  }

  // ---------- the cave floor, drawn once per size: flagstones in perspective, darker with distance ----------
  function buildFloor() {
    floorImg = document.createElement('canvas'); floorImg.width = LW; floorImg.height = LH;
    const x = floorImg.getContext('2d'), img = x.createImageData(LW, LH), d = img.data;
    const hash = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    for (let py = 0; py < LH; py++) for (let px = 0; px < LW; px++) {
      const o = (py * LW + px) * 4;
      if (py <= H0 + 1) { const t = py / (H0 + 1); d[o] = 10 + 6 * t; d[o + 1] = 9 + 5 * t; d[o + 2] = 14 + 6 * t; d[o + 3] = 255; continue; }
      const f = toFloor(px + 0.5, py + 0.5), u = f.x / 0.32, v = f.z / 0.32, row = Math.floor(v), cu = Math.floor(u + (row & 1) * 0.5);
      const fu = u + (row & 1) * 0.5 - cu, fv = v - row, grout = fu < 0.05 || fv < 0.06;
      const n = hash(cu, row), speck = hash(px * 7 + 1, py * 13 + 2) < 0.05;
      let r = 46 + n * 16, gg = 42 + n * 12, b = 52 + n * 14;
      if (grout) { r *= 0.55; gg *= 0.55; b *= 0.6; }
      if (speck) { r += 10; gg += 9; b += 12; }
      const fade = Math.max(0.12, Math.min(1, 1.6 / f.z));
      d[o] = r * fade; d[o + 1] = gg * fade; d[o + 2] = b * fade; d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // the cave wall along the top of the view, ragged
    x.fillStyle = '#0b0a10';
    for (let k = 0; k < LW; k += 4) { const h = 10 + 9 * Math.abs(Math.sin(k * 0.061) + 0.6 * Math.sin(k * 0.21)); x.fillRect(k, 0, 4, h); }
  }
  const TUNNEL = () => ({ x: Math.round(LW * 0.5 - 13), y: 2, w: 26, h: 22 }); // the way back, in the wall

  // ---------- layout in screen space: hands, charms, sack ----------
  const KIT = ['tinder', 'kindling', 'fuel', 'striker'], VESK = ['pot', 'pan', 'skewer'];
  const LARDER = Object.keys(ING);
  function layout() {
    const hands = { x: Math.round(LW / 2 - 30), y: LH - 26, w: 60, h: 26 };
    const charms = STATS.map((k, i) => ({ key: k, x: 6 + i * 13, y: 18 + (i % 2) * 10, w: 11, h: 22 }));
    const sackF = { x: 0.62, z: 1.62 };
    return { hands, charms, sackF };
  }
  const artOf = k => FIRE[k] || (k === 'striker' ? STRIKER : null) || VES[k] || ING[k];
  const NAMES = { tinder: 'Tinder', kindling: 'Kindling', fuel: 'Fuel', striker: 'Strike', pot: 'Pot', pan: 'Pan', skewer: 'Skewer' };

  // ---------- particles ----------
  const parts = [];
  // heat (flames: 0 a weak red lick .. 1.5 a white-hot tongue) and dark (smoke: 0 thin grey wisps .. 1 choking black)
  function emit(kind, x, z, h, n, heat, dark) {
    const q = heat === undefined ? 1 : heat;
    for (let k = 0; k < n && parts.length < 520; k++) parts.push({ kind, heat: q, dark: dark || 0, x: x + (Math.random() - 0.5) * 0.03 * (kind === 'flame' ? 0.6 + q * 0.6 : 1), z: z + (Math.random() - 0.5) * 0.02, h: h || 0, vx: (Math.random() - 0.5) * 0.02, vz: 0,
      vh: kind === 'flame' ? (0.1 + Math.random() * 0.1) * (0.6 + q * 0.8) : kind === 'spark' ? 0.4 + Math.random() * 0.5 : kind === 'smoke' ? (0.06 + Math.random() * 0.05) * (1 - 0.3 * (dark || 0)) : 0.08 + Math.random() * 0.06,
      life: 0, max: kind === 'flame' ? (0.25 + Math.random() * 0.25) * (0.7 + q * 0.5) : kind === 'spark' ? 0.5 : kind === 'bubble' ? 0.4 : 1.6 + Math.random() + (dark || 0) });
  }
  function stepParts(dt) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.life += dt; if (p.life > p.max) { parts.splice(k, 1); continue; }
      p.h += p.vh * dt; if (p.vz) p.z += p.vz * dt; p.x += p.vx * dt + (p.kind === 'smoke' || p.kind === 'steam' ? Math.sin(p.life * 3 + k) * 0.01 * dt : 0);
      if (p.kind === 'spark') p.vh -= 1.2 * dt;
    }
  }

  // ---------- state ----------
  const SAVE = 'undercroft-camp-v1';
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.stats) return s; } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ stats: st.c.stats, stock: st.c.stock })); } catch (e) { /* storage unavailable */ } }

  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'camp fire-screen'; el.hidden = true;
    const btn = (k, label, cls) => `<button type="button" class="cf-btn ${cls || ''}" data-k="${k}" aria-pressed="false"><canvas width="8" height="8" aria-hidden="true"></canvas><span class="nm">${label}</span><span class="ct"></span></button>`;
    el.innerHTML = `<section class="cf-gauge" aria-label="The fire">
        <div class="cf-head"><b class="cf-state">Empty pit</b><span class="cf-trend" aria-hidden="true"></span></div>
        <div class="cf-meter" role="meter" aria-label="Fire strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="cf-fill"></i><i class="cf-mark" style="left:30%"></i><i class="cf-mark" style="left:82%"></i></div>
        <div class="cf-scale" aria-hidden="true"><span>Snuffed</span><span>Steady</span><span>Roaring</span></div>
        <div class="cf-mini"><label>Air</label><div class="cf-bar air" role="meter" aria-label="Air" aria-valuemin="0" aria-valuemax="100"><i></i><b style="left:45%"></b><b style="left:65%"></b></div><span class="cf-airw"></span><label>Fuel</label><div class="cf-bar fuel" role="meter" aria-label="Fuel left" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="cf-time"></span></div>
        <div class="cf-signs"><span data-s="flame">Flame</span><span data-s="embers">Embers</span><span data-s="smoke">Smoke</span></div>
        <p class="cf-hint" aria-live="polite"></p>
      </section>
      <canvas class="scene" aria-label="The fire pit. Choose something from the tray, then tap the floor or a vessel to use it, or drag it there."></canvas>
      <div class="camp-note" hidden></div>
      <div class="cf-tip" hidden aria-live="polite"></div>
      <div class="cf-dock">
      <div class="cf-ctx" hidden></div>
      <div class="cf-larder" hidden role="group" aria-label="Larder">${LARDER.map(k => btn(k, ING[k].name, 'ing')).join('')}</div>
      </div>
      <nav class="cf-tray" aria-label="Camp kit">
        <div class="cf-group" role="group" aria-label="Fire">${KIT.map(k => btn(k, NAMES[k])).join('')}</div>
        <button type="button" class="cf-blow" aria-label="Blow on the fire"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Blow</span></button>
        <div class="cf-group" role="group" aria-label="Vessels">${VESK.map(k => btn(k, NAMES[k])).join('')}</div>
        <div class="cf-group" role="group" aria-label="Supplies">
          <button type="button" class="cf-btn cf-open" aria-expanded="false" aria-label="Larder: ingredients"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1.5 12h-13zM8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="nm">Larder</span></button>
          <button type="button" class="cf-btn cf-forage" aria-label="Forage in the sack (tiring)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10c0-3 3-5 6-5s6 2 6 5l2 9H4zM9 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="nm">Forage</span></button>
        </div>
      </nav>`;
    document.body.appendChild(el);
    cv = el.querySelector('canvas.scene'); g = cv.getContext('2d');
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => { const x = b.querySelector('canvas').getContext('2d'); x.drawImage(sprite(b.dataset.k, artOf(b.dataset.k)), 0, 0); });
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', moveP); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('pointerleave', () => { if (st) st.hover = null; });
    // tray buttons: tap to pick up (tap again to put down), or drag straight into the scene
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => {
      b.addEventListener('pointerdown', e => { if (e.button) return; drag = { from: 'slot', key: b.dataset.k, start: { cx: e.clientX, cy: e.clientY }, p: P(e), moved: false, btn: true }; });
      b.addEventListener('click', e => { if (e.detail === 0) select(b.dataset.k); }); // keyboard
    });
    window.addEventListener('pointermove', e => {
      if (!drag || !drag.btn) return; drag.p = P(e);
      if (Math.hypot(e.clientX - drag.start.cx, e.clientY - drag.start.cy) > 8) drag.moved = true;
    });
    window.addEventListener('pointerup', e => {
      if (!drag || !drag.btn) return; const d = drag; drag = null;
      if (!d.moved) return select(d.key);
      // on touch the release is reported to the button the drag began on, so go by where the finger is
      const r = cv.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) dropSlot(d.key, P(e));
    });
    el.querySelector('.cf-blow').addEventListener('click', blow);
    el.querySelector('.cf-open').addEventListener('click', () => larder());
    el.querySelector('.cf-forage').addEventListener('click', forage);
    el.querySelector('.cf-ctx').addEventListener('click', ctxAction);
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    // the scene band changes size when the larder or a vessel panel opens: re-render it at its new size
    let seen = '';
    if (window.ResizeObserver) new ResizeObserver(() => { const r = cv.getBoundingClientRect(), k = Math.round(r.width) + 'x' + Math.round(r.height); if (!el.hidden && st && k !== seen) { seen = k; size(); } }).observe(cv);
    window.addEventListener('keydown', e => {
      if (el.hidden) return;
      if (e.key === 'Escape') { if (st.sel || st.vsel) { select(null); st.vsel = null; ctx(); } else if (!el.querySelector('.cf-larder').hidden) larder(false); else leave(); }
      if ((e.key === 'b' || e.key === ' ') && !e.repeat && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); blow(); }
    });
  }
  function size() {
    // the bands (status, scene, dock, tray) are laid out by CSS; the scene renders at whatever size it is given
    const r = cv.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    // a low-resolution scene at the band's own aspect (never stretched): about 270 rows, at most 760 columns
    LH = 270; LW = Math.round(LH * aspect);
    if (LW > 760) { LW = 760; LH = Math.max(90, Math.round(LW / aspect)); }
    if (aspect < 1) { LW = 360; LH = Math.round(LW / aspect); } // portrait: taller scene, same width
    cv.width = LW; cv.height = LH; g.imageSmoothingEnabled = false;
    // looking down at the pit: the horizon sits above the frame, the pit a little below the middle
    H0 = -Math.round(LH * 0.6); F = (LH * 0.55 - H0) * PIT.z / H_CAM; CX = LW / 2;
    buildFloor(); st.L = layout();
  }
  // the camp's state exists whether or not the camp is open: the body screen reads and drains the same stats
  function ensure() {
    if (!st) {
      const c = S.createCamp(1), saved = load();
      if (saved) { Object.assign(c.stats, saved.stats); Object.assign(c.stock, saved.stock); }
      c.unlimitedFire = true; // prototype: tinder, kindling and fuel never run out
      st = { c, L: null, saveAt: 0, sel: null, vsel: null, hover: null, uiAt: 0, flash: 0 };
    }
    return st.c;
  }
  function open(leaveFn) {
    ui(); onLeave = leaveFn; ensure();
    el.hidden = false; document.documentElement.classList.add('xp-open');
    size(); refresh(true);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  function leave(silent) { // silent: another screen is taking over, so don't hand back to the world
    el.hidden = true; cancelAnimationFrame(raf); raf = 0; if (st) save();
    if (onLeave && silent !== true) onLeave();
  }

  // ---------- notes: scraps of paper, the only words in the scene ----------
  let noteTimer = null;
  function note(text, x, y, ms) {
    const n = el.querySelector('.camp-note'), r = cv.getBoundingClientRect();
    n.textContent = text; n.hidden = false;
    const px = r.left + x / LW * r.width, py = r.top + y / LH * r.height;
    n.style.left = Math.max(8, Math.min(r.width - 230, px - 110)) + 'px'; n.style.top = Math.max(8, Math.min(r.height - 90, py - 70)) + 'px';
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.hidden = true; }, ms || 2600);
  }
  const words = {
    health: v => v > 80 ? 'Whole.' : v > 55 ? 'Bruised, steady.' : v > 30 ? 'Hurt.' : v > 10 ? 'Bleeding.' : 'Dying.',
    soul: v => v > 80 ? 'Bright.' : v > 55 ? 'Holding.' : v > 30 ? 'Thinning.' : v > 10 ? 'Guttering.' : 'Almost out.',
    hunger: v => v < 20 ? 'Full.' : v < 45 ? 'Fed.' : v < 70 ? 'Hungry.' : v < 88 ? 'Starving.' : 'Eating itself.',
    thirst: v => v < 20 ? 'Slaked.' : v < 45 ? 'Fine.' : v < 70 ? 'Thirsty.' : v < 88 ? 'Parched.' : 'Cracking.',
    exhaustion: v => v < 20 ? 'Rested.' : v < 45 ? 'Tired.' : v < 70 ? 'Worn.' : v < 88 ? 'Spent.' : 'Falling.',
  };
  const CHARM_NAME = { health: 'Blood vial', soul: 'Soul lantern', hunger: 'Bowl', thirst: 'Waterskin', exhaustion: 'Candle stub' };
  function vesselNote(v) {
    const j = S.judge(v);
    if (j.state === 'empty') return `${VES[v.type].name}. Empty. ${VES[v.type].note}`;
    const state = it => it.scorch >= 0.35 ? 'burnt' : it.progress >= 1 ? 'done' : it.progress >= 0.5 ? 'nearly' : it.progress > 0.05 ? 'warming' : 'raw';
    const water = v.type === 'pot' ? (v.water > 0.5 ? ' Water at a ' + (v.T >= 99 ? 'boil.' : 'simmer.') : v.water > 0 ? ' The water is nearly gone.' : ' It is dry.') : '';
    return v.items.map(it => `${ING[it.id].name}: ${state(it)}`).join(', ') + '.' + water + (j.dish ? ` It has become ${j.dish.name}.` : j.possible ? ` Could be ${j.possible.name}.` : '');
  }

  // ---------- input: pick from the tray and tap the scene, or drag; move things on the floor; draw food to your hands ----------
  let drag = null;
  const P = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH }; };
  const inBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  const overTray = e => e.clientY >= cv.getBoundingClientRect().bottom; // anywhere below the scene: the dock or the tray
  function hitPlaced(p) {
    // nearest first: vessels, then pieces
    const vs = st.c.vessels.slice().sort((a, b) => a.z - b.z);
    for (const v of vs) if (v.box && inBox(p, v.box)) return { type: 'vessel', obj: v };
    // pieces: the nearest one within a finger's reach of the point (they are small, and often close together)
    let best = null, bd = 1e9;
    st.c.pieces.forEach(q => { if (!q.box) return; const cx = q.box.x + q.box.w / 2, cy = q.box.y + q.box.h / 2, d = Math.hypot(p.x - cx, p.y - cy), reach = Math.max(8, q.box.w * 0.7); if (d < reach && d < bd) { bd = d; best = q; } });
    return best ? { type: 'piece', obj: best } : null;
  }
  // the item in hand: what a tap on the scene will do
  function select(k) {
    const c = st.c;
    if (k && k === st.sel) k = null;
    if (k && VES[k] && c.vessels.some(v => v.type === k)) { const v = c.vessels.find(q => q.type === k); st.vsel = v.id; k = null; } // already out: select it instead
    st.sel = k;
    refresh(true); ctx();
  }
  function down(e) {
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
    const p = P(e), hit = hitPlaced(p);
    if (hit) { // press and move to rearrange it; a press without moving is a tap (and uses whatever is in hand)
      const f = toFloor(p.x, p.y + 3);
      drag = { from: hit.type, obj: hit.obj, p, start: p, moved: false, gx: f ? hit.obj.x - f.x : 0, gz: f ? hit.obj.z - f.z : 0 };
      return;
    }
    drag = { from: 'tap', p, start: p, moved: false };
  }
  function moveP(e) {
    const p = P(e); st.hover = p;
    if (!drag || drag.btn) return;
    drag.p = p;
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 3) drag.moved = true;
    // the piece stays where you took hold of it, under your finger
    if ((drag.from === 'vessel' || drag.from === 'piece') && drag.moved) { const f = toFloor(p.x, p.y + 3); if (f && f.z < 4.5) { drag.obj.x = f.x + drag.gx; drag.obj.z = Math.max(1.2, f.z + drag.gz); } }
  }
  const onFloorAt = p => { const f = toFloor(p.x, p.y + 3); return f && f.z < 4.5 && !inBox(p, st.L.hands) ? f : null; };
  // use an item at a point in the scene (a drop from the tray, or a tap with it in hand)
  function dropSlot(k, p) {
    const c = st.c, f = onFloorAt(p);
    if (FIRE[k]) { if (!f) return; if (!c.unlimitedFire && c.stock[k] <= 0) { note(`No ${FIRE[k].name.toLowerCase()} left. Forage in the sack for more.`, p.x, p.y); return select(null); } S.placePiece(c, k, f.x, f.z); refresh(true); return; }
    if (k === 'striker') { if (!f) return; const n = S.strike(c, f.x, f.z); emit('spark', f.x, f.z, 0.03, 14); return; }
    if (VES[k]) { if (!f) return; const v = S.placeVessel(c, k, f.x, f.z); if (!v) note(`The ${VES[k].name.toLowerCase()} is already out.`, p.x, p.y); else { st.vsel = v.id; select(null); } refresh(true); return; }
    if (ING[k]) {
      const hit = hitPlaced(p);
      if (hit && hit.type === 'vessel') {
        const v = hit.obj, I = ING[k];
        if (c.stock[k] <= 0) { note(`No ${I.name} left.`, p.x, p.y); return select(null); }
        if (I.only && !I.only.includes(v.type)) return note(`${I.name} only goes in the pot.`, p.x, p.y);
        if (!S.addToVessel(c, v.id, k)) return note(`The ${VES[v.type].name.toLowerCase()} is full.`, p.x, p.y);
        st.vsel = v.id; refresh(true); ctx(); return;
      }
      return;
    }
  }
  function up(e) {
    if (!drag || drag.btn) return;
    const d = drag, p = P(e), L = st.L, c = st.c; drag = null;
    if (!d.moved) return tap(d, p);
    if (d.from === 'piece') { if (overTray(e)) { S.removePiece(c, d.obj.id); refresh(true); } return; }
    if (d.from === 'vessel') {
      const v = d.obj;
      if (inBox(p, L.hands)) return eatFrom(v, p);
      if (overTray(e)) putAway(v, p);
    }
  }
  function eatFrom(v, p) {
    const L = st.L, r = S.eat(st.c, v.id);
    if (!r) return note('Nothing in it to eat.', p.x, p.y);
    const j = r.judged, how = j.dish ? `${j.dish.name}. ${j.dish.note}` : j.state === 'raw' ? 'Raw. It fights you all the way down.' : j.state === 'underdone' ? 'Half-cooked. Something in it is still moving.' : j.state === 'burnt' ? 'Burnt to bitterness. It hurts going down.' : 'Cooked. Barely edible. It will keep you alive.';
    note(how, L.hands.x + 30, L.hands.y - 20, 4200); save(); ctx();
  }
  function putAway(v, p) {
    if (v.items.length) return note('Eat it or leave it on the floor; you cannot pack it full.', p.x, p.y);
    S.removeVessel(st.c, v.id); if (st.vsel === v.id) st.vsel = null; refresh(true); ctx();
  }
  function tap(d, p) {
    const L = st.L, c = st.c;
    if (st.sel && d.from === 'vessel' && !ING[st.sel] && !FIRE[st.sel] && st.sel !== 'striker') { st.vsel = d.obj.id; select(null); return; }
    if (st.sel) {
      const hit = hitPlaced(p);
      if (!(ING[st.sel] || st.sel === 'striker') && hit && hit.type === 'vessel' && !FIRE[st.sel]) { st.vsel = hit.obj.id; select(null); return; }
      return dropSlot(st.sel, p);
    }
    if (d.from === 'vessel') { st.vsel = st.vsel === d.obj.id ? null : d.obj.id; ctx(); return; }
    if (d.from === 'piece') { const q = d.obj, k = FIRE[q.kind]; return note(`${k.name}: ${q.ash ? (q.ember > 20 ? 'embers, still glowing' : 'ash') : q.burning ? (q.air < 0.45 ? 'burning, choking for air' : 'burning') : q.out ? 'gone out, smouldering' : q.T > 60 ? 'hot' : 'cold'}.`, p.x, p.y); }
    const ch = L.charms.find(b => inBox(p, { x: b.x - 2, y: 0, w: b.w + 4, h: b.y + b.h + 4 }));
    if (ch) return note(`${CHARM_NAME[ch.key]}. ${words[ch.key](c.stats[ch.key])}`, p.x + 20, p.y + 30);
    if (st.sackBox && inBox(p, st.sackBox)) return forage();
    if (st.vsel) { st.vsel = null; ctx(); }
  }
  function forage() {
    const c = st.c, L = st.L, got = S.forage(c); emit('smoke', L.sackF.x, L.sackF.z, 0.02, 4);
    const counts = {}; got.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
    note(`You rummage in the sack: ${Object.entries(counts).map(([k, n]) => (ING[k] || FIRE[k] || { name: k }).name + (n > 1 ? ' ×' + n : '')).join(', ')}. It tires you.`, sx(L.sackF.x, L.sackF.z), sy(L.sackF.z) - 30, 4200);
    save(); refresh(true);
  }
  // a breath into the bed of the fire
  function blow() {
    const c = st.c; S.blow(c); st.flash = 1;
    const lit = c.pieces.filter(p => !p.ash || p.ember > 10);
    lit.forEach(p => { emit('spark', p.x, p.z, 0.01, p.ash ? 3 : 2); });
    for (let k = 0; k < 10; k++) parts.push({ kind: 'breath', x: PIT.x + (Math.random() - 0.5) * 0.3, z: PIT.z - 0.45 - Math.random() * 0.2, h: 0.02, vx: 0, vz: 0.6 + Math.random() * 0.3, vh: 0, life: 0, max: 0.6 });
    const b = el.querySelector('.cf-blow'); b.classList.remove('puff'); void b.offsetWidth; b.classList.add('puff');
  }
  function larder(open) {
    const L = el.querySelector('.cf-larder'), b = el.querySelector('.cf-open');
    const show = open === undefined ? L.hidden : open; L.hidden = !show; b.setAttribute('aria-expanded', String(show)); b.classList.toggle('on', show); el.classList.toggle('larder-open', show);
  }

  // ---------- the tray, the gauge and the vessel panel: plain readable UI over the scene ----------
  function refresh(now) {
    const c = st.c;
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => {
      const k = b.dataset.k, n = c.stock[k], out = VES[k] && c.vessels.some(v => v.type === k);
      const inf = c.unlimitedFire && FIRE[k];
      b.querySelector('.ct').textContent = inf ? '∞' : n === undefined ? (out ? 'out' : '') : String(n);
      b.classList.toggle('empty', !inf && n === 0); b.classList.toggle('out', !!out);
      const on = st.sel === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      b.title = artOf(k).name + (n !== undefined ? ` (${n} left)` : '') + '. ' + (artOf(k).note || '');
    });
    cv.style.cursor = st.sel ? 'crosshair' : '';
  }
  const pct = v => Math.round(Math.max(0, Math.min(1, v)) * 100);
  function fireColor(s, air) { // dull red when weak, orange, then yellow-white when roaring; browner when choking
    const stops = [[0, [90, 30, 20]], [0.3, [200, 70, 25]], [0.6, [255, 140, 40]], [0.85, [255, 210, 90]], [1, [255, 248, 220]]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i++) if (s <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
    const t = (s - a[0]) / Math.max(1e-6, b[0] - a[0]), m = Math.max(0.55, Math.min(1, air / 0.6));
    return a[1].map((v, i) => Math.round((v + (b[1][i] - v) * t) * (i === 2 ? m : 1) * (0.75 + 0.25 * m)));
  }
  function gauge(fs) {
    const G = el.querySelector('.cf-gauge'), [r, gg, b] = fireColor(fs.strength, fs.air);
    G.querySelector('.cf-state').textContent = fs.state;
    G.querySelector('.cf-trend').textContent = fs.trend > 0 ? '▲ rising' : fs.trend < 0 ? '▼ falling' : '';
    G.querySelector('.cf-trend').className = 'cf-trend ' + (fs.trend > 0 ? 'up' : fs.trend < 0 ? 'down' : '');
    const m = G.querySelector('.cf-meter'); m.setAttribute('aria-valuenow', String(pct(fs.strength))); m.setAttribute('aria-valuetext', `${fs.state}, ${pct(fs.strength)}%`);
    const fill = G.querySelector('.cf-fill'); fill.style.width = pct(fs.strength) + '%';
    fill.style.background = `linear-gradient(90deg, rgb(${Math.round(r * 0.45)},${Math.round(gg * 0.35)},${Math.round(b * 0.3)}), rgb(${r},${gg},${b}))`;
    fill.style.boxShadow = fs.strength > 0.05 ? `0 0 ${Math.round(4 + 14 * fs.strength)}px rgba(${r},${gg},${b},${0.3 + 0.5 * fs.strength})` : 'none';
    const air = G.querySelector('.cf-bar.air'), fuel = G.querySelector('.cf-bar.fuel');
    const hot = fs.lit > 0 || fs.state === 'Smouldering', aw = !hot ? 'open' : fs.air < fs.chokeAt ? 'choking' : fs.air < fs.airFull ? 'short' : 'good';
    air.firstChild.style.width = pct(fs.air) + '%'; air.dataset.w = aw; air.setAttribute('aria-valuenow', String(pct(fs.air))); air.setAttribute('aria-valuetext', aw);
    G.querySelector('.cf-airw').textContent = { open: '', choking: 'choking', short: 'short', good: 'good' }[aw];
    G.querySelector('.cf-airw').dataset.w = aw;
    const bl = el.querySelector('.cf-blow'); bl.classList.toggle('want', !!fs.needsAir); bl.querySelector('span').textContent = fs.needsAir ? 'Blow!' : 'Blow';
    fuel.firstChild.style.width = pct(fs.fuel / 180) + '%'; fuel.classList.toggle('low', fs.lit > 0 && fs.fuel < 25); fuel.setAttribute('aria-valuenow', String(pct(fs.fuel / 180)));
    const t = Math.round(fs.fuel); G.querySelector('.cf-time').textContent = fs.fuel > 0.5 ? (t >= 60 ? `~${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s` : `~${t}s`) : '';
    G.querySelectorAll('.cf-signs span').forEach(sp => { const v = fs[sp.dataset.s]; sp.style.setProperty('--v', v.toFixed(2)); sp.classList.toggle('on', v > 0.05); });
    const h = G.querySelector('.cf-hint'); if (h.textContent !== fs.hint) h.textContent = fs.hint;
    G.dataset.state = fs.state.toLowerCase().replace(/ /g, '-');
  }
  // the selected vessel: what is in it, how hot, and what you can do with it
  const heatWord = T => T >= 99 ? (T > 160 ? 'searing' : 'boiling hot') : T > 68 ? 'cooking' : T > 40 ? 'warming' : 'cold';
  function ctx() {
    const box = el.querySelector('.cf-ctx'), v = st.vsel && st.c.vessels.find(q => q.id === st.vsel);
    if (!v) { st.vsel = null; box.hidden = true; box.dataset.key = ''; return; }
    box.hidden = false;
    const j = S.judge(v), V = VES[v.type];
    const stateOf = it => it.scorch >= 0.35 ? 'burnt' : it.progress >= 1 ? 'done' : it.progress >= 0.5 ? 'nearly' : it.progress > 0.05 ? 'cooking' : 'raw';
    const water = v.type === 'pot' ? (v.water > 0.5 ? 'water' : v.water > 0 ? 'water nearly gone' : 'dry') : '';
    const dish = j.dish ? `<span class="dish">${j.dish.name}</span>` : j.possible ? `<span class="dish maybe">could be ${j.possible.name}</span>` : '';
    // rebuild only when something you can read changes, so the buttons stay put under your finger
    const key = [v.id, water, dish, ...v.items.map(it => it.id + stateOf(it))].join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      const items = v.items.map(it => `<li class="${stateOf(it)}"><span>${ING[it.id].name}</span><i></i><em>${stateOf(it)}</em></li>`).join('');
      box.innerHTML = `<div class="hd"><b>${V.name}</b><span class="T"></span>${water ? `<span class="w">${water}</span>` : ''}${dish}</div>${items ? `<ul>${items}</ul>` : `<p>Empty. Open the larder, pick something, and tap the ${V.name.toLowerCase()}.</p>`}
        <div class="acts"><button type="button" data-a="eat" ${v.items.length ? '' : 'disabled'}>Eat</button><button type="button" data-a="away" ${v.items.length ? 'disabled' : ''}>Put away</button><button type="button" data-a="close" aria-label="Close">✕</button></div>`;
    }
    const T = box.querySelector('.T'); T.textContent = `${Math.round(v.T)}° · ${heatWord(v.T)}`; T.className = 'T ' + (v.T > V.burnAt ? 'hot' : v.T > 68 ? 'warm' : '');
    box.querySelectorAll('li i').forEach((i, n) => { const it = v.items[n]; if (it) { i.style.setProperty('--p', Math.min(1, it.progress).toFixed(3)); i.style.setProperty('--s', Math.min(1, it.scorch / 0.35).toFixed(3)); } });
  }
  function ctxAction(e) {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const v = st.c.vessels.find(q => q.id === st.vsel), p = { x: LW / 2, y: LH * 0.6 };
    if (a.dataset.a === 'close' || !v) { st.vsel = null; return ctx(); }
    if (a.dataset.a === 'eat') eatFrom(v, p);
    if (a.dataset.a === 'away') putAway(v, p);
  }

  // ---------- drawing ----------
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const c = st.c;
    S.step(c, dt);
    // flames, smoke, steam from the simulation
    const br = Math.min(1, c.breath || 0);
    c.pieces.forEach(q => {
      // flames: more, taller and whiter the harder a piece burns; small, low and red when it is starved of air
      const heat = q.burning ? Math.min(1.5, q.vigour * (q.air < 0.45 ? 0.6 : 1) * (1 + 0.5 * br) * (q.kind === 'fuel' ? 1.15 : 1)) : 0;
      if (q.burning && Math.random() < dt * (6 + 34 * heat)) emit('flame', q.x, q.z, 0.01, 1 + (heat > 0.9 && Math.random() < 0.5 ? 1 : 0), heat);
      if (q.smoke > 0.2 && Math.random() < dt * 7 * Math.min(1.4, q.smoke)) emit('smoke', q.x, q.z, 0.03, 1, 0, q.burning ? (q.air < 0.45 ? 0.8 : 0.2) : 0.6);
      if (q.ash && q.ember > 30 && Math.random() < dt * (1 + 6 * br) * Math.min(1, q.ember / 150)) emit('spark', q.x, q.z, 0.01, 1);
    });
    c.vessels.forEach(v => {
      if (v.T > 80 && Math.random() < dt * (v.T - 70) / 20) emit('steam', v.x, v.z, 0.12, 1);
      if (v.type === 'pot' && v.water > 0 && v.T >= 99 && Math.random() < dt * 10) emit('bubble', v.x + (Math.random() - 0.5) * 0.08, v.z, 0.1, 1);
      if (v.scorch > 0.1 && Math.random() < dt * 6) emit('smoke', v.x, v.z, 0.12, 1);
    });
    if (root.Body && Body.tick) Body.tick(dt); // what is eating you keeps eating while you cook
    stepParts(dt);
    st.flash = Math.max(0, st.flash - dt * 2);
    if (t - st.uiAt > 120) { st.uiAt = t; gauge(S.fireState(c)); if (st.vsel) ctx(); if (t - (st.trayAt || 0) > 600) { st.trayAt = t; refresh(); } }
    if (t - st.saveAt > 5000) { st.saveAt = t; save(); }
    draw(t / 1000);
  }
  function draw(time) {
    const c = st.c, L = st.L, out = S.fireOutput(c), fs = st.fs = S.fireState(c), br = Math.min(1, c.breath || 0);
    const flicker = fs.air < 0.45 && fs.lit ? 0.35 : 0.15, glow = Math.min(1, out / 1800) * (1 - flicker + flicker * Math.sin(time * 9) * Math.sin(time * 5.3)) * (1 + 0.25 * br);
    const [fr, fg, fb] = fireColor(fs.strength, fs.air);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.drawImage(floorImg, 0, 0);
    // the tunnel mouth far behind the fire: the way back, faintly lit by the pilgrims' lavender
    const tn = TUNNEL(); g.fillStyle = '#05040a'; g.beginPath(); g.ellipse(tn.x + tn.w / 2, tn.y + tn.h, tn.w / 2, tn.h, 0, Math.PI, 0); g.fill();
    g.globalAlpha = 0.25 + 0.1 * Math.sin(time * 1.3); g.fillStyle = '#b9b2d8'; g.fillRect(tn.x + tn.w / 2 - 1, tn.y + tn.h - 6, 2, 6); g.globalAlpha = 1;
    // firelight on the floor
    const px = sx(PIT.x, PIT.z), py = sy(PIT.z), R = sc(PIT.z) * (0.6 + 1.6 * glow);
    g.globalCompositeOperation = 'lighter';
    if (glow > 0.02) { const gr = g.createRadialGradient(px, py, 0, px, py, R * 2.2); gr.addColorStop(0, `rgba(${fr},${fg},${fb},${0.5 * glow})`); gr.addColorStop(1, `rgba(${fr},${Math.round(fg * 0.6)},${Math.round(fb * 0.5)},0)`); g.fillStyle = gr; g.fillRect(px - R * 2.2, py - R * 1.4, R * 4.4, R * 2.8); }
    g.globalCompositeOperation = 'source-over';
    // the pit: a ring of stones and a bed of old ash
    g.fillStyle = '#1a1716'; g.beginPath(); g.ellipse(px, py, sc(PIT.z) * PIT.r, sc(PIT.z) * PIT.r * (H_CAM / PIT.z) * 0.9, 0, 0, 7); g.fill();
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * 6.283, wx = PIT.x + Math.cos(a) * PIT.r, wz = PIT.z + Math.sin(a) * PIT.r * 0.95, s = sc(wz);
      g.fillStyle = k % 3 ? '#5a5650' : '#6e6a62'; g.fillRect(Math.round(sx(wx, wz) - s * 0.05), Math.round(sy(wz) - s * 0.05), Math.max(2, Math.round(s * 0.1)), Math.max(2, Math.round(s * 0.07)));
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(Math.round(sx(wx, wz) - s * 0.05), Math.round(sy(wz) + s * 0.015), Math.max(2, Math.round(s * 0.1)), 1);
    }
    // the sack beside the pit
    { const s = sc(L.sackF.z), x0 = sx(L.sackF.x, L.sackF.z), y0 = sy(L.sackF.z); const w = s * 0.2, h = s * 0.18;
      g.fillStyle = '#4a3a2a'; g.beginPath(); g.ellipse(x0, y0 - h * 0.45, w / 2, h / 2, 0, 0, 7); g.fill(); g.fillStyle = '#6a5438'; g.fillRect(x0 - w * 0.15, y0 - h * 0.95, w * 0.3, h * 0.2);
      st.sackBox = { x: x0 - w / 2, y: y0 - h, w, h }; }
    // things on the floor, far to near
    const things = [...c.pieces.map(q => ({ t: 'p', o: q })), ...c.vessels.map(v => ({ t: 'v', o: v }))].sort((a, b) => b.o.z - a.o.z);
    things.forEach(({ t, o }) => t === 'p' ? drawPiece(o, time) : drawVessel(o, time));
    // particles
    parts.forEach(p => {
      const x = sx(p.x, p.z), y = sy(p.z) - p.h * sc(p.z), a = 1 - p.life / p.max, s = Math.max(1, Math.round(sc(p.z) * 0.012));
      if (p.kind === 'flame') { // colour by how hard it burns: white-yellow cores in a strong fire, deep red licks in a weak one
        const q = p.heat, col = q > 1.2 ? (a > 0.6 ? '#fffbe8' : a > 0.3 ? '#ffe27a' : '#ff9a30') : q > 0.65 ? (a > 0.7 ? '#fff0a0' : a > 0.4 ? '#ffb040' : '#d84a20') : q > 0.35 ? (a > 0.6 ? '#ff9a3a' : a > 0.3 ? '#e0581e' : '#9a2a14') : (a > 0.5 ? '#d85020' : '#7a2010');
        const z = s + (q > 0.9 ? 1 : 0) + (a > 0.6 && q > 0.6 ? 1 : 0); g.fillStyle = col; g.globalAlpha = Math.min(1, a * 1.4); g.fillRect(Math.round(x), Math.round(y), z, z + (q > 0.8 ? 1 : 0)); }
      else if (p.kind === 'breath') { g.fillStyle = '#c8d0e0'; g.globalAlpha = a * 0.35; g.fillRect(Math.round(x), Math.round(y), 1, Math.max(2, s * 3)); }
      else if (p.kind === 'spark') { g.fillStyle = '#ffd060'; g.globalAlpha = a; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
      else if (p.kind === 'bubble') { g.fillStyle = '#c8d4e0'; g.globalAlpha = a * 0.8; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
      else if (p.kind === 'steam') { g.fillStyle = '#d8dce8'; g.globalAlpha = a * 0.35; const r = s + p.life * 3; g.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), Math.round(r), Math.round(r)); }
      else { const d = p.dark; g.fillStyle = d > 0.7 ? '#1a1820' : d > 0.4 ? '#2e2a34' : '#6a6672'; g.globalAlpha = a * (0.35 + 0.35 * d); const r = s + p.life * (3 + 3 * d); g.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), Math.round(r), Math.round(r)); }
    });
    g.globalAlpha = 1;
    // darkness beyond the firelight
    const dark = g.createRadialGradient(px, py - 10, 20 + 90 * glow, px, py, LW * 0.75);
    dark.addColorStop(0, 'rgba(4,3,8,0)'); dark.addColorStop(1, `rgba(4,3,8,${0.85 - 0.25 * glow})`);
    g.fillStyle = dark; g.fillRect(0, 0, LW, LH);
    // a breath: the whole bed brightens for a moment
    if (st.flash > 0 && (fs.lit || fs.embers > 0.02)) { g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(px, py, 0, px, py, sc(PIT.z) * 0.5); gr.addColorStop(0, `rgba(255,120,40,${0.35 * st.flash})`); gr.addColorStop(1, 'rgba(255,90,30,0)'); g.fillStyle = gr; g.fillRect(px - sc(PIT.z) * 0.5, py - sc(PIT.z) * 0.3, sc(PIT.z), sc(PIT.z) * 0.6); g.globalCompositeOperation = 'source-over'; }
    drawHands(); drawCharms(g, st.L.charms, c.stats, time);
    // the selected vessel
    const sv = st.vsel && c.vessels.find(v => v.id === st.vsel);
    if (sv && sv.box) { g.strokeStyle = `rgba(243,211,107,${0.6 + 0.3 * Math.sin(time * 5)})`; g.setLineDash([2, 2]); g.strokeRect(Math.round(sv.box.x) + 0.5, Math.round(sv.box.y) + 0.5, Math.round(sv.box.w), Math.round(sv.box.h)); g.setLineDash([]); }
    // what is in hand: dragged from the tray, or picked up and waiting for a tap
    const moving = drag && drag.from === 'piece' && drag.moved ? drag.obj : null;
    const k = drag && drag.from === 'slot' && drag.moved ? drag.key : moving ? moving.kind : st.sel, at = drag && drag.from === 'slot' && drag.moved ? drag.p : moving ? drag.p : st.hover;
    // each piece's air, as a ring on the floor around it: shown while you are laying the fire, or when it is short
    const placing = k && FIRE[k];
    c.pieces.forEach(q => {
      if (q.ash || q === moving || !(q.burning || q.out) || q.air === undefined) return;
      const bad = q.air < fs.chokeAt, short = q.air < fs.airFull;
      if (!placing && !short) return;
      ring(q.x, q.z, 0.06, bad ? `rgba(240,90,60,${0.55 + 0.35 * Math.sin(time * 8)})` : short ? 'rgba(240,180,70,0.6)' : 'rgba(127,176,216,0.4)');
    });
    let tip = '';
    if (k && at) {
      if (!moving) { g.globalAlpha = 0.9; g.drawImage(sprite(k, artOf(k)), Math.round(at.x - 8), Math.round(at.y - 18), 16, 16); g.globalAlpha = 1; }
      const f = moving ? { x: moving.x, z: moving.z } : onFloorAt(at); // a piece being moved is judged where it is
      if (f && FIRE[k]) { // what laying it here would do: will it catch, is it too far, will it smother the fire
        const pv = S.preview(moving ? { ...c, pieces: c.pieces.filter(q => q !== moving) } : c, k, f.x, f.z);
        let col, t;
        if (!pv.lit) { col = 'rgba(255,240,200,0.6)'; t = k === 'tinder' ? 'Lay it, then strike over it.' : 'Nothing is burning. Lay it close around tinder.'; tip = 'idle'; }
        else if (pv.smothers.length) { col = 'rgba(240,80,60,0.9)'; t = 'Too close: it will smother the flames.'; tip = 'bad'; pv.smothers.forEach(id => { const q = c.pieces.find(p => p.id === id); if (q) ring(q.x, q.z, 0.05, `rgba(240,80,60,${0.6 + 0.3 * Math.sin(time * 10)})`); }); }
        else if (!pv.warm) { col = 'rgba(150,150,170,0.7)'; t = 'Too far from the flames to catch.'; tip = 'far'; }
        else if (!pv.catches) { col = 'rgba(240,180,70,0.8)'; t = 'Warm here, but too far to catch yet.'; tip = 'far'; }
        else if (pv.air < 0.45) { col = 'rgba(240,80,60,0.9)'; t = 'Packed in too tight: it will choke.'; tip = 'bad'; }
        else if (pv.air < fs.airFull) { col = 'rgba(240,180,70,0.85)'; t = 'It will catch, but short of air.'; tip = 'ok'; }
        else { col = 'rgba(140,220,120,0.9)'; t = 'Good spot: it will catch and breathe.'; tip = 'good'; }
        ring(f.x, f.z, 0.06, col); ring(f.x, f.z, 0.075, col);
      } else if (f && (k === 'striker' || VES[k])) { const s = sc(f.z); g.strokeStyle = 'rgba(255,240,200,0.5)'; g.beginPath(); g.ellipse(sx(f.x, f.z), sy(f.z), s * (k === 'striker' ? 0.14 : 0.06), s * (k === 'striker' ? 0.06 : 0.025), 0, 0, 7); g.stroke(); }
      if (ING[k]) { const h = hitPlaced(at); if (h && h.type === 'vessel') { g.strokeStyle = 'rgba(243,211,107,0.8)'; g.strokeRect(Math.round(h.obj.box.x) + 0.5, Math.round(h.obj.box.y) + 0.5, Math.round(h.obj.box.w), Math.round(h.obj.box.h)); } }
    }
    if (!tip) showTip('');
  }
  // a ring on the floor of radius rad (m) around (x, z)
  function ring(x, z, rad, col) {
    const s = sc(z), rx = s * rad, ry = rx * (H_CAM / z) * 0.9;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.ellipse(Math.round(sx(x, z)) + 0.5, Math.round(sy(z)) + 0.5, rx, ry, 0, 0, 7); g.stroke();
  }
  // the placement verdict, beside the pointer
  function showTip(text, kind, at) {
    const t = el.querySelector('.cf-tip');
    if (!text) { if (!t.hidden) t.hidden = true; return; }
    if (t.textContent !== text) t.textContent = text;
    t.hidden = false; t.dataset.k = kind;
    const n = el.querySelector('.camp-note'); if (!n.hidden) { n.hidden = true; clearTimeout(noteTimer); } // the verdict says more than the instructions now
    const r = cv.getBoundingClientRect(), x = r.left + at.x / LW * r.width, y = r.top + at.y / LH * r.height;
    t.style.left = Math.max(6, Math.min(r.width - 200, x - 95)) + 'px'; t.style.top = Math.max(6, y - 74) + 'px';
  }
  function drawPiece(q, time) {
    const k = FIRE[q.kind], s = sc(q.z), size = (q.kind === 'fuel' ? 0.2 : q.kind === 'kindling' ? 0.15 : 0.08) * s, x = sx(q.x, q.z), y = sy(q.z);
    let img;
    if (q.ash) img = tinted(q.kind, k, '#6a6660', 0.85);
    else if (q.burning) img = tinted(q.kind, k, q.air < 0.45 ? '#a8381a' : q.vigour > 0.9 ? '#ffb040' : '#ff7a30', 0.35 + 0.15 * Math.sin(time * 11 + q.id));
    else if (q.out && q.T > k.ignite * 0.45) img = tinted(q.kind, k, '#5a2414', 0.5); // smouldering: dull, dark red
    else { const burnt = 1 - q.m / q.m0; img = burnt > 0.05 ? tinted(q.kind, k, '#14100e', Math.min(0.9, burnt * 1.2 + 0.2)) : sprite(q.kind, k); }
    const w = Math.max(3, Math.round(size)), h = q.ash ? Math.max(2, Math.round(w * 0.35)) : w;
    const lifted = drag && drag.from === 'piece' && drag.moved && drag.obj === q;
    if (lifted) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, y, w * 0.55, Math.max(1, w * 0.18), 0, 0, 7); g.fill(); }
    g.drawImage(img, Math.round(x - w / 2), Math.round(y - h + 1 - (lifted ? 3 : 0)), w, h);
    const br = Math.min(1, st.c.breath || 0);
    if (q.ash && q.ember > 12) { // an ember bed: a pulsing orange glow that a breath brightens
      const e = Math.min(1, q.ember / 180) * (0.75 + 0.25 * Math.sin(time * 2.3 + q.id * 1.7)) * (1 + 0.8 * br);
      g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(x, y - 1, 0, x, y - 1, w * 0.9); gr.addColorStop(0, `rgba(255,${Math.round(90 + 60 * Math.min(1, e))},30,${Math.min(0.9, 0.6 * e)})`); gr.addColorStop(1, 'rgba(200,50,20,0)'); g.fillStyle = gr; g.fillRect(x - w, y - w * 0.6, w * 2, w * 1.1); g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(255,${Math.round(120 + 80 * Math.min(1, e))},50,${Math.min(1, e)})`; for (let i = 0; i < 3; i++) g.fillRect(Math.round(x - w / 3 + i * w / 3 + Math.sin(i * 3 + q.id)), Math.round(y - 1 - (i % 2)), 1, 1);
    }
    if (q.burning) { g.globalCompositeOperation = 'lighter'; const v = Math.min(1.3, q.vigour); g.fillStyle = `rgba(255,${q.air < 0.45 ? 70 : 140},40,${0.18 * v})`; g.beginPath(); g.ellipse(x, y - h * 0.4, w * 0.8, h * 0.7, 0, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; }
    q.box = { x: x - w / 2 - 2, y: y - h - 2, w: w + 4, h: h + 6 };
  }
  // food changes as it cooks: raw colours, browning, then black
  function itemSprite(it) {
    const I = ING[it.id];
    if (it.scorch >= 0.2) return tinted(it.id, I, '#14100e', Math.min(0.9, 0.3 + it.scorch));
    if (it.progress > 0.05) return tinted(it.id, I, '#7a4a22', Math.min(0.6, it.progress * 0.5));
    return sprite(it.id, I);
  }
  function drawVessel(v, time) {
    const V = VES[v.type], s = sc(v.z), size = (v.type === 'pot' ? 0.2 : v.type === 'pan' ? 0.22 : 0.24) * s, x = sx(v.x, v.z), y = sy(v.z) - s * 0.04;
    const w = Math.round(size), h = Math.round(size * (v.type === 'skewer' ? 0.5 : 0.8));
    g.drawImage(sprite(v.type, V), Math.round(x - w / 2), Math.round(y - h), w, h);
    // contents
    const n = v.items.length, iw = Math.max(3, Math.round(w * 0.28));
    if (v.type === 'pot') {
      if (v.water > 0) { g.fillStyle = v.T >= 99 ? '#2a2a3c' : '#14141e'; g.fillRect(Math.round(x - w * 0.36), Math.round(y - h * 0.86), Math.round(w * 0.72), Math.max(1, Math.round(h * 0.12))); }
      v.items.filter(it => !ING[it.id].water).forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.3 + k * iw * 0.8 + Math.sin(time * 2 + k) * (v.T >= 99 ? 1 : 0)), Math.round(y - h * 0.98), iw, iw));
    } else if (v.type === 'pan') v.items.forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.36 + k * iw * 0.9), Math.round(y - h * 0.82), iw, iw));
    else v.items.forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.2 + k * iw * 1.1), Math.round(y - h * 0.9), iw, iw));
    v.box = { x: x - w / 2 - 2, y: y - h - iw / 2 - 2, w: w + 4, h: sy(v.z) + 8 - (y - h - iw / 2 - 2) }; // down to the floor it stands on
    if (v.items.length && S.judge(v).dish) { g.fillStyle = `rgba(243,211,107,${0.25 + 0.2 * Math.sin(time * 3)})`; g.fillRect(Math.round(x - 1), Math.round(y - h - iw), 2, 2); }
  }
  function drawHands() {
    const b = st.L.hands; g.fillStyle = '#b89a86';
    g.beginPath(); g.ellipse(b.x + 14, b.y + b.h, 16, 14, -0.3, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(b.x + b.w - 14, b.y + b.h, 16, 14, 0.3, Math.PI, 0); g.fill();
    g.fillStyle = '#8a6a5a'; for (let k = 0; k < 4; k++) { g.fillRect(b.x + 6 + k * 4, b.y + b.h - 13 + Math.abs(k - 1.5), 1, 5); g.fillRect(b.x + b.w - 18 + k * 4, b.y + b.h - 13 + Math.abs(k - 1.5), 1, 5); }
    if (drag && drag.from === 'vessel' && drag.moved) { g.strokeStyle = 'rgba(243,211,107,0.5)'; g.strokeRect(b.x, b.y, b.w, b.h); }
  }
  // the five charms: a blood vial, the soul lantern, a bowl, a waterskin and a candle stub, hung from a cord
  function drawCharms(gg, charms, stats, time) {
    const g = gg, L = { charms }, c = { stats };
    g.strokeStyle = '#4a4038'; g.beginPath(); g.moveTo(0, 6); L.charms.forEach(b => g.lineTo(b.x + b.w / 2, b.y - 2)); g.stroke();
    L.charms.forEach(b => {
      const v = c.stats[b.key], x = b.x, y = b.y, w = b.w, h = b.h, sway = Math.round(Math.sin(time * 1.1 + b.x) * 0.6);
      g.strokeStyle = '#4a4038'; g.beginPath(); g.moveTo(x + w / 2, y - 6); g.lineTo(x + w / 2 + sway, y); g.stroke();
      const X = x + sway;
      if (b.key === 'health') { g.fillStyle = '#2a2026'; g.fillRect(X + 2, y, w - 4, h); const f = Math.round((h - 2) * v / 100); g.fillStyle = '#a0182a'; g.fillRect(X + 3, y + h - 1 - f, w - 6, f); g.fillStyle = '#d8d0c0'; g.fillRect(X + 3, y - 2, w - 6, 2); }
      else if (b.key === 'soul') { g.fillStyle = '#3a3440'; g.fillRect(X + 1, y, w - 2, h - 4); g.fillStyle = '#14101c'; g.fillRect(X + 2, y + 2, w - 4, h - 8); const a = Math.max(0.05, v / 100) * (0.8 + 0.2 * Math.sin(time * 4)); g.fillStyle = `rgba(185,178,216,${a})`; const r = Math.max(1, Math.round((w - 6) * (0.4 + v / 160))); g.fillRect(Math.round(X + w / 2 - r / 2), Math.round(y + (h - 4) / 2 - r / 2), r, r); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(185,178,216,${a * 0.25})`; g.fillRect(X - 2, y - 2, w + 4, h); g.globalCompositeOperation = 'source-over'; }
      else if (b.key === 'hunger') { g.fillStyle = '#5a4a3a'; g.beginPath(); g.ellipse(X + w / 2, y + h - 6, w / 2, 5, 0, 0, Math.PI); g.fill(); const full = 1 - v / 100; g.fillStyle = '#8a6a3a'; g.fillRect(X + 2, Math.round(y + h - 6 - 4 * full), w - 4, Math.max(0, Math.round(4 * full))); }
      else if (b.key === 'thirst') { g.fillStyle = '#4a3a2a'; g.beginPath(); g.ellipse(X + w / 2, y + h / 2 + 2, w / 2, h / 2 - 2, 0, 0, 7); g.fill(); const full = 1 - v / 100; g.fillStyle = '#2d5f7a'; const fh = Math.round((h - 6) * full); g.fillRect(X + 2, y + h - 2 - fh, w - 4, fh); g.fillStyle = '#3a2a1a'; g.fillRect(X + w / 2 - 1, y, 2, 3); }
      else { const len = Math.round((h - 4) * (1 - v / 100)) + 2; g.fillStyle = '#d8ccb0'; g.fillRect(X + 3, y + h - len, w - 6, len); g.fillStyle = '#5a5048'; g.fillRect(X + 1, y + h, w - 2, 2); if (len > 3) { g.fillStyle = `rgba(255,${190 + 40 * Math.sin(time * 13)},90,0.9)`; g.fillRect(X + w / 2 - 1, y + h - len - 3, 2, 3); } }
    });
  }

  // where a floor point is on screen (for scripted checks and, later, aiming in 3D)
  const at = (x, z) => { const r = cv.getBoundingClientRect(); return { x: r.left + sx(x, z) / LW * r.width, y: r.top + (sy(z) - 3) / LH * r.height }; };
  root.Camp = { open, leave, at, state: () => st, shared: ensure, save: () => { if (st) save(); }, drawCharms };
})(window);
