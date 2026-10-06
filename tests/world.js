// Infinite world tests: node tests/world.js   (QUICK=1 for a smaller window)
// Generates every sector within a diamond around the start and checks the global guarantees
// from local generation alone: seams line up, everything connects back to the start, tiers never skip,
// branch caps hold, the Keep is entered only through Checkpoints, and order of generation is irrelevant.
const W = require('../gen/world.js');
const C = require('../gen/core.js');
const DR = require('../gen/dressing.js');
const quick = !!process.env.QUICK;
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const t0 = Date.now();
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

for (const preset of ['underdark', 'arsenal', 'generic']) {
  // small bands so the window reaches the Keep (Arsenal) and the pits into the next level (Underdark)
  const S = { ...W.WORLD_DEFAULTS, preset, seed: preset === 'arsenal' ? 7 : preset === 'underdark' ? 5 : 3, band: preset === 'underdark' ? 1 : 3 };
  const R = quick ? 2 : preset === 'generic' ? 3 : preset === 'arsenal' ? 7 : 5;
  console.log(`${preset}: sectors within ${R} of the start`);
  const sec = new Map(), key = (x, y) => x + ',' + y, times = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (Math.abs(x) + Math.abs(y) > R) continue;
    const s = W.genSector(S, x, y);
    sec.set(key(x, y), s);
    check(s.ok, `${preset} sector ${x},${y} failed to generate: ${s.error}`);
    // real-time budget: a sector must stream in well under the time it takes to walk across one
    check(s.ms < 3000, `${preset} sector ${x},${y} took ${s.ms} ms to generate (budget 3000)`);
    times.push(s.ms);
  }
  let worksDoctrine = 0, worksSectors = 0, landmarks = 0, shown = 0;
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
    if (S.band >= 3) check(kids <= 2, `${preset} ${sx},${sy}: ${kids} cross-tier children`); // the cap needs tiers at least 3 sectors deep
    // underdark: pits only where the strata begin again (a new level), seals between the other strata,
    // and every landmark shows its stratum's centrepiece in the dressing
    if (preset === 'underdark') {
      s.portals.forEach(p => {
        if (!p.cross) return;
        const lvl = Math.max(info.tierIndex, p.toTier) % 3 === 0, hub = s.hubs.find(h => h.portal && h.i === hubIndexOf(p));
        check(hub && hub.fn === (lvl ? 'PT' : 'SE'), `${preset} ${sx},${sy}: border between strata labelled ${hub && hub.fn}, expected ${lvl ? 'PT' : 'SE'}`);
      });
      s.hubs.filter(h => h.fn && h.fn !== 'SE').forEach(h => {
        landmarks++;
        const hx = h.i % C.SW, hy = (h.i / C.SW) | 0;
        for (let y = hy - 7; y <= hy + 7; y++) for (let x = hx - 7; x <= hx + 7; x++) {
          const t = s.deco && s.deco[y * C.SW + x], v = t && DR.DRESS_TILES[t];
          if (v && v.letter === '1') { shown++; return; }
        }
      });
    }
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
  times.sort((p, q) => p - q);
  console.log(`  sector generation: median ${times[times.length >> 1]} ms, p95 ${times[Math.floor(times.length * 0.95)]} ms, max ${times[times.length - 1]} ms`);
  // global connectivity across the window via open doorways (parent chains stay inside the diamond)
  const seen = new Set([key(0, 0)]), q = [[0, 0]];
  while (q.length) {
    const [x, y] = q.shift(), s = sec.get(key(x, y));
    s.portals.forEach(p => { const k = key(p.to[0], p.to[1]); if (sec.has(k) && !seen.has(k)) { seen.add(k); q.push(p.to); } });
  }
  check(seen.size === sec.size, `${preset}: only ${seen.size}/${sec.size} sectors reachable from the start`);
  if (preset === 'underdark') { console.log(`  ${shown}/${landmarks} landmarks show their centrepiece`); check(shown >= landmarks * 0.9, `underdark: only ${shown}/${landmarks} landmarks show their centrepiece`); }
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
  const cx = Math.max(1, Math.min(C.COLS - 2, p.hub[0])), cy = Math.max(1, Math.min(C.ROWS - 2, p.hub[1]));
  return (cy * 3 + 1) * C.SW + cx * 3 + 1;
}
console.log(`\n${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
