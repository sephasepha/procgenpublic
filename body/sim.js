// Body simulation: afflictions on parts of the body that advance, drain you, spread, and are treated by exact
// sequences of tools. No DOM; tests/body.js runs it. Stats are the same object the camp uses (health, soul, hunger,
// thirst, exhaustion), so what you eat and what is eating you meet in one place.
//
// You do not know how to treat anything until you find out. What you have learnt is kept in the body's state:
//   known[ailment] = { named, stages: { [stage]: [step known, ...] } }   learnt by using the right tool at a step
//   tried['ailment:stage:step'] = [tools]                                 the wrong tools tried there
// An ailment is named once any step of it is known; a stage's pilgrims' note once all its steps are. chart() says
// what the screen may show of an affliction.
//
// Treatment does not make a wound vanish: it turns it round. An affliction's phase is
//   active    (no phase)  it advances a stage at a time, drains you and spreads, until treated
//   healing   treated: it goes back down through its stages, a stage every HEAL.stage minutes, draining nothing
//   benign    healed past its first stage: its benign form (a scar, an ache) for HEAL.benign minutes, then gone
// heal is how far through the current healing stage or the benign form it is (0..1).
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const D = isNode ? require('./data.js') : root;
  const PARTS = D.BODY_PARTS, TOOLS = D.BODY_TOOLS, AIL = D.BODY_AILMENTS;
  const clamp = v => Math.max(0, Math.min(100, v));
  const HEAL = { stage: 1.5, benign: 3 }; // minutes: to heal back one stage; as the benign form before it is gone
  const active = a => !a.phase;

  function createBody(seed) {
    return { t: 0, seed: seed || 7, n: 0, nextId: 1, afflictions: [], tools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.uses === Infinity ? -1 : t.uses])), log: [], known: {}, tried: {} };
  }
  // a body saved before discovery existed: everything is unknown
  function upgrade(b) { b.known = b.known || {}; b.tried = b.tried || {}; return b; }
  function rnd(b) { // deterministic from the seed and how many rolls have been made
    let h = Math.imul(b.seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(++b.n, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  const partsFor = key => AIL[key].parts === 'any' ? Object.keys(PARTS) : AIL[key].parts;
  const has = (b, key, part) => b.afflictions.some(a => a.key === key && a.part === part);

  // roll on the ailment table: a new affliction at its first stage, somewhere it can take hold
  function roll(b, key, part) {
    const keys = Object.keys(AIL);
    for (let tries = 0; tries < 20; tries++) {
      const k = key || keys[Math.floor(rnd(b) * keys.length)];
      const free = partsFor(k).filter(p => !has(b, k, p));
      if (!free.length) { if (key) return null; continue; }
      const p = part && free.includes(part) ? part : free[Math.floor(rnd(b) * free.length)];
      const a = { id: b.nextId++, key: k, part: p, stage: 0, progress: 0, step: 0, born: b.t };
      b.afflictions.push(a); b.log.push({ t: b.t, took: k, part: p });
      return a;
    }
    return null;
  }

  // a treated affliction heals: back down a stage at a time, then its benign form, then gone (returns false when gone)
  function heal(b, a, m) {
    a.heal += m / (a.phase === 'benign' ? HEAL.benign : HEAL.stage);
    if (a.heal < 1) return true;
    a.heal = 0;
    if (a.phase === 'healing' && a.stage > 0) { a.stage--; b.log.push({ t: b.t, mending: a.key, part: a.part, stage: a.stage }); return true; }
    if (a.phase === 'healing') { a.phase = 'benign'; b.log.push({ t: b.t, benign: a.key, part: a.part }); return true; }
    b.log.push({ t: b.t, healed: a.key, part: a.part });
    return false;
  }

  // time passes: each affliction advances, drains the body, and from its later stages spreads to neighbouring parts;
  // each treated one heals
  function step(b, dt, stats) {
    b.t += dt;
    const m = dt / 60, born = [];
    b.afflictions = b.afflictions.filter(a => active(a) || heal(b, a, m));
    b.afflictions.forEach(a => {
      if (!active(a)) return;
      const A = AIL[a.key], st = A.stages[a.stage];
      if (st.minutes > 0) {
        a.progress += m / st.minutes;
        if (a.progress >= 1 && a.stage < A.stages.length - 1) { a.stage++; a.progress = 0; a.step = 0; b.log.push({ t: b.t, worse: a.key, part: a.part, stage: a.stage }); }
      }
      if (stats) Object.entries(st.drain).forEach(([s, v]) => { stats[s] = clamp(stats[s] + v * m); });
      if (st.spread > 0 && rnd(b) < st.spread * m) {
        const to = PARTS[a.part].adj.filter(p => partsFor(a.key).includes(p) && !has(b, a.key, p) && !born.some(n => n.key === a.key && n.part === p));
        if (to.length) born.push({ key: a.key, part: to[Math.floor(rnd(b) * to.length)], from: a.part });
      }
    });
    born.forEach(n => { const a = roll(b, n.key, n.part); if (a) b.log.push({ t: b.t, spread: n.key, from: n.from, to: n.part }); });
  }

  // what you know of an ailment's stage
  const knownSteps = (b, key, stage) => { const k = upgrade(b).known[key] = b.known[key] || { named: false, stages: {} }; return (k.stages[stage] = k.stages[stage] || AIL[key].stages[stage].treat.map(() => false)); };
  const triedKey = (a, step) => `${a.key}:${a.stage}:${step}`;

  // use a tool on a part: on the affliction given (id), else whatever there is being treated, else the worst there.
  // The right tool advances the treatment, and you learn it; the last one cures it. The wrong tool hurts (it is not
  // used up: you find out it does not fit), and you remember you tried it there.
  function apply(b, part, tool, ctx, stats, id) {
    const T = TOOLS[tool]; if (!T || !PARTS[part]) return { ok: false, why: 'nothing' };
    const all = b.afflictions.filter(a => a.part === part), here = all.filter(active);
    if (!here.length) return { ok: false, why: all.length ? 'healing' : 'healthy' };
    if (b.tools[tool] === 0) return { ok: false, why: 'none left' };
    if (T.needsFire && !(ctx && ctx.fireHot)) return { ok: false, why: 'cold' };
    const a = here.find(x => x.id === id) || here.find(x => x.step > 0) || here.slice().sort((x, y) => y.stage - x.stage || x.born - y.born)[0];
    const st = AIL[a.key].stages[a.stage], want = st.treat[a.step], steps = knownSteps(b, a.key, a.stage);
    if (tool !== want) {
      if (stats) { stats.health = clamp(stats.health - 2.5); stats.soul = clamp(stats.soul - 1); }
      const t = b.tried[triedKey(a, a.step)] = b.tried[triedKey(a, a.step)] || [];
      if (!t.includes(tool)) t.push(tool);
      b.log.push({ t: b.t, wrong: tool, on: a.key, part });
      return { ok: false, why: 'wrong', affliction: a, step: a.step };
    }
    if (b.tools[tool] > 0) b.tools[tool]--;
    const step = a.step, discovered = !steps[step];
    steps[step] = true; b.known[a.key].named = true;
    a.step++;
    if (a.step >= st.treat.length) { // treated: from now on it heals
      a.phase = 'healing'; a.heal = 0; a.progress = 0;
      b.log.push({ t: b.t, cured: a.key, part, stage: a.stage });
      return { ok: true, cured: true, affliction: a, step, discovered };
    }
    return { ok: true, cured: false, affliction: a, next: a.step, step, discovered };
  }

  // what may be shown of an affliction: its name if known, the look of it (you can see that), each step of its
  // treatment (the tool if known, which are done, which is next, the wrong tools tried there), and the pilgrims'
  // note once the whole stage is known
  // A healing affliction also says how far it has healed and how long it has left; a benign one shows its benign form.
  function chart(b, a) {
    const A = AIL[a.key], st = A.stages[a.stage], k = upgrade(b).known[a.key], steps = (k && k.stages[a.stage]) || st.treat.map(() => false);
    if (!active(a)) {
      const left = a.phase === 'benign' ? (1 - a.heal) * HEAL.benign : (a.stage + 1 - a.heal) * HEAL.stage + HEAL.benign;
      return {
        id: a.id, key: a.key, part: a.part, phase: a.phase, named: true, name: a.phase === 'benign' ? A.benign.name : A.name,
        stage: a.stage, stages: A.stages.length, stageName: st.name, look: a.phase === 'benign' ? A.benign.look : st.look,
        progress: a.heal, worsens: false, minutesLeft: left, steps: [], lore: null,
      };
    }
    return { phase: 'active',
      id: a.id, key: a.key, part: a.part, named: !!(k && k.named), name: k && k.named ? A.name : null,
      stage: a.stage, stages: A.stages.length, stageName: st.name, look: st.look, progress: a.progress, worsens: st.minutes > 0,
      steps: st.treat.map((tool, i) => ({ tool: steps[i] ? tool : null, done: i < a.step, now: i === a.step, tried: b.tried[`${a.key}:${a.stage}:${i}`] || [] })),
      lore: steps.every(Boolean) ? st.lore : null,
    };
  }

  const api = { HEAL, createBody, upgrade, roll, step, apply, chart, active };
  if (isNode) module.exports = api; else root.BodySim = api;
})(typeof window !== 'undefined' ? window : globalThis);
