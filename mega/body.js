// The walker's body for the megastructure: a box that moves over voxels, falls, jumps, and walks up steps of one voxel.
// It knows nothing about the screen, so the tests can drive it too.
(function (root) {
  const HALF = 0.3, TALL = 1.7, WALK = 4.4, RUN = 18, GRAV = 27, JUMP = 8.6;

  function createBody(world, x, y, z, yaw) {
    return { world, p: { x, y, z, vy: 0, yaw: yaw || 0, pitch: 0 }, t: 0, grounded: false, groundT: -9, jumpAt: 0, jumps: 0 };
  }
  function hits(b, x, y, z) {
    const W = b.world, x0 = Math.floor(x - HALF), x1 = Math.floor(x + HALF - 1e-6), z0 = Math.floor(z - HALF), z1 = Math.floor(z + HALF - 1e-6), y0 = Math.floor(y + 1e-6), y1 = Math.floor(y + TALL - 1e-6);
    for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (W.voxel(xx, yy, zz)) return true;
    return false;
  }
  function slide(b, dx, dz) {
    const p = b.p, nx = p.x + dx, nz = p.z + dz;
    if (!hits(b, nx, p.y, nz)) { p.x = nx; p.z = nz; return; }
    if (b.grounded || b.t - b.groundT < 0.1) { // a step of one voxel is walked up
      const top = Math.floor(p.y + 1e-6) + 1;
      if (!hits(b, nx, top, nz)) { p.x = nx; p.z = nz; p.y = top; }
    }
  }
  // fw, sd: -1..1 forward and sideways; speed scales with the stick when it is analogue
  function step(b, dt, fw, sd, run, scale) {
    const p = b.p, ox = p.x, oy = p.y, oz = p.z; b.t += dt;
    const len = Math.hypot(fw, sd);
    if (len > 0.001) {
      const sp = (run ? RUN : WALK) * dt * (scale === undefined ? 1 : scale) / Math.max(1, len);
      slide(b, (Math.sin(p.yaw) * fw + Math.cos(p.yaw) * sd) * sp, 0);
      slide(b, 0, (-Math.cos(p.yaw) * fw + Math.sin(p.yaw) * sd) * sp);
    }
    // a jump press is remembered briefly, and you can still jump just after leaving an edge
    if (b.jumpAt && b.t - b.jumpAt < 0.14 && (b.grounded || b.t - b.groundT < 0.1)) { p.vy = JUMP; b.grounded = false; b.groundT = -9; b.jumpAt = 0; b.jumps++; }
    p.vy = Math.max(-45, p.vy - GRAV * dt);
    const ny = p.y + p.vy * dt;
    if (!hits(b, p.x, ny, p.z)) { p.y = ny; b.grounded = false; }
    else if (p.vy < 0) { p.y = Math.floor(ny) + 1; for (let g = 0; g < 3 && hits(b, p.x, p.y, p.z); g++) p.y += 1; p.vy = 0; b.grounded = true; b.groundT = b.t; } // landed on the top of the voxel below
    else { p.y = Math.floor(ny + TALL) - TALL - 1e-3; p.vy = 0; } // bumped the head
    if (p.vy <= 0 && hits(b, p.x, p.y - 0.03, p.z)) { b.grounded = true; b.groundT = b.t; }
    // the open plain above the structure is a smooth heightfield, not voxels: stand on it, and walk up its slopes
    // portals: crossing a doorway's plane moves you to its twin (the world says by how much)
    if (b.world.portalCross) { const c = b.world.portalCross(ox, oy, oz, p.x, p.y, p.z); if (c) { p.x += c.d[0]; p.y += c.d[1]; p.z += c.d[2]; b.portalled = (b.portalled || 0) + 1; b.lastCross = c; } }
    const G = b.world.groundAt;
    if (G) { const g = G(p.x, p.z);
      if (g !== null && p.y < g && p.y > g - 1.5) { p.y = g; if (p.vy < 0) p.vy = 0; b.grounded = true; b.groundT = b.t; }
      else if (g !== null && p.vy <= 0 && p.y - g < 0.04 && p.y >= g) { b.grounded = true; b.groundT = b.t; } }
  }
  const api = { createBody, step, hits, EYE: 1.55, HALF, TALL, WALK, RUN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MegaBody = api;
})(typeof window !== 'undefined' ? window : globalThis);
