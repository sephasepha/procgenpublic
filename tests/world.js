// Infinite world tests: node tests/world.js   (QUICK=1 for a smaller window)
// Generates every sector within a diamond around the start and checks the global guarantees
// from local generation alone: seams line up, everything connects back to the start, tiers never skip,
// branch caps hold, the Keep is entered only through Checkpoints, and order of generation is irrelevant.
const W = require('../gen/world.js');
const C = require('../gen/core.js');
const quick = !!process.env.QUICK;
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const t0 = Date.now();
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

for (const preset of ['arsenal', 'generic']) {
  const S = { ...W.WORLD_DEFAULTS, preset, seed: preset === 'arsenal' ? 7 : 3 };
  const R = quick ? 2 : preset === 'arsenal' ? 5 : 3;
  console.log(`${preset}: sectors within ${R} of the start`);
  const sec = new Map(), key = (x, y) => x + ',' + y;
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (Math.abs(x) + Math.abs(y) > R) continue;
    const s = W.genSector(S, x, y);
    sec.set(key(x, y), s);
    check(s.ok, `${preset} sector ${x},${y} failed to generate: ${s.error}`);
  }
  let worksDoctrine = 0, worksSectors = 0;
  sec.forEach(s => {
    if (!s.ok) return;
    const { sx, sy, info } = s;
    // contracts match on both sides, and each doorway meets its partner edge to edge
    for (let d = 0; d < 4; d++) {
      const n = sec.get(key(sx + DX[d], sy + DY[d])); if (!n || !n.ok) continue;
      const mine = s.portals.filter(p => p.dir === d), theirs = n.portals.filter(p => p.dir === ((d + 2) & 3));
      check(mine.map(p => p.pos).sort().join() === theirs.map(p => p.pos).sort().join(), `${preset} ${sx},${sy} dir ${d}: doorways differ between the two sides`);
      mine.forEach(a => {
        const b = theirs.find(q => q.pos === a.pos); if (!b) return;
        const ai = s.doors[s.portals.indexOf(a)], bi = n.doors[n.portals.indexOf(b)];
        const ax = s.ox * 3 + ai % C.SW, ay = s.oy * 3 + ((ai / C.SW) | 0);
        const bx = n.ox * 3 + bi % C.SW, by = n.oy * 3 + ((bi / C.SW) | 0);
        check(Math.abs(ax - bx) + Math.abs(ay - by) === 1, `${preset} ${sx},${sy} dir ${d}: doorways do not touch (${ax},${ay} vs ${bx},${by})`);
        check(s.pass[ai] === 1 && n.pass[bi] === 1, `${preset} ${sx},${sy} dir ${d}: doorway not walkable`);
        check(Math.abs(info.tierIndex - n.info.tierIndex) <= 1, `${preset} ${sx},${sy} dir ${d}: link skips a tier`);
        if (a.kind === 'loop') check(info.tierIndex === n.info.tierIndex, `${preset} ${sx},${sy}: loop link between tiers`);
        if (a.cross) check(mine.length === 1, `${preset} ${sx},${sy}: a border between tiers has ${mine.length} doorways`);
      });
    }
    // floor only where this sector owns the cell
    let stray = 0; for (let i = 0; i < s.pass.length; i++) if (s.pass[i] && !s.own[(((i / C.SW) | 0) / 3 | 0) * C.COLS + ((i % C.SW) / 3 | 0)]) stray++;
    check(stray === 0, `${preset} ${sx},${sy}: ${stray} floor sub-cells outside the cells it owns`);
    // tree: every sector except the start has a doorway to its parent
    if (sx || sy) {
      const p = info.parent, pd = p && s.portals.find(q => q.to[0] === p[0] && q.to[1] === p[1]);
      check(!!pd && pd.kind === 'parent', `${preset} ${sx},${sy}: no doorway to parent`);
    }
    // cross-tier children at most 2
    const kids = s.portals.filter(p => p.kind === 'child' && p.cross).length;
    check(kids <= 2, `${preset} ${sx},${sy}: ${kids} cross-tier children`);
    // the Keep is entered only through Checkpoints, and left only through Vaults
    if (preset === 'arsenal') {
      s.portals.forEach((p, k) => {
        const hub = s.hubs.find(h => h.portal && h.i === hubIndexOf(p));
        if (info.type === 2 && p.cross && p.kind === 'parent') check(hub && hub.fn === 'CP', `${preset} ${sx},${sy}: Keep entrance is not a Checkpoint`);
        if (info.type === 2 && p.cross && p.kind !== 'parent') check(hub && hub.fn === 'VA', `${preset} ${sx},${sy}: Keep exit is not a Vault`);
      });
      if (info.type === 1 && s.doctrine) { worksSectors++; if (s.doctrine.power && s.doctrine.cooling && s.doctrine.blast) worksDoctrine++; }
    }
  });
  // every global cell belongs to exactly one sector, and floors meet across a border only at doorways
  {
    const g = new Map(); // global sub-cell -> sector key, for walkable sub-cells
    let overlap = 0;
    sec.forEach((s, k) => { if (!s.ok) return; for (let i = 0; i < s.pass.length; i++) if (s.pass[i]) { const gk = (s.ox * 3 + i % C.SW) + ',' + (s.oy * 3 + ((i / C.SW) | 0)); if (g.has(gk)) overlap++; g.set(gk, k); } });
    check(overlap === 0, `${preset}: ${overlap} sub-cells claimed by two sectors`);
    const doorSet = new Set(); sec.forEach(s => { if (s.ok) s.doors.forEach(i => doorSet.add((s.ox * 3 + i % C.SW) + ',' + (s.oy * 3 + ((i / C.SW) | 0)))); });
    let leaks = 0, crossings = 0;
    g.forEach((k, gk) => {
      const [x, y] = gk.split(',').map(Number);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const k2 = g.get(nx + ',' + ny); if (!k2 || k2 === k) continue;
        crossings++; if (!(doorSet.has(gk) && doorSet.has(nx + ',' + ny))) leaks++;
      }
    });
    check(leaks === 0, `${preset}: ${leaks} places where floors of two sectors touch outside a doorway`);
    console.log(`  ${crossings} doorway crossings between sectors`);
  }
  // global connectivity across the window via open doorways (parent chains stay inside the diamond)
  const seen = new Set([key(0, 0)]), q = [[0, 0]];
  while (q.length) {
    const [x, y] = q.shift(), s = sec.get(key(x, y));
    s.portals.forEach(p => { const k = key(p.to[0], p.to[1]); if (sec.has(k) && !seen.has(k)) { seen.add(k); q.push(p.to); } });
  }
  check(seen.size === sec.size, `${preset}: only ${seen.size}/${sec.size} sectors reachable from the start`);
  if (preset === 'arsenal') console.log(`  Works doctrine fully satisfied in ${worksDoctrine}/${worksSectors} Works sectors`);

  // order independence: regenerate sectors in a scrambled order, interleaved with another preset
  const sig = s => { let h = 0; for (let i = 0; i < s.pass.length; i++) h = (h * 31 + s.pass[i] * 7 + s.col[i]) | 0; return h; };
  const keys = [...sec.keys()].sort(() => Math.random() - 0.5).slice(0, quick ? 3 : 6);
  keys.forEach(k => {
    W.genSector({ ...S, preset: preset === 'arsenal' ? 'generic' : 'arsenal' }, 9, 9); // disturb shared state
    const [x, y] = k.split(',').map(Number), again = W.genSector(S, x, y);
    check(sig(again) === sig(sec.get(k)), `${preset} ${k}: different result when generated in another order`);
  });
}
function hubIndexOf(p) {
  const d = p.dir, cx = d === 0 || d === 2 ? p.pos : d === 1 ? C.COLS - 2 : 1, cy = d === 1 || d === 3 ? p.pos : d === 0 ? 1 : C.ROWS - 2;
  return (cy * 3 + 1) * C.SW + cx * 3 + 1;
}
console.log(`\n${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
