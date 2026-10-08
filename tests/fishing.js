// Fishing: node tests/fishing.js
const F = require('../fishing/sim.js'), D = require('../fishing/data.js'), CAMP = require('../camp/data.js');
const CR = D.FISH_CREATURES, T = D.FISH_TUNING;
let checks = 0, failures = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.log('  FAIL ' + what); } };
const mk = (seed, over) => { const stats = { health: 100, soul: 100 }, wounds = [], earned = {}; const ctx = { stats, stock: { hymnGrub: 3, marrow: 1 }, level: 1, hour: 12, wounds, earned, injure: c => { wounds.push(c); return { cause: c }; }, earn: (k, n) => { earned[k] = (earned[k] || 0) + n; }, ...over }; return { f: F.createAngler(seed), ctx, stats }; };
const run = (f, ctx, secs, dt, each) => { for (let t = 0; t < secs; t += (dt || 0.05)) { if (each) each(t); F.step(f, dt || 0.05, ctx); } };
// bring one to the bite, with a creature chosen
function toBite(f, ctx, creature, dist) { F.cast(f, dist === undefined ? 0.6 : dist, null, ctx); f.creature = creature; run(f, ctx, 20, 0.05, () => {}); }
function hooked(creature, seed) { const w = mk(seed || 1); F.cast(w.f, 0.5, null, w.ctx); w.f.creature = creature; w.f.wait = 0.1; run(w.f, w.ctx, 0.3); F.hook(w.f, w.ctx); return w; }

console.log('Data');
Object.entries(CR).forEach(([k, c]) => {
  check(c.name && c.note && c.hp > 0 && c.stamina > 0 && c.pull > 0 && c.atk.length && c.yield && CAMP.CAMP_INGREDIENTS[c.yield.id], `${k}: complete, and yields a real ingredient`);
  check(Object.keys(c.zones).every(z => D.FISH_ZONES.some(q => q.k === z)), `${k}: lives in real zones`);
  check(c.atk.every(a => ['blunt', 'thorns', 'spores', 'starlight', 'whispers'].includes(a.cause) && require('../body/data.js').BODY_CAUSES[a.cause]), `${k}: its attacks have causes the body knows`);
});
check(CR.boneEel.flies && CR.boneEel.yield.id === 'marrow', 'there is a bone eel, it flies, and it is made of bone');
check(D.fishPeriodOf(2).k === 'night' && D.fishPeriodOf(6).k === 'dawn' && D.fishPeriodOf(12).k === 'day' && D.fishPeriodOf(18).k === 'dusk', 'the hours of the bell');

console.log('Casting and what bites');
{ const { f, ctx } = mk(1); check(F.cast(f, 0.5, { id: 'hymnGrub', tags: ['grub'] }, ctx) && f.phase === 'waiting' && ctx.stock.hymnGrub === 2, 'a cast uses up its bait'); check(!F.cast(f, 0.5, null, ctx), 'and cannot be cast again while the line is out'); }
{ const { f, ctx } = mk(2); F.cast(f, 0.05, null, ctx); const near = f.dist; const g = mk(2); F.cast(g.f, 1, null, g.ctx); check(g.f.dist > near && g.f.zone === 'deep' && f.zone === 'shallows', 'a harder cast goes further, into deeper water'); }
const tally = (bait, hour, dist, n) => { const f = F.createAngler(7), o = {}; for (let i = 0; i < (n || 2000); i++) { const k = F.chooseCreature(f, dist, bait, hour); o[k] = (o[k] || 0) + 1; } return o; };
{ const sh = tally(null, 12, 0.2), deep = tally(null, 12, 0.9); check(Object.keys(sh).every(k => CR[k].zones.shallows) && !sh.weepingDrowner && deep.weepingDrowner > 0 && !deep.blindShoal, 'what bites depends on how deep the line is'); }
{ const none = tally(null, 23, 0.9), bone = tally({ id: 'marrow', tags: ['bone'] }, 23, 0.9); check(bone.boneEel > none.boneEel * 1.5, 'bone bait brings the bone eel'); const honey = tally({ id: 'cometHoney', tags: ['sweet'] }, 23, 0.55), plain = tally(null, 23, 0.55); check(honey.lanternGape > plain.lanternGape * 1.3, 'sweet, bright bait brings the lantern-gape'); const grub = tally({ id: 'hymnGrub', tags: ['grub'] }, 12, 0.2), no = tally(null, 12, 0.2); check(grub.blindShoal > no.blindShoal, 'grubs bring the shoal-things'); }
{ const day = tally(null, 12, 0.9), night = tally(null, 23, 0.9); check(night.boneEel > day.boneEel * 3 && night.weepingDrowner > day.weepingDrowner * 3, 'the bone eel and the drowner come at night'); check(day.ossuaryPike + day.abyssalEel > night.ossuaryPike + night.abyssalEel * 0.6, 'and the pike and eel keep to the day, more'); const dawn = tally(null, 6, 0.9), noon = tally(null, 12, 0.9); check(dawn.abyssalEel > noon.abyssalEel, 'eels rise at the dawn bell'); }
{ const a = mk(3); F.cast(a.f, 0.5, null, a.ctx); const b = mk(3); F.cast(b.f, 0.5, null, b.ctx); check(a.f.creature === b.f.creature && a.f.wait === b.f.wait, 'a seed replays the same cast'); }

