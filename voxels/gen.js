// Voxel prototype generator: tall hollow pillar towers on a ground plate, joined by bridges.
// Pure and seeded, so the page and the tests see exactly the same chunk for the same settings.
//
// Grid is W (x) × H (y, up) × D (z). Index = x + z*W + y*W*D.
// Bridges follow a minimum spanning tree over the tower centres (so every tower is reachable),
// plus a few extra loop bridges. Each bridge sits on a shared floor level and cuts a doorway
// through every tower wall it meets.
(function (root) {
  const EMPTY = 0, GROUND = 1, WALL = 2, FLOOR = 3, DECK = 4, RAIL = 5, ROOF = 6;
  const NAMES = ['empty', 'ground', 'wall', 'floor', 'deck', 'rail', 'roof'];
  const STOREY = 6; // floor slab every 6 voxels; bridges only land on these levels

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function generate(opts) {
    const o = Object.assign({ seed: 1, towers: 6, minH: 18, maxH: 42, loops: 25, W: 64, D: 64, H: 48 }, opts || {});
    const { W, D, H } = o;
    const rng = mulberry32(o.seed * 2654435761 + 7);
    const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const vox = new Uint8Array(W * H * D);
    const owner = new Int16Array(W * H * D).fill(-1); // which tower / bridge a voxel belongs to (debug colouring)
    const idx = (x, y, z) => x + z * W + y * W * D;
    const inb = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D;
    const set = (x, y, z, t, who) => { if (inb(x, y, z)) { const i = idx(x, y, z); vox[i] = t; owner[i] = who; } };
    const get = (x, y, z) => inb(x, y, z) ? vox[idx(x, y, z)] : EMPTY;

    // Ground plate
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) set(x, 0, z, GROUND, -1);

    // Place towers: random square footprints, kept apart so bridges have room to span
    const towers = [];
    const maxH = Math.min(o.maxH, H - 2), minH = Math.min(o.minH, maxH);
    for (let tries = 0; towers.length < o.towers && tries < 600; tries++) {
      const w = ri(5, 8), h = ri(minH, maxH);
      const x0 = ri(2, W - w - 2), z0 = ri(2, D - w - 2);
      const clash = towers.some(t => x0 < t.x0 + t.w + 6 && t.x0 < x0 + w + 6 && z0 < t.z0 + t.w + 6 && t.z0 < z0 + w + 6);
      if (clash) continue;
      towers.push({ id: towers.length, x0, z0, w, h, cx: x0 + (w - 1) / 2, cz: z0 + (w - 1) / 2 });
    }
    const inside = (t, x, z) => x >= t.x0 && x < t.x0 + t.w && z >= t.z0 && z < t.z0 + t.w;
    const towerAt = (x, z) => towers.find(t => inside(t, x, z));

    for (const t of towers) {
      for (let y = 1; y <= t.h; y++) for (let z = t.z0; z < t.z0 + t.w; z++) for (let x = t.x0; x < t.x0 + t.w; x++) {
        const edge = x === t.x0 || z === t.z0 || x === t.x0 + t.w - 1 || z === t.z0 + t.w - 1;
        if (y === t.h) set(x, y, z, ROOF, t.id);
        else if (edge) {
          // window slits mid-storey, on alternate columns away from the corners
          const along = (x === t.x0 || x === t.x0 + t.w - 1) ? z - t.z0 : x - t.x0;
          const win = y % STOREY === 3 && along > 1 && along < t.w - 2 && along % 2 === 0;
          if (!win) set(x, y, z, WALL, t.id);
        } else if (y % STOREY === 0) set(x, y, z, FLOOR, t.id);
      }
    }

    // Bridge graph: Prim's MST over tower centres, then extra loop edges by chance
    const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
    const edges = [];
    if (towers.length > 1) {
      const inTree = new Set([0]);
      while (inTree.size < towers.length) {
        let best = null;
        for (const a of inTree) for (const b of towers) if (!inTree.has(b.id)) {
          const d = dist(towers[a], b);
          if (!best || d < best.d) best = { a, b: b.id, d };
        }
        inTree.add(best.b); edges.push({ a: best.a, b: best.b, tree: true });
      }
      for (let a = 0; a < towers.length; a++) for (let b = a + 1; b < towers.length; b++) {
        if (edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
        if (dist(towers[a], towers[b]) < 34 && rng() * 100 < o.loops) edges.push({ a, b, tree: false });
      }
    }

    const bridges = [];
    for (const e of edges) {
      const A = towers[e.a], B = towers[e.b];
      const top = Math.min(A.h, B.h) - 4; // room for a 3-high doorway under the roof
      const levels = [];
      for (let y = STOREY; y <= top; y += STOREY) levels.push(y);
      if (!levels.length) continue;
      const y = levels[ri(0, levels.length - 1)];
      const id = bridges.length;
      // Walk the centre line in XZ; the deck is 3 wide across the dominant direction
      const dx = B.cx - A.cx, dz = B.cz - A.cz, steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)));
      const xMajor = Math.abs(dx) >= Math.abs(dz);
      const cells = new Set();
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(A.cx + dx * s / steps), pz = Math.round(A.cz + dz * s / steps);
        for (let k = -1; k <= 1; k++) {
          const x = xMajor ? px : px + k, z = xMajor ? pz + k : pz;
          cells.add(x + ',' + z + ',' + k);
        }
      }
      let span = 0;
      for (const c of cells) {
        const [x, z, k] = c.split(',').map(Number);
        const t = towerAt(x, z);
        if (t && y < t.h) {
          // inside a tower footprint: open a doorway through the wall, keep the floor
          if (get(x, y, z) === EMPTY || get(x, y, z) === WALL) set(x, y, z, FLOOR, t.id);
          for (let dy = 1; dy <= 3; dy++) if (get(x, y + dy, z) === WALL) set(x, y + dy, z, EMPTY, -1);
          continue;
        }
        if (get(x, y, z) !== FLOOR) { set(x, y, z, DECK, id); span++; }
        if (k !== 0 && get(x, y + 1, z) === EMPTY) set(x, y + 1, z, RAIL, id);
      }
      // a rail can land in the middle of a crossing deck; clear rails that sit on another bridge's walkway
      bridges.push({ id, a: e.a, b: e.b, y, tree: e.tree, span });
    }
    // Clear any rail standing on a deck cell that is part of a walkway centre (crossing bridges)
    for (let y = 1; y < H - 1; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++)
      if (get(x, y, z) === RAIL && get(x, y - 1, z) === DECK) {
        const under = owner[idx(x, y - 1, z)], self = owner[idx(x, y, z)];
        if (under !== self) set(x, y, z, EMPTY, -1);
      }

    let count = 0; for (let i = 0; i < vox.length; i++) if (vox[i]) count++;
    return { W, H, D, vox, owner, towers, bridges, count, idx, STOREY };
  }

  // Which towers can reach which over the bridges (for tests and the stats line)
  function components(chunk) {
    const p = chunk.towers.map((_, i) => i);
    const f = i => p[i] === i ? i : (p[i] = f(p[i]));
    for (const b of chunk.bridges) p[f(b.a)] = f(b.b);
    return new Set(chunk.towers.map((_, i) => f(i))).size;
  }

  const api = { generateVoxels: generate, voxelComponents: components, VOXEL: { EMPTY, GROUND, WALL, FLOOR, DECK, RAIL, ROOF }, VOXEL_NAMES: NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
