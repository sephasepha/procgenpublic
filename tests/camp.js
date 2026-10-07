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

console.log('Breath and the gauge');
// four logs dropped on a young fire choke it; blowing on it keeps it alive through the worst of it
const heap = (cc, t) => { if (t === 60) for (let k = 0; k < 4; k++) S.placePiece(cc, 'fuel', k % 2 ? 0.03 : -0.03, k > 1 ? 2.03 : 1.97); };
{ const a = camp(bed), b = camp(bed); S.strike(a, 0, 2); S.strike(b, 0, 2);
  run(a, 20, heap); run(b, 20, (cc, t) => { heap(cc, t); if (t > 60 && t < 200 && t % 8 === 0) S.blow(cc); });
  check(!S.burning(a) && S.burning(b), 'blowing on a choking fire saves it; left alone it is snuffed out');
  check(S.fireState(a).state === 'Snuffed out', `a smothered fire reads as snuffed out (${S.fireState(a).state})`);
  check(b.stats.exhaustion > a.stats.exhaustion, 'blowing tires you'); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 60); const q = c.pieces.filter(p => p.ash && p.ember > 0); check(q.length > 0, 'burnt-out kindling leaves embers');
  const e0 = q[0].ember, before = S.fireState(c).out; S.blow(c); S.step(c, 0.1); check(S.fireState(c).out > before, 'a breath makes the embers flare'); check(q[0].ember < e0, 'and burns them down'); }
{ const c = camp(() => {}); check(S.fireState(c).state === 'Empty pit' && S.fireState(c).strength === 0, 'an empty pit reads empty');
  bed(c); check(S.fireState(c).state === 'Cold', 'a laid fire reads cold'); S.strike(c, 0, 2); run(c, 10);
  const f = S.fireState(c); check(f.lit > 0 && f.strength > 0.2 && f.strength < 0.8 && f.flame > 0 && f.fuel > 0, `a kindling fire reads as a middling fire (${f.state} ${f.strength.toFixed(2)})`);
  run(c, 120); check(['Embers', 'Starving'].includes(S.fireState(c).state) || !S.burning(c), 'an unfed fire runs down to embers'); }
{ const c = camp(bed); S.strike(c, 0, 2); const seen = new Set(); run(c, 240, (cc, t) => { tend(cc, t); if (t % 10 === 0) { const f = S.fireState(cc); seen.add(f.state); check(f.strength >= 0 && f.strength <= 1 && f.air >= 0 && f.air <= 1, 'gauge values stay in range'); } });
  check(seen.has('Burning steady'), `a tended fire reads burning steady at some point (${[...seen].join(', ')})`); }

console.log('Spacing');
// the same two logs: stacked on the young fire they smother it; laid either side of it they catch and burn
{ const stacked = camp(bed), spaced = camp(bed); S.strike(stacked, 0, 2); S.strike(spaced, 0, 2);
  run(stacked, 40, (cc, t) => { if (t === 60) [[-0.035, 1.985], [0.035, 2.005]].forEach(([x, z]) => S.placePiece(cc, 'fuel', x, z)); });
  run(spaced, 40, (cc, t) => { if (t === 60) [[0.06, 2], [-0.06, 2]].forEach(([x, z]) => S.placePiece(cc, 'fuel', x, z)); });
  check(!S.burning(stacked), 'two logs stacked on the fire smother it');
  check(spaced.pieces.filter(p => p.kind === 'fuel' && p.burning).length === 2, 'the same logs laid either side of it catch'); }
{ const c = camp(c => { S.placePiece(c, 'tinder', 0, 2); S.placePiece(c, 'kindling', 0.2, 2); }); S.strike(c, 0, 2); run(c, 30); check(!c.pieces.find(p => p.kind === 'kindling').burning && c.pieces.find(p => p.kind === 'kindling').m === D.CAMP_FIRE.kindling.mass, 'kindling laid too far from the flame never catches'); }
{ const loose = camp(bed), tight = camp(c => { S.placePiece(c, 'tinder', 0, 2); [[-0.012, 2], [0.012, 2], [0, 2.012], [0, 1.988]].forEach(([x, z]) => S.placePiece(c, 'kindling', x, z)); });
  S.strike(loose, 0, 2); S.strike(tight, 0, 2); run(loose, 8); run(tight, 8);
  check(S.fireState(tight).air < S.fireState(loose).air - 0.08, `kindling packed tight gets less air than laid loose (${S.fireState(tight).air.toFixed(2)} vs ${S.fireState(loose).air.toFixed(2)})`);
  check(S.fireState(tight).needsAir, 'and the gauge says it wants a breath'); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 6); const a0 = S.fireState(c).air; S.blow(c); S.step(c, 0.1); check(S.fireState(c).air > a0 + 0.05, 'a breath gives the flames air at once'); }
{ const c = camp(bed); S.strike(c, 0, 2); run(c, 6);
  check(S.preview(c, 'fuel', 0, 2).smothers.length > 0, 'the preview warns that a log dropped on the flames will smother them');
  check(S.preview(c, 'kindling', 0.4, 2).catches === false, 'the preview says kindling far from the flames will not catch');
  const ok = S.preview(c, 'kindling', 0.07, 2); check(ok.catches && !ok.smothers.length, 'and that kindling beside the flames will catch without smothering them'); }