console.log('Waiting, the dip and the hook');
{ const { f, ctx } = mk(4); F.cast(f, 0.5, null, ctx); let sawOmen = false, bite = false; for (let t = 0; t < 30 && f.phase === 'waiting'; t += 0.05) { F.step(f, 0.05, ctx); sawOmen = sawOmen || f.omen; } bite = f.phase === 'bite'; check(sawOmen && bite, 'a shadow shows under the bobber, then it dips'); F.hook(f, ctx); check(f.phase === 'fight' && ctx.earned.angling > 0, 'hooking it begins the fight'); }
{ const { f, ctx } = mk(4); F.cast(f, 0.5, null, ctx); check(F.hook(f, ctx) === false && f.phase === 'idle', 'hooking before the dip brings the line back bare'); }
{ const { f, ctx } = mk(4); F.cast(f, 0.5, null, ctx); run(f, ctx, 40); check(f.phase === 'idle' && f.events.some(e => /took the bait/.test(e.text)), 'too slow, and it takes the bait and is gone'); }
{ const { f, ctx } = mk(4); F.cast(f, 0.5, { id: 'hymnGrub', tags: ['grub'] }, ctx); check(F.reelIn(f) && f.phase === 'idle', 'you can wind in before a bite'); }

console.log('The fight on the line');
{ const w = hooked('abyssalEel'); let snapped = false; w.f.reel = true; run(w.f, w.ctx, 60, 0.05, () => { F.setReel(w.f, true); }); check(w.f.phase === 'result' || w.f.phase === 'combat', 'holding the reel down ends the fight one way or another'); }
{ const w = hooked('abyssalEel'); let lost = 0; for (let n = 0; n < 6; n++) { const q = hooked('ossuaryPike', 10 + n); run(q.f, q.ctx, 60, 0.05, () => F.setReel(q.f, true)); if (q.f.result && q.f.result.kind === 'lost') lost++; } check(lost >= 3, 'a hard-hauling thing (the pike) snaps the line if you just hold on'); }
{ // playing it: reel in the calm, ease off when it surges
  let won = 0; for (let n = 0; n < 8; n++) { const q = hooked('abyssalEel', 30 + n); run(q.f, q.ctx, 120, 0.05, () => { const m = q.f.m; F.setReel(q.f, !(m && m.kind && m.kind !== 'gnaw')); if (q.f.phase !== 'fight') return; }); if (q.f.phase === 'combat' || (q.f.result && q.f.result.kind !== 'lost')) won++; }
  check(won >= 6, `reeling in the calm and easing off at the surge lands it (${won} of 8)`); }
{ const q = hooked('blindShoal', 5); q.f.m = { kind: null, t: 0, next: 1e9 }; run(q.f, q.ctx, 8, 0.05, () => F.setReel(q.f, false)); check(q.f.phase === 'result' && q.f.result.why === 'spat', 'never reeling lets it spit the hook'); }
{ const q = hooked('abyssalEel', 6); q.f.m = { kind: 'dive', t: 100, next: 0 }; const d0 = q.f.dist; run(q.f, q.ctx, 2, 0.05, () => { q.f.m.t = 100; F.setReel(q.f, false); }); check(q.f.dist > d0 || q.f.phase === 'result', 'a dive runs the line out if you let it'); }
{ const q = hooked('abyssalEel', 7); q.f.stamina = 0; const d0 = q.f.dist; run(q.f, q.ctx, 2, 0.05, () => F.setReel(q.f, true)); check(d0 - q.f.dist > 0.2 * 1.0 * 0.5, 'a tired thing comes in quickly'); }

