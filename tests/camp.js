// Camp tests: node tests/camp.js
// The fire behaves like a fire (laid well it catches and, tended, keeps going; heaped or smothered it dies),
// cooking depends on where the vessel sits, eating does what the food says, and the data is complete.
const S = require('../camp/sim.js');
const D = require('../camp/data.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const t0 = Date.now();

function camp(lay) { const c = S.createCamp(1); Object.keys(c.stock).forEach(k => { c.stock[k] = 20; }); lay(c); return c; }
const bed = c => { S.placePiece(c, 'tinder', 0, 2); [[-0.04, 1.98], [0.04, 2.0], [0, 2.04]].forEach(([x, z]) => S.placePiece(c, 'kindling', x, z)); };
const tend = (c, tt) => { if (tt === 250) S.placePiece(c, 'fuel', 0.03, 2.03); if (tt === 500) S.placePiece(c, 'fuel', -0.04, 2.01); if (tt === 1100) S.placePiece(c, 'fuel', 0, 1.96); if (tt === 1500) S.placePiece(c, 'fuel', 0.05, 1.98); };
function run(c, secs, each) { let burnt = 0; for (let t = 0; t < secs * 10; t++) { if (each) each(c, t); S.step(c, 0.1); if (S.burning(c)) burnt++; } return burnt / 10; }

console.log('Fire');
{ const c = camp(bed); S.strike(c, 0, 2); const b = run(c, 240, tend); check(S.burning(c), 'a well-laid, tended fire is still burning after four minutes'); check(b > 230, `tended fire burned only ${b}s of 240`); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 20); check(c.pieces.filter(p => p.kind === 'kindling').every(p => p.burning), 'tinder lights the kindling laid around it'); }
{ const c = camp(c => { S.placePiece(c, 'tinder', 0, 2); for (let k = 0; k < 8; k++) S.placePiece(c, 'kindling', (k % 3 - 1) * 0.02, 2 + (k / 3 | 0) * 0.02); for (let k = 0; k < 3; k++) S.placePiece(c, 'fuel', (k - 1) * 0.03, 2.01); }); S.strike(c, 0, 2); const b = run(c, 60); check(b < 2, `a heap of kindling and logs smothers the fire (burned ${b}s)`); check(c.pieces.some(p => p.smoke > 0) || b === 0, 'a smothered fire smokes or never catches'); }
{ const c = camp(c => { S.placePiece(c, 'tinder', 0, 2); S.placePiece(c, 'fuel', 0, 2); }); S.strike(c, 0, 2); run(c, 40); check(!S.burning(c) && c.pieces.find(p => p.kind === 'fuel').T < 330, 'a cold log laid on tinder snuffs it'); }
{ const c = camp(c => { [[-0.04, 1.98], [0.04, 2.0]].forEach(([x, z]) => S.placePiece(c, 'kindling', x, z)); }); S.strike(c, 0, 2); const b = run(c, 30); check(b === 0, 'kindling will not catch from a spark without tinder'); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 25, (cc, t) => { if (t === 250) S.placePiece(cc, 'fuel', 0.03, 2.03); }); run(c, 300); check(!S.burning(c), 'one log alone burns down and the fire goes out: it has to be fed'); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 30); const out = c.pieces.filter(p => p.ash).length; check(out >= 1, 'the tinder burns away to ash'); }

