// Body tests: node tests/body.js
// Ailments take hold, advance through their stages, drain the body and spread to neighbouring parts; the exact
// tools in order cure them, the wrong tool hurts; the red iron needs the fire; and the table is complete.
const B = require('../body/sim.js');
const D = require('../body/data.js');
let checks = 0, failures = 0;
const check = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL ' + m); } };
const stats = () => ({ health: 80, soul: 70, hunger: 40, thirst: 40, exhaustion: 30 });

console.log('Taking hold and getting worse');
{ const b = B.createBody(3), a = B.roll(b); check(a && D.BODY_AILMENTS[a.key] && D.BODY_PARTS[a.part], 'rolling the table gives an affliction on a part'); }
{ const b = B.createBody(3), seen = new Set(); for (let k = 0; k < 60; k++) { const a = B.roll(b); if (a) seen.add(a.key); } check(seen.size === Object.keys(D.BODY_AILMENTS).length, `every ailment can be rolled (${seen.size})`); }
{ const b = B.createBody(3); const a = B.roll(b, 'gaze'); check(a.part === 'head', 'Lantern Gaze only takes the head'); check(!B.roll(b, 'gaze'), 'and only once'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'armL'); const m = D.BODY_AILMENTS.starRot.stages[0].minutes; for (let t = 0; t < m * 60 + 5; t++) B.step(b, 1, s); check(a.stage === 1, `Star-Rot reaches its second stage after ${m} minutes`); check(s.health < 80, 'and has drained health on the way'); }
{ const b = B.createBody(3); const a = B.roll(b, 'starRot', 'armL'); for (let t = 0; t < 60 * 60; t++) B.step(b, 1, stats()); check(a.stage === 2, 'left untreated it reaches its last stage'); check(b.afflictions.filter(x => x.key === 'starRot').length > 1, 'and spreads to neighbouring parts'); check(b.afflictions.every(x => x.key !== 'starRot' || x.part === 'armL' || D.BODY_PARTS[x.part]), 'spread stays on the body'); }
{ const b = B.createBody(5); B.roll(b, 'leech', 'armR'); for (let t = 0; t < 90 * 60; t++) B.step(b, 1, stats()); check(b.afflictions.filter(x => x.key === 'leech').every(x => ['armL', 'armR', 'legL', 'legR'].includes(x.part)), 'leeches stay on the limbs'); }
{ const b = B.createBody(3); B.roll(b, 'starRot', 'head'); for (let t = 0; t < 120; t++) B.step(b, 1, stats()); check(b.afflictions.length === 1, 'a first-stage affliction does not spread'); }

console.log('Treatment');
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'legL'); const r1 = B.apply(b, 'legL', 'salt', {}, s), r2 = B.apply(b, 'legL', 'gauze', {}, s); check(r1.ok && !r1.cured && r2.ok && r2.cured && a.phase === 'healing', 'salt then gauze cures speckled Star-Rot: it starts to heal'); }

console.log('Healing');
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'legL'); a.stage = 2; a.step = 0; ['cautery', 'spirits', 'gauze'].forEach(t => B.apply(b, 'legL', t, { fireHot: true }, s));
  check(a.phase === 'healing' && a.stage === 2 && b.afflictions.includes(a), 'a treated wound stays, healing, at the stage it was treated at');
  const h0 = { ...s }; for (let t = 0; t < 60; t++) B.step(b, 1, s); check(s.health === h0.health && s.soul === h0.soul, 'a healing wound drains nothing');
  const seen = []; for (let t = 0; t < 20 * 60; t++) { B.step(b, 1, s); const x = b.afflictions.find(q => q.id === a.id); const k = x ? x.phase + x.stage : 'gone'; if (seen[seen.length - 1] !== k) seen.push(k); }
  check(seen.join(',') === 'healing2,healing1,healing0,benign0,gone', `it heals back down its stages, becomes benign, then is gone (${seen.join(', ')})`);
  check(b.log.some(l => l.benign === 'starRot') && b.log.some(l => l.healed === 'starRot'), 'and the log says so'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'legL'); a.stage = 2; a.progress = 0.99; B.apply(b, 'legL', 'cautery', { fireHot: true }, s); B.apply(b, 'legL', 'spirits', {}, s); B.apply(b, 'legL', 'gauze', {}, s);
  for (let t = 0; t < 300; t++) B.step(b, 1, s); check(a.stage < 2 && b.afflictions.filter(x => x.key === 'starRot').length === 1, 'a healing wound neither worsens nor spreads'); }
{ const b = B.createBody(3), s = stats(); B.roll(b, 'starRot', 'legL'); B.apply(b, 'legL', 'salt', {}, s); B.apply(b, 'legL', 'gauze', {}, s); check(B.apply(b, 'legL', 'salt', {}, s).why === 'healing', 'there is nothing to treat on a part that is only healing');
  const a = b.afflictions[0], c = B.chart(b, a); check(c.phase === 'healing' && c.name === 'Star-Rot' && c.minutesLeft > B.HEAL.benign && !c.worsens, 'the chart shows it healing, with the time it has left');
  for (let t = 0; t < (B.HEAL.stage + 0.1) * 60; t++) B.step(b, 1, s); const c2 = B.chart(b, a); check(c2.phase === 'benign' && c2.name === D.BODY_AILMENTS.starRot.benign.name && c2.look === D.BODY_AILMENTS.starRot.benign.look, 'then its benign form'); }

