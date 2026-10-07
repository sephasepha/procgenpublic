// Body simulation: afflictions on parts of the body that advance, drain you, spread, and are treated by exact
// sequences of tools. No DOM; tests/body.js runs it. Stats are the same object the camp uses (health, soul, hunger,
// thirst, exhaustion), so what you eat and what is eating you meet in one place.
//
// You do not know how to treat anything until you find out. What you have learnt is kept in the body's state:
//   known[ailment] = { named, stages: { [stage]: [step known, ...] } }   learnt by using the right tool at a step
//   tried['ailment:stage:step'] = [tools]                                 the wrong tools tried there
// An ailment is named once any step of it is known; a stage's pilgrims' note once all its steps are. chart() says
// what the screen may show of an affliction.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const D = isNode ? require('./data.js') : root;
  const PARTS = D.BODY_PARTS, TOOLS = D.BODY_TOOLS, AIL = D.BODY_AILMENTS;
  const clamp = v => Math.max(0, Math.min(100, v));

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

  // time passes: each affliction advances, drains the body, and from its later stages spreads to neighbouring parts
  function step(b, dt, stats) {
    b.t += dt;
    const m = dt / 60, born = [];
    b.afflictions.forEach(a => {
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
    const here = b.afflictions.filter(a => a.part === part);
    if (!here.length) return { ok: false, why: 'healthy' };
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
    if (a.step >= st.treat.length) {
      b.afflictions.splice(b.afflictions.indexOf(a), 1);
      b.log.push({ t: b.t, cured: a.key, part, stage: a.stage });
      return { ok: true, cured: true, affliction: a, step, discovered };
    }
    return { ok: true, cured: false, affliction: a, next: a.step, step, discovered };
  }

  // what may be shown of an affliction: its name if known, the look of it (you can see that), each step of its
  // treatment (the tool if known, which are done, which is next, the wrong tools tried there), and the pilgrims'
  // note once the whole stage is known
  function chart(b, a) {
    const A = AIL[a.key], st = A.stages[a.stage], k = upgrade(b).known[a.key], steps = (k && k.stages[a.stage]) || st.treat.map(() => false);
    return {
      id: a.id, key: a.key, part: a.part, named: !!(k && k.named), name: k && k.named ? A.name : null,
      stage: a.stage, stages: A.stages.length, stageName: st.name, look: st.look, progress: a.progress, worsens: st.minutes > 0,
      steps: st.treat.map((tool, i) => ({ tool: steps[i] ? tool : null, done: i < a.step, now: i === a.step, tried: b.tried[`${a.key}:${a.stage}:${i}`] || [] })),
      lore: steps.every(Boolean) ? st.lore : null,
    };
  }

  const api = { createBody, upgrade, roll, step, apply, chart };
  if (isNode) module.exports = api; else root.BodySim = api;
})(typeof window !== 'undefined' ? window : globalThis);
