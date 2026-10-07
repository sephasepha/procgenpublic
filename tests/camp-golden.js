// Golden run: node tests/camp-golden.js            (compare with tests/camp-golden.json)
//             node tests/camp-golden.js --record   (write it; only when behaviour is meant to change)
// A scripted camp session that touches every part of the simulation: laying, striking, crowding, blowing,
// logs, coals, pots with one and two waters, a pan, a skewer, stews, eating, foraging, collecting ash and char.
// Its state is sampled every few seconds and compared exactly, so a refactor can prove it changed nothing.
const fs = require('fs'), path = require('path');
const S = require('../camp/sim.js');
const FILE = path.join(__dirname, 'camp-golden.json');

function session() {
  const c = S.createCamp(7); c.unlimitedFire = true;
  const out = [], r6 = x => Math.round(x * 1e5) / 1e5;
  const snap = t => out.push({
    t,
    fire: S.fireState(c),
    pieces: c.pieces.map(p => [p.id, p.kind, r6(p.x), r6(p.z), r6(p.T), r6(p.m), r6(p.air || 0), r6(p.vigour || 0), r6(p.ember || 0), !!p.burning, !!p.ash, !!p.out, !!p.coal, !!p.spent]),
    vessels: c.vessels.map(v => [v.id, v.type, r6(v.T), r6(v.water || 0), r6(v.scorch || 0), r6(v.stew || 0), !!v.stewed, v.items.map(it => [it.id, r6(it.progress), r6(it.scorch)]), S.judge(v)]),
    stats: Object.fromEntries(Object.entries(c.stats).map(([k, v]) => [k, r6(v)])),
    stock: { ash: c.stock.ash, char: c.stock.char, lanternEye: c.stock.lanternEye },
    previews: [S.preview(c, 'kindling', 0.06, 2), S.preview(c, 'fuel', 0, 2), S.preview(c, 'fuel', 0.3, 2)],
    heat: r6(S.heatAt(c, 0.12, 2)),
  });
  const ev = {
    0: () => { S.placePiece(c, 'tinder', 0, 2); [[-0.03, 1.99], [0.03, 2.0], [0, 2.03], [0.012, 1.985]].forEach(([x, z]) => S.placePiece(c, 'kindling', x, z)); S.strike(c, 0, 2); },
    40: () => S.blow(c), 48: () => S.blow(c),
    150: () => S.placePiece(c, 'fuel', 0.05, 2.02), 300: () => S.placePiece(c, 'fuel', -0.05, 2.0),
    320: () => { const v = S.placeVessel(c, 'pot', 0.12, 2); ['blackWater', 'lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); },
    340: () => { const v = S.placeVessel(c, 'pan', -0.1, 1.95); ['starGristle', 'moonlard'].forEach(i => S.addToVessel(c, v.id, i)); },
    360: () => { const v = S.placeVessel(c, 'skewer', 0.02, 1.9); S.addToVessel(c, v.id, 'eelSlice'); },
    500: () => S.movePiece(c, c.pieces[c.pieces.length - 1].id, -0.07, 2.04),
    700: () => { const pan = c.vessels.find(v => v.type === 'pan'); S.moveVessel(c, pan.id, -0.25, 1.9); },
    900: () => S.placePiece(c, 'fuel', 0, 1.96), 920: () => S.blow(c),
    1200: () => { const sk = c.vessels.find(v => v.type === 'skewer'); S.eat(c, sk.id); },
    1500: () => { const pan = c.vessels.find(v => v.type === 'pan'); S.eat(c, pan.id); },
    1600: () => { const v = c.vessels.find(v => v.type === 'pan'); S.removeVessel(c, v.id); S.forage(c); },
    1700: () => { const pot = c.vessels.find(v => v.type === 'pot'); S.eat(c, pot.id); ['blackWater', 'blackWater', 'choirEgg', 'hymnGrub'].forEach(i => S.addToVessel(c, pot.id, i)); },
    3600: () => { const pot = c.vessels.find(v => v.type === 'pot'); S.eat(c, pot.id); },
    9000: () => c.pieces.slice().forEach(p => S.collect(c, p.id)),
    15000: () => c.pieces.slice().forEach(p => S.collect(c, p.id)),
  };
  for (let t = 0; t <= 16000; t++) {
    if (ev[t]) ev[t]();
    if (t % 100 === 0) snap(t);
    S.step(c, 0.1);
  }
  snap('end');
  return out;
}

const got = session();
if (process.argv.includes('--record')) { fs.writeFileSync(FILE, JSON.stringify(got)); console.log(`recorded ${got.length} samples`); process.exit(0); }
const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let bad = null;
for (let i = 0; i < Math.max(want.length, got.length) && !bad; i++) {
  const a = JSON.stringify(want[i]), b = JSON.stringify(JSON.parse(JSON.stringify(got[i])));
  if (a !== b) { let k = 0; while (k < a.length && a[k] === b[k]) k++; bad = { i, t: want[i] && want[i].t, want: a && a.slice(Math.max(0, k - 120), k + 120), got: b && b.slice(Math.max(0, k - 120), k + 120) }; }
}
if (bad) { console.log(`Golden run differs at sample ${bad.i} (t=${bad.t})\n  want ${bad.want}\n  got  ${bad.got}`); process.exit(1); }
console.log(`Golden run: ${got.length} samples identical`);
