// Camp: the fire and cooking screen. A fixed first-person view down at a fire pit on the cavern floor.
// Everything is in the world: the kit and larder lie on cloths in front of you, your hands take what you eat,
// five charms hanging at the edge of sight show how you are, the sack beside the pit holds what you find,
// and the tunnel behind the fire is the way back. Touch anything for a scrawled note about it.
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
  const TUNNEL = () => ({ x: Math.round(LW * 0.78), y: 2, w: 26, h: 22 }); // the way back, in the wall

  // ---------- layout in screen space: cloths, hands, charms, sack ----------
  const KIT = ['tinder', 'kindling', 'fuel', 'striker', 'pot', 'pan', 'skewer'];
  const LARDER = Object.keys(ING);
  function layout() {
    const cy = LH - 34, slot = 17;
    const kitX = Math.round(LW * 0.06), larX = Math.round(LW - 10 * slot - LW * 0.03);
    const kit = KIT.map((k, i) => ({ key: k, x: kitX + (i % 4) * slot, y: cy + Math.floor(i / 4) * slot, s: 14 }));
    const lar = LARDER.map((k, i) => ({ key: k, x: larX + (i % 10) * slot, y: cy + Math.floor(i / 10) * slot, s: 14 }));
    const hands = { x: Math.round(LW / 2 - 30), y: LH - 26, w: 60, h: 26 };
    const charms = STATS.map((k, i) => ({ key: k, x: 6 + i * 13, y: 18 + (i % 2) * 10, w: 11, h: 22 }));
    const sackF = { x: 0.62, z: 1.62 };
    return { kit, lar, hands, charms, sackF, kitBox: { x: kitX - 6, y: cy - 6, w: 4 * slot + 8, h: 2 * slot + 10 }, larBox: { x: larX - 6, y: cy - 6, w: 10 * slot + 8, h: 2 * slot + 10 } };
  }

  // ---------- particles ----------
  const parts = [];
  function emit(kind, x, z, h, n) {
    for (let k = 0; k < n && parts.length < 420; k++) parts.push({ kind, x: x + (Math.random() - 0.5) * 0.03, z: z + (Math.random() - 0.5) * 0.02, h: h || 0, vx: (Math.random() - 0.5) * 0.02, vh: kind === 'flame' ? 0.18 + Math.random() * 0.15 : kind === 'spark' ? 0.4 + Math.random() * 0.5 : 0.08 + Math.random() * 0.06, life: 0, max: kind === 'flame' ? 0.35 + Math.random() * 0.3 : kind === 'spark' ? 0.5 : kind === 'bubble' ? 0.4 : 1.6 + Math.random() });
  }
  function stepParts(dt) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.life += dt; if (p.life > p.max) { parts.splice(k, 1); continue; }
      p.h += p.vh * dt; p.x += p.vx * dt + (p.kind === 'smoke' || p.kind === 'steam' ? Math.sin(p.life * 3 + k) * 0.01 * dt : 0);
      if (p.kind === 'spark') p.vh -= 1.2 * dt;
    }
  }

  // ---------- state ----------
  const SAVE = 'undercroft-camp-v1';
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.stats) return s; } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ stats: st.c.stats, stock: st.c.stock })); } catch (e) { /* storage unavailable */ } }

  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'camp'; el.hidden = true;
    el.innerHTML = `<canvas aria-label="Campfire: drag tinder, kindling and fuel into the pit, strike over the tinder, cook in the pot, pan and skewer, and draw a vessel to your hands to eat"></canvas><div class="camp-note" hidden></div>`;
    document.body.appendChild(el);
    cv = el.querySelector('canvas'); g = cv.getContext('2d');
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', moveP); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    window.addEventListener('keydown', e => { if (!el.hidden && e.key === 'Escape') leave(); });
  }
  function size() {
    const r = el.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    LH = 270; LW = Math.max(300, Math.min(640, Math.round(LH * aspect)));
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
      st = { c, L: null, saveAt: 0 };
    }
    return st.c;
  }
  function open(leaveFn) {
    ui(); onLeave = leaveFn; ensure();
    el.hidden = false; document.documentElement.classList.add('xp-open');
    size();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    note('The fire pit. Lay tinder in the ring, kindling around it, then strike.', LW / 2, LH * 0.35, 4200);
  }
  function leave() {
    el.hidden = true; cancelAnimationFrame(raf); raf = 0; if (st) save();
    if (onLeave) onLeave();
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

  // ---------- input: drag from the cloths, move things on the floor, draw food to your hands ----------
  let drag = null;
  const P = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH }; };
  const inBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  function hitPlaced(p) {
    // nearest first: vessels, then pieces
    const vs = st.c.vessels.slice().sort((a, b) => a.z - b.z);
    for (const v of vs) if (v.box && inBox(p, v.box)) return { type: 'vessel', obj: v };
    const ps = st.c.pieces.slice().sort((a, b) => a.z - b.z);
    for (const q of ps) if (q.box && inBox(p, q.box)) return { type: 'piece', obj: q };
    return null;
  }
  function down(e) {
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
    const p = P(e), L = st.L;
    const slot = [...L.kit, ...L.lar].find(s => p.x >= s.x - 1 && p.y >= s.y - 1 && p.x < s.x + s.s + 1 && p.y < s.y + s.s + 1);
    if (slot) { drag = { from: 'slot', key: slot.key, p, start: p, moved: false }; return; }
    const hit = hitPlaced(p);
    if (hit) { drag = { from: hit.type, obj: hit.obj, p, start: p, moved: false, ox: 0, oz: 0 }; return; }
    drag = { from: 'tap', p, start: p, moved: false };
  }
  function moveP(e) {
    if (!drag) return;
    const p = P(e); drag.p = p;
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 3) drag.moved = true;
    if ((drag.from === 'vessel' || drag.from === 'piece') && drag.moved) { const f = toFloor(p.x, p.y + 3); if (f && f.z < 4.5) { drag.obj.x = f.x; drag.obj.z = f.z; } }
  }
  function up(e) {
    if (!drag) return;
    const d = drag, p = P(e), L = st.L, c = st.c; drag = null;
    const f = toFloor(p.x, p.y + 3), onFloor = f && f.z < 4.5 && !inBox(p, L.kitBox) && !inBox(p, L.larBox) && !inBox(p, L.hands);
    if (!d.moved) return tap(d, p);
    if (d.from === 'slot') {
      const k = d.key;
      if (FIRE[k]) { if (!onFloor) return; if (c.stock[k] <= 0) return note(`No ${FIRE[k].name.toLowerCase()} left. The sack might have some.`, p.x, p.y); S.placePiece(c, k, f.x, f.z); return; }
      if (k === 'striker') { if (!onFloor) return; S.strike(c, f.x, f.z); emit('spark', f.x, f.z, 0.03, 14); return; }
      if (VES[k]) { if (!onFloor) return; if (!S.placeVessel(c, k, f.x, f.z)) note(`The ${VES[k].name.toLowerCase()} is already out.`, p.x, p.y); return; }
      if (ING[k]) {
        const hit = hitPlaced(p);
        if (hit && hit.type === 'vessel') {
          const v = hit.obj, I = ING[k];
          if (c.stock[k] <= 0) return note(`No ${I.name} left.`, p.x, p.y);
          if (I.only && !I.only.includes(v.type)) return note(`${I.name} only goes in the pot.`, p.x, p.y);
          if (!S.addToVessel(c, v.id, k)) return note(`The ${VES[v.type].name.toLowerCase()} is full.`, p.x, p.y);
          return;
        }
        return note(`${ING[k].name} needs a pot, pan or skewer.`, p.x, p.y);
      }
    }
    if (d.from === 'piece') { if (inBox(p, L.kitBox)) S.removePiece(c, d.obj.id); return; }
    if (d.from === 'vessel') {
      const v = d.obj;
      if (inBox(p, L.hands)) {
        const r = S.eat(c, v.id);
        if (!r) return note('Nothing in it to eat.', p.x, p.y);
        const j = r.judged, how = j.dish ? `${j.dish.name}. ${j.dish.note}` : j.state === 'raw' ? 'Raw. It fights you all the way down.' : j.state === 'underdone' ? 'Half-cooked. Something in it is still moving.' : j.state === 'burnt' ? 'Burnt to bitterness. It hurts going down.' : 'Cooked. Barely edible. It will keep you alive.';
        note(how, L.hands.x + 30, L.hands.y - 20, 4200); save(); return;
      }
      if (inBox(p, L.kitBox)) { if (v.items.length) return note('Eat it or leave it on the floor; you cannot pack it full.', p.x, p.y); S.removeVessel(c, v.id); }
    }
  }
  function tap(d, p) {
    const L = st.L, c = st.c;
    if (d.from === 'slot') {
      const k = d.key, o = FIRE[k] || (k === 'striker' ? STRIKER : null) || VES[k] || ING[k];
      const n = c.stock[k] !== undefined ? ` (${c.stock[k] > 0 ? c.stock[k] + ' left' : 'none left'})` : '';
      return note(`${o.name}${n}. ${o.note}`, p.x, p.y, 3600);
    }
    if (d.from === 'vessel') return note(vesselNote(d.obj), p.x, p.y, 4200);
    if (d.from === 'piece') { const q = d.obj, k = FIRE[q.kind]; return note(`${k.name}: ${q.ash ? 'ash' : q.burning ? (q.air < 0.45 ? 'burning, choking for air' : 'burning') : q.out ? 'gone out, smouldering' : q.T > 60 ? 'hot' : 'cold'}.`, p.x, p.y); }
    const ch = L.charms.find(b => inBox(p, { x: b.x - 2, y: 0, w: b.w + 4, h: b.y + b.h + 4 }));
    if (ch) return note(`${CHARM_NAME[ch.key]}. ${words[ch.key](c.stats[ch.key])}`, p.x + 20, p.y + 30);
    if (st.sackBox && inBox(p, st.sackBox)) { const got = S.forage(c); emit('smoke', L.sackF.x, L.sackF.z, 0.02, 4); note(`You rummage in the sack: ${[...new Set(got)].map(k => (ING[k] || FIRE[k] || { name: k }).name).join(', ')}. It tires you.`, p.x, p.y, 4200); save(); return; }
    const t = TUNNEL(); if (inBox(p, { x: t.x - 6, y: t.y - 6, w: t.w + 12, h: t.h + 12 })) return leave();
    if (inBox(p, L.hands)) return note('Your hands. Draw a pot, pan or skewer here to eat from it.', p.x, p.y);
  }

  // ---------- drawing ----------
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const c = st.c;
    S.step(c, dt);
    // flames, smoke, steam from the simulation
    c.pieces.forEach(q => {
      if (q.burning && Math.random() < dt * (8 + 30 * q.vigour)) emit('flame', q.x, q.z, 0.01, 1);
      if (q.smoke > 0.2 && Math.random() < dt * 6 * Math.min(1, q.smoke)) emit('smoke', q.x, q.z, 0.03, 1);
      if (q.ash && q.ember > 30 && Math.random() < dt * 1.5) emit('spark', q.x, q.z, 0.01, 1);
    });
    c.vessels.forEach(v => {
      if (v.T > 80 && Math.random() < dt * (v.T - 70) / 20) emit('steam', v.x, v.z, 0.12, 1);
      if (v.type === 'pot' && v.water > 0 && v.T >= 99 && Math.random() < dt * 10) emit('bubble', v.x + (Math.random() - 0.5) * 0.08, v.z, 0.1, 1);
      if (v.scorch > 0.1 && Math.random() < dt * 6) emit('smoke', v.x, v.z, 0.12, 1);
    });
    if (root.Body && Body.tick) Body.tick(dt); // what is eating you keeps eating while you cook
    stepParts(dt);
    if (t - st.saveAt > 5000) { st.saveAt = t; save(); }
    draw(t / 1000);
  }
  function draw(time) {
    const c = st.c, L = st.L, out = S.fireOutput(c), glow = Math.min(1, out / 1800) * (0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 5.3));
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.drawImage(floorImg, 0, 0);
    // the tunnel mouth far behind the fire: the way back, faintly lit by the pilgrims' lavender
    const tn = TUNNEL(); g.fillStyle = '#05040a'; g.beginPath(); g.ellipse(tn.x + tn.w / 2, tn.y + tn.h, tn.w / 2, tn.h, 0, Math.PI, 0); g.fill();
    g.globalAlpha = 0.25 + 0.1 * Math.sin(time * 1.3); g.fillStyle = '#b9b2d8'; g.fillRect(tn.x + tn.w / 2 - 1, tn.y + tn.h - 6, 2, 6); g.globalAlpha = 1;
    // firelight on the floor
    const px = sx(PIT.x, PIT.z), py = sy(PIT.z), R = sc(PIT.z) * (0.6 + 1.6 * glow);
    g.globalCompositeOperation = 'lighter';
    if (glow > 0.02) { const gr = g.createRadialGradient(px, py, 0, px, py, R * 2.2); gr.addColorStop(0, `rgba(255,150,60,${0.45 * glow})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(px - R * 2.2, py - R * 1.4, R * 4.4, R * 2.8); }
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
      if (p.kind === 'flame') { g.fillStyle = a > 0.7 ? '#fff0a0' : a > 0.4 ? '#ffb040' : '#d84a20'; g.globalAlpha = Math.min(1, a * 1.4); g.fillRect(Math.round(x), Math.round(y), s + 1, s + 1); }
      else if (p.kind === 'spark') { g.fillStyle = '#ffd060'; g.globalAlpha = a; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
      else if (p.kind === 'bubble') { g.fillStyle = '#c8d4e0'; g.globalAlpha = a * 0.8; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
      else { g.fillStyle = p.kind === 'steam' ? '#d8dce8' : '#3a3540'; g.globalAlpha = a * (p.kind === 'steam' ? 0.35 : 0.55); const r = s + p.life * 3; g.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), Math.round(r), Math.round(r)); }
    });
    g.globalAlpha = 1;
    // darkness beyond the firelight
    const dark = g.createRadialGradient(px, py - 10, 20 + 90 * glow, px, py, LW * 0.75);
    dark.addColorStop(0, 'rgba(4,3,8,0)'); dark.addColorStop(1, `rgba(4,3,8,${0.85 - 0.25 * glow})`);
    g.fillStyle = dark; g.fillRect(0, 0, LW, LH);
    drawCloths(); drawHands(); drawCharms(g, st.L.charms, c.stats, time);
    // what is being dragged from a cloth
    if (drag && drag.from === 'slot' && drag.moved) {
      const k = drag.key, art = FIRE[k] || (k === 'striker' ? STRIKER : null) || VES[k] || ING[k];
      g.globalAlpha = 0.9; g.drawImage(sprite(k, art), Math.round(drag.p.x - 8), Math.round(drag.p.y - 8), 16, 16); g.globalAlpha = 1;
      if (k === 'striker' || FIRE[k] || VES[k]) { const f = toFloor(drag.p.x, drag.p.y + 3); if (f) { const s = sc(f.z); g.strokeStyle = 'rgba(255,240,200,0.35)'; g.beginPath(); g.ellipse(sx(f.x, f.z), sy(f.z), s * 0.06, s * 0.025, 0, 0, 7); g.stroke(); } }
    }
  }
  function drawPiece(q, time) {
    const k = FIRE[q.kind], s = sc(q.z), size = (q.kind === 'fuel' ? 0.2 : q.kind === 'kindling' ? 0.15 : 0.08) * s, x = sx(q.x, q.z), y = sy(q.z);
    let img;
    if (q.ash) img = tinted(q.kind, k, '#6a6660', 0.85);
    else if (q.burning) img = tinted(q.kind, k, '#ff7a30', 0.35 + 0.15 * Math.sin(time * 11 + q.id));
    else { const burnt = 1 - q.m / q.m0; img = burnt > 0.05 ? tinted(q.kind, k, '#14100e', Math.min(0.9, burnt * 1.2 + 0.2)) : sprite(q.kind, k); }
    const w = Math.max(3, Math.round(size)), h = q.ash ? Math.max(2, Math.round(w * 0.35)) : w;
    g.drawImage(img, Math.round(x - w / 2), Math.round(y - h + 1), w, h);
    if (q.ash && q.ember > 20) { g.fillStyle = `rgba(255,110,40,${Math.min(0.8, q.ember / 200)})`; g.fillRect(Math.round(x - w / 4), Math.round(y - 1), Math.max(1, Math.round(w / 2)), 1); }
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
  function cloth(b, col, edge) {
    g.fillStyle = col; g.beginPath(); g.moveTo(b.x + 4, b.y); g.lineTo(b.x + b.w - 4, b.y); g.lineTo(b.x + b.w + 2, b.y + b.h); g.lineTo(b.x - 2, b.y + b.h); g.closePath(); g.fill();
    g.strokeStyle = edge; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(b.x + 6, b.y + 2); g.lineTo(b.x + b.w - 6, b.y + 2); g.stroke(); g.setLineDash([]);
  }
  function drawCloths() {
    const L = st.L, c = st.c;
    cloth(L.kitBox, '#3a2e24', '#6a5438'); cloth(L.larBox, '#2e2a34', '#5a5068');
    [...L.kit, ...L.lar].forEach(s => {
      const k = s.key, art = FIRE[k] || (k === 'striker' ? STRIKER : null) || VES[k] || ING[k], n = c.stock[k];
      const out = VES[k] && c.vessels.some(v => v.type === k);
      g.globalAlpha = (n === 0 || out) ? 0.25 : 1;
      if (n > 1) g.drawImage(sprite(k, art), s.x + 2, s.y - 1, s.s, s.s); // a second one behind: there are more
      g.drawImage(sprite(k, art), s.x, s.y, s.s, s.s);
      g.globalAlpha = 1;
      // tally notches scratched into the cloth for how many
      if (n !== undefined && n > 0) { g.fillStyle = 'rgba(230,220,200,0.55)'; for (let t = 0; t < Math.min(n, 8); t++) g.fillRect(s.x + 1 + t * 2 - (t >= 5 ? 0 : 0), s.y + s.s + 1, 1, 2); }
    });
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

  root.Camp = { open, leave, state: () => st, shared: ensure, save: () => { if (st) save(); }, drawCharms };
})(window);
