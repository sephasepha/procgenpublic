// Camp view: what the camp screen's parts share. The screen's live state (CampView: the element, the scene canvas
// and its size, the projection, the camp, what is being dragged), the projection from the floor to the scene, the
// 8x8 sprites, and where things are on screen. camp/draw.js paints the scene, camp/panels.js keeps the readable UI
// (gauge, vessel panel, tray, larder, notes) up to date, and camp/camp.js opens the screen and handles input.
//
// The scene is a fixed first-person view down at a fire pit on the cavern floor. Floor points (x, z) are in
// metres, z the distance ahead; the scene is a low-resolution canvas (LW x LH) whose horizon sits at H0 (above
// the frame), with focal length F and centre column CX.
(function (root) {
  // thresholds come from the simulation, so what the screen shows always agrees with what the fire does
  const S = root.CampSim;
  const V = {
    S, RES: root.CAMP_RESIDUE, FIRE: root.CAMP_FIRE, STRIKER: root.CAMP_STRIKER, VES: root.CAMP_VESSELS, ING: root.CAMP_INGREDIENTS, STATS: root.CAMP_STATS,
    CHOKE: S.CAMP_TUNING.chokeAir, SMOULDER: S.CAMP_TUNING.smokeAt, COOK: S.CAMP_COOK, PIT: S.CAMP_PIT,
    H_CAM: 1.3, // the eye's height above the floor (m)
    // live state, set by camp/camp.js
    el: null, cv: null, g: null, // the screen, the scene canvas and its context
    LW: 480, LH: 270, H0: 0, F: 0, CX: 0, // the scene's size and projection
    st: null, // { c: the camp, L: layout, sel: item in hand, vsel: selected vessel id, hover, flash, sackBox, ... }
    drag: null, // what is being dragged: { from: 'slot' | 'piece' | 'vessel' | 'tap', ... }
  };

  // ---------- projection: floor (x, z) in metres to the scene, and back ----------
  V.sy = z => V.H0 + V.F * V.H_CAM / z;
  V.sx = (x, z) => V.CX + V.F * x / z;
  V.sc = z => V.F / z; // pixels per metre at distance z
  V.toFloor = (px, py) => { if (py <= V.H0 + 2) return null; const z = V.F * V.H_CAM / (py - V.H0); return { x: (px - V.CX) * z / V.F, z }; };
  // a pointer event to a point in the scene
  V.P = e => { const r = V.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * V.LW, y: (e.clientY - r.top) / r.height * V.LH }; };
  V.inBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  // the floor under a point, if it is floor you can put things on (not too far off, not your hands)
  V.onFloorAt = p => { const f = V.toFloor(p.x, p.y + 3); return f && f.z < 4.5 && !V.inBox(p, V.st.L.hands) ? f : null; };

  // ---------- sprites: 8x8 art from the data, drawn once ----------
  const sprites = {};
  V.sprite = (key, art) => {
    if (sprites[key]) return sprites[key];
    const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
    art.px.forEach((row, y) => [...row].forEach((ch, i) => { if (art.pal[ch]) { x.fillStyle = art.pal[ch]; x.fillRect(i, y, 1, 1); } }));
    return (sprites[key] = c);
  };
  // a tinted copy (cooking browns things; burning blackens them; flames redden)
  V.tinted = (key, art, color, amount) => {
    const k = key + '|' + color + '|' + Math.round(amount * 8);
    if (sprites[k]) return sprites[k];
    const base = V.sprite(key, art), c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
    x.drawImage(base, 0, 0); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = Math.round(amount * 8) / 8; x.fillStyle = color; x.fillRect(0, 0, 8, 8);
    return (sprites[k] = c);
  };

  // ---------- what there is to use, and where things are ----------
  V.KIT = ['tinder', 'kindling', 'fuel', 'striker'];
  V.VESK = ['pot', 'pan', 'skewer'];
  V.LARDER = Object.keys(V.ING);
  V.NAMES = { tinder: 'Tinder', kindling: 'Kindling', fuel: 'Fuel', striker: 'Strike', pot: 'Pot', pan: 'Pan', skewer: 'Skewer' };
  V.artOf = k => V.FIRE[k] || (k === 'striker' ? V.STRIKER : null) || V.VES[k] || V.ING[k];
  // in scene space: your hands at the bottom, the charms top left, the sack on the floor beside the pit
  V.layout = () => {
    const { LW, LH } = V;
    const hands = { x: Math.round(LW / 2 - 30), y: LH - 26, w: 60, h: 26 };
    const charms = V.STATS.map((k, i) => ({ key: k, x: 6 + i * 13, y: 18 + (i % 2) * 10, w: 11, h: 22 }));
    const sackF = { x: 0.62, z: 1.62 };
    return { hands, charms, sackF };
  };
  V.TUNNEL = () => ({ x: Math.round(V.LW * 0.5 - 13), y: 2, w: 26, h: 22 }); // the way back, in the wall

  // what is under a point: a vessel (nearest first), else the nearest piece within a finger's reach
  V.hitPlaced = p => {
    const vs = V.st.c.vessels.slice().sort((a, b) => a.z - b.z);
    for (const v of vs) if (v.box && V.inBox(p, v.box)) return { type: 'vessel', obj: v };
    // pieces are small and often close together
    let best = null, bd = 1e9;
    V.st.c.pieces.forEach(q => { if (!q.box) return; const cx = q.box.x + q.box.w / 2, cy = q.box.y + q.box.h / 2, d = Math.hypot(p.x - cx, p.y - cy), reach = Math.max(8, q.box.w * 0.7); if (d < reach && d < bd) { bd = d; best = q; } });
    return best ? { type: 'piece', obj: best } : null;
  };

  // the fire's colour: dull red when weak, orange, then yellow-white when roaring; browner when choking
  V.fireColor = (s, air) => {
    const stops = [[0, [90, 30, 20]], [0.3, [200, 70, 25]], [0.6, [255, 140, 40]], [0.85, [255, 210, 90]], [1, [255, 248, 220]]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i++) if (s <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
    const t = (s - a[0]) / Math.max(1e-6, b[0] - a[0]), m = Math.max(0.55, Math.min(1, air / 0.6));
    return a[1].map((v, i) => Math.round((v + (b[1][i] - v) * t) * (i === 2 ? m : 1) * (0.75 + 0.25 * m)));
  };

  root.CampView = V;
})(window);
