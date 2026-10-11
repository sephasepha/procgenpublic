// First-person walking in the infinite megastructure (mega/world.js): WebGL, no libraries. Plain flat-shaded voxels,
// pale fog, and the scale of the place. WASD, mouse look and Space on a computer; a thumb-stick, a look pad and a jump
// button on a phone.
(function (root) {
  const W = root.MegaWorld, { CW, CH } = W;
  const EYE = 1.55, STEP_DT = 1 / 120;
  const PHONE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  // cells drawn around you: sideways, above, below. The drawn volume is an ellipsoid, wide and tall, so you see far
  // up and down a shaft while the sideways reach stays the same
  const RH = PHONE ? 5 : 6, RUP = PHONE ? 5 : 7, RDOWN = PHONE ? 8 : 10;
  // fog: thicker than before, but vertical distance counts for less (FOGV), so drops and shafts read deep
  const FOG = [0.62, 0.64, 0.66], FOGD = PHONE ? 0.0125 : 0.012, FOGV = 0.45;
  const reach = (di, dj, dk) => { const h = Math.hypot(di, dk) / (RH + 0.6), v = dj > 0 ? dj / (RUP + 0.5) : -dj / (RDOWN + 0.5); return h * h + v * v; };
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
    if (j === world.PJ) meshTerrain(c);
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
  const dropCell = c => { if (c.vbo) { gl.deleteBuffer(c.vbo); gl.deleteBuffer(c.ibo); } if (c.tvbo) { gl.deleteBuffer(c.tvbo); gl.deleteBuffer(c.tibo); } };
  let PAL = [];
  // the plain: a smooth heightfield over the surface cell, a vertex per voxel corner, shaded by its slope and coloured
  // grass or dirt by a slow noise; the quads over a portal's stairwell are left out
  function meshTerrain(c) {
    const ox = c.i * CW, oz = c.k * CW, N = CW + 1, P = new Float32Array(N * N * 6), X = [];
    const L = [0.35, 0.85, 0.4], ll = Math.hypot(...L);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const gx = ox + x, gz = oz + z, h = world.terrainH(gx, gz), hx = world.terrainH(gx + 1, gz) - world.terrainH(gx - 1, gz), hz = world.terrainH(gx, gz + 1) - world.terrainH(gx, gz - 1);
      const n = [-hx / 2, 1, -hz / 2], nl = Math.hypot(...n), lit = 0.55 + 0.45 * Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl / ll);
      const g = Math.min(1, Math.max(0, (Math.sin(gx * 0.11) * Math.cos(gz * 0.09) * 0.5 + 0.5) * 0.6 + 0.4 * ((gx * 7 + gz * 13) % 5) / 5));
      const col = [0.30 + (0.23 - 0.30) * g, 0.29 + (0.30 - 0.29) * g, 0.24 + (0.19 - 0.24) * g];
      const o = (z * N + x) * 6; P[o] = x; P[o + 1] = h - c.j * CH; P[o + 2] = z; P[o + 3] = col[0] * lit; P[o + 4] = col[1] * lit; P[o + 5] = col[2] * lit;
    }
    for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
      if (world.groundAt(ox + x + 0.5, oz + z + 0.5) === null || world.voxel(ox + x, world.SURF + 1, oz + z)) continue; // the stairwell, and the stone that comes up to the surface
      const a = z * N + x; X.push(a, a + N, a + N + 1, a, a + N + 1, a + 1);
    }
    c.tvbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, c.tvbo); gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);
    c.tibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.tibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(X), gl.STATIC_DRAW);
    c.tn = X.length;
  }
  const TVS = `attribute vec3 aP; attribute vec3 aC; uniform mat4 uVP; uniform vec3 uRel; varying vec3 vRel; varying vec3 vCol;
    void main() { vRel = aP + uRel; vCol = aC * (0.5 + 0.9 / (1.0 + 0.12 * length(vRel))); gl_Position = uVP * vec4(vRel, 1.0); }`;
  const TFS = `precision mediump float; varying vec3 vRel; varying vec3 vCol; uniform vec3 uFog; uniform float uFogD; uniform vec4 uClip;
    void main() { if (dot(uClip.xyz, vRel) + uClip.w > 0.0) discard; float d = length(vec3(vRel.x, vRel.y * 0.45, vRel.z)) * uFogD; gl_FragColor = vec4(mix(vCol, uFog, 1.0 - exp(-d * d)), 1.0); }`;
  let tprog, tloc;

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
  const FS = `precision mediump float; varying vec3 vL; varying vec3 vRel; varying float vFace; varying vec3 vCol; uniform vec3 uFog; uniform float uFogD; uniform vec4 uClip;
    void main() {
      if (dot(uClip.xyz, vRel) + uClip.w > 0.0) discard; // through a portal: nothing on the near side of its twin
      vec2 uv = vFace < 1.5 ? vL.zy : vFace < 3.5 ? vL.xz : vL.xy;
      vec2 fr = fract(uv); float e = min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y));
      float grid = 0.91 + 0.09 * smoothstep(0.0, 0.06, e);
      float d = length(vec3(vRel.x, vRel.y * 0.45, vRel.z)) * uFogD; float fog = 1.0 - exp(-d * d);
      gl_FragColor = vec4(mix(vCol * grid, uFog, fog), 1.0);
    }`;
  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function initGL() {
    gl = cv.getContext('webgl', { antialias: !coarse, stencil: true, powerPreference: 'high-performance' }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = { a: gl.getAttribLocation(prog, 'a') };
    tprog = gl.createProgram(); gl.attachShader(tprog, shader(gl.VERTEX_SHADER, TVS)); gl.attachShader(tprog, shader(gl.FRAGMENT_SHADER, TFS)); gl.linkProgram(tprog);
    if (!gl.getProgramParameter(tprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(tprog));
    tloc = { aP: gl.getAttribLocation(tprog, 'aP'), aC: gl.getAttribLocation(tprog, 'aC') }; ['uVP', 'uRel', 'uFog', 'uFogD', 'uClip'].forEach(n => { tloc[n] = gl.getUniformLocation(tprog, n); });
    ['uVP', 'uRel', 'uPal', 'uLight', 'uAmb', 'uFog', 'uFogD', 'uClip'].forEach(n => { loc[n] = gl.getUniformLocation(prog, n); });
    qprog = gl.createProgram(); gl.attachShader(qprog, shader(gl.VERTEX_SHADER, QVS)); gl.attachShader(qprog, shader(gl.FRAGMENT_SHADER, QFS)); gl.linkProgram(qprog);
    qloc = { aP: gl.getAttribLocation(qprog, 'aP'), uVP: gl.getUniformLocation(qprog, 'uVP'), uCol: gl.getUniformLocation(qprog, 'uCol') }; qbuf = gl.createBuffer();
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
    const want = [], keep = new Set();
    // everything you could see from a viewpoint: the drawn ellipsoid round it (on the plain the crust hides the
    // structure, so only the plain's levels)
    const around = (ci, cj, ck, extra, kept) => {
      const top = cj >= world.PJ;
      for (let dj = -RDOWN; dj <= RUP; dj++) for (let dk = -RH; dk <= RH; dk++) for (let di = -RH; di <= RH; di++) {
        const r = reach(di, dj, dk); if (r > 1) continue; if (top && (cj + dj < world.GJ || cj + dj > world.PJ + 1)) continue;
        want.push([ci + di, cj + dj, ck + dk, extra + Math.hypot(di, dk) + Math.abs(dj) * 0.5]);
        if (kept) keep.add((ci + di) + ',' + (cj + dj) + ',' + (ck + dk));
      }
    };
    around(ci, cj, ck, 0, false);
    // and from the far end of the nearest doorway: the eye moved through it, so that the view through the doorway is
    // complete, and stepping through finds everything built (after the cells round you, which come first)
    const N = st.ready && nearestPortal([p.x, p.y + EYE, p.z]);
    if (N) { const v = [p.x + N.d[0], p.y + 1 + N.d[1], p.z + N.d[2]]; around(fdiv(Math.floor(v[0]), CW), fdiv(Math.floor(v[1]), CH), fdiv(Math.floor(v[2]), CW), 1.5, true); }
    want.sort((a, b) => a[3] - b[3]);
    let built = 0;
    for (const [i, j, k] of want) {
      const key = i + ',' + j + ',' + k; if (st.cells.has(key)) continue;
      st.cells.set(key, meshCell(i, j, k)); built++;
      if (performance.now() - t0 > budgetMs && st.ready) break;
    }
    st.cells.forEach((c, key) => { if (reach(c.i - ci, c.j - cj, c.k - ck) > 1.35 && !keep.has(key)) { dropCell(c); st.cells.delete(key); } });
    if (!st.ready) { const near = want.filter(w => w[3] <= 1.5).every(w => st.cells.has(w[0] + ',' + w[1] + ',' + w[2])); if (near) { st.ready = true; q('.mg-load').hidden = true; } }
    return built;
  }

  // ---------- frame ----------
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - (st.last || ts)) / 1000); st.last = ts; st.acc = (st.acc || 0) + dt;
    resize();
    stepGuide();
    const S = st.stats, tc = performance.now(), built = chunks(st.ready ? 5 : 40), cm = performance.now() - tc;
    S.frame = S.frame * 0.92 + dt * 1000 * 0.08; S.chunk = S.chunk * 0.92 + cm * 0.08; S.built += built; if (cm > S.chunkMax) S.chunkMax = cm;
    if (st.ready) {
      let n = 0; while (st.acc >= STEP_DT && n++ < 12) { st.acc -= STEP_DT; physics(STEP_DT); }
      if (st.acc > STEP_DT * 12) st.acc = 0;
      // which portal you came down: you were on the plain and now you are under the lid, in a portal's column
      { const up = st.p.y >= world.SURF + 0.5;
        const lc = st.body.lastCross; if (lc && lc !== st.seenCross) { st.seenCross = lc; if (lc.down) st.entered = lc.a; }
        if (up || st.p.y < world.SURF - 1) st.wasUp = up; }
      if (st.grounded && st.t - st.safeT > 0.5) { st.safe = { x: st.p.x, y: st.p.y, z: st.p.z }; st.safeT = st.t; }
    }
    const td = performance.now(); draw(); st.stats.draw = st.stats.draw * 0.92 + (performance.now() - td) * 0.08;
    if (ts - st.hudT > 150) { st.hudT = ts; hud(); }
    if (ts - st.stats.at > 500) { // the timing line, twice a second
      const S = st.stats, secs = (ts - S.at) / 1000;
      q('.mg-stats').textContent = `${S.frame.toFixed(1)} ms · ${Math.round(1000 / Math.max(1, S.frame))} fps · draw ${S.draw.toFixed(1)} ms · chunks ${S.chunk.toFixed(1)} ms (max ${S.chunkMax.toFixed(0)}, ${(S.built / secs).toFixed(0)}/s) · ${st.drawn}/${st.cells.size} cells` + (st.portalsSeen ? ` · ${st.portalsSeen} portal${st.portalsSeen > 1 ? 's' : ''} (${st.portalDrawn} cells)` : '') + (S.guideMs ? ` · route ${S.guideMs.toFixed(0)} ms over ${S.guideFrames} frames` : '');
      S.at = ts; S.built = 0; S.chunkMax = 0;
    }
    st.frames++;
  }
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2) * (coarse ? 0.7 : 1), w = Math.max(2, Math.floor(cv.clientWidth * scale)), h = Math.max(2, Math.floor(cv.clientHeight * scale));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  // the fog where an eye is: above ground dense and a little green, thickening as you climb out of a stairwell
  function fogAt(y) { const up = Math.min(1, Math.max(0, (y - (world.SURF - 6)) / 8)); return { fog: FOG.map((f, n) => f + ([0.66, 0.68, 0.64][n] - f) * up), fogD: FOGD + (0.042 - FOGD) * up }; }
  const NOCLIP = [0, 0, 0, -1];
  // the cells and the plain as seen from eye (the view-projection m is relative to the eye, so it serves any eye with
  // the same look); clip is a plane in eye-relative space: fragments with dot(xyz, rel) + w > 0 are dropped
  function scene(eye, m, pl, clip, F) {
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uVP, false, m); gl.uniform3fv(loc.uFog, F.fog); gl.uniform1f(loc.uFogD, F.fogD); gl.uniform4fv(loc.uClip, clip);
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
    gl.disableVertexAttribArray(loc.a);
    // the plain
    gl.useProgram(tprog); gl.uniformMatrix4fv(tloc.uVP, false, m); gl.uniform3fv(tloc.uFog, F.fog); gl.uniform1f(tloc.uFogD, F.fogD); gl.uniform4fv(tloc.uClip, clip);
    gl.enableVertexAttribArray(tloc.aP); gl.enableVertexAttribArray(tloc.aC);
    st.cells.forEach(c => {
      if (!c.tn) return;
      gl.uniform3f(tloc.uRel, c.i * CW - eye[0], c.j * CH - eye[1], c.k * CW - eye[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.tvbo); gl.vertexAttribPointer(tloc.aP, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(tloc.aC, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.tibo); gl.drawElements(gl.TRIANGLES, c.tn, gl.UNSIGNED_SHORT, 0);
    });
    gl.disableVertexAttribArray(tloc.aP); gl.disableVertexAttribArray(tloc.aC);
    return drawn;
  }
  // a flat quad (eye-relative corners) in one colour, for marking portal openings
  const QVS = `attribute vec3 aP; uniform mat4 uVP; void main() { gl_Position = uVP * vec4(aP, 1.0); }`;
  const QFS = `precision mediump float; uniform vec4 uCol; void main() { gl_FragColor = uCol; }`;
  let qprog, qloc, qbuf;
  function quad(m, pts, col) {
    gl.useProgram(qprog); gl.uniformMatrix4fv(qloc.uVP, false, m); gl.uniform4fv(qloc.uCol, col);
    gl.bindBuffer(gl.ARRAY_BUFFER, qbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(qloc.aP); gl.vertexAttribPointer(qloc.aP, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, pts.length / 3); gl.disableVertexAttribArray(qloc.aP);
  }
  // Portals, after Prey's: for each doorway near you, on its open side, its opening is marked in the stencil buffer
  // (where it is not hidden), the depth there is reset to the far plane and painted with the fog of the other side, and
  // the world is drawn again from the eye moved to the twin doorway, only inside the mark, with everything on the near
  // side of the twin's plane cut away. The two doorways have the same shape and facing, so the move is a translation.
  // the portal doorways near an eye that it sees from their open side: on the plain from in front (+z), a twin from
  // its stair (-z). Each with the move to its other end, d.
  function nearPortals(eye) {
    const ci = Math.floor(Math.floor(eye[0]) / CW), cj = Math.floor(Math.floor(eye[1]) / CH), ck = Math.floor(Math.floor(eye[2]) / CW), out = [];
    for (let i = ci - 3; i <= ci + 3; i++) for (let k = ck - 3; k <= ck + 3; k++) {
      if (cj >= world.PJ - 1 && world.portalAt(i, k)) { const P = world.portalPair(i, k), f = P.A; if (eye[1] > f.y0 - 1 && eye[1] < f.y0 + 12 && eye[2] > f.zP) out.push({ f, far: P.B, d: P.d, side: 1 }); }
      if (cj < world.GJ) for (let j = cj - 2; j <= cj + 1; j++) if (world.isSite(i, j, k)) { const P = world.pairOfSite(i, j, k), f = P.B; if (eye[1] > f.y0 - 12 && eye[1] < f.y0 + 6 && eye[2] < f.zP) out.push({ f, far: P.A, d: P.d.map(v => -v), side: -1 }); }
    }
    return out;
  }
  // the nearest doorway end within a few cells, on either side of it (for loading what is beyond it)
  function nearestPortal(eye) {
    const ci = Math.floor(Math.floor(eye[0]) / CW), cj = Math.floor(Math.floor(eye[1]) / CH), ck = Math.floor(Math.floor(eye[2]) / CW);
    let best = null; const consider = (f, d) => { const dist = Math.hypot((f.x0 + f.x1) / 2 - eye[0], f.y0 - eye[1], f.zP - eye[2]); if (dist < 4 * CW && (!best || dist < best.dist)) best = { d, dist }; };
    for (let i = ci - 3; i <= ci + 3; i++) for (let k = ck - 3; k <= ck + 3; k++) {
      if (cj >= world.PJ - 1 && world.portalAt(i, k)) { const P = world.portalPair(i, k); consider(P.A, P.d); }
      if (cj < world.GJ) for (let j = cj - 2; j <= cj + 1; j++) if (world.isSite(i, j, k)) { const P = world.pairOfSite(i, j, k); consider(P.B, P.d.map(v => -v)); }
    }
    return best;
  }
  function portals(eye, m, pl) {
    const out = nearPortals(eye);
    for (const P of out) {
      const f = P.f, z = f.zP - eye[2], y0 = f.y0 - eye[1], y1 = f.y0 + f.h - eye[1], x0 = f.x0 - eye[0], x1 = f.x1 - eye[0];
      // The opening is marked as a shallow box, half a metre deep, going back from the plane into the doorway's own depth
      // (where only the opening can see it). A flat quad would be sliced by the near plane as you step through it,
      // above all walking in sideways, and for a frame part of the view would show this side; every ray through the
      // opening meets the box, however close the eye is. Its sides sit a hair inside the opening, clear of the piers.
      const e = 0.003, a0 = x0 + e, a1 = x1 - e, b0 = y0 + e, b1 = y1 - e, zb = z - 0.5 * P.side;
      const Q = (p0, p1, p2, p3) => [...p0, ...p1, ...p2, ...p0, ...p2, ...p3];
      const tri = [].concat(Q([a0, b0, z], [a1, b0, z], [a1, b1, z], [a0, b1, z]), Q([a0, b0, zb], [a1, b0, zb], [a1, b1, zb], [a0, b1, zb]),
        Q([a0, b0, z], [a0, b0, zb], [a0, b1, zb], [a0, b1, z]), Q([a1, b0, z], [a1, b0, zb], [a1, b1, zb], [a1, b1, z]),
        Q([a0, b0, z], [a1, b0, z], [a1, b0, zb], [a0, b0, zb]), Q([a0, b1, z], [a1, b1, z], [a1, b1, zb], [a0, b1, zb]));
      const inside = false;
      const eyeV = [eye[0] + P.d[0], eye[1] + P.d[1], eye[2] + P.d[2]], F = fogAt(eyeV[1] - EYE); // exactly the fog you will have there
      gl.enable(gl.STENCIL_TEST); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.colorMask(false, false, false, false); gl.depthMask(false);
      if (inside) { gl.clearStencil(1); gl.clear(gl.STENCIL_BUFFER_BIT); gl.clearStencil(0); }
      else { gl.disable(gl.CULL_FACE); quad(m, tri, [0, 0, 0, 0]); gl.enable(gl.CULL_FACE); }
      // the far plane and the other side's fog inside the mark
      gl.stencilFunc(gl.EQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.colorMask(true, true, true, true); gl.depthMask(true); gl.depthFunc(gl.ALWAYS); gl.depthRange(1, 1); gl.disable(gl.CULL_FACE);
      const far = [-1e3, -1e3, 0, 1e3, -1e3, 0, 1e3, 1e3, 0, -1e3, -1e3, 0, 1e3, 1e3, 0, -1e3, 1e3, 0]; // a big quad straight ahead of the camera, in clip space below
      quadClip(far, [F.fog[0], F.fog[1], F.fog[2], 1]);
      gl.depthRange(0, 1); gl.depthFunc(gl.LESS); gl.enable(gl.CULL_FACE);
      // the far side: keep only what lies beyond the twin's plane (z < zP from the plain's doorway; z > zP from the crust's)
      const zF = P.far.zP, clip = P.side > 0 ? [0, 0, 1, eyeV[2] - zF] : [0, 0, -1, zF - eyeV[2]];
      st.portalDrawn += scene(eyeV, m, pl, clip, F);
      gl.disable(gl.STENCIL_TEST);
    }
    return out.length;
  }
  // a quad given directly in clip space (x, y in -1..1 cover the screen), for filling the stencil mark
  function quadClip(pts, col) {
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), P = [];
    for (let n = 0; n < pts.length; n += 3) P.push(Math.max(-1, Math.min(1, pts[n])), Math.max(-1, Math.min(1, pts[n + 1])), 0.999);
    quad(I, P, col);
  }
  function draw() {
    const p = st.p, eye = [p.x, p.y + EYE, p.z];
    const m = viewProj(p.yaw, p.pitch, cv.width / cv.height), pl = planes(m), F = fogAt(p.y);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(F.fog[0], F.fog[1], F.fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    st.portalDrawn = 0;
    const drawn = scene(eye, m, pl, NOCLIP, F);
    st.portalsSeen = portals(eye, m, pl);
    drawLine(m, eye, F.fog, F.fogD);
    st.drawn = drawn;
  }

  // ---------- hud ----------
  let toastT = 0;
  function toast(msg) { const t = q('.mg-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
  function hud() {
    const p = st.p, i = fdiv(Math.floor(p.x), CW), j = fdiv(Math.floor(p.y), CH), k = fdiv(Math.floor(p.z), CW), inf = world.info(i, j, k);
    const place = inf.site ? 'A doorway to the surface' : inf.j === world.GJ ? 'Rock' : inf.biome === 'surface' ? 'Open ground' : inf.air ? 'Open air' : inf.void ? (inf.biome === 'expanse' ? 'A deck' : 'The shaft') : inf.biome === 'expanse' ? 'Inside an obelisk' : inf.well ? 'A well' : inf.drop ? 'A drop' : ({ open: 'A hall', pillars: 'Pillar hall', tunnels: 'Conduit', warren: 'Cells', terrace: 'A terrace', catacomb: 'Passages', crypt: 'A stairwell' })[inf.variant];
    q('.mg-where').innerHTML = `<b>${W.BIOME_NAMES[inf.biome]}</b><span>${place} · ${W.PALETTES[inf.region].name} · level ${j}</span>`;
    q('.mg-pos').textContent = `cell ${i}, ${j}, ${k} · seed ${world.seed}`;
  }

  // ---------- input ----------
  function setup() {
    window.addEventListener('keydown', e => {
      if (!st) return;
      if (e.code === 'KeyR' && !e.repeat) { respawn(); return; }
      if (e.code === 'KeyF' && !e.repeat) { guide(); return; }
      if (e.code === 'KeyT' && !e.repeat) { surfaceToggle(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); st.keys[e.code] = true; }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) st.jumpAt = st.t; st.keys.Space = true; }
    });
    window.addEventListener('keyup', e => { if (!st) return; delete st.keys[e.code]; });
    window.addEventListener('blur', () => { if (st) st.keys = {}; });
    const lockEl = q('.mg-stage');
    // raw mouse input where the browser has it (it avoids the acceleration that makes some jumps); else plain lock
    const lock = () => {
      if (coarse || document.pointerLockElement === cv || !cv.requestPointerLock) return;
      try { const r = cv.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { cv.requestPointerLock(); } catch (e) {} }); }
      catch (e) { try { cv.requestPointerLock(); } catch (e2) {} }
    };
    q('.mg-help').addEventListener('click', lock); cv.addEventListener('click', lock);
    // Mouse look. Browsers now and then report one absurd movement (Chrome does it most just after the lock starts,
    // and on some mice at random): the first events after locking are ignored, and so is any single event bigger than
    // a hand could make, so the view never whips round in one frame.
    const SENS = 0.0014;
    let lockedAt = 0;
    document.addEventListener('pointerlockchange', () => { const on = document.pointerLockElement === cv; el.classList.toggle('looking', on); lockedAt = performance.now(); });
    document.addEventListener('mousemove', e => {
      if (!st || document.pointerLockElement !== cv) return;
      const dx = e.movementX || 0, dy = e.movementY || 0, m = Math.hypot(dx, dy);
      if (performance.now() - lockedAt < 120) return;
      if (m > 250) return; // a spike, not a hand (250 px in one event is some 30,000 px a second)
      st.p.yaw = (st.p.yaw + dx * SENS) % TAU; st.p.pitch = Math.max(-1.52, Math.min(1.52, st.p.pitch - dy * SENS));
    });
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
      const sb = q('.mg-surf'); if (sb) sb.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); surfaceToggle(); });
      const gb = q('.mg-guide'); if (gb) gb.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); guide(); });
      const jump = q('.mg-jump'); jump.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); st.jumpAt = st.t; st.keys.Space = true; });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => jump.addEventListener(t, () => { if (st) delete st.keys.Space; }));
    }
    q('.mg-respawn').addEventListener('click', e => { e.stopPropagation(); respawn(); });
    q('.mg-full').addEventListener('click', e => { e.stopPropagation(); fullscreen(true); });
    q('.mg-seed').addEventListener('click', e => { e.stopPropagation(); const s = Math.floor(Math.random() * 1e6); history.replaceState(null, '', hashFor(s, biome)); start(s); });
    // the biome picker: Mixed, or every district forced to one kind, to look at each on its own
    const bl = q('.mg-biomes');
    if (bl) {
      bl.innerHTML = ['', ...W.BIOMES].map(b => `<button type="button" data-b="${b}">${b ? W.BIOME_NAMES[b].replace('The ', '') : 'Mixed'}</button>`).join('');
      bl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); biome = b.dataset.b || null; history.replaceState(null, '', hashFor(world.seed, biome)); start(world.seed); });
      ['pointerdown', 'touchstart', 'mousedown'].forEach(t => bl.addEventListener(t, e => e.stopPropagation(), { passive: true }));
    }
    window.addEventListener('hashchange', () => { const s = seedFromHash(), b = biomeFromHash(); if (s !== null && world && (s !== world.seed || b !== biome)) { biome = b; start(s); } });
  }
  let askedFull = false;
  function fullscreen(force) {
    if ((askedFull && !force) || document.fullscreenElement || !document.documentElement.requestFullscreen) { if (force && document.fullscreenElement) document.exitFullscreen(); return; }
    askedFull = true; document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
  const startPoint = () => biome ? world.spawn() : world.surfaceSpawn(); // Mixed begins on the plain; a forced kind begins inside it
  // ---------- the guide line (F): a glowing ribbon along the floor to the nearest portal, pulsing towards it ----------
  const LVS = `attribute vec3 aP; attribute float aT; uniform mat4 uVP; uniform vec3 uRel; varying vec3 vRel; varying float vT;
    void main() { vRel = aP + uRel; vT = aT; gl_Position = uVP * vec4(vRel, 1.0); }`;
  const LFS = `precision mediump float; varying vec3 vRel; varying float vT; uniform vec3 uFog; uniform float uFogD; uniform float uTime; uniform float uAlpha;
    void main() { float pulse = pow(1.0 - fract(vT / 5.0 - uTime * 1.2), 3.0); vec3 col = vec3(1.0, 0.82, 0.45) * (0.75 + 0.6 * pulse);
      float d = length(vec3(vRel.x, vRel.y * 0.45, vRel.z)) * uFogD; float fog = (1.0 - exp(-d * d)) * 0.7;
      gl_FragColor = vec4(mix(col, uFog, fog), uAlpha * (0.75 + 0.25 * pulse)); }`;
  let lprog, lloc, line = null;
  const GUIDE_S = 6;
  // F starts a search job; the frame loop gives it a few milliseconds each frame until it has the route
  let job = null;
  function guide() {
    if (!st || !st.ready || job) return;
    job = { j: MegaGuide.routeJob(world, st.p.x, st.p.y, st.p.z), t0: performance.now(), work: 0, frames: 0 };
    stepGuide();
    if (job) toast('Finding the way…');
  }
  function stepGuide() {
    if (!job) return;
    const t = performance.now(), r = job.j.step(4); job.work += performance.now() - t; job.frames++;
    if (r === undefined) return;
    st.stats.guideMs = job.work; st.stats.guideFrames = job.frames; job = null;
    showRoute(r);
  }
  function showRoute(r) {
    if (!r || r.length < 2) { toast('No way to a portal was found from here.'); return; }
    if (!lprog) {
      lprog = gl.createProgram(); gl.attachShader(lprog, shader(gl.VERTEX_SHADER, LVS)); gl.attachShader(lprog, shader(gl.FRAGMENT_SHADER, LFS)); gl.linkProgram(lprog);
      lloc = { aP: gl.getAttribLocation(lprog, 'aP'), aT: gl.getAttribLocation(lprog, 'aT') }; ['uVP', 'uRel', 'uFog', 'uFogD', 'uTime', 'uAlpha'].forEach(n => { lloc[n] = gl.getUniformLocation(lprog, n); });
    }
    if (line) { gl.deleteBuffer(line.vbo); gl.deleteBuffer(line.ibo); }
    // smooth the staircase of voxel centres a little, then lay a flat ribbon 0.2 m wide just above the floor
    const o = r[0], pts = r.map((p, n) => { if (n === 0 || n === r.length - 1) return p; const a = r[n - 1], b = r[n + 1]; return [(a[0] + 2 * p[0] + b[0]) / 4, p[1], (a[2] + 2 * p[2] + b[2]) / 4]; });
    const V = [], X = []; let along = 0, nv = 0;
    for (let n = 0; n < pts.length - 1; n++) {
      const a = pts[n], b = pts[n + 1], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz); if (l < 1e-3) { along += Math.abs(b[1] - a[1]); continue; }
      const nx = -dz / l * 0.1, nz = dx / l * 0.1, ya = a[1] - o[1] + 0.06, yb = b[1] - o[1] + 0.06, la = along; along += Math.hypot(l, b[1] - a[1]);
      V.push(a[0] - o[0] + nx, ya, a[2] - o[2] + nz, la, a[0] - o[0] - nx, ya, a[2] - o[2] - nz, la, b[0] - o[0] + nx, yb, b[2] - o[2] + nz, along, b[0] - o[0] - nx, yb, b[2] - o[2] - nz, along);
      X.push(nv, nv + 1, nv + 2, nv + 1, nv + 3, nv + 2); nv += 4;
    }
    line = { o, n: X.length, t0: st.t, vbo: gl.createBuffer(), ibo: gl.createBuffer() };
    gl.bindBuffer(gl.ARRAY_BUFFER, line.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, line.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(X), gl.STATIC_DRAW);
    toast(`The way to a portal: about ${Math.round(along)} m.`);
  }
  function drawLine(m, eye, fog, fogD) {
    if (!line) return;
    const age = st.t - line.t0; if (age > GUIDE_S) { gl.deleteBuffer(line.vbo); gl.deleteBuffer(line.ibo); line = null; return; }
    const alpha = Math.min(1, age / 0.2) * Math.min(1, (GUIDE_S - age) / 1.5);
    gl.useProgram(lprog); gl.uniformMatrix4fv(lloc.uVP, false, m); gl.uniform3fv(lloc.uFog, fog); gl.uniform1f(lloc.uFogD, fogD);
    gl.uniform1f(lloc.uTime, age); gl.uniform1f(lloc.uAlpha, alpha); gl.uniform3f(lloc.uRel, line.o[0] - eye[0], line.o[1] - eye[1], line.o[2] - eye[2]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.enableVertexAttribArray(lloc.aP); gl.enableVertexAttribArray(lloc.aT);
    gl.bindBuffer(gl.ARRAY_BUFFER, line.vbo); gl.vertexAttribPointer(lloc.aP, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(lloc.aT, 1, gl.FLOAT, false, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, line.ibo); gl.drawElements(gl.TRIANGLES, line.n, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(lloc.aP); gl.disableVertexAttribArray(lloc.aT);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
  }

  // T: up to the plain, in front of the doorway you came down (or the nearest one), remembering where you were; and
  // from the plain, back down to exactly that place
  function teleport(x, y, z, yaw, pitch) { Object.assign(st.p, { x, y, z, vy: 0, yaw, pitch }); st.safe = { x, y, z }; st.wasUp = y >= world.SURF + 0.5; }
  function surfaceToggle() {
    if (!st || !st.ready) return;
    const p = st.p, onPlain = p.y >= world.SURF + 0.5;
    if (onPlain) {
      if (!st.back) { toast('Nowhere to go back to: go down through a doorway, then T brings you up and back.'); return; }
      const b = st.back; st.back = null; teleport(b.x, b.y, b.z, b.yaw, b.pitch); toast('Back where you were.'); return;
    }
    let pk = st.entered;
    if (!pk) { // the nearest portal over where you are
      const ci = Math.floor(Math.floor(p.x) / CW), ck = Math.floor(Math.floor(p.z) / CW);
      for (let r = 0; r <= 40 && !pk; r++) for (let i = ci - r; i <= ci + r && !pk; i++) for (let k = ck - r; k <= ck + r && !pk; k++) if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) === r && world.portalAt(i, k)) pk = [i, k];
      if (!pk) { toast('No doorway to the surface was found near here.'); return; }
    }
    st.back = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
    const f = world.frameIn(pk[0], world.PJ, pk[1]), x = (f.x0 + f.x1) / 2, z = f.zP + 4;
    teleport(x, world.terrainH(x, z), z, 0, 0);
    toast(st.entered ? 'Up at the doorway you came down. T takes you back.' : 'Up at the nearest doorway. T takes you back.');
  }

  function respawn() { const s = startPoint(); Object.assign(st.p, { x: s.x, y: s.y, z: s.z, vy: 0, yaw: s.yaw, pitch: 0 }); st.safe = { x: s.x, y: s.y, z: s.z }; toast('Back at the start.'); }

  // ---------- start ----------
  const seedFromHash = () => { const m = /seed=(-?\d+)/.exec(location.hash); return m ? +m[1] : null; };
  const biomeFromHash = () => { const m = /biome=(\w+)/.exec(location.hash); return m && W.BIOMES.includes(m[1]) ? m[1] : null; };
  const hashFor = (s, b) => '#seed=' + s + (b ? '&biome=' + b : '');
  let biome = null;
  function start(seed) {
    if (st) { st.cells.forEach(dropCell); } job = null;
    world = W.createWorld(seed, { biome });
    el.querySelectorAll('.mg-biomes button').forEach(b => b.classList.toggle('on', (b.dataset.b || null) === biome));
    PAL = W.PALETTES.map(palFlat);
    const s = startPoint();
    const body = MegaBody.createBody(world, s.x, s.y, s.z, s.yaw);
    st = { body, p: body.p, keys: {}, stick: { on: false, x: 0, y: 0, mag: 0 }, cells: new Map(), ready: false, t: 0, last: 0, acc: 0, grounded: false, groundT: 0, jumpAt: 0, jumps: 0, safe: { x: s.x, y: s.y, z: s.z }, safeT: 0, frames: 0, hudT: 0, drawn: 0, entered: null, back: null, wasUp: false, stats: { frame: 16, chunk: 0, draw: 0, built: 0, chunkMax: 0, at: 0, guideMs: 0, guideFrames: 0 } };
    q('.mg-load').hidden = false; q('.mg-load').textContent = 'Building the first rooms…';
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function init(rootEl) {
    el = rootEl; cv = q('canvas');
    if (!initGL()) { q('.mg-load').textContent = 'This needs WebGL, which this browser does not have.'; return; }
    setup();
    let seed = seedFromHash(); biome = biomeFromHash(); if (seed === null) { seed = Math.floor(Math.random() * 1e6); history.replaceState(null, '', hashFor(seed, biome)); }
    start(seed);
    root.Mega = { state: () => st, world: () => world, start, respawn, guide, line: () => line, CW, CH };
  }
  root.MegaGame = { init };
})(window);