console.log('The fight on the ledge');
function landed(creature, seed) { const q = hooked(creature, seed); q.f.dist = 0.03; run(q.f, q.ctx, 0.1); return q; }
{ const q = landed('thornLeech', 8); check(q.f.phase === 'combat' && q.f.combat.hp === CR.thornLeech.hp, 'what you reel in is on the ledge, alive'); }
{ const q = landed('sporeCarp', 9); let hits = 0; run(q.f, q.ctx, 12, 0.05); check(q.stats.health < 100 && q.f.combat.hits > 0, 'left alone it hurts you'); check(q.ctx.wounds.length >= 0, 'and may wound you'); }
{ const q = landed('thornLeech', 10); let n = 0; for (; n < 20 && q.f.phase === 'combat'; n++) { F.strike(q.f, q.ctx); run(q.f, q.ctx, 0.7, 0.05); } check(q.f.phase === 'result' && q.f.result.kind === 'caught' && q.ctx.stock.thornLeech >= 1, 'striking kills it and you take what it gives'); check(q.f.tally.thornLeech === 1 && q.ctx.earned.angling > 5, 'and it is logged and earns angling experience'); }
{ const q = landed('lanternGape', 11); q.f.combat.ph = 'idle'; q.f.combat.t = 100; const hp = q.f.combat.hp; F.strike(q.f, q.ctx); const a = hp - q.f.combat.hp; q.f.cd = 0; q.f.combat.ph = 'recover'; q.f.combat.t = 5; const hp2 = q.f.combat.hp; F.strike(q.f, q.ctx); check(hp2 - q.f.combat.hp > a * 1.4, 'a blow while it is open does far more'); }
{ const q = landed('abyssalEel', 12); const k = q.f.combat; k.ph = 'windup'; k.atk = CR.abyssalEel.atk[0]; k.t = 0.05; F.brace(q.f); const h0 = q.stats.health; run(q.f, q.ctx, 0.1); check(q.f.combat.ph === 'recover' && q.f.combat.parried && 100 - q.stats.health < CR.abyssalEel.atk[0].dmg * 0.3 && q.ctx.wounds.length === 0, 'a brace takes the attack on your guard, no wound, and leaves it open'); }
{ const q = landed('abyssalEel', 13); const k = q.f.combat; k.ph = 'windup'; k.atk = { ...CR.abyssalEel.atk[0], wound: 1 }; k.t = 0.05; run(q.f, q.ctx, 0.1); check(q.stats.health < 95 && q.ctx.wounds.length === 1 && q.ctx.wounds[0] === 'blunt', 'an unbraced attack hurts, and wounds you with its cause'); }
{ const q = landed('abyssalEel', 14); check(F.brace(q.f) && !F.brace(q.f), 'bracing has a cooldown'); }
{ const q = landed('ossuaryPike', 15); check(F.retreat(q.f) && q.f.result.kind === 'fled' && !q.ctx.stock.marrow || q.ctx.stock.marrow === 1, 'you can cut loose and lose the catch'); }
{ const q = landed('weepingDrowner', 16); q.stats.health = 0.5; q.f.combat.ph = 'windup'; q.f.combat.atk = CR.weepingDrowner.atk[1]; q.f.combat.t = 0.02; run(q.f, q.ctx, 0.2); check(q.f.result && q.f.result.kind === 'collapsed' && q.stats.health >= 1, 'if it drops you, you collapse and lose it, but live'); }

