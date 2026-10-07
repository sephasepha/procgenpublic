// Skills: experience by kind of work. Each skill (firemaking, cooking, medicine, ...) has its own level and
// experience; doing that kind of work earns it. No DOM in the model (createSkills, gain, need); tests/skills.js
// tests it. In the browser, Skills also keeps your skills saved and tells the experience bar (skills/bar.js)
// whenever one changes, so the one bar can show whichever skill just moved.
//
// What earns what is decided where the work happens, from the amounts in XP below:
//   firemaking   a piece catching (camp), coals forming, a breath when the fire needs one, gathering ash and char
//   cooking      food cooking (by how far each item gets towards done, unburnt), freeing food that was sticking,
//                eating a dish or a stew
//   medicine     a right step of a treatment, finding out a step, a cure (body)
(function (root) {
  const SKILLS = {
    fire: { name: 'Firemaking', icon: '♨' },
    cooking: { name: 'Cooking', icon: '◒' },
    medicine: { name: 'Medicine', icon: '✚' },
  };
  const XP = {
    catch: { tinder: 1, kindling: 2, fuel: 4 }, coals: 3, breath: 1, gather: 1,  // firemaking
    cook: 8, dish: 10, stew: 6, tend: 1,                                         // cooking: cook is per item fully cooked; tend frees stuck food
    step: 3, stepPerStage: 2, discover: 5, cure: 6,                              // medicine: cure is per stage (1..3)
  };
  // experience from one level to the next: 30 at level 1, rising
  const need = level => Math.round(30 * Math.pow(level, 1.4));
  const MAX = 99;

  function createSkills() { return Object.fromEntries(Object.keys(SKILLS).map(k => [k, { level: 1, xp: 0 }])); }
  // add experience to a skill; returns where it now stands and how many levels it went up
  function gain(s, key, amount) {
    const k = s[key] = s[key] || { level: 1, xp: 0 }, from = k.level;
    k.xp += Math.max(0, amount || 0);
    while (k.level < MAX && k.xp >= need(k.level)) { k.xp -= need(k.level); k.level++; }
    return { key, level: k.level, xp: k.xp, need: need(k.level), levelled: k.level - from };
  }

  const model = { SKILLS, XP, need, createSkills, gain };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') { module.exports = model; return; }

  // ---------- in the browser: one set of skills, saved, and listeners ----------
  const SAVE = 'undercroft-skills-v1', listeners = [];
  let s = null, savedAt = 0;
  function all() {
    if (!s) {
      s = createSkills();
      try { const v = JSON.parse(localStorage.getItem(SAVE)); if (v) { Object.keys(SKILLS).forEach(k => { if (v[k]) s[k] = v[k]; }); if (SKILLS[v.last]) s.last = v.last; } } catch (e) { /* storage unavailable */ }
      root.addEventListener('pagehide', save);
    }
    return s;
  }
  // the skill that last moved (the bar shows it when the page opens)
  const last = () => all().last || 'fire';
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } savedAt = performance.now(); }
  // earn experience; listeners hear of it when the whole number shown changes or a level is gained
  function earn(key, amount) {
    if (!(amount > 0)) return null;
    const before = Math.floor(all()[key] ? all()[key].xp : 0), r = gain(all(), key, amount);
    s.last = key;
    if (r.levelled || Math.floor(r.xp) !== before) {
      r.gained = amount; listeners.forEach(f => f(r));
      if (r.levelled || performance.now() - savedAt > 3000) save();
    }
    return r;
  }
  root.Skills = { ...model, all, last, earn, on: f => listeners.push(f), save };
})(typeof window !== 'undefined' ? window : globalThis);
