// Body: the treatment screen. A table by candlelight: the pilgrims' anatomical chart, The Pilgrim's Body, on which
// your afflictions show as living ink; the surgeon's roll of tools along the front edge; the omen bones that roll
// what takes hold of you next; an hourglass to let time pass; the charms. Drag a tool onto a part of the body to use
// it there. Touch anything for a note.
(function (root) {
  const B = root.BodySim, PARTS = root.BODY_PARTS, TOOLS = root.BODY_TOOLS, AIL = root.BODY_AILMENTS;
  let el = null, cv, g, LW = 480, LH = 270, raf = 0, last = 0, st = null, onLeave = null, table = null;
  const SAVE = 'undercroft-body-v1';
  const TOOL_KEYS = Object.keys(TOOLS);

  // shared with the camp: the same stats, and the camp's fire (the cautery iron needs it)
  const camp = () => root.Camp && Camp.shared();
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.afflictions) return s; } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(st.b)); } catch (e) { /* storage unavailable */ } }
  function body() { if (!st) { st = { b: load() || B.createBody(Date.now() % 100000), selected: null, saveAt: 0, flash: [] }; } return st.b; }
  // time passes on whichever screen is open: the camp calls this too
  function tick(dt) { if (!st && !load()) return; const c = camp(); B.step(body(), dt, c ? c.stats : null); }

  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'camp body-screen'; el.hidden = true;
    el.innerHTML = `<canvas aria-label="Treatment: drag a tool from the roll onto a part of the body on the chart; touch the bones to roll what takes hold next, the hourglass to let time pass"></canvas><div class="camp-note" hidden></div>`;
    document.body.appendChild(el);
    cv = el.querySelector('canvas'); g = cv.getContext('2d');
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    window.addEventListener('keydown', e => { if (!el.hidden && e.key === 'Escape') leave(); });
  }
  function size() {
    const r = el.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    LH = 270; LW = Math.max(300, Math.min(760, Math.round(LH * aspect)));
    if (aspect < 1) { LW = 360; LH = Math.round(LW / aspect); }
    cv.width = LW; cv.height = LH; g.imageSmoothingEnabled = false;
    // the chart: a sheet of parchment in the middle of the table
    const ph = LH - 64, pw = Math.round(ph * 0.82), px = Math.round(LW * 0.44 - pw / 2), py = 8;
    st.chart = { x: px, y: py, w: pw, h: ph, k: (ph - 20) / 140, ox: px + pw / 2 - 50 * (ph - 20) / 140, oy: py + 10 };
    const slot = Math.min(26, Math.floor((LW - 40) / TOOL_KEYS.length));
    st.roll = { x: Math.round(LW / 2 - slot * TOOL_KEYS.length / 2) - 6, y: LH - 44, w: slot * TOOL_KEYS.length + 12, h: 40, slot };
    st.bones = { x: Math.round(LW * 0.78), y: 34, w: 30, h: 20 };
    st.glass = { x: Math.round(LW * 0.9), y: 24, w: 14, h: 30 };
    st.ear = { x: st.chart.x + st.chart.w - 14, y: st.chart.y + st.chart.h - 14, w: 14, h: 14 };
    buildTable();
  }
  function buildTable() {
    table = document.createElement('canvas'); table.width = LW; table.height = LH; const x = table.getContext('2d');
    for (let yy = 0; yy < LH; yy += 22) { // planks
      const shade = 34 + ((yy / 22) % 3) * 4; x.fillStyle = `rgb(${shade + 8},${shade - 4},${shade - 12})`; x.fillRect(0, yy, LW, 21);
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, yy + 21, LW, 1);
      for (let k = 0; k < LW; k += 3) if (Math.sin(k * 0.37 + yy) > 0.7) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(k, yy + 4 + ((k * 7) % 12), 3, 1); }
    }
  }
  function open(leaveFn) {
    ui(); onLeave = leaveFn; body();
    el.hidden = false; document.documentElement.classList.add('xp-open');
    size();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    if (!st.b.afflictions.length) note('The Pilgrim\'s Body. Nothing has taken hold of you yet. The bones will tell you what does.', LW / 2, LH * 0.35, 4500);
  }
  function leave(silent) { el.hidden = true; cancelAnimationFrame(raf); raf = 0; save(); const c = camp(); if (c && root.Camp) Camp.save(); if (onLeave && silent !== true) onLeave(); }

  let noteTimer = null;
  function note(text, x, y, ms) {
    const n = el.querySelector('.camp-note'), r = cv.getBoundingClientRect();
    n.textContent = text; n.hidden = false;
    const px = r.left + x / LW * r.width, py = r.top + y / LH * r.height;
    n.style.left = Math.max(8, Math.min(r.width - 230, px - 110)) + 'px'; n.style.top = Math.max(8, Math.min(r.height - 110, py - 80)) + 'px';
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.hidden = true; }, ms || 3000);
  }

  // ---------- the chart: which part is under a point ----------
  function chartPt(p) { const c = st.chart; return { x: (p.x - c.ox) / c.k, y: (p.y - c.oy) / c.k }; }
  function inShape(sh, q) {
    if (sh.e) { const [cx, cy, rx, ry] = sh.e; return ((q.x - cx) / rx) ** 2 + ((q.y - cy) / ry) ** 2 <= 1; }
    let inside = false; const P = sh.p;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > q.y) !== (yj > q.y) && q.x < (xj - xi) * (q.y - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
  }
  const partAt = p => { const q = chartPt(p); return Object.keys(PARTS).find(k => inShape(PARTS[k].shape, q)) || null; };
  function shapePath(sh) {
    const c = st.chart; g.beginPath();
    if (sh.e) { const [cx, cy, rx, ry] = sh.e; g.ellipse(c.ox + cx * c.k, c.oy + cy * c.k, rx * c.k, ry * c.k, 0, 0, 7); }
    else sh.p.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, c.ox + x * c.k, c.oy + y * c.k));
    g.closePath();
  }
  const bbox = sh => { if (sh.e) { const [cx, cy, rx, ry] = sh.e; return [cx - rx, cy - ry, cx + rx, cy + ry]; } const xs = sh.p.map(p => p[0]), ys = sh.p.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

  // ---------- input ----------
  let drag = null;
  const P = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH }; };
  const inBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  const toolAt = p => { const r = st.roll; if (!inBox(p, r)) return null; const k = Math.floor((p.x - r.x - 6) / r.slot); return TOOL_KEYS[k] || null; };
  function down(e) { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); const p = P(e); drag = { tool: toolAt(p), start: p, p, moved: false }; }
  function mv(e) { if (!drag) return; drag.p = P(e); if (Math.hypot(drag.p.x - drag.start.x, drag.p.y - drag.start.y) > 3) drag.moved = true; }
  const fireHot = () => { const c = camp(); return !!(c && root.CampSim && CampSim.burning(c)); };
  const STEP_WORDS = ['', 'One thing done.', 'Two things done.', 'Three things done.', 'Four things done.'];
  function up(e) {
    if (!drag) return; const d = drag, p = P(e), b = st.b, c = camp(); drag = null;
    if (d.tool && d.moved) {
      const part = partAt(p); if (!part) return;
      const r = B.apply(b, part, d.tool, { fireHot: fireHot() }, c ? c.stats : null), T = TOOLS[d.tool], where = PARTS[part].name.toLowerCase();
      st.flash.push({ part, t: performance.now(), ok: r.ok });
      if (r.why === 'healthy') return note(`Nothing has taken your ${where}. Save the ${T.name.toLowerCase()}.`, p.x, p.y);
      if (r.why === 'none left') return note(`No ${T.name.toLowerCase()} left.`, p.x, p.y);
      if (r.why === 'cold') return note('The iron is cold. It wants the camp fire, burning, before it will do anything.', p.x, p.y, 3800);
      if (r.why === 'wrong') return note(`Not that. The ${T.name.toLowerCase()} only hurt, and the ${AIL[r.affliction.key].name} did not care.`, p.x, p.y, 3600);
      if (r.cured) { save(); return note(`The ${AIL[r.affliction.key].name} is gone from your ${where}.`, p.x, p.y, 3600); }
      return note(`${T.name}. ${STEP_WORDS[r.next] || 'More done.'} Keep going.`, p.x, p.y);
    }
    if (d.moved) return;
    if (d.tool) { const T = TOOLS[d.tool], left = b.tools[d.tool]; return note(`${T.name}${left >= 0 ? ` (${left} left)` : ''}. ${T.note}`, p.x, p.y - 20, 3600); }
    if (inBox(p, st.bones)) {
      const a = B.roll(b); save();
      return note(a ? `The bones fall. ${AIL[a.key].name} takes your ${PARTS[a.part].name.toLowerCase()}: ${AIL[a.key].stages[0].look}` : 'The bones fall, and say nothing new.', p.x - 40, p.y + 60, 4500);
    }
    if (inBox(p, st.glass)) { const cc = camp(); for (let k = 0; k < 300; k++) { B.step(b, 1, cc ? cc.stats : null); if (cc && root.CampSim) CampSim.step(cc, 1); } save(); return note('You turn the glass and wait. Time passes; nothing waits with you.', p.x - 60, p.y + 60, 3200); }
    if (inBox(p, st.ear)) return leave();
    const ch = (st.charms || []).find(k => inBox(p, { x: k.x - 2, y: 0, w: k.w + 4, h: k.y + k.h + 4 }));
    if (ch && c) return note(`${CHARM_NAME[ch.key]}. ${WORDS[ch.key](c.stats[ch.key])}`, p.x + 20, p.y + 30);
    const part = partAt(p);
    if (part) {
      const here = b.afflictions.filter(a => a.part === part);
      if (!here.length) return note(`Your ${PARTS[part].name.toLowerCase()}. Clean, for now.`, p.x, p.y);
      return note(`${PARTS[part].name}: ` + here.map(a => { const A = AIL[a.key], s = A.stages[a.stage]; return `${A.name}, ${s.name}. ${s.look} ${a.step ? STEP_WORDS[a.step] + ' ' : ''}The pilgrims wrote: "${s.lore}"`; }).join(' / '), p.x, p.y, 7000);
    }
  }
  const CHARM_NAME = { health: 'Blood vial', soul: 'Soul lantern', hunger: 'Bowl', thirst: 'Waterskin', exhaustion: 'Candle stub' };
  const WORDS = {
    health: v => v > 80 ? 'Whole.' : v > 55 ? 'Bruised, steady.' : v > 30 ? 'Hurt.' : v > 10 ? 'Bleeding.' : 'Dying.',
    soul: v => v > 80 ? 'Bright.' : v > 55 ? 'Holding.' : v > 30 ? 'Thinning.' : v > 10 ? 'Guttering.' : 'Almost out.',
    hunger: v => v < 20 ? 'Full.' : v < 45 ? 'Fed.' : v < 70 ? 'Hungry.' : v < 88 ? 'Starving.' : 'Eating itself.',
    thirst: v => v < 20 ? 'Slaked.' : v < 45 ? 'Fine.' : v < 70 ? 'Thirsty.' : v < 88 ? 'Parched.' : 'Cracking.',
    exhaustion: v => v < 20 ? 'Rested.' : v < 45 ? 'Tired.' : v < 70 ? 'Worn.' : v < 88 ? 'Spent.' : 'Falling.',
  };

  // ---------- drawing ----------
  const sprites = {};
  function sprite(key, art) { if (sprites[key]) return sprites[key]; const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); art.px.forEach((row, y) => [...row].forEach((ch, i) => { if (art.pal[ch]) { x.fillStyle = art.pal[ch]; x.fillRect(i, y, 1, 1); } })); return (sprites[key] = c); }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const c = camp();
    B.step(st.b, dt, c ? c.stats : null);
    if (c && root.CampSim) CampSim.step(c, dt); // the fire keeps burning while you see to yourself
    if (t - st.saveAt > 5000) { st.saveAt = t; save(); }
    draw(t / 1000);
  }
  // seeded scatter so marks hold still from frame to frame
  const hr = (a, k) => { let h = Math.imul(a * 7919 + k, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  function drawMark(a, time) {
    const A = AIL[a.key], sh = PARTS[a.part].shape, c = st.chart, [x0, y0, x1, y1] = bbox(sh), sev = a.stage + Math.min(1, a.progress);
    const pt = k => ({ x: c.ox + (x0 + hr(a.id, k) * (x1 - x0)) * c.k, y: c.oy + (y0 + hr(a.id, k + 500) * (y1 - y0)) * c.k });
    g.save(); shapePath(sh); g.clip();
    g.fillStyle = A.mark; g.strokeStyle = A.mark;
    const n = Math.round(4 + sev * 7);
    if (A.kind === 'specks') {
      if (a.stage === 2) { g.fillStyle = '#05040a'; g.globalAlpha = 0.8; const q = pt(1); g.beginPath(); g.ellipse(q.x, q.y, 6 * c.k, 4 * c.k, 0, 0, 7); g.fill(); g.globalAlpha = 1; g.fillStyle = A.mark; }
      for (let k = 0; k < n; k++) { const q = pt(k); const tw = 0.6 + 0.4 * Math.sin(time * 3 + k); g.globalAlpha = tw; g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); }
      if (a.stage >= 1) { g.globalAlpha = 0.5; g.beginPath(); for (let k = 0; k < n - 1; k += 2) { const q = pt(k), r = pt(k + 1); g.moveTo(q.x, q.y); g.lineTo(r.x, r.y); } g.stroke(); }
    } else if (A.kind === 'mouth' || A.kind === 'hollow') {
      const m = A.kind === 'hollow' ? 1 : Math.round(1 + sev * 1.5);
      for (let k = 0; k < m; k++) { const q = A.kind === 'hollow' ? { x: c.ox + 50 * c.k, y: c.oy + 52 * c.k } : pt(k * 3); const r = (1.5 + sev * 1.4) * c.k * (A.kind === 'hollow' ? 1.4 : 0.7);
        g.globalAlpha = 0.7; g.beginPath(); g.ellipse(q.x, q.y, r, r * 0.7, 0, 0, 7); g.fill();
        if (a.stage === 2) { g.fillStyle = '#14080c'; g.beginPath(); g.ellipse(q.x, q.y, r * 0.7, r * 0.3 * (0.6 + 0.4 * Math.sin(time * 2)), 0, 0, 7); g.fill(); g.fillStyle = '#e8e0c8'; for (let tt = -2; tt <= 2; tt++) g.fillRect(Math.round(q.x + tt * r * 0.25), Math.round(q.y - r * 0.15), 1, 1); g.fillStyle = A.mark; } }
    } else if (A.kind === 'glyph') {
      g.globalAlpha = 0.6 + 0.3 * Math.sin(time * 5); g.lineWidth = 1;
      for (let k = 0; k < n; k++) { const q = pt(k), s = 2 * c.k; g.beginPath(); g.moveTo(q.x - s, q.y); g.lineTo(q.x, q.y - s); g.lineTo(q.x + s, q.y); if (hr(a.id, k + 9) > 0.5) g.lineTo(q.x, q.y + s); g.stroke(); }
    } else if (A.kind === 'eye') {
      const q = { x: c.ox + 50 * c.k, y: c.oy + 9 * c.k }, open = [0.2, 0.55, 1][a.stage] * (0.85 + 0.15 * Math.sin(time * 0.7)), r = 4 * c.k;
      g.fillStyle = '#e8e2cf'; g.beginPath(); g.ellipse(q.x, q.y, r, r * open * 0.6, 0, 0, 7); g.fill();
      g.fillStyle = A.mark; g.beginPath(); g.ellipse(q.x + Math.sin(time * 0.5) * r * 0.3, q.y, r * 0.45 * open, r * 0.45 * open, 0, 0, 7); g.fill();
      g.fillStyle = '#0b1a12'; g.fillRect(Math.round(q.x + Math.sin(time * 0.5) * r * 0.3), Math.round(q.y), 1, 1);
    } else if (A.kind === 'threads' || A.kind === 'burrow' || A.kind === 'crack') {
      g.globalAlpha = 0.75; g.lineWidth = 1;
      for (let k = 0; k < Math.round(2 + sev * 3); k++) { let q = pt(k * 2); g.beginPath(); g.moveTo(q.x, q.y); for (let s = 0; s < 4; s++) { const ang = hr(a.id, k * 10 + s) * 6.28, len = (A.kind === 'crack' ? 4 : 3) * c.k; q = { x: q.x + Math.cos(ang) * len, y: q.y + Math.sin(ang) * len }; g.lineTo(q.x + (A.kind === 'burrow' ? Math.sin(time * 4 + s) : 0), q.y); } g.stroke();
        if (A.kind === 'threads' && a.stage >= 1) { g.fillRect(Math.round(q.x - 1), Math.round(q.y - 1), 3, 2); } }
    } else if (A.kind === 'water') {
      const lvl = (0.25 + sev * 0.22) * (y1 - y0); g.globalAlpha = 0.45; g.fillRect(c.ox + x0 * c.k, c.oy + (y1 - lvl + Math.sin(time * 1.5) * 1.2) * c.k, (x1 - x0) * c.k, lvl * c.k);
    } else if (A.kind === 'fade') {
      g.globalAlpha = 0.25 + sev * 0.18; g.fillStyle = '#d9ccae'; g.fillRect(c.ox + x0 * c.k, c.oy + y0 * c.k, (x1 - x0) * c.k, (y1 - y0) * c.k);
      g.globalAlpha = 0.3; g.fillStyle = A.mark; for (let k = 0; k < n; k++) { const q = pt(k); g.fillRect(Math.round(q.x), Math.round(q.y), 2, 1); }
    }
    g.restore();
    // ink ticks for treatment done so far
    if (a.step) { const q = pt(77); g.fillStyle = '#2a2018'; for (let k = 0; k < a.step; k++) g.fillRect(Math.round(q.x + k * 2), Math.round(q.y - 6), 1, 3); }
  }
  function draw(time) {
    const b = st.b, c = st.chart, cs = camp();
    g.globalAlpha = 1; g.drawImage(table, 0, 0);
    // candlelight
    const lx = LW * 0.86, ly = LH * 0.5, gr = g.createRadialGradient(lx, ly, 4, lx, ly, LW * 0.8);
    gr.addColorStop(0, 'rgba(255,190,110,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, LW, LH);
    g.fillStyle = '#d8ccb0'; g.fillRect(Math.round(lx) - 2, Math.round(ly) - 2, 5, 12); g.fillStyle = `rgba(255,${200 + 30 * Math.sin(time * 13)},90,1)`; g.fillRect(Math.round(lx), Math.round(ly) - 6, 2, 4);
    // parchment
    g.fillStyle = '#d9ccae'; g.fillRect(c.x, c.y, c.w, c.h); g.fillStyle = 'rgba(120,90,50,0.18)'; g.fillRect(c.x, c.y, c.w, 2); g.fillRect(c.x, c.y + c.h - 2, c.w, 2);
    g.fillStyle = '#c8b994'; g.beginPath(); g.moveTo(st.ear.x, st.ear.y + st.ear.h); g.lineTo(st.ear.x + st.ear.w, st.ear.y); g.lineTo(st.ear.x + st.ear.w, st.ear.y + st.ear.h); g.closePath(); g.fill(); // the dog-ear: fold it away
    g.fillStyle = 'rgba(42,32,24,0.7)'; g.font = `${Math.max(7, Math.round(c.k * 4.2))}px "IM Fell English SC", serif`; g.textAlign = 'center'; g.fillText('The Pilgrim\'s Body', c.x + c.w / 2, c.y + c.h - 4);
    // the body: ink outline, parts washed where something has taken hold
    Object.entries(PARTS).forEach(([k, p]) => {
      const here = b.afflictions.filter(a => a.part === k);
      shapePath(p.shape); g.fillStyle = here.length ? `rgba(120,40,40,${Math.min(0.35, 0.08 + 0.06 * here.reduce((s, a) => s + a.stage + 1, 0))})` : 'rgba(120,90,50,0.08)'; g.fill();
      g.strokeStyle = '#3a2c20'; g.lineWidth = 1; g.stroke();
    });
    b.afflictions.forEach(a => drawMark(a, time));
    // a flash where a tool was used: green for right, red for wrong
    st.flash = st.flash.filter(f => performance.now() - f.t < 600);
    st.flash.forEach(f => { shapePath(PARTS[f.part].shape); g.fillStyle = f.ok ? 'rgba(120,200,120,0.25)' : 'rgba(220,60,60,0.3)'; g.fill(); });
    // the omen bones and the hourglass
    const bo = st.bones; g.fillStyle = '#e8e0c8'; g.fillRect(bo.x, bo.y + 6, 12, 10); g.fillRect(bo.x + 16, bo.y + 2, 11, 11); g.fillStyle = '#2a2018';
    [[3, 9], [8, 13], [5, 11], [19, 5], [23, 9]].forEach(([dx, dy]) => g.fillRect(bo.x + dx, bo.y + dy, 1, 1));
    const gl = st.glass; g.fillStyle = '#5a4030'; g.fillRect(gl.x, gl.y, gl.w, 2); g.fillRect(gl.x, gl.y + gl.h - 2, gl.w, 2);
    g.fillStyle = 'rgba(200,220,255,0.35)'; g.beginPath(); g.moveTo(gl.x + 2, gl.y + 2); g.lineTo(gl.x + gl.w - 2, gl.y + 2); g.lineTo(gl.x + gl.w / 2 + 1, gl.y + gl.h / 2); g.lineTo(gl.x + gl.w - 2, gl.y + gl.h - 2); g.lineTo(gl.x + 2, gl.y + gl.h - 2); g.lineTo(gl.x + gl.w / 2 - 1, gl.y + gl.h / 2); g.closePath(); g.fill();
    g.fillStyle = '#d9b86a'; const sand = (b.t / 20) % 1; g.fillRect(gl.x + 4, gl.y + gl.h - 3 - Math.round(sand * 10), gl.w - 8, Math.round(sand * 10)); g.fillRect(gl.x + gl.w / 2 - 0.5, gl.y + gl.h / 2, 1, gl.h / 2 - 3);
    // the surgeon's roll
    const r = st.roll; g.fillStyle = '#4a3424'; g.fillRect(r.x, r.y, r.w, r.h); g.strokeStyle = '#6a5438'; g.setLineDash([2, 2]); g.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); g.setLineDash([]);
    TOOL_KEYS.forEach((k, i) => {
      const x = r.x + 6 + i * r.slot, left = b.tools[k], T = TOOLS[k], cold = T.needsFire && !(cs && root.CampSim && CampSim.burning(cs));
      g.globalAlpha = left === 0 ? 0.25 : 1; g.drawImage(sprite(k, T), x + 2, r.y + 6, r.slot - 6, r.slot - 6);
      if (cold) { g.globalAlpha = 0.55; g.fillStyle = '#3a3a42'; g.fillRect(x + r.slot - 9, r.y + 6, 4, 4); } // the iron's tip is dark when the fire is out
      g.globalAlpha = 1;
      if (left > 0) { g.fillStyle = 'rgba(230,220,200,0.6)'; for (let t = 0; t < Math.min(left, 8); t++) g.fillRect(x + 2 + t * 2, r.y + r.h - 7, 1, 3); }
    });
    drawCharms(time);
    if (drag && drag.tool && drag.moved) { g.globalAlpha = 0.9; g.drawImage(sprite(drag.tool, TOOLS[drag.tool]), Math.round(drag.p.x - 9), Math.round(drag.p.y - 9), 18, 18); g.globalAlpha = 1; const part = partAt(drag.p); if (part) { shapePath(PARTS[part].shape); g.strokeStyle = 'rgba(243,211,107,0.8)'; g.stroke(); } }
    // vignette
    const v = g.createRadialGradient(LW / 2, LH / 2, LH * 0.4, LW / 2, LH / 2, LW * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = v; g.fillRect(0, 0, LW, LH);
  }
  function drawCharms(time) {
    const cs = camp(); if (!cs) return;
    st.charms = ['health', 'soul', 'hunger', 'thirst', 'exhaustion'].map((k, i) => ({ key: k, x: 6 + i * 13, y: 18 + (i % 2) * 10, w: 11, h: 22 }));
    if (root.Camp && Camp.drawCharms) Camp.drawCharms(g, st.charms, cs.stats, time);
  }

  root.Body = { open, leave, tick, state: () => st };
})(window);
