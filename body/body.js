// Body: the treatment screen. A table by candlelight with the pilgrims' anatomical chart, The Pilgrim's Body, on
// which your afflictions show as living ink; the surgeon's roll of tools along the front edge; the omen bones that
// roll what takes hold of you next; an hourglass to let time pass. Your needs (HP and SOUL first) run along the top.
//
// Touch an afflicted part to examine it: an X-ray of the part, the wound circled, and beside it the affliction's
// status (as in Metal Gear Solid 3's cure screen): what it is, what it looks like, how close it is to worsening,
// and its cure, step by step. You do not know any of that at first: an ailment is "???" and each step "?" until
// you find the right tool by trying them (body/sim.js keeps what you have learnt). Drag a tool onto the X-ray or
// the panel to use it on the wound; drag one onto the chart to use it on that part.
//
//   body/chart.js   drawing the body: parts, marks, skeleton
//   body/sim.js     afflictions, treatment, discovery         body/data.js   parts, tools, ailments
(function (root) {
  const B = root.BodySim, PARTS = root.BODY_PARTS, TOOLS = root.BODY_TOOLS, AIL = root.BODY_AILMENTS, C = root.BodyChart;
  let el = null, cv, g, LW = 480, LH = 270, raf = 0, last = 0, st = null, onLeave = null, table = null;
  const SAVE = 'undercroft-body-v1';
  const TOOL_KEYS = Object.keys(TOOLS);
  const NEEDS = [ // the bars along the top: HP and SOUL large; the rest small, filling as the need grows
    { k: 'health', label: 'HP', big: true }, { k: 'soul', label: 'Soul', big: true },
    { k: 'hunger', label: 'Hunger' }, { k: 'thirst', label: 'Thirst' }, { k: 'exhaustion', label: 'Fatigue' },
  ];

  // shared with the camp: the same stats, and the camp's fire (the cautery iron needs it)
  const camp = () => root.Camp && Camp.shared();
  const advanceCamp = dt => { if (root.Camp && Camp.advance) Camp.advance(dt); };
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE)); if (s && s.afflictions) return B.upgrade(s); } catch (e) { /* storage unavailable */ } return null; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(st.b)); } catch (e) { /* storage unavailable */ } }
  function body() { if (!st) { st = { b: load() || B.createBody(Date.now() % 100000), saveAt: 0, uiAt: 0, flash: [], exam: null }; } return st.b; }
  // time passes on whichever screen is open: the camp calls this too
  function tick(dt) { if (!st && !load()) return; const c = camp(); B.step(body(), dt, c ? c.stats : null); }

  // ---------- the screen ----------
  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'camp body-screen'; el.hidden = true;
    el.innerHTML = `<canvas aria-label="Treatment: touch an afflicted part to examine it; drag a tool from the roll onto it to use it"></canvas>
      <div class="bx-needs" role="group" aria-label="Your needs">${NEEDS.map(n => `<div class="need ${n.big ? 'big' : 'sm'}" data-s="${n.k}"><b>${n.label}</b><div class="bar" role="meter" aria-label="${n.label}" aria-valuemin="0" aria-valuemax="100"><i></i></div>${n.big ? '<span class="v"></span><span class="dr" aria-hidden="true"></span>' : ''}</div>`).join('')}</div>
      <section class="bx-panel" hidden aria-live="polite"></section>
      <div class="camp-note" hidden></div>`;
    document.body.appendChild(el);
    cv = el.querySelector('canvas'); g = cv.getContext('2d');
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    el.querySelector('.bx-panel').addEventListener('click', panelClick);
    window.addEventListener('resize', () => { if (!el.hidden) size(); });
    window.addEventListener('keydown', e => { if (el.hidden || e.key !== 'Escape') return; if (st.exam) examine(null); else leave(); });
  }
  function size() {
    const r = el.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    LH = 270; LW = Math.max(300, Math.min(760, Math.round(LH * aspect)));
    if (aspect < 1) { LW = 360; LH = Math.round(LW / aspect); }
    cv.width = LW; cv.height = LH; g.imageSmoothingEnabled = false;
    const toLow = px => px * LH / Math.max(1, r.height);
    const top = Math.ceil(toLow(el.querySelector('.bx-needs').getBoundingClientRect().bottom - r.top)) + 4; // below the needs
    const slot = Math.min(26, Math.floor((LW - 40) / TOOL_KEYS.length));
    st.rollChart = { x: Math.round(LW / 2 - slot * TOOL_KEYS.length / 2) - 6, y: LH - 44, w: slot * TOOL_KEYS.length + 12, h: 40, slot };
    // the chart: a sheet of parchment between the needs and the roll, never wider than the table
    let ph = st.rollChart.y - top - 8, pw = Math.round(ph * 0.82);
    if (pw > LW - 16) { pw = LW - 16; ph = Math.round(pw / 0.82); }
    const px = Math.round(Math.max(8, Math.min(LW - pw - 8, LW * 0.44 - pw / 2))), py = top + Math.max(0, Math.round((st.rollChart.y - 8 - top - ph) / 2));
    const k = (ph - 20) / 140;
    st.chart = { x: px, y: py, w: pw, h: ph, k, ox: px + pw / 2 - 50 * k, oy: py + 10 };
    st.bones = { x: Math.min(LW - 72, Math.round(LW * 0.78)), y: top + 10, w: 30, h: 20 };
    st.glass = { x: Math.min(LW - 22, Math.round(LW * 0.9)), y: top, w: 14, h: 30 };
    st.ear = { x: st.chart.x + st.chart.w - 14, y: st.chart.y + st.chart.h - 14, w: 14, h: 14 };
    // examining: the X-ray to one side (left, or the top in portrait) and the status panel beside it
    // (in landscape the roll moves under the X-ray, so the panel can run the full height beside both)
    const portrait = aspect < 1, bottom = st.rollChart.y - 6;
    st.rollExam = portrait ? st.rollChart : { ...st.rollChart, x: 8 };
    st.xr = portrait ? { x: 8, y: top, w: LW - 16, h: Math.round((bottom - top) * 0.5) } : { x: 8, y: top, w: Math.max(Math.round(LW * 0.52), st.rollExam.w), h: bottom - top };
    const css = v => v / LH * r.height, cssX = v => v / LW * r.width, P = el.querySelector('.bx-panel').style;
    if (portrait) { P.left = '8px'; P.right = '8px'; P.top = css(st.xr.y + st.xr.h + 6) + 'px'; P.bottom = (r.height - css(bottom)) + 'px'; }
    else { P.left = cssX(st.xr.x + st.xr.w + 8) + 'px'; P.right = '8px'; P.top = css(top) + 'px'; P.bottom = '8px'; }

    el.classList.toggle('portrait', portrait);
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
    needs(); size(); panel();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
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

  // ---------- examining an affliction ----------
  const examined = () => st.exam && st.b.afflictions.find(a => a.id === st.exam.id);
  // look closely at an affliction (or at the worst on a part), or back to the chart (null)
  function examine(part, id) {
    if (!part) { st.exam = null; panel(); return; }
    const here = st.b.afflictions.filter(a => a.part === part);
    if (!here.length) { st.exam = null; panel(); return; }
    const a = here.find(x => x.id === id) || here.find(x => x.step > 0) || here.slice().sort((x, y) => y.stage - x.stage || x.born - y.born)[0];
    st.exam = { part, id: a.id }; panel();
  }
  // the X-ray's transform: the part, with some of what is around it, filling the X-ray
  function xrayTf() {
    const r = st.xr, [x0, y0, x1, y1] = C.bbox(PARTS[st.exam.part].shape), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.min(r.w / ((x1 - x0) * 1.7 + 12), r.h / ((y1 - y0) * 1.3 + 12));
    return { k, ox: r.x + r.w / 2 - cx * k, oy: r.y + r.h / 2 - cy * k };
  }

  // ---------- the status panel (the side of the cure screen) ----------
  const toolIcon = k => `<canvas width="8" height="8" data-t="${k}" aria-hidden="true"></canvas>`;
  function panel(force) {
    const P = el.querySelector('.bx-panel'), a = examined();
    if (!a) { if (st.exam && st.exam.cured) return; st.exam = null; P.hidden = true; P.dataset.key = ''; el.classList.remove('examining'); return; }
    el.classList.add('examining'); P.hidden = false;
    const ch = B.chart(st.b, a), here = st.b.afflictions.filter(x => x.part === a.part);
    // rebuild only when what you can read changes, so it holds still under your finger
    const { progress, ...still } = ch, key = JSON.stringify([still, here.map(x => x.id + ':' + (B.chart(st.b, x).name || '?'))]);
    if (P.dataset.key === key && !force) return liveBits(P, ch);
    P.dataset.key = key;
    const A = AIL[a.key], tabs = here.length > 1 ? `<div class="tabs" role="tablist">${here.map(x => { const n = B.chart(st.b, x).name || '???'; return `<button type="button" role="tab" data-id="${x.id}" aria-selected="${x.id === a.id}" style="--m:${AIL[x.key].mark}">${n}</button>`; }).join('')}</div>` : '';
    const steps = ch.steps.map((s, i) => `<li class="${s.done ? 'done' : s.now ? 'now' : ''} ${s.tool ? 'known' : 'unknown'}" data-i="${i}">
        <span class="n">${i + 1}</span>${s.tool ? toolIcon(s.tool) : '<span class="q">?</span>'}<span class="t">${s.tool ? TOOLS[s.tool].name : '???'}</span>
        ${s.now && s.tried.length ? `<span class="tried" title="Tried here: ${s.tried.map(t => TOOLS[t].name).join(', ')}">${s.tried.map(toolIcon).join('')}</span>` : ''}</li>`).join('');
    P.innerHTML = `<header><button type="button" class="back" data-a="back" aria-label="Back to the chart">◂</button><span class="where">${PARTS[a.part].name}</span><span class="stage">Stage ${ch.stage + 1}/${ch.stages}</span></header>
      ${tabs}
      <h3 style="--m:${A.mark}">${ch.name || '???'}</h3>
      <div class="worse">${ch.worsens ? '<label>Worsens</label><div class="bar"><i></i></div>' : '<label class="last">Final stage</label>'}</div>
      <h4>Condition</h4><p class="look">${ch.look}</p>
      <h4>Cure</h4><ol class="steps">${steps}</ol>
      ${ch.lore ? `<p class="lore">“${ch.lore}”</p>` : ''}`;
    P.querySelectorAll('canvas[data-t]').forEach(c => c.getContext('2d').drawImage(sprite(c.dataset.t, TOOLS[c.dataset.t]), 0, 0));
    liveBits(P, ch);
  }
  // what changes moment to moment: how close it is to worsening
  function liveBits(P, ch) { const w = P.querySelector('.worse .bar i'); if (w) { w.style.width = Math.round(Math.min(1, ch.progress) * 100) + '%'; w.parentNode.classList.toggle('near', ch.progress > 0.75); } }
  function panelClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'back') return examine(null);
    if (b.dataset.id) examine(st.exam.part, +b.dataset.id);
  }
  // a step lights up in the panel: right, wrong, or newly found out
  function pulseStep(i, cls) { const li = el.querySelector(`.bx-panel .steps li[data-i="${i}"]`); if (li) { li.classList.remove('hit', 'miss', 'found'); void li.offsetWidth; li.classList.add(cls); } }

  // ---------- the needs along the top ----------
  function needs() {
    const c = camp(), N = el.querySelector('.bx-needs'); if (!c) { N.hidden = true; return; } N.hidden = false;
    // what the afflictions are draining, a minute
    const drain = { health: 0, soul: 0 };
    st.b.afflictions.forEach(a => { const d = AIL[a.key].stages[a.stage].drain; drain.health += d.health || 0; drain.soul += d.soul || 0; });
    NEEDS.forEach(n => {
      const box = N.querySelector(`[data-s="${n.k}"]`), v = c.stats[n.k], bar = box.querySelector('.bar');
      bar.firstChild.style.width = Math.round(v) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(v)));
      box.classList.toggle('low', n.big ? v < 30 : v > 70);
      if (n.big) {
        box.querySelector('.v').textContent = String(Math.round(v));
        const d = drain[n.k], dr = box.querySelector('.dr'); dr.textContent = d < 0 ? `▼${(-d).toFixed(1)}/min` : ''; box.classList.toggle('draining', d < 0);
      }
    });
  }

  // ---------- input ----------
  let drag = null;
  const P = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH }; };
  const inBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  const roll = () => st.exam ? st.rollExam : st.rollChart; // the roll moves aside while examining (landscape)
  const toolAt = p => { const r = roll(); if (!inBox(p, r)) return null; const k = Math.floor((p.x - r.x - 6) / r.slot); return TOOL_KEYS[k] || null; };
  const overPanel = e => { const pn = el.querySelector('.bx-panel'); if (pn.hidden) return false; const r = pn.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom; };
  // what a point is over: in the X-ray, the examined wound (or another part shown there); on the chart, a part
  function target(p, e) {
    if (st.exam) {
      if (overPanel(e) || (inBox(p, st.xr) && C.partAt(p, xrayTf()) === st.exam.part)) return { part: st.exam.part, id: st.exam.id };
      if (inBox(p, st.xr)) { const part = C.partAt(p, xrayTf()); return part ? { part } : null; }
      return null;
    }
    const part = C.partAt(p, st.chart); return part ? { part } : null;
  }
  function down(e) { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); const p = P(e); drag = { tool: toolAt(p), start: p, p, moved: false }; }
  function mv(e) { if (!drag) return; drag.p = P(e); drag.over = target(drag.p, e); if (Math.hypot(drag.p.x - drag.start.x, drag.p.y - drag.start.y) > 3) drag.moved = true; }
  const fireHot = () => { const c = camp(); return !!(c && root.CampSim && CampSim.burning(c)); };
  function up(e) {
    if (!drag) return; const d = drag, p = P(e), b = st.b; drag = null;
    if (d.tool && d.moved) return use(d.tool, target(p, e), p);
    if (d.moved) return;
    if (d.tool) { const T = TOOLS[d.tool], left = b.tools[d.tool]; return note(`${T.name}${left >= 0 ? ` (${left} left)` : ''}. ${T.note}`, p.x, p.y - 20, 3600); }
    if (st.exam) { // in the X-ray: another afflicted part shown there is examined in turn
      const t = target(p, e); if (t && t.part !== st.exam.part && b.afflictions.some(a => a.part === t.part)) examine(t.part);
      return;
    }
    if (inBox(p, st.bones)) {
      const a = B.roll(b); save();
      return note(a ? `The bones fall. Something takes your ${PARTS[a.part].name.toLowerCase()}.` : 'The bones fall, and say nothing new.', p.x - 40, p.y + 60, 3500);
    }
    if (inBox(p, st.glass)) { const cc = camp(); for (let k = 0; k < 300; k++) { B.step(b, 1, cc ? cc.stats : null); advanceCamp(1); } save(); return note('You turn the glass and wait. Time passes; nothing waits with you.', p.x - 60, p.y + 60, 3200); }
    if (inBox(p, st.ear)) return leave();
    const t = target(p, e);
    if (t) { if (b.afflictions.some(a => a.part === t.part)) return examine(t.part); return note(`Your ${PARTS[t.part].name.toLowerCase()}. Clean, for now.`, p.x, p.y); }
  }
  // a tool used on a part (on one affliction there, when examining it)
  function use(tool, t, p) {
    if (!t) return;
    const b = st.b, c = camp(), T = TOOLS[tool], where = PARTS[t.part].name.toLowerCase(), was = st.exam;
    const r = B.apply(b, t.part, tool, { fireHot: fireHot() }, c ? c.stats : null, t.id);
    st.flash.push({ part: t.part, t: performance.now(), ok: r.ok });
    if (r.why === 'healthy') return note(`Nothing has taken your ${where}. Save the ${T.name.toLowerCase()}.`, p.x, p.y);
    if (r.why === 'none left') return note(`No ${T.name.toLowerCase()} left.`, p.x, p.y);
    if (r.why === 'cold') return note('The iron is cold. It wants the camp fire, burning.', p.x, p.y, 3000);
    const a = r.affliction;
    if (r.ok && root.Skills) { const X = Skills.XP; Skills.earn('medicine', X.step + X.stepPerStage * a.stage + (r.discovered ? X.discover : 0) + (r.cured ? X.cure * (a.stage + 1) : 0)); }
    if (r.cured && !(was && was.id === a.id)) { save(); return note(`It is gone from your ${where}.`, p.x, p.y, 2000); } // cured from the chart
    if (!was || was.id !== a.id) examine(t.part, a.id); // see what you are working on
    if (r.cured) { // the wound closes: a moment to see it, then the next on the part, or the chart
      save(); st.exam = { part: t.part, id: a.id, cured: true };
      const P = el.querySelector('.bx-panel'); P.classList.remove('cured'); void P.offsetWidth; P.classList.add('cured');
      el.querySelectorAll('.bx-panel .steps li').forEach(li => li.classList.add('done'));
      setTimeout(() => { P.classList.remove('cured'); if (st.exam && st.exam.cured) examine(st.b.afflictions.some(x => x.part === t.part) ? t.part : null); }, 1300);
      return;
    }
    panel();
    pulseStep(r.step, r.ok ? (r.discovered ? 'found' : 'hit') : 'miss');
  }

  // ---------- drawing ----------
  const sprites = {};
  function sprite(key, art) { if (sprites[key]) return sprites[key]; const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); art.px.forEach((row, y) => [...row].forEach((ch, i) => { if (art.pal[ch]) { x.fillStyle = art.pal[ch]; x.fillRect(i, y, 1, 1); } })); return (sprites[key] = c); }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const c = camp();
    B.step(st.b, dt, c ? c.stats : null);
    advanceCamp(dt); // the fire keeps burning while you see to yourself
    if (t - st.uiAt > 200) { st.uiAt = t; needs(); if (st.exam && !st.exam.cured) { if (examined()) panel(); else examine(st.exam.part); } }
    if (t - st.saveAt > 5000) { st.saveAt = t; save(); }
    draw(t / 1000);
  }
  function draw(time) {
    const b = st.b, c = st.chart, cs = camp();
    g.globalAlpha = 1; g.drawImage(table, 0, 0);
    // candlelight
    const lx = LW * 0.86, ly = LH * 0.5, gr = g.createRadialGradient(lx, ly, 4, lx, ly, Math.max(LW, LH) * 0.8);
    gr.addColorStop(0, 'rgba(255,190,110,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, LW, LH);
    if (st.exam) drawXray(time);
    else {
      g.fillStyle = '#d8ccb0'; g.fillRect(Math.round(lx) - 2, Math.round(ly) - 2, 5, 12); g.fillStyle = `rgba(255,${200 + 30 * Math.sin(time * 13)},90,1)`; g.fillRect(Math.round(lx), Math.round(ly) - 6, 2, 4);
      drawChart(time);
      // the omen bones and the hourglass
      const bo = st.bones; g.fillStyle = '#e8e0c8'; g.fillRect(bo.x, bo.y + 6, 12, 10); g.fillRect(bo.x + 16, bo.y + 2, 11, 11); g.fillStyle = '#2a2018';
      [[3, 9], [8, 13], [5, 11], [19, 5], [23, 9]].forEach(([dx, dy]) => g.fillRect(bo.x + dx, bo.y + dy, 1, 1));
      const gl = st.glass; g.fillStyle = '#5a4030'; g.fillRect(gl.x, gl.y, gl.w, 2); g.fillRect(gl.x, gl.y + gl.h - 2, gl.w, 2);
      g.fillStyle = 'rgba(200,220,255,0.35)'; g.beginPath(); g.moveTo(gl.x + 2, gl.y + 2); g.lineTo(gl.x + gl.w - 2, gl.y + 2); g.lineTo(gl.x + gl.w / 2 + 1, gl.y + gl.h / 2); g.lineTo(gl.x + gl.w - 2, gl.y + gl.h - 2); g.lineTo(gl.x + 2, gl.y + gl.h - 2); g.lineTo(gl.x + gl.w / 2 - 1, gl.y + gl.h / 2); g.closePath(); g.fill();
      g.fillStyle = '#d9b86a'; const sand = (b.t / 20) % 1; g.fillRect(gl.x + 4, gl.y + gl.h - 3 - Math.round(sand * 10), gl.w - 8, Math.round(sand * 10)); g.fillRect(gl.x + gl.w / 2 - 0.5, gl.y + gl.h / 2, 1, gl.h / 2 - 3);
    }
    // the surgeon's roll
    const r = roll(); g.fillStyle = '#4a3424'; g.fillRect(r.x, r.y, r.w, r.h); g.strokeStyle = '#6a5438'; g.lineWidth = 1; g.setLineDash([2, 2]); g.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); g.setLineDash([]);
    TOOL_KEYS.forEach((k, i) => {
      const x = r.x + 6 + i * r.slot, left = b.tools[k], T = TOOLS[k], cold = T.needsFire && !(cs && root.CampSim && CampSim.burning(cs));
      g.globalAlpha = left === 0 ? 0.25 : 1; g.drawImage(sprite(k, T), x + 2, r.y + 6, r.slot - 6, r.slot - 6);
      if (cold) { g.globalAlpha = 0.55; g.fillStyle = '#3a3a42'; g.fillRect(x + r.slot - 9, r.y + 6, 4, 4); } // the iron's tip is dark when the fire is out
      g.globalAlpha = 1;
      if (left > 0) { g.fillStyle = 'rgba(230,220,200,0.6)'; for (let t = 0; t < Math.min(left, 8); t++) g.fillRect(x + 2 + t * 2, r.y + r.h - 7, 1, 3); }
    });
    // the tool in hand, and the part it would be used on
    if (drag && drag.tool && drag.moved) {
      const o = drag.over;
      if (o && !st.exam) { C.shapePath(g, PARTS[o.part].shape, c); g.strokeStyle = 'rgba(243,211,107,0.8)'; g.stroke(); }
      g.globalAlpha = 0.9; g.drawImage(sprite(drag.tool, TOOLS[drag.tool]), Math.round(drag.p.x - 9), Math.round(drag.p.y - 9), 18, 18); g.globalAlpha = 1;
    }
    // vignette
    const v = g.createRadialGradient(LW / 2, LH / 2, Math.min(LW, LH) * 0.45, LW / 2, LH / 2, Math.max(LW, LH) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = v; g.fillRect(0, 0, LW, LH);
  }
  // the pilgrims' chart: ink outline, parts washed where something has taken hold, the marks
  function drawChart(time) {
    const b = st.b, c = st.chart;
    g.fillStyle = '#d9ccae'; g.fillRect(c.x, c.y, c.w, c.h); g.fillStyle = 'rgba(120,90,50,0.18)'; g.fillRect(c.x, c.y, c.w, 2); g.fillRect(c.x, c.y + c.h - 2, c.w, 2);
    g.fillStyle = '#c8b994'; g.beginPath(); g.moveTo(st.ear.x, st.ear.y + st.ear.h); g.lineTo(st.ear.x + st.ear.w, st.ear.y); g.lineTo(st.ear.x + st.ear.w, st.ear.y + st.ear.h); g.closePath(); g.fill(); // the dog-ear: fold it away
    g.fillStyle = 'rgba(42,32,24,0.7)'; g.font = `${Math.max(7, Math.round(c.k * 4.2))}px "IM Fell English SC", serif`; g.textAlign = 'center'; g.fillText('The Pilgrim\'s Body', c.x + c.w / 2, c.y + c.h - 4);
    Object.entries(PARTS).forEach(([k, p]) => {
      const here = b.afflictions.filter(a => a.part === k);
      C.shapePath(g, p.shape, c); g.fillStyle = here.length ? `rgba(120,40,40,${Math.min(0.35, 0.08 + 0.06 * here.reduce((s, a) => s + a.stage + 1, 0))})` : 'rgba(120,90,50,0.08)'; g.fill();
      g.strokeStyle = '#3a2c20'; g.lineWidth = 1; g.stroke();
    });
    b.afflictions.forEach(a => C.drawMark(g, a, time, c));
    drawFlash(c);
  }
  // a flash where a tool was used: green for right, red for wrong
  function drawFlash(tf) {
    st.flash = st.flash.filter(f => performance.now() - f.t < 600);
    st.flash.forEach(f => { C.shapePath(g, PARTS[f.part].shape, tf); g.fillStyle = f.ok ? 'rgba(120,220,140,0.3)' : 'rgba(230,60,60,0.35)'; g.fill(); });
  }
  // the X-ray: the part and what is around it, bones showing through, the wound circled with a line to its status
  function drawXray(time) {
    const r = st.xr, a = examined() || null, part = st.exam.part, tf = xrayTf(), pulse = 0.5 + 0.5 * Math.sin(time * 4);
    g.fillStyle = '#031012'; g.fillRect(r.x, r.y, r.w, r.h);
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    g.strokeStyle = 'rgba(90,200,210,0.07)'; g.lineWidth = 1; g.beginPath();
    for (let x = r.x + 0.5; x < r.x + r.w; x += 10) { g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); }
    for (let y = r.y + 0.5; y < r.y + r.h; y += 10) { g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); }
    g.stroke();
    // flesh, faint; the examined part brighter
    Object.entries(PARTS).forEach(([k, p]) => {
      C.shapePath(g, p.shape, tf); g.fillStyle = k === part ? 'rgba(110,220,230,0.2)' : 'rgba(90,180,200,0.08)'; g.fill();
      g.strokeStyle = k === part ? `rgba(160,240,255,${0.55 + 0.3 * pulse})` : 'rgba(120,200,220,0.25)'; g.lineWidth = Math.max(1, tf.k * 0.4); g.stroke();
    });
    C.drawBones(g, tf, part, 0.7 + 0.3 * pulse);
    st.b.afflictions.filter(x => x.part === part).forEach(x => C.drawMark(g, x, time, tf));
    drawFlash(tf);
    // the scan: a bright band sweeping down, and scanlines
    const sy = r.y + ((time * 50) % (r.h + 30)) - 15, sg = g.createLinearGradient(0, sy - 12, 0, sy + 12);
    sg.addColorStop(0, 'rgba(140,240,255,0)'); sg.addColorStop(0.5, 'rgba(140,240,255,0.12)'); sg.addColorStop(1, 'rgba(140,240,255,0)'); g.fillStyle = sg; g.fillRect(r.x, sy - 12, r.w, 24);
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = r.y; y < r.y + r.h; y += 2) g.fillRect(r.x, y, r.w, 1);
    g.restore();
    // the reticle on the wound, and a line from it to the panel
    if (a) {
      const m = C.markCentre(a), mx = tf.ox + m.x * tf.k, my = tf.oy + m.y * tf.k, rad = Math.max(8, Math.min(r.w, r.h) * 0.16) * (1 + 0.06 * pulse);
      const col = `rgba(255,${st.exam.cured ? 240 : 230},${st.exam.cured ? 140 : 120},${0.75 + 0.25 * pulse})`;
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath(); g.ellipse(mx, my, rad, rad, 0, 0, 7); g.stroke();
      g.setLineDash([3, 3]); g.lineDashOffset = -time * 8; g.beginPath(); g.ellipse(mx, my, rad + 3, rad + 3, 0, 0, 7); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { g.beginPath(); g.moveTo(mx + dx * (rad - 3), my + dy * (rad - 3)); g.lineTo(mx + dx * (rad + 5), my + dy * (rad + 5)); g.stroke(); });
      g.beginPath();
      if (el.classList.contains('portrait')) { g.moveTo(mx, my + rad); g.lineTo(mx, r.y + r.h + 4); }
      else { const ex = r.x + r.w + 6, ey = Math.max(r.y + 12, Math.min(r.y + 30, my)); g.moveTo(mx + rad, my); g.lineTo(mx + rad + 8, my); g.lineTo(ex - 6, ey); g.lineTo(ex, ey); }
      g.stroke();
    }
    // the frame's corners
    g.strokeStyle = 'rgba(160,240,255,0.7)'; g.lineWidth = 1; const L = 8;
    [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].forEach(([x, y, sx, sy2]) => { g.beginPath(); g.moveTo(x + 0.5 * sx, y + L * sy2); g.lineTo(x + 0.5 * sx, y + 0.5 * sy2); g.lineTo(x + L * sx, y + 0.5 * sy2); g.stroke(); });
    // the tool in hand over the X-ray: the wound outlined
    if (drag && drag.tool && drag.moved && drag.over && drag.over.part === part) { C.shapePath(g, PARTS[part].shape, tf); g.strokeStyle = 'rgba(243,211,107,0.9)'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
  }

  root.Body = { open, leave, tick, state: () => st, examine };
})(window);
