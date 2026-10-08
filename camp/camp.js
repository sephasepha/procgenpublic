// Camp: the fire and cooking screen. A fixed first-person view down at a fire pit on the cavern floor.
// The scene is the pit, the vessels and the fire; what you can use is a tray of buttons along the bottom (fire kit,
// a Blow button, vessels, the larder drawer, foraging), and a gauge shows how the fire is doing. Pick a button and
// tap the floor (or a vessel) to use it, or drag it straight there. Drag a vessel to your hands to eat from it.
// Tending the fire and cooking are separate modes (the Fire and Cook tabs): the tray, the gauge and what the scene
// answers to change with the mode. Touching a vessel switches to cooking.
//
// This file opens and closes the screen, runs its loop, and turns input into actions on the camp. The rest:
//   camp/view.js     shared state, projection, sprites, layout, hit-testing
//   camp/draw.js     painting the scene
//   camp/panels.js   the gauge, vessel panel, tray, larder and notes
//   camp/sim.js      the simulation (fire.js, cooking.js), which knows nothing of the screen
(function (root) {
  const V = root.CampView, D = root.CampDraw, UI = root.CampPanels;
  const { S, FIRE, VES, ING, CHOKE, PIT } = V;
  let raf = 0, last = 0, onLeave = null;

  // ---------- experience: tending the fire earns firemaking, food cooking earns cooking ----------
  const XP = root.Skills ? Skills.XP : null, earn = (k, n) => { if (root.Skills) Skills.earn(k, n); };
  const caught = new Set(), coaled = new Set(); // pieces that have earned their catching, their coals
  // how far, all told, the food on the fire has cooked (each item up to done, and only while it is not burnt)
  const cookedSoFar = c => c.vessels.reduce((n, v) => n + v.items.reduce((m, it) => m + (ING[it.id].water || it.scorch >= V.COOK.burnt ? 0 : Math.min(1, it.progress)), 0), 0);
  // time passes at the camp, whichever screen is open: the fire burns, food cooks, and that earns experience
  function advance(dt) {
    const c = ensure(), before = cookedSoFar(c);
    S.step(c, dt);
    if (!XP) return;
    const cooked = cookedSoFar(c) - before; if (cooked > 0) earn('cooking', cooked * XP.cook);
    c.pieces.forEach(q => {
      if (q.burning && !caught.has(q.id)) { caught.add(q.id); earn('fire', XP.catch[q.kind] || 1); }
      if (q.coal && !coaled.has(q.id)) { coaled.add(q.id); earn('fire', XP.coals); }
    });
  }

  // ---------- saving: your stats and what you carry ----------
  const SAVE = 'undercroft-camp-v1';
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.stats) return s; } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ stats: V.st.c.stats, stock: V.st.c.stock, coin: V.st.c.coin || 0, goods: V.st.c.goods || [] })); } catch (e) { /* storage unavailable */ } }

  // ---------- the screen ----------
  function ui() {
    if (V.el) return;
    const el = V.el = document.createElement('div'); el.className = 'camp fire-screen'; el.hidden = true;
    el.innerHTML = UI.markup();
    document.body.appendChild(el);
    V.cv = el.querySelector('canvas.scene'); V.g = V.cv.getContext('2d');
    UI.paintIcons(el);
    wire(el, V.cv);
  }
  function size() {
    // the bands (status, scene, dock, tray) are laid out by CSS; the scene renders at whatever size it is given
    const cv = V.cv, r = cv.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    // a low-resolution scene at the band's own aspect (never stretched): about 270 rows, at most 760 columns
    let LH = 270, LW = Math.round(LH * aspect);
    if (LW > 760) { LW = 760; LH = Math.max(90, Math.round(LW / aspect)); }
    if (aspect < 1) { LW = 360; LH = Math.round(LW / aspect); } // portrait: taller scene, same width
    V.LW = LW; V.LH = LH; cv.width = LW; cv.height = LH; V.g.imageSmoothingEnabled = false;
    // looking down at the pit: the horizon sits above the frame, the pit a little below the middle
    V.H0 = -Math.round(LH * 0.6); V.F = (LH * 0.55 - V.H0) * PIT.z / V.H_CAM; V.CX = LW / 2;
    D.buildFloor(); V.st.L = V.layout();
  }
  // the camp's state exists whether or not the camp is open: the body screen reads and drains the same stats
  function ensure() {
    if (!V.st) {
      const c = S.createCamp(1), saved = load();
      if (saved) { Object.assign(c.stats, saved.stats); Object.assign(c.stock, saved.stock); c.coin = saved.coin || 0; c.goods = saved.goods || []; }
      c.unlimitedFire = true; // prototype: tinder, kindling and fuel never run out
      V.st = { c, L: null, mode: 'fire', saveAt: 0, sel: null, vsel: null, hover: null, uiAt: 0, trayAt: 0, flash: 0, sackBox: null };
    }
    return V.st.c;
  }
  function open(leaveFn) {
    ui(); onLeave = leaveFn; ensure();
    V.el.hidden = false; document.documentElement.classList.add('xp-open');
    UI.mode(V.st.mode); size(); UI.refresh();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  function leave(silent) { // silent: another screen is taking over, so don't hand back to the world
    V.el.hidden = true; cancelAnimationFrame(raf); raf = 0; if (V.st) save();
    if (onLeave && silent !== true) onLeave();
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const st = V.st, c = st.c;
    advance(dt);
    D.emitFrom(c, dt);
    if (root.Body && Body.tick) Body.tick(dt); // what is eating you keeps eating while you cook
    D.stepParts(dt);
    st.flash = Math.max(0, st.flash - dt * 2);
    // the readable UI a few times a second, the tray less often
    if (t - st.uiAt > 120) { st.uiAt = t; UI.gauge(S.fireState(c)); if (st.vsel) UI.ctx(); if (t - st.trayAt > 600) { st.trayAt = t; UI.refresh(); } }
    if (t - st.saveAt > 5000) { st.saveAt = t; save(); }
    D.draw(t / 1000);
  }

  // ---------- input ----------
  // Tray buttons: tap to pick up (tap again to put down), or drag straight into the scene.
  // The scene: press and move a piece or vessel to rearrange it; a press without moving is a tap.
  function wire(el, cv) {
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', moveP); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { V.drag = null; });
    cv.addEventListener('pointerleave', () => { if (V.st) V.st.hover = null; });
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => {
      b.addEventListener('pointerdown', e => { if (e.button) return; V.drag = { from: 'slot', key: b.dataset.k, start: { cx: e.clientX, cy: e.clientY }, p: V.P(e), moved: false, btn: true }; });
      b.addEventListener('click', e => { if (e.detail === 0) select(b.dataset.k); }); // keyboard
    });
    window.addEventListener('pointermove', e => {
      const d = V.drag; if (!d || !d.btn) return; d.p = V.P(e);
      if (Math.hypot(e.clientX - d.start.cx, e.clientY - d.start.cy) > 8) d.moved = true;
    });
    window.addEventListener('pointerup', e => {
      const d = V.drag; if (!d || !d.btn) return; V.drag = null;
      if (!d.moved) return select(d.key);
      // on touch the release is reported to the button the drag began on, so go by where the finger is
      const r = cv.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) use(d.key, V.P(e));
    });
    el.querySelectorAll('.cf-mode [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    el.querySelector('.cf-blow').addEventListener('click', blow);
    el.querySelector('.cf-open').addEventListener('click', () => UI.larder());
    el.querySelector('.cf-forage').addEventListener('click', forage);
    el.querySelector('.cf-ctx').addEventListener('click', ctxAction);
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    // the scene band changes size when the larder or a vessel panel opens: re-render it at its new size
    let seen = '';
    if (window.ResizeObserver) new ResizeObserver(() => { const r = cv.getBoundingClientRect(), k = Math.round(r.width) + 'x' + Math.round(r.height); if (!el.hidden && V.st && k !== seen) { seen = k; size(); } }).observe(cv);
    window.addEventListener('keydown', e => {
      if (el.hidden) return;
      const st = V.st;
      if (e.key === 'Escape') { if (st.sel || st.vsel) { select(null); st.vsel = null; UI.ctx(); } else if (UI.larderOpen()) UI.larder(false); else if (st.mode === 'cook') setMode('fire'); else leave(); }
      if (e.key === 'f' && !e.repeat && st.mode === 'cook') { const v = st.c.vessels.find(q => q.id === st.vsel); if (v) tendVessel(v); }
      if ((e.key === 'b' || e.key === ' ') && !e.repeat && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); blow(); }
    });
  }
  const overTray = e => e.clientY >= V.cv.getBoundingClientRect().bottom; // anywhere below the scene: the dock or the tray
  function down(e) {
    e.preventDefault(); V.cv.setPointerCapture?.(e.pointerId);
    const p = V.P(e), st = V.st;
    // each mode answers to its own things first: tending, the fire's pieces (a vessel touched instead starts
    // cooking); cooking, only the vessels
    const vs = V.hitVessel(p), pc = st.mode === 'fire' ? V.hitPiece(p) : null;
    // where both are under the finger, the one drawn in front (nearer) is the one touched
    const hit = vs && pc && V.inBox(p, pc.obj.box) && pc.obj.z < vs.obj.z ? pc : vs || pc;
    if (hit) { // take hold of it where you touched it
      const f = V.toFloor(p.x, p.y + 3);
      // what has burnt down (embers, coals, ash) stays where it lies: touching it is only ever a tap
      const fixed = hit.type === 'piece' && !!(hit.obj.ash || hit.obj.coal);
      V.drag = { from: hit.type, obj: hit.obj, p, start: p, moved: false, fixed, gx: f ? hit.obj.x - f.x : 0, gz: f ? hit.obj.z - f.z : 0 };
      return;
    }
    V.drag = { from: 'tap', p, start: p, moved: false };
  }
  function moveP(e) {
    const p = V.P(e), d = V.drag; V.st.hover = p;
    if (!d || d.btn) return;
    d.p = p;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3 && !d.fixed) d.moved = true;
    // the piece stays where you took hold of it, under your finger
    if ((d.from === 'vessel' || d.from === 'piece') && d.moved) { const f = V.toFloor(p.x, p.y + 3); if (f && f.z < 4.5) { d.obj.x = f.x + d.gx; d.obj.z = Math.max(1.2, f.z + d.gz); } }
  }
  function up(e) {
    const d = V.drag; if (!d || d.btn) return;
    const p = V.P(e), L = V.st.L, c = V.st.c; V.drag = null;
    if (!d.moved) { if (d.from === 'vessel' && V.st.mode === 'fire') setMode('cook'); return tap(d, p); } // touching a vessel (not moving it) starts cooking
    if (d.from === 'piece') { // dropped on the tray: gather what it left, or take it back if it is cold
      if (overTray(e)) { if (hasResidue(d.obj)) gather(d.obj, p); else if (S.removePiece(c, d.obj.id) === false) UI.note('Too hot to pick up.', p.x, p.y, 1400); UI.refresh(); }
      return;
    }
    if (d.from === 'vessel') {
      if (V.inBox(p, L.hands)) return eatFrom(d.obj, p);
      if (overTray(e)) putAway(d.obj, p);
    }
  }
  // a tap on the scene: use what is in hand, select a vessel, gather ash, or read a note about what is there
  function tap(d, p) {
    const st = V.st, c = st.c, sel = st.sel;
    if (sel) {
      // a vessel or other tool in hand, tapped on a vessel: select that vessel instead
      const tool = !ING[sel] && !FIRE[sel] && sel !== 'striker';
      if (tool && d.from === 'vessel') { st.vsel = d.obj.id; select(null); return; }
      const hit = V.hitVessel(p);
      if (tool && hit && hit.type === 'vessel') { st.vsel = hit.obj.id; select(null); return; }
      return use(sel, p);
    }
    if (d.from === 'vessel') { st.vsel = st.vsel === d.obj.id ? null : d.obj.id; UI.ctx(); return; }
    if (d.from === 'piece' && hasResidue(d.obj)) return gather(d.obj, p);
    if (d.from === 'piece') { const q = d.obj; return UI.note(`${FIRE[q.kind].name}: ${q.ash ? (q.ember > 20 ? 'embers, still glowing' : 'ash') : q.burning ? (q.air < CHOKE ? 'burning, choking for air' : 'burning') : q.out ? 'gone out, smouldering' : q.T > 60 ? 'hot' : 'cold'}.`, p.x, p.y); }
    const ch = st.L.charms.find(b => V.inBox(p, { x: b.x - 2, y: 0, w: b.w + 4, h: b.y + b.h + 4 }));
    if (ch) return UI.note(UI.charmNote(ch.key, c.stats[ch.key]), p.x + 20, p.y + 30);
    if (st.sackBox && V.inBox(p, st.sackBox)) return forage();
    if (st.vsel) { st.vsel = null; UI.ctx(); }
  }
  function ctxAction(e) {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const st = V.st, v = st.c.vessels.find(q => q.id === st.vsel), p = { x: V.LW / 2, y: V.LH * 0.6 };
    if (a.dataset.a === 'close' || !v) { st.vsel = null; return UI.ctx(); }
    if (a.dataset.a === 'tend') tendVessel(v);
    if (a.dataset.a === 'take') takeFrom(v, p);
    if (a.dataset.a === 'sell') sellFrom(v, p);
    if (a.dataset.a === 'eat') eatFrom(v, p);
    if (a.dataset.a === 'away') putAway(v, p);
  }

  // ---------- actions ----------
  // tend the fire, or cook: put down what the other mode had in hand, and close what it had open
  function setMode(m) {
    const st = V.st; if (st.mode === m) return;
    st.mode = m;
    if (m === 'fire') { st.vsel = null; UI.larder(false); if (st.sel && !FIRE[st.sel] && st.sel !== 'striker') st.sel = null; }
    else if (st.sel && (FIRE[st.sel] || st.sel === 'striker')) st.sel = null;
    UI.mode(m); UI.refresh(); UI.ctx();
  }
  // pick up an item from the tray (or put it down); with a vessel selected, an ingredient goes straight into it
  function select(k) {
    const st = V.st, c = st.c;
    const sv = k && ING[k] && st.vsel && c.vessels.find(v => v.id === st.vsel);
    if (sv) { addTo(sv, k); return; }
    if (k && k === st.sel) k = null;
    if (k && VES[k] && c.vessels.some(v => v.type === k)) { const v = c.vessels.find(q => q.type === k); st.vsel = v.id; k = null; } // already out: select it instead
    st.sel = k;
    UI.refresh(); UI.ctx();
  }
  // why an ingredient can't go into a vessel, or null if it can
  function refusal(v, k) {
    const c = V.st.c, I = ING[k];
    return c.stock[k] <= 0 ? `No ${I.name} left.` : I.only && !I.only.includes(v.type) ? `${I.name} only goes in the pot.` : v.items.length >= VES[v.type].cap ? `The ${VES[v.type].name.toLowerCase()} is full.` : null;
  }
  // an ingredient tapped in the larder, into the selected vessel
  function addTo(v, k) {
    const b = V.el.querySelector(`.cf-larder .cf-btn[data-k="${k}"]`), why = refusal(v, k);
    if (!why) S.addToVessel(V.st.c, v.id, k);
    if (b) UI.pulse(b, why ? 'refused' : 'added', ['added', 'refused']);
    if (why) { const r = v.box; UI.note(why, r ? r.x + r.w / 2 : V.LW / 2, r ? r.y : V.LH / 2, 1800); }
    UI.refresh(); UI.ctx();
  }
  // use an item at a point in the scene (a drop from the tray, or a tap with it in hand)
  function use(k, p) {
    const st = V.st, c = st.c, f = V.onFloorAt(p);
    if (FIRE[k]) { // lay a piece of the fire
      if (!f) return;
      if (!c.unlimitedFire && c.stock[k] <= 0) { UI.note(`No ${FIRE[k].name.toLowerCase()} left. Forage in the sack for more.`, p.x, p.y); return select(null); }
      S.placePiece(c, k, f.x, f.z); UI.refresh(); return;
    }
    if (k === 'striker') { if (!f) return; S.strike(c, f.x, f.z); D.emit('spark', f.x, f.z, 0.03, 14); return; }
    if (VES[k]) { // set a vessel down, and select it
      if (!f) return;
      const v = S.placeVessel(c, k, f.x, f.z);
      if (!v) UI.note(`The ${VES[k].name.toLowerCase()} is already out.`, p.x, p.y); else { st.vsel = v.id; select(null); }
      UI.refresh(); return;
    }
    if (ING[k]) { // an ingredient dropped on a vessel goes in
      const hit = V.hitVessel(p); if (!hit) return;
      const v = hit.obj, why = refusal(v, k);
      if (why) { UI.note(why, p.x, p.y); if (c.stock[k] <= 0) select(null); return; }
      S.addToVessel(c, v.id, k);
      st.vsel = v.id; UI.refresh(); UI.ctx();
    }
  }
  // flip the pan, turn the skewer, stir the pot: frees what is sticking (and earns a little cooking, if it was)
  function tendVessel(v) {
    const r = S.tend(V.st.c, v.id); if (!r) return;
    if (XP && r.freed > 0.4) earn('cooking', XP.tend);
    D.tendFx(v); UI.ctx();
  }
  function takeFrom(v, p) {
    const r = S.take(V.st.c, v.id); if (!r) return UI.note('It has not come together yet.', p.x, p.y);
    if (XP) earn('cooking', XP.dish * r.count);
    UI.note(`${r.count > 1 ? r.count + ' × ' : ''}${r.name}${r.traits.length ? ` (${r.traits.join(', ').toLowerCase()})` : ''}. Kept for the Body screen.`, V.st.L.hands.x + 30, V.st.L.hands.y - 20, 4800); save(); UI.refresh(); UI.ctx();
  }
  function sellFrom(v, p) {
    const r = S.sell(V.st.c, v.id); if (!r) return UI.note('Nobody buys that.', p.x, p.y);
    const j = r.judged, name = j.dish ? j.dish.name : j.stew ? 'Stew' : 'The meal';
    if (XP) earn('cooking', XP.dish * (j.dish ? 1 : 0.5));
    UI.note(`${name} sold: ${r.value} coin (${r.worth.grade.toLowerCase()}). You have ${V.st.c.coin}.`, V.st.L.hands.x + 30, V.st.L.hands.y - 20, 4200); save(); UI.refresh(); UI.ctx();
  }
  function eatFrom(v, p) {
    const L = V.st.L, r = S.eat(V.st.c, v.id);
    if (!r) return UI.note('Nothing in it to eat.', p.x, p.y);
    const j = r.judged;
    if (XP) { if (j.dish) earn('cooking', XP.dish); else if (j.stew) earn('cooking', XP.stew); }
    const how = j.dish ? `${r.name || j.dish.name}. ${j.dish.note}` : j.state === 'raw' ? 'Raw. It fights you all the way down.' : j.state === 'underdone' ? 'Half-cooked. Something in it is still moving.' : j.state === 'burnt' ? 'Burnt to bitterness. It hurts going down.' : j.state === 'overdone' ? 'Overdone. Dry and tough, but it goes down.' : 'Cooked. Barely edible. It will keep you alive.';
    UI.note(how, L.hands.x + 30, L.hands.y - 20, 4200); save(); UI.ctx();
  }
  function putAway(v, p) {
    if (v.items.length) return UI.note('Eat it or leave it on the floor; you cannot pack it full.', p.x, p.y);
    S.removeVessel(V.st.c, v.id); if (V.st.vsel === v.id) V.st.vsel = null; UI.refresh(); UI.ctx();
  }
  // keep what the fire left: ash from cold heaps, char from coals gone out or a piece put out half-burnt
  const hasResidue = q => { const r = S.residueOf(q); return r.ash + r.char > 0; };
  function gather(q, p) {
    const c = V.st.c;
    // sweep up what lies with it: every cold heap within a hand's width
    const near = c.pieces.filter(o => o !== q && o.spent && Math.hypot(o.x - q.x, o.z - q.z) < 0.07).map(o => o.id);
    const got = S.collect(c, q.id); if (!got) return;
    near.forEach(id => { const more = S.collect(c, id); if (more) { got.ash += more.ash; got.char += more.char; } });
    if (XP) earn('fire', (got.ash + got.char) * XP.gather);
    UI.note([got.ash ? `Ash ×${got.ash}` : '', got.char ? `Char ×${got.char}` : ''].filter(Boolean).join(', ') + ' kept.', p.x, p.y, 1600);
    save(); UI.refresh();
  }
  // rummage in the sack: a few things turn up, and it tires you
  function forage() {
    const c = V.st.c, L = V.st.L, got = S.forage(c); D.emit('smoke', L.sackF.x, L.sackF.z, 0.02, 4);
    const counts = {}; got.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
    UI.note(`You rummage in the sack: ${Object.entries(counts).map(([k, n]) => (ING[k] || FIRE[k] || { name: k }).name + (n > 1 ? ' ×' + n : '')).join(', ')}. It tires you.`, V.sx(L.sackF.x, L.sackF.z), V.sy(L.sackF.z) - 30, 4200);
    save(); UI.refresh();
  }
  // a breath into the bed of the fire
  function blow() {
    const c = V.st.c, wanted = S.fireState(c).needsAir; S.blow(c); V.st.flash = 1;
    if (wanted && XP) earn('fire', XP.breath); // a breath when the fire needed one
    c.pieces.filter(p => !p.ash || p.ember > 10).forEach(p => { D.emit('spark', p.x, p.z, 0.01, p.ash ? 3 : 2); });
    D.breathe();
    UI.pulse(V.el.querySelector('.cf-blow'), 'puff');
  }

  // where a floor point is on screen (for scripted checks and, later, aiming in 3D)
  const at = (x, z) => { const r = V.cv.getBoundingClientRect(); return { x: r.left + V.sx(x, z) / V.LW * r.width, y: r.top + (V.sy(z) - 3) / V.LH * r.height }; };
  root.Camp = { open, leave, at, advance, state: () => V.st, shared: ensure, save: () => { if (V.st) save(); } };
})(window);
