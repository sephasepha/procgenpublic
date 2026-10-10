// First-person walking in the infinite megastructure (mega/world.js): WebGL, no libraries. Plain flat-shaded voxels,
// pale fog, and the scale of the place. WASD, mouse look and Space on a computer; a thumb-stick, a look pad and a jump
// button on a phone.
(function (root) {
  const W = root.MegaWorld, { CW, CH } = W;
  const EYE = 1.55, STEP_DT = 1 / 120;
  const RH = (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) ? 5 : 6, RUP = 4, RDOWN = 6;                    // cells drawn around you: sideways, above, below
  const FOG = [0.62, 0.64, 0.66], FOGD = (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) ? 0.009 : 0.0085;
  const TAU = Math.PI * 2;
  const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const fdiv = (a, b) => Math.floor(a / b);

  let world, gl, prog, loc, cv, st, el, raf = 0;
  const q = s => el.querySelector(s);
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  // ---------- meshing: faces between a solid voxel and air; vertices are 4 bytes: x, y, z, face + 8 * material ----------
  const FACES = [
    { d: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, { d: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { d: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, { d: [0, -1, 0], v: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { d: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] }, { d: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];
  function meshCell(i, j, k) {
    const g = world.cell(i, j, k); let any = false;
    for (let n = 0; n < g.length; n++) if (g[n]) { any = true; break; }
    const c = { i, j, k, n: 0, vbo: null, ibo: null, info: world.info(i, j, k) };
    if (!any) return c;
    const ox = i * CW, oy = j * CH, oz = k * CW, V = [], X = [];
    const at = (x, y, z) => (x >= 0 && x < CW && y >= 0 && y < CH && z >= 0 && z < CW) ? g[(y * CW + z) * CW + x] : world.voxel(ox + x, oy + y, oz + z);
    let nv = 0;
    for (let y = 0; y < CH; y++) for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
      const m = g[(y * CW + z) * CW + x]; if (!m) continue;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f]; if (at(x + F.d[0], y + F.d[1], z + F.d[2])) continue;
        const pk = f + 8 * m;
        for (let v = 0; v < 4; v++) V.push(x + F.v[v][0], y + F.v[v][1], z + F.v[v][2], pk);
        X.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3); nv += 4;
      }
    }
    if (nv > 65000) { console.warn('mega: cell too dense for 16-bit indices'); return c; }
    c.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(V), gl.STATIC_DRAW);
    c.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(X), gl.STATIC_DRAW);
    c.n = X.length; c.pal = new Float32Array(PAL[c.info.region]); c.light = c.info.light; { let e = 0; for (const [a, b, d] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]) if (world.isVoid(c.i + a, c.j + b, c.k + d)) e++; c.amb = 0.16 + 0.12 * e; if (c.info.void) c.amb = 0.4; }
    return c;
  }
  const dropCell = c => { if (c.vbo) { gl.deleteBuffer(c.vbo); gl.deleteBuffer(c.ibo); } };
  let PAL = [];

  // ---------- shaders ----------
  const VS = `attribute vec4 a; uniform mat4 uVP; uniform vec3 uRel; uniform vec3 uPal[8]; uniform float uLight; uniform float uAmb;
    varying vec3 vL; varying vec3 vRel; varying float vFace; varying vec3 vCol;
    void main() {
      float mat = floor(a.w / 8.0 + 0.001); float face = a.w - mat * 8.0;
      float shade = face < 1.5 ? 0.80 : face < 2.5 ? 1.0 : face < 3.5 ? 0.50 : 0.66;
      vec3 base = uPal[int(mat + 0.5)];
      vCol = mat > 6.5 ? base * 1.12 : base * shade * uLight * (uAmb + 1.1 / (1.0 + 0.12 * length(a.xyz + uRel)));
      vL = a.xyz; vFace = face; vRel = a.xyz + uRel;
      gl_Position = uVP * vec4(vRel, 1.0);
    }`;
  const FS = `precision mediump float; varying vec3 vL; varying vec3 vRel; varying float vFace; varying vec3 vCol; uniform vec3 uFog; uniform float uFogD;
    void main() {
      vec2 uv = vFace < 1.5 ? vL.zy : vFace < 3.5 ? vL.xz : vL.xy;
      vec2 fr = fract(uv); float e = min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y));
      float grid = 0.91 + 0.09 * smoothstep(0.0, 0.06, e);
      float d = length(vRel) * uFogD; float fog = 1.0 - exp(-d * d);
      gl_FragColor = vec4(mix(vCol * grid, uFog, fog), 1.0);
    }`;
  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function initGL() {
    gl = cv.getContext('webgl', { antialias: !coarse, powerPreference: 'high-performance' }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = { a: gl.getAttribLocation(prog, 'a') };
    ['uVP', 'uRel', 'uPal', 'uLight', 'uAmb', 'uFog', 'uFogD'].forEach(n => { loc[n] = gl.getUniformLocation(prog, n); });
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    return true;
  }
  // a cell's palette: [unused, floor, wall, ceiling, pillar, bridge, trim, light] as 8 colours
  const palFlat = p => { const out = [0, 0, 0]; p.c.forEach(h => out.push(...hexRGB(h))); return out; };

  // ---------- camera ----------
  function viewProj(yaw, pitch, aspect) {
    const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const r = [Math.cos(yaw), 0, Math.sin(yaw)], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    // the camera sits at the origin of "relative" space: positions are given relative to the eye
    const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1];
    const fov = 1 / Math.tan(1.2 / 2), n = 0.08, fa = 160, P = [fov / aspect, 0, 0, 0, 0, fov, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++) for (let k = 0; k < 4; k++) o[c * 4 + r2] += P[k * 4 + r2] * V[c * 4 + k];
    return o;
  }
  function planes(m) { // frustum planes from a view-projection matrix
    const p = [];
    for (const [s, a] of [[1, 0], [-1, 0], [1, 1], [-1, 1], [1, 2], [-1, 2]]) p.push([m[3] + s * m[a], m[7] + s * m[a + 4], m[11] + s * m[a + 8], m[15] + s * m[a + 12]]);
    return p.map(v => { const l = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / l); });
  }

  // ---------- physics: mega/body.js ----------
  function physics(dt) {
    const k = st.keys;
    let fw = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), sd = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), scale = 1;
    if (st.stick.on) { fw += -st.stick.y; sd += st.stick.x; scale = Math.min(1, Math.hypot(fw, sd)); }
    const run = k.ShiftLeft || k.ShiftRight || (st.stick.on && st.stick.mag > 0.92);
    if (st.jumpAt) { st.body.jumpAt = st.body.t; st.jumpAt = 0; }
    if (k.Space) st.body.jumpAt = st.body.t; // holding the key keeps jumping
    MegaBody.step(st.body, dt, fw, sd, run, scale);
    st.t = st.body.t; st.grounded = st.body.grounded; st.groundT = st.body.groundT; st.jumps = st.body.jumps;
  }

  // ---------- chunks ----------
  function chunks(budgetMs) {
    const p = st.p, ci = fdiv(Math.floor(p.x), CW), cj = fdiv(Math.floor(p.y + 1), CH), ck = fdiv(Math.floor(p.z), CW), t0 = performance.now();
    const want = [];
    for (let dj = -RDOWN; dj <= RUP; dj++) for (let dk = -RH; dk <= RH; dk++) for (let di = -RH; di <= RH; di++) {
      const d = Math.hypot(di, dk) + Math.abs(dj) * 0.9; if (d > RH + 0.6) continue; want.push([ci + di, cj + dj, ck + dk, d]);
    }
    want.sort((a, b) => a[3] - b[3]);
    let built = 0;
    for (const [i, j, k] of want) {
      const key = i + ',' + j + ',' + k; if (st.cells.has(key)) continue;
      st.cells.set(key, meshCell(i, j, k)); built++;
      if (performance.now() - t0 > budgetMs && st.ready) break;
    }
    st.cells.forEach((c, key) => { if (Math.abs(c.i - ci) > RH + 1 || Math.abs(c.k - ck) > RH + 1 || c.j - cj > RUP + 1 || cj - c.j > RDOWN + 1) { dropCell(c); st.cells.delete(key); } });
    if (!st.ready) { const near = want.filter(w => w[3] <= 1.5).every(w => st.cells.has(w[0] + ',' + w[1] + ',' + w[2])); if (near) { st.ready = true; q('.mg-load').hidden = true; } }
    return built;
  }

  // ---------- frame ----------
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - (st.last || ts)) / 1000); st.last = ts; st.acc = (st.acc || 0) + dt;
    resize();
    chunks(st.ready ? 5 : 40);
    if (st.ready) {
      let n = 0; while (st.acc >= STEP_DT && n++ < 12) { st.acc -= STEP_DT; physics(STEP_DT); }
      if (st.acc > STEP_DT * 12) st.acc = 0;
      if (st.grounded && st.t - st.safeT > 0.5) { st.safe = { x: st.p.x, y: st.p.y, z: st.p.z }; st.safeT = st.t; }
      if (st.p.y < st.safe.y - 90) { st.p.x = st.safe.x; st.p.y = st.safe.y + 0.1; st.p.z = st.safe.z; st.p.vy = 0; toast('The fall ends. You are set back where you last stood.'); }
    }
    draw();
    if (ts - st.hudT > 150) { st.hudT = ts; hud(); }
    st.frames++;
  }
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2) * (coarse ? 0.7 : 1), w = Math.max(2, Math.floor(cv.clientWidth * scale)), h = Math.max(2, Math.floor(cv.clientHeight * scale));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  function draw() {
    const p = st.p, eye = [p.x, p.y + EYE, p.z];
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    const m = viewProj(p.yaw, p.pitch, cv.width / cv.height), pl = planes(m);
    gl.uniformMatrix4fv(loc.uVP, false, m); gl.uniform3fv(loc.uFog, FOG); gl.uniform1f(loc.uFogD, FOGD);
    gl.enableVertexAttribArray(loc.a);
    let drawn = 0;
    st.cells.forEach(c => {
      if (!c.n) return;
      const cx = c.i * CW + CW / 2 - eye[0], cy = c.j * CH + CH / 2 - eye[1], cz = c.k * CW + CW / 2 - eye[2];
      for (let f = 0; f < 6; f++) if (pl[f][0] * cx + pl[f][1] * cy + pl[f][2] * cz + pl[f][3] < -13) return; // outside the view
      gl.uniform3f(loc.uRel, c.i * CW - eye[0], c.j * CH - eye[1], c.k * CW - eye[2]);
      gl.uniform3fv(loc.uPal, c.pal); gl.uniform1f(loc.uLight, c.light); gl.uniform1f(loc.uAmb, c.amb);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo); gl.vertexAttribPointer(loc.a, 4, gl.UNSIGNED_BYTE, false, 4, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo); gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
      drawn++;
    });
    st.drawn = drawn;
  }

  // ---------- hud ----------
  let toastT = 0;
  function toast(msg) { const t = q('.mg-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
  function hud() {
    const p = st.p, i = fdiv(Math.floor(p.x), CW), j = fdiv(Math.floor(p.y), CH), k = fdiv(Math.floor(p.z), CW), inf = world.info(i, j, k);
    const place = inf.void ? 'The shaft' : inf.well ? 'A well' : inf.drop ? 'A drop' : ({ open: 'A hall', pillars: 'Pillar hall', tunnels: 'Conduit', warren: 'Cells' })[inf.variant];
    q('.mg-where').innerHTML = `<b>${place}</b><span>${W.PALETTES[inf.region].name} · level ${j}</span>`;
    q('.mg-pos').textContent = `cell ${i}, ${j}, ${k} · seed ${world.seed}`;
  }

  // ---------- input ----------
  function setup() {
    window.addEventListener('keydown', e => {
      if (!st) return;
      if (e.code === 'KeyR' && !e.repeat) { respawn(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); st.keys[e.code] = true; }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) st.jumpAt = st.t; st.keys.Space = true; }
    });
    window.addEventListener('keyup', e => { if (!st) return; delete st.keys[e.code]; });
    window.addEventListener('blur', () => { if (st) st.keys = {}; });
    const lockEl = q('.mg-stage');
    const lock = () => { if (!coarse && document.pointerLockElement !== cv) cv.requestPointerLock && cv.requestPointerLock(); };
    q('.mg-help').addEventListener('click', lock); cv.addEventListener('click', lock);
    document.addEventListener('pointerlockchange', () => { const on = document.pointerLockElement === cv; el.classList.toggle('looking', on); });
    document.addEventListener('mousemove', e => { if (!st || document.pointerLockElement !== cv) return; st.p.yaw = (st.p.yaw + e.movementX * 0.0022) % TAU; st.p.pitch = Math.max(-1.52, Math.min(1.52, st.p.pitch - e.movementY * 0.0022)); });
    // phones: a floating thumb-stick on the left half, a look pad on the right half, a jump button
    if (coarse) {
      el.classList.add('touch');
      const zone = q('.mg-touch'), base = q('.mg-stick'), knob = base.querySelector('i');
      let moveId = null, lookId = null, mo = null, lk = null, R = 52;
      zone.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        e.preventDefault(); zone.setPointerCapture && zone.setPointerCapture(e.pointerId); fullscreen();
        if (e.clientX < innerWidth * 0.5 && moveId === null) { moveId = e.pointerId; mo = [e.clientX, e.clientY]; base.hidden = false; base.style.left = mo[0] + 'px'; base.style.top = mo[1] + 'px'; knob.style.transform = 'translate(-50%,-50%)'; st.stick = { on: true, x: 0, y: 0, mag: 0 }; }
        else if (e.clientX >= innerWidth * 0.5 && lookId === null) { lookId = e.pointerId; lk = [e.clientX, e.clientY]; }
      });
      zone.addEventListener('pointermove', e => {
        if (e.pointerId === moveId) { const dx = e.clientX - mo[0], dy = e.clientY - mo[1], r = Math.hypot(dx, dy), s = Math.min(1, r / R); st.stick = { on: true, x: dx / (r || 1) * s, y: dy / (r || 1) * s, mag: s }; knob.style.transform = `translate(calc(-50% + ${dx / (r || 1) * Math.min(r, R)}px), calc(-50% + ${dy / (r || 1) * Math.min(r, R)}px))`; }
        else if (e.pointerId === lookId) { const dx = e.clientX - lk[0], dy = e.clientY - lk[1]; lk = [e.clientX, e.clientY]; st.p.yaw = (st.p.yaw + dx * 0.0052) % TAU; st.p.pitch = Math.max(-1.52, Math.min(1.52, st.p.pitch - dy * 0.0052)); }
      });
      const lift = e => { if (e.pointerId === moveId) { moveId = null; base.hidden = true; st.stick = { on: false, x: 0, y: 0, mag: 0 }; } if (e.pointerId === lookId) lookId = null; };
      ['pointerup', 'pointercancel'].forEach(t => zone.addEventListener(t, lift));
      const jump = q('.mg-jump'); jump.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); st.jumpAt = st.t; st.keys.Space = true; });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => jump.addEventListener(t, () => { if (st) delete st.keys.Space; }));
    }
    q('.mg-respawn').addEventListener('click', e => { e.stopPropagation(); respawn(); });
    q('.mg-full').addEventListener('click', e => { e.stopPropagation(); fullscreen(true); });
    q('.mg-seed').addEventListener('click', e => { e.stopPropagation(); const s = Math.floor(Math.random() * 1e6); location.hash = 'seed=' + s; start(s); });
    window.addEventListener('hashchange', () => { const s = seedFromHash(); if (s !== null && world && s !== world.seed) start(s); });
  }
  let askedFull = false;
  function fullscreen(force) {
    if ((askedFull && !force) || document.fullscreenElement || !document.documentElement.requestFullscreen) { if (force && document.fullscreenElement) document.exitFullscreen(); return; }
    askedFull = true; document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
  function respawn() { const s = world.spawn(); Object.assign(st.p, { x: s.x, y: s.y, z: s.z, vy: 0, yaw: s.yaw, pitch: 0 }); st.safe = { x: s.x, y: s.y, z: s.z }; toast('Back at the start.'); }

  // ---------- start ----------
  const seedFromHash = () => { const m = /seed=(-?\d+)/.exec(location.hash); return m ? +m[1] : null; };
  function start(seed) {
    if (st) { st.cells.forEach(dropCell); }
    world = W.createWorld(seed);
    PAL = W.PALETTES.map(palFlat);
    const s = world.spawn();
    const body = MegaBody.createBody(world, s.x, s.y, s.z, s.yaw);
    st = { body, p: body.p, keys: {}, stick: { on: false, x: 0, y: 0, mag: 0 }, cells: new Map(), ready: false, t: 0, last: 0, acc: 0, grounded: false, groundT: 0, jumpAt: 0, jumps: 0, safe: { x: s.x, y: s.y, z: s.z }, safeT: 0, frames: 0, hudT: 0, drawn: 0 };
    q('.mg-load').hidden = false; q('.mg-load').textContent = 'Building the first rooms…';
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function init(rootEl) {
    el = rootEl; cv = q('canvas');
    if (!initGL()) { q('.mg-load').textContent = 'This needs WebGL, which this browser does not have.'; return; }
    setup();
    let seed = seedFromHash(); if (seed === null) { seed = Math.floor(Math.random() * 1e6); history.replaceState(null, '', '#seed=' + seed); }
    start(seed);
    root.Mega = { state: () => st, world: () => world, start, respawn, CW, CH };
  }
  root.MegaGame = { init };
})(window);