console.log('Cooking');
function cook(type, dx, items, secs) {
  const c = camp(bed); S.strike(c, 0, 2); let v = null, cookedAt = -1, burntAt = -1;
  run(c, 30 + secs, (cc, t) => { tend(cc, t); if (t === 300) { v = S.placeVessel(cc, type, dx, 2); items.forEach(i => S.addToVessel(cc, v.id, i)); } if (v) { const j = S.judge(v); if (cookedAt < 0 && j.state === 'cooked') cookedAt = (t - 300) / 10; if (burntAt < 0 && j.state === 'burnt') burntAt = (t - 300) / 10; } });
  return { c, v, cookedAt, burntAt };
}
{ const r = cook('pan', 0, ['starGristle', 'moonlard'], 90); check(r.burntAt >= 0 && r.burntAt < 40, `a pan right over the fire burns (burnt at ${r.burntAt}s)`); }
{ const r = cook('pan', 0.1, ['starGristle', 'moonlard'], 90); check(r.cookedAt > 0 && r.burntAt < 0, `a pan at the edge of the flames cooks without burning (cooked ${r.cookedAt}s, burnt ${r.burntAt}s)`); }
{ const r = cook('pan', 0.3, ['starGristle', 'moonlard'], 90); check(r.cookedAt < 0, 'a pan far from the fire does not cook in time'); }
{ const r = cook('pot', 0, ['blackWater', 'lanternEye', 'weepingTuber'], 120); check(r.cookedAt > 0 && r.burntAt < 0, `a pot of water boils its contents without burning (cooked ${r.cookedAt}s)`); check(r.v.T <= 100.01, 'a pot with water stays at the boil'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pan', 0, 2); check(!S.addToVessel(c, v.id, 'blackWater'), 'black water only goes in the pot'); check(S.addToVessel(c, v.id, 'eelSlice') && S.addToVessel(c, v.id, 'cometHoney') && S.addToVessel(c, v.id, 'moonlard') && !S.addToVessel(c, v.id, 'waxFig'), 'a pan holds three things'); }

console.log('Eating');
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'lanternEye'); const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.soul < before.soul && c.stats.health < before.health, 'a raw Lantern Eye hurts soul and health'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'lanternEye'); v.items[0].progress = 1.2; const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.hunger < before.hunger && c.stats.soul >= before.soul, 'a cooked Lantern Eye eases hunger without hurting soul'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'starGristle'); v.items[0].progress = 1.2; v.items[0].scorch = 0.8; v.scorch = 0.8; const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.health < before.health + 6, 'burnt food hurts'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pot', 0, 2); ['blackWater', 'lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); v.items.forEach(it => { it.progress = 1.1; }); const j = S.judge(v); check(j.dish && j.dish.name === 'Eyestew', 'a cooked pot of black water, eye and tuber is Eyestew'); const r = S.eat(c, v.id); check(r.judged.dish && c.log[c.log.length - 1].ate === 'Eyestew', 'eating it counts as the dish'); }
{ const c = camp(() => {}); const s0 = { ...c.stats }; S.step(c, 600); check(c.stats.hunger > s0.hunger && c.stats.thirst > s0.thirst, 'hunger and thirst grow with time'); }
{ const c = camp(bed); S.strike(c, 0, 2); const s0 = c.stats.exhaustion; run(c, 120, tend); check(c.stats.exhaustion < s0, 'resting by a burning fire eases exhaustion'); }

console.log('Data');
const ING = D.CAMP_INGREDIENTS;
check(Object.keys(ING).length === 20, `20 base ingredients (${Object.keys(ING).length})`);
check(new Set(Object.values(ING).map(i => i.theme)).size >= 5, 'ingredients span at least five themes');
Object.entries(ING).forEach(([k, I]) => {
  check(I.px.length === 8 && I.px.every(r => r.length === 8), `${k}: art is 8x8`);
  check(I.px.join('').split('').every(ch => ch === '.' || I.pal[ch]), `${k}: art uses only its palette`);
  check(Object.values(I.raw).some(v => v < 0) || I.raw.health < 0 || I.raw.soul < 0, `${k}: dangerous raw`);
  check(I.cook > 0 && Object.keys(I.cooked).length > 0, `${k}: cooks into something`);
});
[...Object.values(D.CAMP_FIRE), D.CAMP_STRIKER, ...Object.values(D.CAMP_VESSELS)].forEach(o => check(o.px.length === 8 && o.px.every(r => r.length === 8) && o.px.join('').split('').every(ch => ch === '.' || o.pal[ch]), `${o.name}: art is 8x8 in its palette`));
check(D.CAMP_DISHES.length >= 8, `at least 8 dishes (${D.CAMP_DISHES.length})`);
D.CAMP_DISHES.forEach(d => { check(d.items.every(i => ING[i]) && d.items.length <= D.CAMP_VESSELS[d.vessel].cap, `${d.name}: real ingredients that fit its vessel`); check(d.items.every(i => !ING[i].only || ING[i].only.includes(d.vessel)), `${d.name}: every ingredient may go in a ${d.vessel}`); });

console.log(`\n${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