{ const b = B.createBody(3), s = stats(); B.roll(b, 'starRot', 'legL'); const h = s.health; const r = B.apply(b, 'legL', 'gauze', {}, s); check(!r.ok && r.why === 'wrong' && s.health < h && b.afflictions[0].step === 0, 'the wrong tool hurts and does nothing'); check(b.tools.gauze === D.BODY_TOOLS.gauze.uses, 'but is not used up (you only find out it does not fit)'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'torso'); a.stage = 2; const r = B.apply(b, 'torso', 'cautery', { fireHot: false }, s); check(!r.ok && r.why === 'cold', 'the cautery iron does nothing while the fire is out'); check(B.apply(b, 'torso', 'cautery', { fireHot: true }, s).ok, 'and works when it is red from the fire'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'cyst', 'armL'); B.apply(b, 'armL', 'knife', {}, s); a.progress = 0.999; B.step(b, 60, s); check(a.stage === 1 && a.step === 0, 'a stage advancing mid-treatment starts its treatment over'); }
{ const b = B.createBody(3); check(B.apply(b, 'head', 'knife', {}, stats()).why === 'healthy', 'nothing to treat on a healthy part'); }
{ const b = B.createBody(3), s = stats(); B.roll(b, 'gaze', 'head'); B.roll(b, 'starRot', 'head'); const g = b.afflictions[0]; g.stage = 1; const r = B.apply(b, 'head', 'blindfold', {}, s); check(r.ok && r.affliction === g, 'treatment goes to the worst affliction on the part'); B.apply(b, 'head', 'knife', {}, s); check(g.step === 2, 'and stays with it once started'); }
{ const b = B.createBody(3); b.tools.salt = 0; B.roll(b, 'starRot', 'legL'); check(B.apply(b, 'legL', 'salt', {}, stats()).why === 'none left', 'a used-up tool cannot be used'); }

console.log('Discovery');
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'legL'); let c = B.chart(b, a);
  check(!c.named && c.name === null && c.steps.length === 2 && c.steps.every(x => x.tool === null) && c.lore === null, 'an ailment starts unknown: no name, its steps unknown, no note');
  check(c.look === D.BODY_AILMENTS.starRot.stages[0].look, 'but you can see what it looks like');
  B.apply(b, 'legL', 'knife', {}, s); B.apply(b, 'legL', 'moss', {}, s); B.apply(b, 'legL', 'knife', {}, s); c = B.chart(b, a);
  check(!c.named && c.steps[0].tried.join() === 'knife,moss', 'wrong tools tried at a step are remembered, once each');
  const r = B.apply(b, 'legL', 'salt', {}, s); c = B.chart(b, a);
  check(r.discovered && c.named && c.name === 'Star-Rot' && c.steps[0].tool === 'salt' && c.steps[0].done && c.steps[1].now && c.steps[1].tool === null, 'the right tool reveals the step and names the ailment');
  B.apply(b, 'legL', 'gauze', {}, s);
  const a2 = B.roll(b, 'starRot', 'armL'), c2 = B.chart(b, a2);
  check(c2.steps.every(x => x.tool) && c2.lore && c2.steps[0].now, 'what you learnt holds for the next one, with the pilgrims\' note');
  check(!B.apply(b, 'armL', 'salt', {}, s).discovered, 'a known step is not discovered again');
  a2.stage = 1; a2.step = 0; check(B.chart(b, a2).steps.every(x => x.tool === null) && B.chart(b, a2).named, 'each stage is learnt separately, though the name stays known'); }
{ const b = B.createBody(3), s = stats(); B.roll(b, 'starRot', 'head'); B.roll(b, 'gaze', 'head'); const g = b.afflictions[1]; const r = B.apply(b, 'head', 'blindfold', {}, s, g.id); check(r.ok && r.affliction === g, 'a tool can be aimed at one affliction of several on a part'); }
{ const b = B.createBody(3); delete b.known; delete b.tried; B.upgrade(b); check(b.known && b.tried, 'an old save gains an empty memory'); }

console.log('The table');
const tools = D.BODY_TOOLS;
Object.entries(D.BODY_AILMENTS).forEach(([k, A]) => {
  check(A.stages.length === 3, `${k}: three stages`);
  A.stages.forEach((st, i) => {
    check(st.treat.length >= 1 && st.treat.every(t => tools[t]), `${k} stage ${i + 1}: treatment uses real tools`);
    check(st.treat[st.treat.length - 1] === 'gauze' || ['boneChoir', 'tideLung', 'hunger', 'glyphBurn', 'cyst', 'gaze'].includes(k), `${k} stage ${i + 1}: ends sensibly`);
    check(i === 2 ? st.minutes === 0 : st.minutes > 0, `${k} stage ${i + 1}: advances unless it is the last`);
    check(Object.values(st.drain).some(v => v !== 0), `${k} stage ${i + 1}: costs the body something`);
    check(st.lore && st.look, `${k} stage ${i + 1}: has a look and a pilgrim's note`);
  });
  check(A.stages[2].spread > 0 || A.stages[1].spread > 0, `${k}: spreads when it is bad`);
  check(A.benign && A.benign.name && A.benign.look, `${k}: has a benign form to heal into`);
});
check(Object.keys(D.BODY_AILMENTS).length >= 10, 'at least ten ailments');
Object.entries(tools).forEach(([k, t]) => check(t.px.length === 8 && t.px.every(r => r.length === 8) && t.px.join('').split('').every(c => c === '.' || t.pal[c]), `${k}: art is 8x8 in its palette`));

console.log(`\n${checks} checks`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
