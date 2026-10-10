// The spawn room for the first-person view. The maze has no outside to start from (its entrance is a spot in the
// middle of a room), so the player starts in a room of their own: a plain chamber found inside solid rock near the
// entrance, joined to the rest of the maze by one corridor cut through the rock. The corridor touches the maze only at
// its far end, so it opens no shortcuts. `planSpawn` only needs a function saying what is at a cell
// (1 floor, 0 wall, -1 not generated yet), so it runs the same in the browser and in tests.
(function (root) {
  const D4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const ROOM = 7;            // the room's inside, in cells
  const HALF = (ROOM - 1) / 2; // 3: the inside runs centre-3..centre+3
  const RING = HALF + 1;     // the room's own wall, 4 from the centre
  const MARGIN = RING + 1;   // and rock beyond it, 5: all of it must be solid
  const MIN_LEN = 6;         // the shortest corridor, door to maze, in cells
  const MAX_DIST = 64;       // how far from the entrance to look for rock

  function planSpawn(at, ex, ey, opt) {
    const o = { minDist: 10, maxDist: MAX_DIST, ...opt };
    const solid = (cx, cy) => { for (let y = cy - MARGIN; y <= cy + MARGIN; y++) for (let x = cx - MARGIN; x <= cx + MARGIN; x++) if (at(x, y) !== 0) return false; return true; };
    for (let r = o.minDist; r <= o.maxDist; r++) {
      const ring = [];
      for (let k = -r; k <= r; k++) { ring.push([ex + k, ey - r], [ex + k, ey + r]); if (k > -r && k < r) ring.push([ex - r, ey + k], [ex + r, ey + k]); }
      // nearer to straight above/below/beside first, so the result does not lean to one corner
      for (const [cx, cy] of ring) {
        if (!solid(cx, cy)) continue;
        const path = corridor(at, cx, cy);
        if (path) return build(cx, cy, path);
      }
    }
    return { ok: false };
  }

  // shortest cut through solid cells from one of the room's four doors to a cell that borders the maze
  function corridor(at, cx, cy) {
    const inBox = (x, y) => Math.abs(x - cx) <= RING && Math.abs(y - cy) <= RING;
    const key = (x, y) => x + ',' + y, parent = new Map(), depth = new Map(), q = [];
    D4.forEach(([dx, dy], d) => { const x = cx + dx * MARGIN, y = cy + dy * MARGIN; parent.set(key(x, y), null); depth.set(key(x, y), 1); q.push([x, y, d]); });
    for (let h = 0; h < q.length && h < 6000; h++) {
      const [x, y, d0] = q[h], dd = depth.get(key(x, y));
      let floors = 0, unknown = false;
      for (const [dx, dy] of D4) { const p = at(x + dx, y + dy); if (p === 1) floors++; else if (p < 0) unknown = true; }
      if (unknown || floors > 1) continue; // two floors beside it would join two places of the maze
      if (floors) { if (dd + 1 >= MIN_LEN) { const cells = []; let k = key(x, y); while (k) { const [a, b] = k.split(',').map(Number); cells.push([a, b]); k = parent.get(k); } return { cells: cells.reverse(), door: d0 }; } continue; }
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (depth.has(k) || inBox(nx, ny) || at(nx, ny) !== 0) continue;
        depth.set(k, dd + 1); parent.set(k, key(x, y)); q.push([nx, ny, d0]);
      }
    }
    return null;
  }

  function build(cx, cy, path) {
    const [dx, dy] = D4[path.door], cells = new Map();
    for (let y = cy - HALF; y <= cy + HALF; y++) for (let x = cx - HALF; x <= cx + HALF; x++) cells.set(x + ',' + y, 'room');
    cells.set((cx + dx * RING) + ',' + (cy + dy * RING), 'door');
    path.cells.forEach(([x, y]) => cells.set(x + ',' + y, 'corridor'));
    // you start at the far wall from the door, looking at it, so the way out is the first thing you see
    const sx = cx - dx * (HALF - 1), sy = cy - dy * (HALF - 1);
    return { ok: true, cells, room: { cx, cy, x0: cx - HALF, y0: cy - HALF, w: ROOM, h: ROOM }, door: [cx + dx * RING, cy + dy * RING], length: path.cells.length + 1, join: path.cells[path.cells.length - 1], start: { gx: sx, gy: sy, dir: path.door } };
  }

  const api = { planSpawn, SPAWN_ROOM: ROOM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
