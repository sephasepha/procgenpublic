// The maze in first person: WASD to walk, the mouse to look, space to jump, shift to run. A deliberately plain 3D view
// (flat colours, a torch and fog): what matters here is the space, not how it looks.
// You always start in a spawn room of your own (walk/spawn.js), joined by a corridor to the maze's entrance.
// Cells are read straight from the explorer's sectors, so the world is the same one the map shows, streaming in as you go.
(function (root) {
  const CELL = 2, HEIGHT = 3.2, EYE = 1.6, RADIUS = 0.34, HEADROOM = 0.15; // world units
  const WALK = 4.6, RUN = 7.5, GRAVITY = 24, JUMP = 7.4, CH = 16, SHOW = 4, KEEP = 6;
  const TAU = Math.PI * 2;
  const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const C = { room: hexRGB('#6f9a94'), corridor: hexRGB('#a8946a'), wall: hexRGB('#7b8090'), ceil: hexRGB('#4a4a58') };

  let el = null, cv = null, gl = null, prog = null, loc = null, st = null, raf = 0, onClose = null;

  // ---------- the world as cells ----------
  // the spawn room and its corridor are laid over the maze: a cell is floor if they say so, else if the maze does
  const key = (x, y) => x + ',' + y;
  const kindAt = (gx, gy) => st.plan.cells.get(key(gx, gy)) || null;
  const cellAt = (gx, gy) => (st.plan.cells.has(key(gx, gy)) ? 1 : root.Infinite.pass(gx, gy));
  const solid = (x, z) => cellAt(Math.floor(x / CELL), Math.floor(z / CELL)) !== 1;

  // ---------- meshes: one per 16 by 16 cells, built when near and dropped when far ----------
  function floorColor(gx, gy) {
    const k = kindAt(gx, gy); if (k) return k === 'room' ? C.room : C.corridor;
    const cols = root.Infinite.floorColors(), c = root.Infinite.col(gx, gy), base = cols[c >= 0 && c < 5 ? c : 5];
    return [base[0] / 400, base[1] / 400, base[2] / 400];
  }
  function buildChunk(cx, cy) {
    const v = []; let unknown = false;
    const quad = (a, b, c, d, n, col) => { [a, b, c, a, c, d].forEach(p => v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2])); };
    for (let gy = cy * CH; gy < cy * CH + CH; gy++) for (let gx = cx * CH; gx < cx * CH + CH; gx++) {
      if (cellAt(gx, gy) !== 1) continue;
      const x0 = gx * CELL, x1 = x0 + CELL, z0 = gy * CELL, z1 = z0 + CELL;
      quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], floorColor(gx, gy));
      quad([x0, HEIGHT, z0], [x1, HEIGHT, z0], [x1, HEIGHT, z1], [x0, HEIGHT, z1], [0, -1, 0], C.ceil);
      const shade = 0.92 + ((gx * 73856093 ^ gy * 19349663) & 15) / 100; // a little variation so the walls are not one flat block
      const w = [C.wall[0] * shade, C.wall[1] * shade, C.wall[2] * shade];
      const side = (nx, ny, a, b, c, d, n) => { const p = cellAt(nx, ny); if (p === 1) return; if (p < 0) unknown = true; quad(a, d, c, b, n, w); }; // wound to face into the cell
      side(gx, gy - 1, [x1, 0, z0], [x0, 0, z0], [x0, HEIGHT, z0], [x1, HEIGHT, z0], [0, 0, 1]);
      side(gx + 1, gy, [x1, 0, z1], [x1, 0, z0], [x1, HEIGHT, z0], [x1, HEIGHT, z1], [-1, 0, 0]);
      side(gx, gy + 1, [x0, 0, z1], [x1, 0, z1], [x1, HEIGHT, z1], [x0, HEIGHT, z1], [0, 0, -1]);
      side(gx - 1, gy, [x0, 0, z0], [x0, 0, z1], [x0, HEIGHT, z1], [x0, HEIGHT, z0], [1, 0, 0]);
    }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    return { buf, n: v.length / 9, unknown, ver: st.ver };
  }
  const dropChunk = c => gl.deleteBuffer(c.buf);
  // the sectors loaded changes as you walk: chunks that were built beside ground not yet generated are built again
  const version = () => { const s = root.Infinite.state(); return s ? s.sectors.size + s.failures : 0; };
  function chunks(px, pz, budget) {
    const pcx = Math.floor(px / CELL / CH), pcy = Math.floor(pz / CELL / CH); let built = 0;
    st.ver = version();
    const want = [];
    for (let dy = -SHOW; dy <= SHOW; dy++) for (let dx = -SHOW; dx <= SHOW; dx++) want.push([pcx + dx, pcy + dy, Math.abs(dx) + Math.abs(dy)]);
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of want) {
      const k = key(cx, cy), c = st.chunks.get(k);
      if (c && !(c.unknown && c.ver !== st.ver)) continue;
      if (built >= budget) break;
      if (c) dropChunk(c);
      st.chunks.set(k, buildChunk(cx, cy)); built++;
    }
    st.chunks.forEach((c, k) => { const [cx, cy] = k.split(',').map(Number); if (Math.abs(cx - pcx) > KEEP || Math.abs(cy - pcy) > KEEP) { dropChunk(c); st.chunks.delete(k); } });
  }

  // ---------- gl ----------
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 m; varying vec3 vc; varying vec3 vn; varying vec3 vp;
    void main() { vc = c; vn = n; vp = p; gl_Position = m * vec4(p, 1.0); }`;
  const FS = `precision mediump float; varying vec3 vc; varying vec3 vn; varying vec3 vp; uniform vec3 eye;
    void main() {
      vec3 d = eye - vp; float dist = length(d); float facing = max(dot(normalize(vn), d / max(dist, 0.001)), 0.0);
      float torch = min(1.0, 1.7 / (1.0 + 0.025 * dist * dist)) * (0.45 + 0.55 * facing);
      vec3 col = vc * (0.34 + 0.7 * torch);
      float fog = 1.0 - exp(-dist * 0.032);
      gl_FragColor = vec4(mix(col, vec3(0.012, 0.012, 0.03), fog), 1.0);
    }`;
  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function initGL() {
    gl = cv.getContext('webgl', { antialias: true }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c'), m: gl.getUniformLocation(prog, 'm'), eye: gl.getUniformLocation(prog, 'eye') };
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0.012, 0.012, 0.03, 1);
    return true;
  }
  function viewProj(eye, yaw, pitch, aspect) {
    const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const r = [Math.cos(yaw), 0, Math.sin(yaw)], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1];
    const fov = 1 / Math.tan(1.15 / 2), n = 0.05, fa = 90, P = [fov / aspect, 0, 0, 0, 0, fov, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++) for (let k = 0; k < 4; k++) o[c * 4 + r2] += P[k * 4 + r2] * V[c * 4 + k];
    return o;
  }

  // ---------- the walker ----------
  function collide(x, z) { const r = RADIUS; return solid(x - r, z - r) || solid(x + r, z - r) || solid(x - r, z + r) || solid(x + r, z + r); }
  function step(dt) {
    const p = st.p, k = st.keys;
    const fw = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), sd = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (fw || sd) {
      const len = Math.hypot(fw, sd), sp = (k.ShiftLeft || k.ShiftRight ? RUN : WALK) * dt / len;
      const dx = (Math.sin(p.yaw) * fw + Math.cos(p.yaw) * sd) * sp, dz = (-Math.cos(p.yaw) * fw + Math.sin(p.yaw) * sd) * sp;
      if (!collide(p.x + dx, p.z)) p.x += dx; // each axis on its own, so you slide along a wall
      if (!collide(p.x, p.z + dz)) p.z += dz;
    }
    if (k.Space && p.y === 0) { p.vy = JUMP; st.jumps++; }
    if (p.y > 0 || p.vy > 0) {
      p.vy -= GRAVITY * dt; p.y += p.vy * dt;
      if (p.y + EYE + HEADROOM > HEIGHT) { p.y = HEIGHT - EYE - HEADROOM; if (p.vy > 0) p.vy = 0; }
      if (p.y <= 0) { p.y = 0; p.vy = 0; }
    }
  }
  const cellOf = () => [Math.floor(st.p.x / CELL), Math.floor(st.p.z / CELL)];
  function where() {
    const [gx, gy] = cellOf(), kind = kindAt(gx, gy);
    if (kind === 'room') return 'Spawn room';
    if (kind) return 'Spawn corridor';
    const i = root.Infinite.info(); return i ? i.name : 'The maze';
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (st.t || t)) / 1000); st.t = t;
    resize();
    step(dt);
    const [gx, gy] = cellOf();
    if (gx !== st.gx || gy !== st.gy) { st.gx = gx; st.gy = gy; if (!kindAt(gx, gy)) root.Infinite.follow(gx, gy); st.moved++; label(); }
    chunks(st.p.x, st.p.z, 2);
    const eye = st.cam ? st.cam.eye : [st.p.x, st.p.y + EYE, st.p.z], cyaw = st.cam ? st.cam.yaw : st.p.yaw, cpitch = st.cam ? st.cam.pitch : st.p.pitch; // st.cam: a fixed camera, for testing
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog); gl.uniformMatrix4fv(loc.m, false, viewProj(eye, cyaw, cpitch, cv.width / cv.height)); gl.uniform3fv(loc.eye, eye);
    gl.enableVertexAttribArray(loc.p); gl.enableVertexAttribArray(loc.n); gl.enableVertexAttribArray(loc.c);
    st.chunks.forEach(c => {
      if (!c.n) return; gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 36, 0); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 36, 12); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, 36, 24);
      gl.drawArrays(gl.TRIANGLES, 0, c.n);
    });
    st.frames++;
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  const label = () => { const e = el.querySelector('.wk-where'); if (e) e.textContent = where(); };

  // ---------- open and close ----------
  function ui() {
    if (el) return;
    el = document.createElement('div'); el.className = 'walk'; el.hidden = true;
    el.innerHTML = `<canvas aria-label="First-person view: WASD to walk, mouse to look, space to jump"></canvas><i class="wk-dot"></i>
      <div class="wk-top"><b class="wk-where"></b><button type="button" class="wk-back" aria-label="Back to the map">Map</button></div>
      <div class="wk-help"><b>Click to look around</b><span>W A S D walk · mouse looks · Space jumps · Shift runs · Esc frees the mouse, then closes</span></div>`;
    document.body.appendChild(el); cv = el.querySelector('canvas');
    el.querySelector('.wk-back').addEventListener('click', e => { e.stopPropagation(); close(); });
    cv.addEventListener('click', () => { if (document.pointerLockElement !== cv) cv.requestPointerLock && cv.requestPointerLock(); });
    el.querySelector('.wk-help').addEventListener('click', () => { cv.requestPointerLock && cv.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { if (el.hidden) return; const on = document.pointerLockElement === cv; el.classList.toggle('looking', on); if (st) st.locked = on; });
    document.addEventListener('mousemove', e => {
      if (!st || el.hidden || document.pointerLockElement !== cv) return;
      st.p.yaw = (st.p.yaw + e.movementX * 0.0022) % TAU; st.p.pitch = Math.max(-1.5, Math.min(1.5, st.p.pitch - e.movementY * 0.0022));
    });
    window.addEventListener('keydown', e => {
      if (!st || el.hidden) return;
      if (e.code === 'Escape') { if (document.pointerLockElement !== cv) close(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); st.keys[e.code] = true; }
    }, true);
    window.addEventListener('keyup', e => { if (st) delete st.keys[e.code]; }, true);
    window.addEventListener('blur', () => { if (st) st.keys = {}; });
  }

  function open(done) {
    const I = root.Infinite; if (!I || !I.ready()) return false;
    ui(); onClose = done || null;
    const ent = I.entrance(); if (!ent) return false;
    // look for rock for the spawn room in what is generated around the entrance
    const plan = root.planSpawn((x, y) => I.pass(x, y), ent.gx, ent.gy);
    if (!plan.ok) { console.warn('walk: no room for a spawn room'); return false; }
    if (st) { st.chunks.forEach(dropChunk); }
    I.suspend(); el.hidden = false;
    document.documentElement.classList.add('walk-open');
    if (!gl && !initGL()) { el.hidden = true; I.resume(); return false; }
    st = { plan, chunks: new Map(), keys: {}, p: { x: (plan.start.gx + 0.5) * CELL, z: (plan.start.gy + 0.5) * CELL, y: 0, vy: 0, yaw: plan.start.dir * Math.PI / 2, pitch: 0 }, t: 0, gx: null, gy: null, ver: 0, frames: 0, moved: 0, jumps: 0, locked: false };
    el.classList.remove('looking'); label(); resize();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    return true;
  }
  function close() {
    if (!el || el.hidden) return;
    cancelAnimationFrame(raf); raf = 0; if (document.pointerLockElement === cv) document.exitPointerLock();
    el.hidden = true; document.documentElement.classList.remove('walk-open');
    if (st) { st.keys = {}; const [gx, gy] = cellOf(); if (!kindAt(gx, gy)) root.Infinite.follow(gx, gy); }
    root.Infinite.resume(); if (onClose) onClose();
  }
  root.Walk = { open, close, cellAt, active: () => !!(el && !el.hidden), state: () => st, CELL, HEIGHT, EYE };
})(window);
