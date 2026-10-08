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
  const PARTS = D.BODY_PARTS, TOOLS = D.BODY_TOOLS, AIL = D.BODY_AILMENTS, CAUSES = D.BODY_CAUSES;
  const clamp = v => Math.max(0, Math.min(100, v));
  const HEAL = { stage: 1.5, benign: 3 }; // minutes: to heal back one stage; as the benign form before it is gone
  const active = a => !a.phase;

  function createBody(seed) {
    return { t: 0, seed: seed || 7, n: 0, nextId: 1, afflictions: [], tools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.uses === Infinity ? -1 : t.uses])), log: [], history: [], known: {}, tried: {} };
  }
  // a body saved before discovery existed: everything is unknown
  function upgrade(b) {
    b.known = b.known || {}; b.tried = b.tried || {}; b.history = b.history || []; if (b.tools && b.tools.bandage === undefined) b.tools.bandage = 0;
    b.afflictions.forEach(a => { if (!b.history.some(h => h.id === a.id)) b.history.push({ id: a.id, t: a.born || 0, cause: 'unknown', key: a.key, part: a.part, peak: a.stage, status: a.phase || 'active', end: null }); });
    return b;
  }
  // the medical history: one record per affliction, newest first in chart order; kept after it is gone
  const record = (b, a) => b.history.find(h => h.id === a.id);
  const note = (b, a, patch) => { const h = record(b, a); if (h) Object.assign(h, patch); };
  function rnd(b) { // deterministic from the seed and how many rolls have been made
    let h = Math.imul(b.seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(++b.n, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  const partsFor = key => AIL[key].parts === 'any' ? Object.keys(PARTS) : AIL[key].parts;
  const has = (b, key, part) => b.afflictions.some(a => a.key === key && a.part === part);

  // roll on the ailment table: a new affliction at its first stage, somewhere it can take hold
  function roll(b, key, part, cause, from) {
    const keys = Object.keys(AIL);
    for (let tries = 0; tries < 20; tries++) {
      const k = key || keys[Math.floor(rnd(b) * keys.length)];
      const free = partsFor(k).filter(p => !has(b, k, p));
      if (!free.length) { if (key) return null; continue; }
      const p = part && free.includes(part) ? part : free[Math.floor(rnd(b) * free.length)];
      const a = { id: b.nextId++, key: k, part: p, stage: 0, progress: 0, step: 0, born: b.t };
      b.afflictions.push(a); b.log.push({ t: b.t, took: k, part: p });
      b.history.push({ id: a.id, t: b.t, cause: cause || 'unknown', from: from || null, key: k, part: p, peak: 0, status: 'active', end: null });
      return a;
    }
    return null;
  }

  // something happens to you: a cause (random if not given) leaves an affliction on a part (random if not given, or
  // another if it cannot take hold there). Returns the affliction, or null when nothing more can.
  function injure(b, cause, part) {
    const keys = Object.keys(CAUSES).filter(k => Object.keys(CAUSES[k].results).length);
    for (let tries = 0; tries < 12; tries++) {
      const c = cause && CAUSES[cause] && Object.keys(CAUSES[cause].results).length ? cause : keys[Math.floor(rnd(b) * keys.length)];
      const parts = part ? [part] : Object.keys(PARTS), p = parts[Math.floor(rnd(b) * parts.length)];
      const opts = Object.entries(CAUSES[c].results).filter(([k, w]) => partsFor(k).includes(p) && !has(b, k, p));
      if (!opts.length) { if (cause && part) return null; continue; }
      let r = rnd(b) * opts.reduce((s, o) => s + o[1], 0), pick = opts[0][0];
      for (const [k, w] of opts) { if ((r -= w) < 0) { pick = k; break; } }
      return roll(b, pick, p, c);
    }
    return null;
  }

  // a treated affliction heals: back down a stage at a time, then its benign form, then gone (returns false when gone)
  function heal(b, a, m) {
    a.heal += m * (a.dress ? a.dress.power : 1) / (a.phase === 'benign' ? HEAL.benign : HEAL.stage); // a good bandage speeds it
    if (a.heal < 1) return true;
    a.heal = 0;
    if (a.phase === 'healing' && a.stage > 0) { a.stage--; b.log.push({ t: b.t, mending: a.key, part: a.part, stage: a.stage }); return true; }
    if (a.phase === 'healing') { a.phase = 'benign'; note(b, a, { status: 'benign' }); b.log.push({ t: b.t, benign: a.key, part: a.part }); return true; }
    note(b, a, { status: 'healed', end: b.t }); b.log.push({ t: b.t, healed: a.key, part: a.part });
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
        if (a.progress >= 1 && a.stage < A.stages.length - 1) { a.stage++; a.progress = 0; a.step = 0; a.dress = null; note(b, a, { peak: a.stage }); b.log.push({ t: b.t, worse: a.key, part: a.part, stage: a.stage }); }
      }
      if (stats) Object.entries(st.drain).forEach(([s, v]) => { stats[s] = clamp(stats[s] + v * m); });
      if (st.spread > 0 && rnd(b) < st.spread * m) {
        const to = PARTS[a.part].adj.filter(p => partsFor(a.key).includes(p) && !has(b, a.key, p) && !born.some(n => n.key === a.key && n.part === p));
        if (to.length) born.push({ key: a.key, part: to[Math.floor(rnd(b) * to.length)], from: a.part });
      }
    });
    born.forEach(n => { const a = roll(b, n.key, n.part, 'spread', n.from); if (a) b.log.push({ t: b.t, spread: n.key, from: n.from, to: n.part }); });
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
    const eff = tool === 'bandage' ? 'gauze' : tool; // a boiled bandage binds like gauze
    if (eff !== want) {
      if (stats) { stats.health = clamp(stats.health - 2.5); stats.soul = clamp(stats.soul - 1); }
      const t = b.tried[triedKey(a, a.step)] = b.tried[triedKey(a, a.step)] || [];
      if (!t.includes(tool)) t.push(tool);
      b.log.push({ t: b.t, wrong: tool, on: a.key, part });
      return { ok: false, why: 'wrong', affliction: a, step: a.step };
    }
    if (b.tools[tool] > 0) b.tools[tool]--;
    const step = a.step, discovered = !steps[step];
    steps[step] = true; b.known[a.key].named = true;
    if (tool === 'bandage' && ctx && ctx.bandage) { a.dress = { ...ctx.bandage }; note(b, a, { dressed: ctx.bandage.name, tier: ctx.bandage.tier }); } // what it was boiled in goes into the wound
    a.step++;
    if (a.step >= st.treat.length) { // treated: from now on it heals
      a.phase = 'healing'; a.heal = 0; a.progress = 0; note(b, a, { status: 'healing', treatedAt: b.t });
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
      const pw = a.dress ? a.dress.power : 1, left = (a.phase === 'benign' ? (1 - a.heal) * HEAL.benign : (a.stage + 1 - a.heal) * HEAL.stage + HEAL.benign) / pw;
      return {
        id: a.id, key: a.key, part: a.part, phase: a.phase, named: true, name: a.phase === 'benign' ? A.benign.name : A.name,
        stage: a.stage, stages: A.stages.length, stageName: st.name, look: a.phase === 'benign' ? A.benign.look : st.look,
        progress: a.heal, worsens: false, minutesLeft: left, steps: [], lore: null, dress: a.dress || null,
      };
    }
    return { phase: 'active',
      id: a.id, key: a.key, part: a.part, named: !!(k && k.named), name: k && k.named ? A.name : null,
      stage: a.stage, stages: A.stages.length, stageName: st.name, look: st.look, progress: a.progress, worsens: st.minutes > 0,
      steps: st.treat.map((tool, i) => ({ tool: steps[i] ? tool : null, done: i < a.step, now: i === a.step, tried: b.tried[`${a.key}:${a.stage}:${i}`] || [] })),
      lore: steps.every(Boolean) ? st.lore : null,
    };
  }

  // the medical history for reading: newest first, "Blunt impact, chest", what it became and how it stands. An affliction
  // you have not yet worked out is only "Unknown affliction"; once treated its name is known.
  function history(b) {
    upgrade(b);
    return b.history.slice().reverse().map(h => {
      const A = AIL[h.key], k = b.known[h.key], named = !!(k && k.named) || h.status !== 'active', C = CAUSES[h.cause] || CAUSES.unknown;
      const text = h.cause === 'spread' && h.from ? `Spread from ${PARTS[h.from].site}, ${PARTS[h.part].site}` : h.cause === 'unknown' ? `Unknown cause, ${PARTS[h.part].site}` : `${C.name}, ${PARTS[h.part].site}`;
      const live = b.afflictions.find(a => a.id === h.id);
      return { id: h.id, t: h.t, text, status: h.status, end: h.end, treatedAt: h.treatedAt || null, peak: h.peak, stages: A.stages.length,
        dressed: h.dressed || null, tier: h.tier || null,
        name: named ? (h.status === 'benign' ? A.benign.name : A.name) : null, became: named && h.status !== 'active' ? A.benign.name : null, stage: live ? live.stage : null };
    });
  }

  const api = { history, HEAL, createBody, upgrade, roll, injure, step, apply, chart, active };
  if (isNode) module.exports = api; else root.BodySim = api;
})(typeof window !== 'undefined' ? window : globalThis);
