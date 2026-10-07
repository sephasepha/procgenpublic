// Skills: node tests/skills.js
const K = require('../skills/skills.js');
let fails = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.log('  FAIL ' + what); } };
console.log('Skills');
{ const s = K.createSkills(); check(Object.keys(K.SKILLS).every(k => s[k].level === 1 && s[k].xp === 0), 'every skill starts at level 1 with nothing'); }
{ const s = K.createSkills(); const r = K.gain(s, 'fire', 10); check(r.level === 1 && r.xp === 10 && r.need === K.need(1) && !r.levelled, 'experience adds up'); check(s.cooking.xp === 0 && s.medicine.xp === 0, 'and only to the skill that earned it'); }
{ const s = K.createSkills(); const r = K.gain(s, 'cooking', K.need(1) + 5); check(r.level === 2 && Math.abs(r.xp - 5) < 1e-9 && r.levelled === 1, 'enough goes up a level, keeping the rest'); }
{ const s = K.createSkills(); const r = K.gain(s, 'medicine', K.need(1) + K.need(2) + K.need(3)); check(r.level === 4 && r.levelled === 3, 'a lot goes up several levels at once'); }
{ const s = K.createSkills(); let r; for (let i = 0; i < 1000; i++) r = K.gain(s, 'cooking', 0.08); let spent = 0; for (let l = 1; l < r.level; l++) spent += K.need(l); check(r.level === 2 && Math.abs(s.cooking.xp + spent - 80) < 1e-6, 'small amounts (food cooking a little each moment) add up exactly'); }
{ const s = K.createSkills(); K.gain(s, 'fire', -5); K.gain(s, 'fire', NaN); check(s.fire.xp === 0, 'nothing negative or broken is earned'); }
{ let ok = true; for (let l = 1; l < 60; l++) ok = ok && K.need(l + 1) > K.need(l); check(ok && K.need(1) === 30, 'each level needs more than the last'); }
console.log(`\n${n} checks`); console.log(fails ? `${fails} FAILED` : 'All passed'); process.exit(fails ? 1 : 0);
