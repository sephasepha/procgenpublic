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
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'legL'); const r1 = B.apply(b, 'legL', 'salt', {}, s), r2 = B.apply(b, 'legL', 'gauze', {}, s); check(r1.ok && !r1.cured && r2.ok && r2.cured && !b.afflictions.length, 'salt then gauze cures speckled Star-Rot'); }
{ const b = B.createBody(3), s = stats(); B.roll(b, 'starRot', 'legL'); const h = s.health; const r = B.apply(b, 'legL', 'gauze', {}, s); check(!r.ok && r.why === 'wrong' && s.health < h && b.afflictions[0].step === 0, 'the wrong tool hurts and does nothing'); check(b.tools.gauze === D.BODY_TOOLS.gauze.uses - 1, 'and is wasted'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'starRot', 'torso'); a.stage = 2; const r = B.apply(b, 'torso', 'cautery', { fireHot: false }, s); check(!r.ok && r.why === 'cold', 'the cautery iron does nothing while the fire is out'); check(B.apply(b, 'torso', 'cautery', { fireHot: true }, s).ok, 'and works when it is red from the fire'); }
{ const b = B.createBody(3), s = stats(); const a = B.roll(b, 'cyst', 'armL'); B.apply(b, 'armL', 'knife', {}, s); a.progress = 0.999; B.step(b, 60, s); check(a.stage === 1 && a.step === 0, 'a stage advancing mid-treatment starts its treatment over'); }
{ const b = B.createBody(3); check(B.apply(b, 'head', 'knife', {}, stats()).why === 'healthy', 'nothing to treat on a healthy part'); }
{ const b = B.createBody(3), s = stats(); B.roll(b, 'gaze', 'head'); B.roll(b, 'starRot', 'head'); const g = b.afflictions[0]; g.stage = 1; const r = B.apply(b, 'head', 'blindfold', {}, s); check(r.ok && r.affliction === g, 'treatment goes to the worst affliction on the part'); B.apply(b, 'head', 'knife', {}, s); check(g.step === 2, 'and stays with it once started'); }
{ const b = B.createBody(3); b.tools.salt = 0; B.roll(b, 'starRot', 'legL'); check(B.apply(b, 'legL', 'salt', {}, stats()).why === 'none left', 'a used-up tool cannot be used'); }

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
});
check(Object.keys(D.BODY_AILMENTS).length >= 10, 'at least ten ailments');
Object.entries(tools).forEach(([k, t]) => check(t.px.length === 8 && t.px.every(r => r.length === 8) && t.px.join('').split('').every(c => c === '.' || t.pal[c]), `${k}: art is 8x8 in its palette`));

console.log(`\n${checks} checks`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('All passed');