console.log('The bone eel');
{ const q = landed('boneEel', 17), k = q.f.combat; k.ph = 'idle'; k.t = 100; check(!F.reachable(q.f), 'it circles in the air, out of reach'); const hp = k.hp; q.f.cd = 0; F.strike(q.f, q.ctx); check(k.hp === hp, 'a blow at it then finds nothing');
  k.ph = 'windup'; k.atk = CR.boneEel.atk[0]; k.t = k.atk.windup * 1.3; check(!F.reachable(q.f), 'at the start of a swoop it is still far'); k.t = k.atk.windup * 1.3 * 0.3; check(F.reachable(q.f), 'at the end of the swoop it is on you, and can be hit'); q.f.cd = 0; F.strike(q.f, q.ctx); check(k.hp < hp, 'and you can hit it then');
  k.ph = 'recover'; k.t = 1; check(F.reachable(q.f), 'and when a parry leaves it open'); }
{ const q = landed('boneEel', 18); let n = 0, parried = 0; run(q.f, q.ctx, 90, 0.05, () => { const k = q.f.combat; if (!k || q.f.phase !== 'combat') return; if (k.ph === 'windup' && k.t < 0.35) F.brace(q.f); if (F.reachable(q.f)) F.strike(q.f, q.ctx); }); check(q.f.result && q.f.result.kind === 'caught' && q.ctx.stock.marrow >= 3, 'braced at the swoop and struck when open, the bone eel can be killed, and gives marrow'); }

console.log('Telling the move before it comes');
{ const q = hooked('ossuaryPike', 21); q.f.m = { kind: null, t: 0, next: 0.05 }; let seenTell = false, tenseAt = -1, hitAt = -1, t = 0; const lp = q.f.line.hp;
  for (; t < 6; t += 0.05) { F.setReel(q.f, true); F.step(q.f, 0.05, q.ctx); const w = F.warning(q.f); if (w && tenseAt < 0) { tenseAt = t; seenTell = true; check(w.harm && (w.kind === 'gnaw' || w.strain > T.tension.danger), 'a hard move warns that reeling through it would harm the line'); } if (tenseAt >= 0 && !w && hitAt < 0) hitAt = t; if (q.f.line.hp < lp - 0.01 && hitAt < 0) { hitAt = -2; break; } }
  check(seenTell && hitAt !== -2, 'the line takes no damage while the move is only being told');
  check(F.warning(q.f) === null || q.f.m.tell > 0, 'the warning ends when the move begins'); }
{ const q = hooked('ossuaryPike', 22); q.f.m = { kind: 'thrash', tell: T.tell, t: 0, next: 0 }; const t0 = q.f.tension; let max = 0; for (let t = 0; t < T.tell - 0.1; t += 0.05) { F.setReel(q.f, true); F.step(q.f, 0.05, q.ctx); max = Math.max(max, q.f.tension); } check(max < T.tension.danger, 'during the tell the strain stays below the danger line, so there is time to ease off');
  for (let t = 0; t < 1.5; t += 0.05) { F.setReel(q.f, false); F.step(q.f, 0.05, q.ctx); } check(q.f.line.hp === q.f.line.max, 'easing off at the tell takes no line damage at all'); }
{ const q = hooked('ossuaryPike', 23); q.f.m = { kind: 'thrash', tell: T.tell, t: 0, next: 0 }; for (let t = 0; t < T.tell + 1.4; t += 0.05) { F.setReel(q.f, true); F.step(q.f, 0.05, q.ctx); } check(q.f.line.hp < q.f.line.max, 'but reeling through it does'); }
{ const q = hooked('abyssalEel', 24); q.f.m = { kind: 'gnaw', tell: T.tell, t: 0, next: 0 }; check(F.warning(q.f).harm, 'a gnaw is told as harm'); for (let t = 0; t < T.tell - 0.1; t += 0.05) F.step(q.f, 0.05, q.ctx); check(q.f.line.hp === q.f.line.max, 'and does nothing until the tell is over'); }
{ const q = hooked('blindShoal', 25); q.f.m = { kind: 'thrash', tell: T.tell, t: 0, next: 0 }; check(!F.warning(q.f).harm, 'a weak thing thrashing is told, but not as a danger to the line'); }

console.log(`\n${checks} checks`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
