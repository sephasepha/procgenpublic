// Gatherable props scattered over the plain: flint, bones, rusted scrap, pale fungus and the rare relic shard.
// A pure function of (world, surface cell): the same cell always holds the same props, each with a stable id, so what
// has been gathered can be remembered as a set of ids. Density follows a slow noise, so props come in patches with bare
// ground between; nothing sits in a portal's doorway or where the structure's stone breaks the surface.
// meshOf builds their geometry for the plain's shader (x, y, z, r, g, b per vertex), relative to a cell's origin.
(function (root) {
  const fdiv = (a, b) => Math.floor(a / b);
  function hash(a, b, c, d) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647) ^ Math.imul(d | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  // smooth value noise on a coarse lattice, for patches
  function patch(seed, x, z) {
    const s = 40, gx = x / s, gz = z / s, x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz), h = (a, b) => hash(seed, a, b, 77);
    return (h(x0, z0) * (1 - u) + h(x0 + 1, z0) * u) * (1 - v) + (h(x0, z0 + 1) * (1 - u) + h(x0 + 1, z0 + 1) * u) * v;
  }

  // kinds: name, how common, and colours (the relic glows)
  const KINDS = {
    flint: { name: 'flint', plural: 'flint', weight: 34, col: [0.27, 0.27, 0.29] },
    bone: { name: 'bone', plural: 'bones', weight: 20, col: [0.80, 0.77, 0.68] },
    scrap: { name: 'scrap', plural: 'scrap', weight: 22, col: [0.46, 0.26, 0.15] },
    fungus: { name: 'pale fungus', plural: 'pale fungus', weight: 21, col: [0.86, 0.84, 0.77], cap: [0.60, 0.48, 0.44] },
    relic: { name: 'relic shard', plural: 'relic shards', weight: 3, col: [0.78, 0.96, 1.0], glow: true }
  };
  const ORDER = Object.keys(KINDS), TOTAL = ORDER.reduce((a, k) => a + KINDS[k].weight, 0);
  const pickKind = r => { let t = r * TOTAL; for (const k of ORDER) { t -= KINDS[k].weight; if (t <= 0) return k; } return ORDER[0]; };

  // the props of the surface cell (i, k): [{ id, kind, x, y, z, yaw, s }] in world coordinates (y is the ground)
  function propsIn(world, i, k) {
    const { CW, SURF, PJ } = world, seed = world.seed | 0, ox = i * CW, oz = k * CW, out = [];
    const portal = world.portalAt(i, k) ? world.frameIn(i, PJ, k) : null;
    const tries = 14;
    for (let n = 0; n < tries; n++) {
      const x = ox + 0.6 + hash(seed, i, k, n * 4 + 1) * (CW - 1.2), z = oz + 0.6 + hash(seed, i, k, n * 4 + 2) * (CW - 1.2);
      // patches: dense in some places, almost nothing in others
      const p = patch(seed, x, z), keep = Math.max(0, (p - 0.32) / 0.68) ** 1.6;
      if (hash(seed, i, k, n * 4 + 3) > keep * 0.8) continue;
      if (portal && x > portal.x0 - 4 && x < portal.x1 + 4 && z > oz - 1 && z < portal.zP + 6) continue; // the doorway and its approaches
      const g = world.groundAt(x, z); if (g === null) continue;
      if (world.voxel(Math.floor(x), SURF + 1, Math.floor(z))) continue; // stone breaking the surface
      const r = hash(seed, i, k, n * 4 + 4);
      out.push({ id: `${i},${k},${n}`, kind: pickKind(r), x, y: world.terrainH(x, z), z, yaw: hash(seed, i, k, n + 900) * Math.PI * 2, s: 0.8 + 0.5 * hash(seed, i, k, n + 950) });
    }
    return out;
  }

  // ---- geometry: little boxes, turned about Y and sometimes tipped, with the light baked into the colours ----
  function meshOf(props, ox, oy, oz) {
    const P = [], X = [];
    const L = [0.35, 0.85, 0.4], ll = Math.hypot(...L);
    // a box centred at (cx, cy, cz) in the prop's frame, half sizes (hx, hy, hz), tipped by tilt about its x axis
    function box(pr, cx, cy, cz, hx, hy, hz, col, tilt, glow) {
      const c = Math.cos(pr.yaw), s = Math.sin(pr.yaw), ct = Math.cos(tilt || 0), stt = Math.sin(tilt || 0), S = pr.s;
      const tr = (x, y, z) => { // tip about x, then turn about y, then scale and place
        const y1 = y * ct - z * stt, z1 = y * stt + z * ct, x2 = (x * c + z1 * s) * S, z2 = (-x * s + z1 * c) * S;
        return [pr.x + x2 - ox, pr.y + y1 * S - oy, pr.z + z2 - oz];
      };
      const F = [[[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
        [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
        [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]];
      for (const f of F) {
        const v = f.map(([a, b, d]) => tr(cx + a * hx, cy + b * hy, cz + d * hz));
        const e1 = v[1].map((q, n) => q - v[0][n]), e2 = v[2].map((q, n) => q - v[0][n]);
        const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...nrm) || 1;
        const lit = glow ? 1.25 : 0.42 + 0.58 * Math.max(0, (nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]) / nl / ll);
        const base = P.length / 6;
        for (const p of v) P.push(p[0], p[1], p[2], col[0] * lit, col[1] * lit, col[2] * lit);
        X.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    for (const pr of props) {
      const K = KINDS[pr.kind];
      if (pr.kind === 'flint') { box(pr, 0, 0.09, 0, 0.16, 0.1, 0.12, K.col, 0.2); box(pr, 0.22, 0.06, 0.1, 0.1, 0.07, 0.09, K.col.map(v => v * 1.15), -0.3); box(pr, -0.15, 0.05, 0.16, 0.08, 0.05, 0.07, K.col.map(v => v * 0.9), 0.4); }
      else if (pr.kind === 'bone') { box(pr, 0, 0.05, 0, 0.32, 0.04, 0.045, K.col, 0.05); box(pr, 0.33, 0.06, 0, 0.06, 0.06, 0.08, K.col); box(pr, -0.33, 0.06, 0, 0.06, 0.06, 0.08, K.col); box(pr, 0.12, 0.04, 0.22, 0.16, 0.03, 0.035, K.col.map(v => v * 0.92), 0.1); }
      else if (pr.kind === 'scrap') { box(pr, 0, 0.12, 0, 0.3, 0.015, 0.22, K.col, 0.55); box(pr, 0.12, 0.05, -0.15, 0.04, 0.05, 0.16, K.col.map(v => v * 0.8)); }
      else if (pr.kind === 'fungus') { for (const [dx, dz, h] of [[0, 0, 0.26], [0.12, 0.07, 0.17], [-0.09, 0.1, 0.13], [0.04, -0.12, 0.1]]) { box(pr, dx, h / 2, dz, 0.025, h / 2, 0.025, K.col); box(pr, dx, h, dz, 0.08 * (0.6 + h * 2), 0.03, 0.08 * (0.6 + h * 2), K.cap); } }
      else if (pr.kind === 'relic') { box(pr, 0, 0.32, 0, 0.06, 0.3, 0.06, K.col, 0.12, true); box(pr, 0, 0.03, 0, 0.13, 0.03, 0.13, [0.2, 0.22, 0.24]); }
    }
    return { P: new Float32Array(P), X: new Uint16Array(X) };
  }

  // the nearest prop within reach of feet at (x, y, z), among those not yet gathered
  function nearest(world, x, y, z, gathered, reach) {
    const { CW } = world, ci = fdiv(Math.floor(x), CW), ck = fdiv(Math.floor(z), CW); let best = null;
    for (let i = ci - 1; i <= ci + 1; i++) for (let k = ck - 1; k <= ck + 1; k++) for (const p of propsIn(world, i, k)) {
      if (gathered.has(p.id) || Math.abs(p.y - y) > 2.2) continue;
      const d = Math.hypot(p.x - x, p.z - z); if (d <= (reach || 2.2) && (!best || d < best.d)) best = { p, d };
    }
    return best && best.p;
  }

  const api = { propsIn, meshOf, nearest, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaProps = api;
})(typeof window !== 'undefined' ? window : globalThis);
