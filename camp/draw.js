// Camp drawing: paints the camp scene each frame from the camp's state. The cave floor (drawn once per size), the
// pit, the sack, the fire's pieces and the vessels far to near, flames, smoke and steam, the darkness beyond the
// firelight, your hands and the charms, and what is in hand with its placement ring. Reads CampView (camp/view.js);
// changes nothing in the camp except each piece's and vessel's on-screen box (q.box, v.box), which taps hit-test.
(function (root) {
  const V = root.CampView, { S, FIRE, VES, ING, CHOKE, SMOULDER, COOK, PIT, H_CAM } = V;
  const { sx, sy, sc, sprite, tinted } = V;
  let floorImg = null;

  // ---------- the cave floor, drawn once per size: flagstones in perspective, darker with distance ----------
  function buildFloor() {
    const { LW, LH, H0 } = V;
    floorImg = document.createElement('canvas'); floorImg.width = LW; floorImg.height = LH;
    const x = floorImg.getContext('2d'), img = x.createImageData(LW, LH), d = img.data;
    const hash = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    for (let py = 0; py < LH; py++) for (let px = 0; px < LW; px++) {
      const o = (py * LW + px) * 4;
      if (py <= H0 + 1) { const t = py / (H0 + 1); d[o] = 10 + 6 * t; d[o + 1] = 9 + 5 * t; d[o + 2] = 14 + 6 * t; d[o + 3] = 255; continue; }
      const f = V.toFloor(px + 0.5, py + 0.5), u = f.x / 0.32, v = f.z / 0.32, row = Math.floor(v), cu = Math.floor(u + (row & 1) * 0.5);
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

  // ---------- particles: flames, smoke, sparks, steam, bubbles, breath ----------
  const parts = [];
  // heat (flames: 0 a weak red lick .. 1.5 a white-hot tongue) and dark (smoke: 0 thin grey wisps .. 1 choking black)
  function emit(kind, x, z, h, n, heat, dark) {
    const q = heat === undefined ? 1 : heat;
    for (let k = 0; k < n && parts.length < 520; k++) parts.push({ kind, heat: q, dark: dark || 0, x: x + (Math.random() - 0.5) * 0.03 * (kind === 'flame' ? 0.6 + q * 0.6 : 1), z: z + (Math.random() - 0.5) * 0.02, h: h || 0, vx: (Math.random() - 0.5) * 0.02, vz: 0,
      vh: kind === 'flame' ? (0.1 + Math.random() * 0.1) * (0.6 + q * 0.8) : kind === 'spark' ? 0.4 + Math.random() * 0.5 : kind === 'smoke' ? (0.06 + Math.random() * 0.05) * (1 - 0.3 * (dark || 0)) : 0.08 + Math.random() * 0.06,
      life: 0, max: kind === 'flame' ? (0.25 + Math.random() * 0.25) * (0.7 + q * 0.5) : kind === 'spark' ? 0.5 : kind === 'bubble' ? 0.4 : 1.6 + Math.random() + (dark || 0) });
  }
  // a breath: wisps blown from where you kneel towards the pit
  function breathe() {
    for (let k = 0; k < 10; k++) parts.push({ kind: 'breath', x: PIT.x + (Math.random() - 0.5) * 0.3, z: PIT.z - 0.45 - Math.random() * 0.2, h: 0.02, vx: 0, vz: 0.6 + Math.random() * 0.3, vh: 0, life: 0, max: 0.6 });
  }
  // what the simulation is doing, as particles: flames, smoke and sparks from the fire, steam and bubbles from vessels
  function emitFrom(c, dt) {
    const br = Math.min(1, c.breath || 0);
    c.pieces.forEach(q => {
      // flames: more, taller and whiter the harder a piece burns; small, low and red when it is starved of air
      const heat = q.burning ? Math.min(1.5, q.vigour * (q.air < CHOKE ? 0.6 : 1) * (1 + 0.5 * br) * (q.kind === 'fuel' ? 1.15 : 1)) : 0;
      if (q.burning && Math.random() < dt * (6 + 34 * heat)) emit('flame', q.x, q.z, 0.01, 1 + (heat > 0.9 && Math.random() < 0.5 ? 1 : 0), heat);
      if (q.smoke > 0.2 && Math.random() < dt * 7 * Math.min(1.4, q.smoke)) emit('smoke', q.x, q.z, 0.03, 1, 0, q.burning ? (q.air < CHOKE ? 0.8 : 0.2) : 0.6);
      if (q.ash && q.ember > 30 && Math.random() < dt * (1 + 6 * br) * Math.min(1, q.ember / 150)) emit('spark', q.x, q.z, 0.01, 1);
    });
    c.vessels.forEach(v => {
      if (v.T > 80 && Math.random() < dt * (v.T - 70) / 20) emit('steam', v.x, v.z, 0.12, 1);
      if (v.type === 'pot' && v.water > 0 && v.T >= 99 && Math.random() < dt * 10) emit('bubble', v.x + (Math.random() - 0.5) * 0.08, v.z, 0.1, 1);
      // food starting to catch, as warnings that build: wisps where it sticks, then smoke darkening as it scorches,
      // then flames licking up from what is burning
      const stuck = Math.max(0, ...v.items.map(it => it.stick || 0));
      if (stuck > 0.5 && v.T > COOK.stickBurnFrom && Math.random() < dt * 3 * stuck) emit('smoke', v.x, v.z, 0.1, 1, 0, 0.05);
      if (v.scorch > COOK.overdone * 0.6 && Math.random() < dt * (3 + 12 * v.scorch)) emit('smoke', v.x, v.z, 0.12, 1, 0, Math.min(1, v.scorch * 1.8));
      if (v.scorch > COOK.burnt * 0.85 && v.T > 170 && Math.random() < dt * 2.5) emit('flame', v.x + (Math.random() - 0.5) * 0.05, v.z, 0.1, 1, 0.45);
    });
  }
  function stepParts(dt) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.life += dt; if (p.life > p.max) { parts.splice(k, 1); continue; }
      p.h += p.vh * dt; if (p.vz) p.z += p.vz * dt; p.x += p.vx * dt + (p.kind === 'smoke' || p.kind === 'steam' ? Math.sin(p.life * 3 + k) * 0.01 * dt : 0);
      if (p.kind === 'spark') p.vh -= 1.2 * dt;
    }
  }
  function drawParts(g) {
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
  }

  // ---------- the scene ----------
  function draw(time) {
    const { g, LW, st, drag } = V, c = st.c, L = st.L, out = S.fireOutput(c), fs = S.fireState(c), br = Math.min(1, c.breath || 0);
    const flicker = fs.air < fs.chokeAt && fs.lit ? 0.35 : 0.15, glow = Math.min(1, out / 1800) * (1 - flicker + flicker * Math.sin(time * 9) * Math.sin(time * 5.3)) * (1 + 0.25 * br);
    const [fr, fg, fb] = V.fireColor(fs.strength, fs.air);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.drawImage(floorImg, 0, 0);
    // the tunnel mouth far behind the fire: the way back, faintly lit by the pilgrims' lavender
    const tn = V.TUNNEL(); g.fillStyle = '#05040a'; g.beginPath(); g.ellipse(tn.x + tn.w / 2, tn.y + tn.h, tn.w / 2, tn.h, 0, Math.PI, 0); g.fill();
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
    things.forEach(({ t, o }) => t === 'p' ? drawPiece(g, o, time) : drawVessel(g, o, time));
    drawParts(g);
    // darkness beyond the firelight
    const dark = g.createRadialGradient(px, py - 10, 20 + 90 * glow, px, py, LW * 0.75);
    dark.addColorStop(0, 'rgba(4,3,8,0)'); dark.addColorStop(1, `rgba(4,3,8,${0.85 - 0.25 * glow})`);
    g.fillStyle = dark; g.fillRect(0, 0, LW, V.LH);
    // a breath: the whole bed brightens for a moment
    if (st.flash > 0 && (fs.lit || fs.embers > 0.02)) { g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(px, py, 0, px, py, sc(PIT.z) * 0.5); gr.addColorStop(0, `rgba(255,120,40,${0.35 * st.flash})`); gr.addColorStop(1, 'rgba(255,90,30,0)'); g.fillStyle = gr; g.fillRect(px - sc(PIT.z) * 0.5, py - sc(PIT.z) * 0.3, sc(PIT.z), sc(PIT.z) * 0.6); g.globalCompositeOperation = 'source-over'; }
    drawHands(g); drawCharms(g, L.charms, c.stats, time);
    // the selected vessel
    const sv = st.vsel && c.vessels.find(v => v.id === st.vsel);
    if (sv && sv.box) { g.strokeStyle = `rgba(243,211,107,${0.6 + 0.3 * Math.sin(time * 5)})`; g.setLineDash([2, 2]); g.strokeRect(Math.round(sv.box.x) + 0.5, Math.round(sv.box.y) + 0.5, Math.round(sv.box.w), Math.round(sv.box.h)); g.setLineDash([]); }
    drawInHand(g, c, fs, drag, time);
  }

  // what is in hand (dragged from the tray, picked up and waiting for a tap, or a piece being moved), and what
  // laying it there would do: a ring on the floor, green to red
  function drawInHand(g, c, fs, drag, time) {
    const st = V.st;
    const moving = drag && drag.from === 'piece' && drag.moved ? drag.obj : null;
    const k = drag && drag.from === 'slot' && drag.moved ? drag.key : moving ? moving.kind : st.sel, at = drag && drag.from === 'slot' && drag.moved ? drag.p : moving ? drag.p : st.hover;
    // each piece's air, as a ring on the floor around it: shown while you are laying the fire, or when it is short
    // (only while tending the fire: cooking, the gauge says enough)
    const placing = k && FIRE[k];
    if (st.mode === 'fire') c.pieces.forEach(q => {
      if (q.ash || q === moving || !(q.burning || q.out) || q.air === undefined) return;
      const bad = q.air < fs.chokeAt, short = q.air < fs.airFull;
      if (!placing && !short) return;
      ring(g, q.x, q.z, 0.06, bad ? `rgba(240,90,60,${0.55 + 0.35 * Math.sin(time * 8)})` : short ? 'rgba(240,180,70,0.6)' : 'rgba(127,176,216,0.4)');
    });
    if (!k || !at) return;
    if (!moving) { g.globalAlpha = 0.9; g.drawImage(sprite(k, V.artOf(k)), Math.round(at.x - 8), Math.round(at.y - 18), 16, 16); g.globalAlpha = 1; }
    const f = moving ? { x: moving.x, z: moving.z } : V.onFloorAt(at); // a piece being moved is judged where it is
    if (f && FIRE[k]) { // will it catch, is it too far, will it smother the fire
      const pv = S.preview(moving ? { ...c, pieces: c.pieces.filter(q => q !== moving) } : c, k, f.x, f.z);
      let col;
      if (!pv.lit) col = 'rgba(255,240,200,0.6)'; // nothing burning yet
      else if (pv.smothers.length) { // too close: it would smother these
        col = 'rgba(240,80,60,0.9)';
        pv.smothers.forEach(id => { const q = c.pieces.find(p => p.id === id); if (q) ring(g, q.x, q.z, 0.05, `rgba(240,80,60,${0.6 + 0.3 * Math.sin(time * 10)})`); });
      }
      else if (!pv.warm) col = 'rgba(150,150,170,0.7)';       // too far from the flames to catch
      else if (!pv.catches) col = 'rgba(240,180,70,0.8)';     // warm, but too far to catch yet
      else if (pv.air < CHOKE) col = 'rgba(240,80,60,0.9)';   // packed in too tight: it will choke
      else if (pv.air < fs.airFull) col = 'rgba(240,180,70,0.85)'; // it will catch, but short of air
      else col = 'rgba(140,220,120,0.9)';                     // a good spot
      ring(g, f.x, f.z, 0.06, col); ring(g, f.x, f.z, 0.075, col);
    } else if (f && (k === 'striker' || VES[k])) { const s = sc(f.z); g.strokeStyle = 'rgba(255,240,200,0.5)'; g.beginPath(); g.ellipse(sx(f.x, f.z), sy(f.z), s * (k === 'striker' ? 0.14 : 0.06), s * (k === 'striker' ? 0.06 : 0.025), 0, 0, 7); g.stroke(); }
    if (ING[k]) { const h = V.hitVessel(at); if (h) { g.strokeStyle = 'rgba(243,211,107,0.8)'; g.strokeRect(Math.round(h.obj.box.x) + 0.5, Math.round(h.obj.box.y) + 0.5, Math.round(h.obj.box.w), Math.round(h.obj.box.h)); } }
  }
  // a ring on the floor of radius rad (m) around (x, z)
  function ring(g, x, z, rad, col) {
    const s = sc(z), rx = s * rad, ry = rx * (H_CAM / z) * 0.9;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.ellipse(Math.round(sx(x, z)) + 0.5, Math.round(sy(z)) + 0.5, rx, ry, 0, 0, 7); g.stroke();
  }

  // ---------- a piece of the fire: fresh, burning, smouldering, ash with embers, coals, or a cold heap ----------
  function drawPiece(g, q, time) {
    const k = FIRE[q.kind], s = sc(q.z), size = (q.kind === 'fuel' ? 0.2 : q.kind === 'kindling' ? 0.15 : 0.08) * s, x = sx(q.x, q.z), y = sy(q.z), drag = V.drag;
    let img;
    if (q.ash) img = tinted(q.kind, k, '#6a6660', 0.85);
    else if (q.burning) img = tinted(q.kind, k, q.air < CHOKE ? '#a8381a' : q.vigour > 0.9 ? '#ffb040' : '#ff7a30', 0.35 + 0.15 * Math.sin(time * 11 + q.id));
    else if (q.out && q.T > k.ignite * SMOULDER) img = tinted(q.kind, k, '#5a2414', 0.5); // smouldering: dull, dark red
    else { const burnt = 1 - q.m / q.m0; img = burnt > 0.05 ? tinted(q.kind, k, '#14100e', Math.min(0.9, burnt * 1.2 + 0.2)) : sprite(q.kind, k); }
    const w = Math.max(3, Math.round(size)), h = q.ash ? Math.max(2, Math.round(w * 0.35)) : w;
    const lifted = drag && drag.from === 'piece' && drag.moved && drag.obj === q;
    if (lifted) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, y, w * 0.55, Math.max(1, w * 0.18), 0, 0, 7); g.fill(); }
    const br = Math.min(1, V.st.c.breath || 0);
    if (q.coal && !q.spent) { // a bed of coals: black lumps split by glowing cracks, brighter under a breath
      const e = Math.min(1, q.ember / 220) * (0.8 + 0.2 * Math.sin(time * 1.7 + q.id)) * (1 + 0.6 * br), n = 5, lw = Math.max(2, Math.round(w / 3.2));
      for (let i = 0; i < n; i++) {
        const lx = Math.round(x - w / 2 + (i * 0.23 + ((q.id * 7 + i * 3) % 5) * 0.03) * w), ly = Math.round(y - lw - (i % 2) * Math.max(1, lw / 2) + 1);
        g.fillStyle = '#1a1416'; g.fillRect(lx, ly, lw, lw);
        g.fillStyle = `rgba(255,${Math.round(80 + 110 * e)},40,${0.35 + 0.6 * e})`; g.fillRect(lx + ((i + q.id) % 2), ly + lw - 1, Math.max(1, lw - 1), 1); if (lw > 2) g.fillRect(lx + lw - 1, ly + 1, 1, lw - 2);
      }
      g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(x, y - 1, 0, x, y - 1, w * 1.1); gr.addColorStop(0, `rgba(255,110,40,${0.45 * e})`); gr.addColorStop(1, 'rgba(200,50,20,0)'); g.fillStyle = gr; g.fillRect(x - w * 1.2, y - w * 0.8, w * 2.4, w * 1.3); g.globalCompositeOperation = 'source-over';
      q.box = { x: x - w / 2 - 2, y: y - w * 0.6, w: w + 4, h: w * 0.6 + 4 };
      return;
    }
    if (q.spent) { // cold: a grey heap of ash to gather, with a black lump of char where coals went out
      g.fillStyle = '#6e6a66'; g.beginPath(); g.ellipse(x, y - 1, w * 0.45, Math.max(1.5, w * 0.16), 0, 0, 7); g.fill();
      g.fillStyle = '#9a958e'; g.fillRect(Math.round(x - w * 0.15), Math.round(y - 2), Math.max(1, Math.round(w * 0.3)), 1);
      if (q.coal) { g.fillStyle = '#141216'; g.fillRect(Math.round(x - 1), Math.round(y - 3), Math.max(2, Math.round(w / 4)), 2); }
      q.box = { x: x - w / 2 - 2, y: y - w * 0.4, w: w + 4, h: w * 0.4 + 4 };
      return;
    }
    g.drawImage(img, Math.round(x - w / 2), Math.round(y - h + 1 - (lifted ? 3 : 0)), w, h);
    if (q.ash && q.ember > 12) { // an ember bed: a pulsing orange glow that a breath brightens
      const e = Math.min(1, q.ember / 180) * (0.75 + 0.25 * Math.sin(time * 2.3 + q.id * 1.7)) * (1 + 0.8 * br);
      g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(x, y - 1, 0, x, y - 1, w * 0.9); gr.addColorStop(0, `rgba(255,${Math.round(90 + 60 * Math.min(1, e))},30,${Math.min(0.9, 0.6 * e)})`); gr.addColorStop(1, 'rgba(200,50,20,0)'); g.fillStyle = gr; g.fillRect(x - w, y - w * 0.6, w * 2, w * 1.1); g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(255,${Math.round(120 + 80 * Math.min(1, e))},50,${Math.min(1, e)})`; for (let i = 0; i < 3; i++) g.fillRect(Math.round(x - w / 3 + i * w / 3 + Math.sin(i * 3 + q.id)), Math.round(y - 1 - (i % 2)), 1, 1);
    }
    if (q.burning) { g.globalCompositeOperation = 'lighter'; const v = Math.min(1.3, q.vigour); g.fillStyle = `rgba(255,${q.air < CHOKE ? 70 : 140},40,${0.18 * v})`; g.beginPath(); g.ellipse(x, y - h * 0.4, w * 0.8, h * 0.7, 0, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; }
    q.box = { x: x - w / 2 - 2, y: y - h - 2, w: w + 4, h: h + 6 };
  }

  // ---------- a vessel and what is in it ----------
  // food changes as it cooks: raw colours, browning, then black
  function itemSprite(it) {
    const I = ING[it.id];
    if (it.scorch >= COOK.overdone) return tinted(it.id, I, '#14100e', Math.min(0.9, 0.25 + it.scorch * 1.2));
    if (S.foodState(it) === 'overdone') return tinted(it.id, I, '#3a2210', 0.6); // dried out: dark brown
    if (it.progress > COOK.warming) return tinted(it.id, I, '#7a4a22', Math.min(0.6, it.progress * 0.5));
    return sprite(it.id, I);
  }
  // a flip, turn or stir: what is in the vessel jumps, and a puff of steam goes up
  const hops = new WeakMap(); let now = 0;
  function tendFx(v) { hops.set(v, now + 0.22); emit('steam', v.x, v.z, 0.1, 3); }
  const hopOf = v => { const u = (hops.get(v) || 0) - now; return u > 0 ? Math.round(Math.sin(u / 0.22 * Math.PI) * 3) : 0; };
  function drawVessel(g, v, time) {
    now = time; const hop = hopOf(v);
    const Vt = VES[v.type], s = sc(v.z), size = (v.type === 'pot' ? 0.2 : v.type === 'pan' ? 0.22 : 0.24) * s, x = sx(v.x, v.z), y = sy(v.z) - s * 0.04;
    const w = Math.round(size), h = Math.round(size * (v.type === 'skewer' ? 0.5 : 0.8));
    g.drawImage(sprite(v.type, Vt), Math.round(x - w / 2), Math.round(y - h), w, h);
    const iw = Math.max(3, Math.round(w * 0.28));
    if (v.type === 'pot') {
      // the surface: dark water, browning as the stew comes together, then a thick stew; dry, a hot glowing floor
      const sx0 = Math.round(x - w * 0.36), sy0 = Math.round(y - h * 0.86), sw0 = Math.round(w * 0.72), sh0 = Math.max(1, Math.round(h * 0.14)), k2 = v.stewed ? 1 : (v.stew || 0);
      if (v.water > 0) { const a = [v.T >= 99 ? 42 : 20, v.T >= 99 ? 42 : 20, v.T >= 99 ? 60 : 30], b = [104, 64, 34]; g.fillStyle = `rgb(${a.map((q, i) => Math.round(q + (b[i] - q) * k2)).join(',')})`; g.fillRect(sx0, sy0, sw0, sh0); }
      else if (v.items.length && v.T > 110) { g.fillStyle = `rgba(255,${v.T > 140 ? 90 : 140},40,${Math.min(0.6, (v.T - 110) / 80)})`; g.fillRect(sx0, sy0 + sh0 - 1, sw0, 1); }
      if (v.stewed && v.water > 0) { if (v.T >= 99) { g.fillStyle = '#c08a50'; g.fillRect(Math.round(x - w * 0.15 + Math.sin(time * 3) * w * 0.15), sy0, 1, 1); } }
      else v.items.filter(it => !ING[it.id].water).forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.3 + k * iw * 0.8 + Math.sin(time * 2 + k) * (v.T >= 99 ? 1 : 0)), Math.round(y - h * 0.98) - hop, iw, iw));
    } else if (v.type === 'pan') v.items.forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.36 + k * iw * 0.9), Math.round(y - h * 0.82) - hop, iw, iw));
    else v.items.forEach((it, k) => g.drawImage(itemSprite(it), Math.round(x - w * 0.2 + k * iw * 1.1), Math.round(y - h * 0.9) - hop, iw, iw));
    v.box = { x: x - w / 2 - 2, y: y - h - iw / 2 - 2, w: w + 4, h: sy(v.z) + 8 - (y - h - iw / 2 - 2) }; // down to the floor it stands on
    if (v.items.length && S.judge(v).dish) { g.fillStyle = `rgba(243,211,107,${0.25 + 0.2 * Math.sin(time * 3)})`; g.fillRect(Math.round(x - 1), Math.round(y - h - iw), 2, 2); }
  }

  // ---------- you: your hands, and the charms ----------
  function drawHands(g) {
    const b = V.st.L.hands, drag = V.drag; g.fillStyle = '#b89a86';
    g.beginPath(); g.ellipse(b.x + 14, b.y + b.h, 16, 14, -0.3, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(b.x + b.w - 14, b.y + b.h, 16, 14, 0.3, Math.PI, 0); g.fill();
    g.fillStyle = '#8a6a5a'; for (let k = 0; k < 4; k++) { g.fillRect(b.x + 6 + k * 4, b.y + b.h - 13 + Math.abs(k - 1.5), 1, 5); g.fillRect(b.x + b.w - 18 + k * 4, b.y + b.h - 13 + Math.abs(k - 1.5), 1, 5); }
    if (drag && drag.from === 'vessel' && drag.moved) { g.strokeStyle = 'rgba(243,211,107,0.5)'; g.strokeRect(b.x, b.y, b.w, b.h); }
  }
  // the five charms: a blood vial, the soul lantern, a bowl, a waterskin and a candle stub, hung from a cord.
  // The body screen draws them too, on its own canvas.
  function drawCharms(g, charms, stats, time) {
    g.strokeStyle = '#4a4038'; g.beginPath(); g.moveTo(0, 6); charms.forEach(b => g.lineTo(b.x + b.w / 2, b.y - 2)); g.stroke();
    charms.forEach(b => {
      const v = stats[b.key], x = b.x, y = b.y, w = b.w, h = b.h, sway = Math.round(Math.sin(time * 1.1 + b.x) * 0.6);
      g.strokeStyle = '#4a4038'; g.beginPath(); g.moveTo(x + w / 2, y - 6); g.lineTo(x + w / 2 + sway, y); g.stroke();
      const X = x + sway;
      if (b.key === 'health') { g.fillStyle = '#2a2026'; g.fillRect(X + 2, y, w - 4, h); const f = Math.round((h - 2) * v / 100); g.fillStyle = '#a0182a'; g.fillRect(X + 3, y + h - 1 - f, w - 6, f); g.fillStyle = '#d8d0c0'; g.fillRect(X + 3, y - 2, w - 6, 2); }
      else if (b.key === 'soul') { g.fillStyle = '#3a3440'; g.fillRect(X + 1, y, w - 2, h - 4); g.fillStyle = '#14101c'; g.fillRect(X + 2, y + 2, w - 4, h - 8); const a = Math.max(0.05, v / 100) * (0.8 + 0.2 * Math.sin(time * 4)); g.fillStyle = `rgba(185,178,216,${a})`; const r = Math.max(1, Math.round((w - 6) * (0.4 + v / 160))); g.fillRect(Math.round(X + w / 2 - r / 2), Math.round(y + (h - 4) / 2 - r / 2), r, r); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(185,178,216,${a * 0.25})`; g.fillRect(X - 2, y - 2, w + 4, h); g.globalCompositeOperation = 'source-over'; }
      else if (b.key === 'hunger') { g.fillStyle = '#5a4a3a'; g.beginPath(); g.ellipse(X + w / 2, y + h - 6, w / 2, 5, 0, 0, Math.PI); g.fill(); const full = 1 - v / 100; g.fillStyle = '#8a6a3a'; g.fillRect(X + 2, Math.round(y + h - 6 - 4 * full), w - 4, Math.max(0, Math.round(4 * full))); }
      else if (b.key === 'thirst') { g.fillStyle = '#4a3a2a'; g.beginPath(); g.ellipse(X + w / 2, y + h / 2 + 2, w / 2, h / 2 - 2, 0, 0, 7); g.fill(); const full = 1 - v / 100; g.fillStyle = '#2d5f7a'; const fh = Math.round((h - 6) * full); g.fillRect(X + 2, y + h - 2 - fh, w - 4, fh); g.fillStyle = '#3a2a1a'; g.fillRect(X + w / 2 - 1, y, 2, 3); }
      else { const len = Math.round((h - 4) * (1 - v / 100)) + 2; g.fillStyle = '#d8ccb0'; g.fillRect(X + 3, y + h - len, w - 6, len); g.fillStyle = '#5a5048'; g.fillRect(X + 1, y + h, w - 2, 2); if (len > 3) { g.fillStyle = `rgba(255,${190 + 40 * Math.sin(time * 13)},90,0.9)`; g.fillRect(X + w / 2 - 1, y + h - len - 3, 2, 3); } }
    });
  }

  root.CampDraw = { buildFloor, draw, drawCharms, emit, breathe, emitFrom, stepParts, tendFx };
})(window);