{ const c = S.createCamp(1); c.unlimitedFire = true; c.stock.kindling = 0; for (let k = 0; k < 30; k++) S.placePiece(c, 'kindling', 0.3 + k * 0.01, 2); check(c.pieces.length === 30 && c.stock.kindling === 0, 'with unlimited fire supplies, kindling never runs out'); }
console.log('Burning');
// a vessel held at a temperature (as over coals that hold steady): when its first item is done, overdone, burnt
function hold(T, items, flipEvery, secs, type) {
  const c = camp(() => {}); const v = S.placeVessel(c, type || 'pan', 3, 2); items.forEach(i => S.addToVessel(c, v.id, i));
  const at = {}, stick = [];
  for (let t = 0; t < (secs || 120) * 10; t++) {
    v.T = T; if (flipEvery && t && t % (flipEvery * 10) === 0) S.tend(c, v.id);
    S.step(c, 0.1); const st = S.foodState(v.items[0]); if (!(st in at)) at[st] = t / 10; if (t === 50) stick.push(v.items[0].stick);
  }
  return { at, v, c, stick: stick[0] };
}
{ const r = hold(180, ['starGristle'], 0); check(r.at.burnt > 0 && r.at.burnt < 40, `a pan left on 180 degree coals burns what is in it (burnt at ${r.at.burnt}s)`); }
{ const r = hold(180, ['starGristle'], 3); check(r.at.done > 0 && r.at.overdone > r.at.done + 4 && r.at.burnt > r.at.overdone, `flipped every few seconds, it is done, stays good a while, then overdone, then burnt (done ${r.at.done}, overdone ${r.at.overdone}, burnt ${r.at.burnt})`); }
{ const a = hold(180, ['starGristle'], 0), b = hold(180, ['starGristle'], 3); check(b.at.burnt > a.at.burnt + 8, `flipping holds off burning (left ${a.at.burnt}s, flipped ${b.at.burnt}s)`); check(!('done' in a.at) || a.at.overdone - a.at.done < 3, 'left alone, food sticks and is overdone as soon as it is done'); }
{ const lo = hold(130, ['starGristle'], 3), hi = hold(180, ['starGristle'], 3); check(lo.at.overdone - lo.at.done > hi.at.overdone - hi.at.done, `a gentler heat is slower but more forgiving (good for ${(lo.at.overdone - lo.at.done).toFixed(1)}s at 130, ${(hi.at.overdone - hi.at.done).toFixed(1)}s at 180)`); }
{ const r = hold(300, ['starGristle'], 1); check(r.at.burnt < 5 && !('done' in r.at), 'a searing pan burns food before it is done, flipped or not'); }
{ const d = hold(170, ['choirEgg'], 3), t = hold(170, ['saintsFinger'], 3); check(d.at.burnt - d.at.done < t.at.burnt - t.at.done, `delicate food burns sooner after it is done than tough food (egg ${(d.at.burnt - d.at.done).toFixed(1)}s, root ${(t.at.burnt - t.at.done).toFixed(1)}s)`); }
{ const a = hold(180, ['starGristle'], 0), b = hold(180, ['starGristle', 'moonlard'], 0); check(b.stick < a.stick * 0.6 && b.at.burnt > a.at.burnt, `fat greases the pan: food sticks and burns less (stuck ${a.stick.toFixed(2)} vs ${b.stick.toFixed(2)})`); }
{ const r = hold(180, ['starGristle'], 0, 6); const T0 = r.v.T, f = S.tend(r.c, r.v.id); check(f && f.freed > 0.4 && r.v.items[0].stick === 0 && r.v.T < T0, 'a flip frees what was sticking and costs a little heat'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pot', 3, 2); ['blackWater', 'blackWater', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); for (let t = 0; t < 600; t++) { v.T = 100; S.step(c, 0.1); } check(v.items[2].stick === 0 && v.items[2].scorch === 0 && S.foodState(v.items[2]) === 'done', 'food in water neither sticks nor overcooks'); }
{ const r = hold(160, ['lanternEye', 'weepingTuber'], 0, 30, 'pot'); check(r.v.items[0].stick > 0.5, 'a dry pot sticks'); const s = hold(160, ['lanternEye', 'weepingTuber'], 3, 120, 'pot'), n = hold(160, ['lanternEye', 'weepingTuber'], 0, 120, 'pot'); check(s.at.burnt > n.at.burnt, `stirring a dry pot holds off burning (left ${n.at.burnt}s, stirred ${s.at.burnt}s)`); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pan', 3, 2); S.addToVessel(c, v.id, 'starGristle'); const it = v.items[0];
  it.progress = 1.1; const good = { ...c.stats }; S.eat(c, v.id); const dGood = good.hunger - c.stats.hunger;
  S.addToVessel(c, v.id, 'starGristle'); v.items[0].progress = 1.9; v.items[0].dried = true; const b = { ...c.stats }; check(S.judge(v).state === 'overdone', 'food dried past its window is overdone'); S.eat(c, v.id); const dOver = b.hunger - c.stats.hunger;
  check(dOver > 0 && dOver < dGood, `overdone food does a little less (hunger ${dGood.toFixed(1)} vs ${dOver.toFixed(1)})`); }

console.log('Cooking');
function cook(type, dx, items, secs, flipEvery) {
  const c = camp(bed); S.strike(c, 0, 2); let v = null, cookedAt = -1, burntAt = -1;
  run(c, 30 + secs, (cc, t) => { tend(cc, t); if (v && flipEvery && (t - 300) % (flipEvery * 10) === 0) S.tend(cc, v.id); if (t === 300) { v = S.placeVessel(cc, type, dx, 2); items.forEach(i => S.addToVessel(cc, v.id, i)); } if (v) { const j = S.judge(v); if (cookedAt < 0 && j.state === 'cooked') cookedAt = (t - 300) / 10; if (burntAt < 0 && j.state === 'burnt') burntAt = (t - 300) / 10; } });
  return { c, v, cookedAt, burntAt };
}
{ const r = cook('pan', 0, ['starGristle', 'moonlard'], 90); check(r.burntAt >= 0 && r.burntAt < 20, `a pan right over the fire burns fast (burnt at ${r.burntAt}s)`); }
{ const r = cook('pan', 0.1, ['starGristle', 'moonlard'], 90, 3); check(r.cookedAt > 0 && r.cookedAt < 30 && (r.burntAt < 0 || r.burntAt > r.cookedAt + 8), `a pan at the edge of the flames, flipped, cooks fast with time to take it off (cooked ${r.cookedAt}s, burnt ${r.burntAt}s)`); }
{ const r = cook('pan', 0.1, ['starGristle', 'moonlard'], 120); check(r.burntAt > 0, `the same pan left alone burns (burnt ${r.burntAt}s)`); }
{ const r = cook('pan', 0.3, ['starGristle', 'moonlard'], 90); check(r.cookedAt < 0, 'a pan far from the fire does not cook in time'); }
{ const r = cook('pot', 0, ['blackWater', 'blackWater', 'lanternEye', 'weepingTuber'], 120); check(r.cookedAt > 0 && r.burntAt < 0, `a pot of water boils its contents without burning (cooked ${r.cookedAt}s)`); check(r.v.T <= 100.01, 'a pot with water stays at the boil'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pan', 0, 2); check(!S.addToVessel(c, v.id, 'blackWater'), 'black water only goes in the pot'); check(S.addToVessel(c, v.id, 'eelSlice') && S.addToVessel(c, v.id, 'cometHoney') && S.addToVessel(c, v.id, 'moonlard') && !S.addToVessel(c, v.id, 'waxFig'), 'a pan holds three things'); }

{ const r = cook('pot', 0, ['lanternEye', 'weepingTuber'], 90); check(r.burntAt >= 0, `a dry pot over the fire is an oven: it burns its contents (burnt at ${r.burntAt}s)`); }
{ const r = cook('pot', 0, ['lanternEye', 'weepingTuber'], 90), p = cook('pan', 0, ['lanternEye', 'weepingTuber'], 90); check(r.burntAt >= 0 && (p.burntAt < 0 || r.burntAt <= p.burntAt + 15), 'a dry pot scorches about as fast as a pan, or faster'); }
{ const c = camp(bed); S.strike(c, 0, 2); let v = null, stewAt = -1, cookedAt = -1;
  run(c, 200, (cc, t) => { tend(cc, t); if (t === 300) { v = S.placeVessel(cc, 'pot', 0, 2); ['blackWater', 'blackWater', 'lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(cc, v.id, i)); }
    if (v) { const j = S.judge(v); if (t === 301) check(j.state === 'raw' && !j.stew, 'adding food and water does not make a stew'); if (cookedAt < 0 && j.state === 'cooked') cookedAt = t; if (stewAt < 0 && j.stew) stewAt = t; } });
  check(stewAt > 0 && cookedAt > 0 && stewAt - cookedAt >= 200, `a stew comes together only after a simmer, once everything is cooked (cooked ${(cookedAt - 300) / 10}s, stew ${(stewAt - 300) / 10}s)`);
  check(S.judge(v).stew && S.judge(v).state === 'stew', 'and then it is a stew'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pot', 0, 2); ['blackWater', 'lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); v.items.forEach(it => { it.progress = 1.1; }); check(!S.judge(v).dish, 'a cooked pot is not yet the dish: it has to come together'); }

console.log('Water, coals and what is left');
{ const c = camp(() => {}); const pot = S.placeVessel(c, 'pot', 0.5, 2), pan = S.placeVessel(c, 'pan', -0.5, 2); pot.T = 100; pan.T = 200;
  for (let t = 0; t < 300; t++) S.step(c, 0.1);
  check(pot.T > 60 && pan.T > 50, `off the fire, pots and pans hold their heat (after 30 s: pot ${pot.T.toFixed(0)}, pan ${pan.T.toFixed(0)})`); }
{ // one measure of water: rich but little margin; two: thinner, safer
  const go = waters => { const c = camp(bed); S.strike(c, 0, 2); let v = null, stew = -1, dry = -1, burnt = -1;
    run(c, 260, (cc, t) => { tend(cc, t); if (t === 300) { v = S.placeVessel(cc, 'pot', 0, 2); for (let w = 0; w < waters; w++) S.addToVessel(cc, v.id, 'blackWater'); ['lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(cc, v.id, i)); }
      if (v) { const j = S.judge(v); if (stew < 0 && j.stew) stew = t; if (dry < 0 && !(v.water > 0)) dry = t; if (burnt < 0 && j.state === 'burnt') burnt = t; } });
    return { v, stew, dry, burnt, j: S.judge(v) }; };
  const one = go(1), two = go(2);
  check(one.stew > 0 && one.dry > one.stew && one.burnt > one.dry, `one water over the flames: stew, then dry, then burnt (stew ${one.stew}, dry ${one.dry}, burnt ${one.burnt})`);
  check(two.dry < 0 || two.dry - two.stew > (one.dry - one.stew) * 2, 'two waters leave much more time after the stew forms');
  const a = camp(() => {}), b = camp(() => {});
  [[a, 1], [b, 2]].forEach(([c, w]) => { const v = S.placeVessel(c, 'pot', 0, 2); for (let k = 0; k < w; k++) S.addToVessel(c, v.id, 'blackWater'); ['lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); v.items.forEach(it => { it.progress = 1.1; }); v.stewed = true; v.water = 0.5; });
  const ja = S.judge(a.vessels[0]), jb = S.judge(b.vessels[0]);
  check(ja.richness === 'rich' && jb.richness === 'thin' && ja.quality > jb.quality, 'one water makes a rich stew, two a thin one');
  check(ja.dish && jb.dish && ja.dish === jb.dish, 'the dish is the same however much water');
  const ha = a.stats.hunger, hb = b.stats.hunger; S.eat(a, a.vessels[0].id); S.eat(b, b.vessels[0].id); check(ha - a.stats.hunger > hb - b.stats.hunger, 'and the rich one feeds you more');
  // a simmer just at the boil keeps its water far longer than a pot over the flames
  const keep = dx => { const c = camp(bed); S.strike(c, 0, 2); let v = null; run(c, 200, (cc, t) => { tend(cc, t); if (t === 300) { v = S.placeVessel(cc, 'pot', dx, 2); S.addToVessel(cc, v.id, 'blackWater'); } }); return v.water; };
  check(keep(0.1) > keep(0) + 0.3, 'a pot set back from the flames boils off less water');
}
{ // logs burn down to coals that cook for minutes, then go cold to ash and char
  const c = camp(bed); c.unlimitedFire = true; S.strike(c, 0, 2);
  run(c, 50, (cc, t) => { if (t === 250) S.placePiece(cc, 'fuel', 0.03, 2.03); if (t === 450) S.placePiece(cc, 'fuel', -0.04, 2.01); });
  let coalsAt = -1, boilOnCoals = 0, hot = null;
  run(c, 1500, (cc, t) => { const f = S.fireState(cc); if (coalsAt < 0 && f.state === 'Coals') { coalsAt = t; const q = cc.pieces.find(p => p.coal && !p.spent); hot = q ? S.collect(cc, q.id) : 'none'; } if (f.state === 'Coals' && 12 + S.heatAt(cc, 0.1, 2) * 0.17 >= 100) boilOnCoals++; });
  check(coalsAt > 0, 'burnt-out logs leave a bed of coals');
  check(boilOnCoals > 600, `the coals alone keep a pot beside them at the boil for minutes (${(boilOnCoals / 10).toFixed(0)}s)`);
  check(hot === null, 'glowing coals cannot be picked up');
  run(c, 4000);
  let ash = 0, char = 0; c.pieces.slice().forEach(p => { const g = S.collect(c, p.id); if (g) { ash += g.ash; char += g.char; } });
  check(char >= 2 && ash >= 4 && c.stock.char >= 2 && c.stock.ash >= 4, `cold heaps give ash and char to keep (ash ${ash}, char ${char})`);
}
{ const c = camp(c => { S.placePiece(c, 'kindling', 0, 2); }); const p = c.pieces[0]; p.m = p.m0 * 0.5; p.T = 20; const g = S.collect(c, p.id); check(g && g.char === 1, 'a half-burnt stick put out is char'); }

{ const c = camp(() => {}); for (let k = 0; k < 200; k++) { c.t = k * 3.7; S.forage(c); } check(c.stock.ash === 20 && c.stock.char === 20, 'foraging never turns up ash or char'); }
console.log('Eating');
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'lanternEye'); const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.soul < before.soul && c.stats.health < before.health, 'a raw Lantern Eye hurts soul and health'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'lanternEye'); v.items[0].progress = 1.2; const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.hunger < before.hunger && c.stats.soul >= before.soul, 'a cooked Lantern Eye eases hunger without hurting soul'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'skewer', 0, 2); S.addToVessel(c, v.id, 'starGristle'); v.items[0].progress = 1.2; v.items[0].scorch = 0.8; v.scorch = 0.8; const before = { ...c.stats }; S.eat(c, v.id); check(c.stats.health < before.health + 6, 'burnt food hurts'); }
{ const c = camp(() => {}); const v = S.placeVessel(c, 'pot', 0, 2); ['blackWater', 'lanternEye', 'weepingTuber'].forEach(i => S.addToVessel(c, v.id, i)); v.items.forEach(it => { it.progress = 1.1; }); v.stewed = true; const j = S.judge(v); check(j.dish && j.dish.name === 'Eyestew', 'a cooked pot of black water, eye and tuber is Eyestew'); const r = S.eat(c, v.id); check(r.judged.dish && c.log[c.log.length - 1].ate === 'Eyestew', 'eating it counts as the dish'); }
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
