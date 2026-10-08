// Body drawing: the body's parts, the marks afflictions leave on them, and the skeleton under them, drawn in chart
// space (100 x 140, the body seen from the front) through a transform tf = { ox, oy, k } (screen = o + chart * k).
// The body screen draws the pilgrims' anatomical chart and the X-ray with these; nothing here knows the screen.
(function (root) {
  const PARTS = root.BODY_PARTS, AIL = root.BODY_AILMENTS;

  // ---------- shapes ----------
  function inShape(sh, q) {
    if (sh.e) { const [cx, cy, rx, ry] = sh.e; return ((q.x - cx) / rx) ** 2 + ((q.y - cy) / ry) ** 2 <= 1; }
    let inside = false; const P = sh.p;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > q.y) !== (yj > q.y) && q.x < (xj - xi) * (q.y - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
  }
  // the part under a screen point, through a transform
  const partAt = (p, tf) => { const q = { x: (p.x - tf.ox) / tf.k, y: (p.y - tf.oy) / tf.k }; return Object.keys(PARTS).find(k => inShape(PARTS[k].shape, q)) || null; };
  function shapePath(g, sh, tf) {
    g.beginPath();
    if (sh.e) { const [cx, cy, rx, ry] = sh.e; g.ellipse(tf.ox + cx * tf.k, tf.oy + cy * tf.k, rx * tf.k, ry * tf.k, 0, 0, 7); }
    else sh.p.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, tf.ox + x * tf.k, tf.oy + y * tf.k));
    g.closePath();
  }
  const bbox = sh => { if (sh.e) { const [cx, cy, rx, ry] = sh.e; return [cx - rx, cy - ry, cx + rx, cy + ry]; } const xs = sh.p.map(p => p[0]), ys = sh.p.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

  // ---------- an affliction's mark: living ink in the part, by its kind and how far it has gone (fade: 0..1) ----------
  // seeded scatter so marks hold still from frame to frame
  const hr = (a, k) => { let h = Math.imul(a * 7919 + k, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  function drawMark(g, a, time, tf, fade) {
    fade = fade === undefined ? 1 : fade;
    const A = AIL[a.key], sh = PARTS[a.part].shape, c = tf, [x0, y0, x1, y1] = bbox(sh), sev = a.stage + Math.min(1, a.progress);
    const pt = k => ({ x: c.ox + (x0 + hr(a.id, k) * (x1 - x0)) * c.k, y: c.oy + (y0 + hr(a.id, k + 500) * (y1 - y0)) * c.k });
    g.save(); shapePath(g, sh, tf); g.clip(); g.globalAlpha = fade;
    g.fillStyle = A.mark; g.strokeStyle = A.mark; g.lineWidth = 1;
    const n = Math.round(4 + sev * 7);
    if (A.kind === 'specks') {
      if (a.stage === 2) { g.fillStyle = '#05040a'; g.globalAlpha = fade * 0.8; const q = pt(1); g.beginPath(); g.ellipse(q.x, q.y, 6 * c.k, 4 * c.k, 0, 0, 7); g.fill(); g.globalAlpha = fade * 1; g.fillStyle = A.mark; }
      const s = Math.max(1, Math.round(c.k * 0.6));
      for (let k = 0; k < n; k++) { const q = pt(k); const tw = 0.6 + 0.4 * Math.sin(time * 3 + k); g.globalAlpha = fade * tw; g.fillRect(Math.round(q.x), Math.round(q.y), s, s); }
      if (a.stage >= 1) { g.globalAlpha = fade * 0.5; g.beginPath(); for (let k = 0; k < n - 1; k += 2) { const q = pt(k), r = pt(k + 1); g.moveTo(q.x, q.y); g.lineTo(r.x, r.y); } g.stroke(); }
    } else if (A.kind === 'mouth' || A.kind === 'hollow') {
      const m = A.kind === 'hollow' ? 1 : Math.round(1 + sev * 1.5);
      for (let k = 0; k < m; k++) { const q = A.kind === 'hollow' ? { x: c.ox + 50 * c.k, y: c.oy + 52 * c.k } : pt(k * 3); const r = (1.5 + sev * 1.4) * c.k * (A.kind === 'hollow' ? 1.4 : 0.7);
        g.globalAlpha = fade * 0.7; g.beginPath(); g.ellipse(q.x, q.y, r, r * 0.7, 0, 0, 7); g.fill();
        if (a.stage === 2) { g.fillStyle = '#14080c'; g.beginPath(); g.ellipse(q.x, q.y, r * 0.7, r * 0.3 * (0.6 + 0.4 * Math.sin(time * 2)), 0, 0, 7); g.fill(); g.fillStyle = '#e8e0c8'; for (let tt = -2; tt <= 2; tt++) g.fillRect(Math.round(q.x + tt * r * 0.25), Math.round(q.y - r * 0.15), 1, 1); g.fillStyle = A.mark; } }
    } else if (A.kind === 'glyph') {
      g.globalAlpha = fade * (0.6 + 0.3 * Math.sin(time * 5));
      for (let k = 0; k < n; k++) { const q = pt(k), s = 2 * c.k; g.beginPath(); g.moveTo(q.x - s, q.y); g.lineTo(q.x, q.y - s); g.lineTo(q.x + s, q.y); if (hr(a.id, k + 9) > 0.5) g.lineTo(q.x, q.y + s); g.stroke(); }
    } else if (A.kind === 'eye') {
      const q = { x: c.ox + 50 * c.k, y: c.oy + 9 * c.k }, open = [0.2, 0.55, 1][a.stage] * (0.85 + 0.15 * Math.sin(time * 0.7)), r = 4 * c.k;
      g.fillStyle = '#e8e2cf'; g.beginPath(); g.ellipse(q.x, q.y, r, r * open * 0.6, 0, 0, 7); g.fill();
      g.fillStyle = A.mark; g.beginPath(); g.ellipse(q.x + Math.sin(time * 0.5) * r * 0.3, q.y, r * 0.45 * open, r * 0.45 * open, 0, 0, 7); g.fill();
      g.fillStyle = '#0b1a12'; g.fillRect(Math.round(q.x + Math.sin(time * 0.5) * r * 0.3), Math.round(q.y), Math.max(1, Math.round(c.k * 0.5)), Math.max(1, Math.round(c.k * 0.5)));
    } else if (A.kind === 'threads' || A.kind === 'burrow' || A.kind === 'crack') {
      g.globalAlpha = fade * 0.75; g.lineWidth = Math.max(1, c.k * 0.35);
      for (let k = 0; k < Math.round(2 + sev * 3); k++) { let q = pt(k * 2); g.beginPath(); g.moveTo(q.x, q.y); for (let s = 0; s < 4; s++) { const ang = hr(a.id, k * 10 + s) * 6.28, len = (A.kind === 'crack' ? 4 : 3) * c.k; q = { x: q.x + Math.cos(ang) * len, y: q.y + Math.sin(ang) * len }; g.lineTo(q.x + (A.kind === 'burrow' ? Math.sin(time * 4 + s) * c.k * 0.4 : 0), q.y); } g.stroke();
        if (A.kind === 'threads' && a.stage >= 1) { g.fillRect(Math.round(q.x - c.k * 0.5), Math.round(q.y - c.k * 0.5), Math.max(3, c.k * 1.2), Math.max(2, c.k * 0.8)); } }
    } else if (A.kind === 'water') {
      const lvl = (0.25 + sev * 0.22) * (y1 - y0); g.globalAlpha = fade * 0.45; g.fillRect(c.ox + x0 * c.k, c.oy + (y1 - lvl + Math.sin(time * 1.5) * 1.2) * c.k, (x1 - x0) * c.k, lvl * c.k);
    } else if (A.kind === 'fade') {
      g.globalAlpha = fade * (0.25 + sev * 0.18); g.fillStyle = '#d9ccae'; g.fillRect(c.ox + x0 * c.k, c.oy + y0 * c.k, (x1 - x0) * c.k, (y1 - y0) * c.k);
      g.globalAlpha = fade * 0.3; g.fillStyle = A.mark; for (let k = 0; k < n; k++) { const q = pt(k); g.fillRect(Math.round(q.x), Math.round(q.y), Math.max(2, c.k), Math.max(1, c.k * 0.5)); }
    }
    g.restore();
  }
  // ---------- an affliction's icon: a small badge on its part, by kind. (x, y, r) in screen pixels ----------
  // phase: active = its colour on a dark disc, stage shown by pips; healing = green ring; benign = grey and faint
  const ICONS = {
    specks(g, r) { [[0, -.55], [-.5, .3], [.55, .15], [.1, .6]].forEach(([x, y]) => { g.beginPath(); g.arc(x * r, y * r, r * .13, 0, 7); g.fill(); }); g.beginPath(); g.moveTo(0, -.55 * r); g.lineTo(-.5 * r, .3 * r); g.lineTo(.55 * r, .15 * r); g.stroke(); },
    mouth(g, r) { g.beginPath(); g.ellipse(0, 0, r * .7, r * .4, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-.5 * r, 0); g.quadraticCurveTo(0, r * .3, .5 * r, 0); g.stroke(); },
    glyph(g, r) { g.beginPath(); g.moveTo(-.55 * r, .5 * r); g.lineTo(0, -.6 * r); g.lineTo(.55 * r, .5 * r); g.moveTo(-.3 * r, .1 * r); g.lineTo(.3 * r, .1 * r); g.stroke(); },
    eye(g, r) { g.beginPath(); g.moveTo(-.75 * r, 0); g.quadraticCurveTo(0, -.7 * r, .75 * r, 0); g.quadraticCurveTo(0, .7 * r, -.75 * r, 0); g.stroke(); g.beginPath(); g.arc(0, 0, r * .22, 0, 7); g.fill(); },
    threads(g, r) { g.beginPath(); g.moveTo(0, .65 * r); g.lineTo(0, -.2 * r); g.moveTo(0, .2 * r); g.lineTo(-.45 * r, -.3 * r); g.moveTo(0, 0); g.lineTo(.5 * r, -.45 * r); g.moveTo(0, -.2 * r); g.lineTo(-.15 * r, -.65 * r); g.stroke(); },
    burrow(g, r) { g.beginPath(); g.moveTo(-.7 * r, .3 * r); g.bezierCurveTo(-.3 * r, -.6 * r, .1 * r, .7 * r, .7 * r, -.3 * r); g.stroke(); g.beginPath(); g.arc(.7 * r, -.3 * r, r * .13, 0, 7); g.fill(); },
    crack(g, r) { g.beginPath(); g.moveTo(-.2 * r, -.7 * r); g.lineTo(.15 * r, -.2 * r); g.lineTo(-.2 * r, .1 * r); g.lineTo(.2 * r, .7 * r); g.stroke(); },
    water(g, r) { g.beginPath(); g.moveTo(0, -.7 * r); g.bezierCurveTo(.6 * r, .0, .6 * r, .6 * r, 0, .6 * r); g.bezierCurveTo(-.6 * r, .6 * r, -.6 * r, 0, 0, -.7 * r); g.fill(); },
    hollow(g, r) { g.beginPath(); g.ellipse(0, 0, r * .6, r * .6, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(0, 0, r * .28, r * .28, 0, 0, 7); g.fill(); },
    fade(g, r) { for (let i = 0; i < 3; i++) { g.globalAlpha *= .8; g.beginPath(); g.moveTo(-.65 * r, (-.4 + i * .4) * r); g.lineTo((.65 - i * .2) * r, (-.4 + i * .4) * r); g.stroke(); } },
  };
  function drawIcon(g, a, x, y, r, time, active) {
    const A = AIL[a.key], healing = a.phase === 'healing', benign = a.phase === 'benign';
    const col = benign ? '#a89f8a' : healing ? '#8fd29a' : A.mark, pulse = active ? 0.85 + 0.15 * Math.sin(time * 4 + a.id) : 1;
    g.save(); g.translate(Math.round(x), Math.round(y)); g.globalAlpha = benign ? 0.55 : 1;
    g.fillStyle = benign ? 'rgba(40,34,28,0.55)' : 'rgba(10,8,14,0.85)'; g.beginPath(); g.arc(0, 0, r * pulse, 0, 7); g.fill();
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1, r * .12); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.arc(0, 0, r * pulse, 0, 7); g.stroke();
    g.lineWidth = Math.max(1, r * .14); (ICONS[A.kind] || ICONS.hollow)(g, r * .72);
    if (active) { g.globalAlpha = 1; for (let i = 0; i <= a.stage; i++) { g.beginPath(); g.arc((i - a.stage / 2) * r * .5, r * 1.35, Math.max(1, r * .14), 0, 7); g.fill(); } }
    g.restore();
  }
  // where on the part an affliction's mark centres (chart space), for the X-ray's reticle
  function markCentre(a) {
    const A = AIL[a.key], [x0, y0, x1, y1] = bbox(PARTS[a.part].shape);
    if (A.kind === 'eye') return { x: 50, y: 9 };
    if (A.kind === 'hollow') return { x: 50, y: 52 };
    let x = 0, y = 0; const n = 6; for (let k = 0; k < n; k++) { x += x0 + hr(a.id, k) * (x1 - x0); y += y0 + hr(a.id, k + 500) * (y1 - y0); }
    return { x: x / n, y: y / n };
  }

  // ---------- the skeleton, by part (chart space; the left side is mirrored from the right) ----------
  const M = x => 100 - x;
  const limb = (pts, side) => side ? pts.map(([x1, y1, x2, y2]) => [M(x1), y1, M(x2), y2]) : pts;
  const ARM = [[66, 30, 71, 49], [71, 50, 77, 68], [72.5, 50, 75.5, 69]];           // humerus, radius, ulna
  const LEG = [[55, 72, 57.5, 100], [57.5, 103, 57.5, 129], [60, 103.5, 60, 128]];  // femur, tibia, fibula
  const BONES = {
    armL: { lines: limb(ARM, 0), dots: [[77, 70.5, 1.2]] }, armR: { lines: limb(ARM, 1), dots: [[23, 70.5, 1.2]] },
    legL: { lines: limb(LEG, 0), dots: [[57.5, 101.5, 1.4]] }, legR: { lines: limb(LEG, 1), dots: [[42.5, 101.5, 1.4]] },
  };
  function drawBones(g, tf, part, glow) {
    const k = tf.k, X = x => tf.ox + x * k, Y = y => tf.oy + y * k, lw = Math.max(1, k * 1.1);
    const pass = (alpha, w) => {
      const on = p => (p === part ? 1 : 0.45) * alpha;
      // skull, jaw, sockets
      g.strokeStyle = `rgba(200,246,255,${on('head')})`; g.lineWidth = w;
      g.beginPath(); g.ellipse(X(50), Y(13.5), 6.6 * k, 8.2 * k, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(X(50), Y(19), 4.4 * k, 3 * k, 0, 0.1, Math.PI - 0.1); g.stroke();
      // spine, ribs, collarbones, pelvis
      g.strokeStyle = `rgba(200,246,255,${on('torso')})`;
      for (let y = 24; y < 66; y += 3.5) { g.beginPath(); g.moveTo(X(49), Y(y)); g.lineTo(X(51), Y(y)); g.lineTo(X(51), Y(y + 2.4)); g.lineTo(X(49), Y(y + 2.4)); g.closePath(); g.stroke(); }
      for (let i = 0; i < 7; i++) {
        const y = 30 + i * 4.2, w2 = 8.5 + 3.2 * Math.sin(Math.PI * (i + 1.5) / 9);
        [-1, 1].forEach(s => { g.beginPath(); g.moveTo(X(50 + s * 1.2), Y(y)); g.quadraticCurveTo(X(50 + s * w2 * 1.05), Y(y - 1.5), X(50 + s * w2 * 0.92), Y(y + 4)); g.stroke(); });
      }
      g.beginPath(); g.moveTo(X(50), Y(27)); g.lineTo(X(38), Y(28.5)); g.moveTo(X(50), Y(27)); g.lineTo(X(62), Y(28.5)); g.stroke();
      g.beginPath(); [[40, 63], [60, 63], [58.5, 69.5], [52.5, 72], [47.5, 72], [41.5, 69.5]].forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, X(x), Y(y))); g.closePath(); g.stroke();
      // limbs
      Object.entries(BONES).forEach(([p, b]) => {
        g.strokeStyle = `rgba(200,246,255,${on(p)})`;
        b.lines.forEach(([x1, y1, x2, y2]) => { g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); });
        b.dots.forEach(([x, y, r]) => { g.beginPath(); g.ellipse(X(x), Y(y), r * k, r * k, 0, 0, 7); g.stroke(); });
      });
    };
    pass(0.16 * glow, lw * 3); pass(0.85, lw);
    // the eye sockets, dark
    g.fillStyle = 'rgba(2,12,14,0.9)'; [[47.2, 12.8], [52.8, 12.8]].forEach(([x, y]) => { g.beginPath(); g.ellipse(X(x), Y(y), 1.7 * k, 1.5 * k, 0, 0, 7); g.fill(); });
  }

  root.BodyChart = { inShape, partAt, shapePath, bbox, drawMark, drawIcon, markCentre, drawBones };
})(window);
