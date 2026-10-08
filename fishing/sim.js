// Fishing: cast, wait, hook, fight, and (what is on the line is not a fish) the fight on the ledge. No DOM; the rules
// live here, the screen (fishing/fishing.js) only draws and sends the player's actions.
//
//   phase  idle -> waiting (line out, a shadow shows before the bite) -> bite (a moment to hook it) -> fight (reel,
//          ease off, keep the line from snapping) -> combat (it is on the ledge: strike, brace, or cut loose) -> result
// The player's side is passed in as ctx: { stats, stock, level, injure(cause), earn(skill, n) }, so the rules need
// no browser. Everything random comes from the angler's own seed, so a given run can be replayed.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const D = isNode ? require('./data.js') : root;
  const ZONES = D.FISH_ZONES, CR = D.FISH_CREATURES, T = D.FISH_TUNING, periodOf = D.fishPeriodOf;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function createAngler(seed) {
    return { s: (seed || 1) >>> 0, phase: 'idle', t: 0, dist: 0, zone: null, bait: null, creature: null, wait: 0, omen: false, biteT: 0,
      line: { hp: T.line, max: T.line }, tension: 0, reel: false, hookLoss: 0, stamina: 0, m: null, combat: null, cd: 0, brace: 0, braceCd: 0,
      result: null, events: [], tally: {} };
  }
  function rng(f) { f.s = (f.s + 0x6D2B79F5) >>> 0; let t = f.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  const between = (f, [a, b]) => a + (b - a) * rng(f);
  const say = (f, text, kind) => { f.events.push({ t: f.t, text, kind: kind || 'info' }); if (f.events.length > 40) f.events.shift(); };
  const zoneOf = d => ZONES.find(z => d <= z.max) || ZONES[ZONES.length - 1];
  const matches = (tags, likes, id) => (tags || []).filter(t => likes.includes(t)).length + (id && likes.includes(id) ? 2 : 0); // the exact bait counts for more than its kind

  // what takes the bait: by where it landed, the hour (some things only come at night), and what the bait is (a creature
  // that likes it is far likelier; the very thing it likes, far more so)
  function chooseCreature(f, dist, bait, hour) {
    const z = zoneOf(dist), per = periodOf(hour === undefined ? 12 : hour).k;
    const ws = Object.entries(CR).map(([k, c]) => [k, (c.zones[z.k] || 0) * (c.hours && c.hours[per] !== undefined ? c.hours[per] : 1) * (1 + 3 * matches(bait && bait.tags, c.likes, bait && bait.id))]).filter(([, w]) => w > 0);
    let r = rng(f) * ws.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of ws) if ((r -= w) < 0) return k;
    return ws[0][0];
  }

  // cast: power 0..1 is how far out. The bait (an ingredient: { id, tags }) is used up.
  function cast(f, power, bait, ctx) {
    if (f.phase !== 'idle') return false;
    f.dist = 0.18 + 0.82 * clamp(power, 0, 1); f.zone = zoneOf(f.dist).k;
    if (bait && ctx && ctx.stock && ctx.stock[bait.id] > 0) { ctx.stock[bait.id]--; f.bait = bait; } else f.bait = null;
    f.hour = ctx && ctx.hour !== undefined ? ctx.hour : 12; f.creature = chooseCreature(f, f.dist, f.bait, f.hour);
    const liked = f.bait && matches(f.bait.tags, CR[f.creature].likes, f.bait.id) > 0;
    f.wait = between(f, T.wait) * (f.bait ? T.waitBait : 1) * (liked ? T.waitLiked : 1);
    f.omen = false; f.phase = 'waiting'; f.t0 = f.t; f.result = null;
    say(f, `The line goes out into ${zoneOf(f.dist).name.toLowerCase()}.`);
    return true;
  }
  // how big the shadow under the bobber is, once it shows (0..1): a hint at what is coming
  const shadow = f => f.creature ? clamp(CR[f.creature].hp / 32, 0.15, 1) : 0;

  // hook: at the dip. Too soon and the line comes back bare.
  function hook(f, ctx) {
    if (f.phase === 'waiting') { f.phase = 'idle'; say(f, 'Too soon. The line comes back bare.', 'bad'); return false; }
    if (f.phase !== 'bite') return false;
    const c = CR[f.creature], lvl = (ctx && ctx.level) || 1;
    f.phase = 'fight'; f.line.max = f.line.hp = T.line + (lvl - 1) * T.linePerLevel; f.tension = 0.3; f.hookLoss = 0; f.stamina = c.stamina;
    f.m = { kind: null, t: 0, next: between(f, c.gap) }; f.reel = false;
    if (ctx && ctx.earn) ctx.earn('angling', 2);
    say(f, `Hooked. Something heavy turns under the water.`, 'warn');
    return true;
  }
  const setReel = (f, on) => { f.reel = !!on; };
  // wind it in without a bite (before it bites), or give up the line entirely
  function reelIn(f) { if (f.phase === 'waiting' || f.phase === 'bite') { f.phase = 'idle'; say(f, 'You wind in the line.'); return true; } return false; }
  function finish(f, kind, extra) { f.phase = 'result'; f.result = { kind, creature: f.creature, ...extra }; f.combat = null; f.reel = false; }
  function nextCast(f) { if (f.phase === 'result') { f.phase = 'idle'; f.result = null; f.creature = null; return true; } return false; }

  // the line, the creature and your hands: one step of the fight
  function fight(f, dt, ctx) {
    const c = CR[f.creature], m = f.m, tune = T.tension, tired = f.stamina <= 0;
    m.t -= dt;
    if (m.kind && m.t <= 0) { m.kind = null; m.next = between(f, c.gap) * (tired ? 1.6 : 1); }
    else if (!m.kind) { m.next -= dt; if (m.next <= 0 && !tired) { m.kind = c.moves[Math.floor(rng(f) * c.moves.length)]; m.t = between(f, T.surgeLen); say(f, ({ thrash: 'It thrashes.', dive: 'It dives, taking line.', gnaw: 'It gnaws at the line.' })[m.kind], 'warn'); } }
    const surging = !!m.kind && m.kind !== 'gnaw', pull = c.pull * (tired ? 0.3 : 1), now = surging ? pull : pull * tune.calmPull;
    const target = f.reel ? tune.reel + now * tune.surge : now * tune.free;
    f.tension += clamp(target - f.tension, -tune.rate * dt, tune.rate * dt);
    // it runs when it dives and you let it; you take it in when you reel
    if (m.kind === 'dive' && !f.reel) f.dist += T.run * (0.5 + pull) * dt;
    if (f.reel) f.dist -= T.reel * (tired ? 1 + T.reelTired : 1) * (1 - now * 0.6) * dt;
    // the line takes the strain
    if (f.tension > tune.danger) f.line.hp -= (f.tension - tune.danger) * T.lineDamage * dt;
    if (m.kind === 'gnaw') f.line.hp -= T.gnaw * dt;
    // it tires from surging and from being reeled in the sweet band; slack lets it shake the hook
    if (surging) f.stamina -= T.tire.surge * dt;
    if (f.reel && f.tension >= T.tire.band[0] && f.tension <= T.tire.band[1]) f.stamina -= T.tire.reel * dt;
    if (f.tension < tune.slack && !surging) f.hookLoss += T.hookLoss * dt; else f.hookLoss = Math.max(0, f.hookLoss - 0.4 * dt);
    f.stamina = Math.max(0, f.stamina);
    if (f.line.hp <= 0 || f.dist > T.farthest) { say(f, 'The line snaps.', 'bad'); return finish(f, 'lost', { why: 'snapped' }); }
    if (f.hookLoss >= 1) { say(f, 'It spits the hook and is gone.', 'bad'); return finish(f, 'lost', { why: 'spat' }); }
    if (f.dist <= T.land) startCombat(f, ctx);
  }

  function startCombat(f, ctx) {
    const c = CR[f.creature];
    f.phase = 'combat'; f.reel = false; f.cd = 0; f.brace = 0; f.braceCd = 0;
    f.combat = { hp: c.hp, max: c.hp, ph: 'idle', t: between(f, T.gapCombat) * (c.flies ? T.flyGap : 1), atk: null, near: !c.flies, hits: 0, parries: 0 };
    say(f, c.flies ? 'It comes up out of the water on a hundred small bones, and takes the air.' : `It comes up out of the water onto the ledge, and it is not a fish.`, 'bad');
    if (ctx && ctx.earn) ctx.earn('angling', 3);
  }
  // can you reach it? A flyer circles out of reach, and comes in only to attack (and when it has been parried)
  function reachable(f) { const c = CR[f.creature], k = f.combat; if (!c.flies) return true; return k.ph === 'recover' || (k.ph === 'windup' && k.t < k.atk.windup * T.flyWindup * T.near); }

  function combat(f, dt, ctx) {
    const c = CR[f.creature], k = f.combat;
    f.cd = Math.max(0, f.cd - dt); f.brace = Math.max(0, f.brace - dt); f.braceCd = Math.max(0, f.braceCd - dt);
    k.t -= dt;
    if (k.ph === 'idle' && k.t <= 0) { k.atk = c.atk[Math.floor(rng(f) * c.atk.length)]; k.ph = 'windup'; k.t = k.atk.windup * (c.flies ? T.flyWindup : 1); say(f, `It ${k.atk.name.replace(/ you$/, '')}…`, 'warn'); }
    else if (k.ph === 'windup' && k.t <= 0) landAttack(f, ctx);
    else if (k.ph === 'recover' && k.t <= 0) { k.ph = 'idle'; k.t = between(f, T.gapCombat) * (c.flies ? T.flyGap : 1); }
    k.near = reachable(f);
    if (ctx && ctx.stats && ctx.stats.health <= 0) { ctx.stats.health = 3; say(f, 'You go down. The water takes what you were holding.', 'bad'); finish(f, 'collapsed', {}); }
  }
  function landAttack(f, ctx) {
    const k = f.combat, a = k.atk, st = ctx && ctx.stats;
    if (f.brace > 0) { // braced: it hits a guard, and is left open
      k.parries++; if (st) { st.health = clamp(st.health - a.dmg * T.parried, 0, 100); }
      k.ph = 'recover'; k.t = T.recover; k.parried = true; say(f, 'You take it on your guard. It reels, open.', 'good'); if (ctx && ctx.earn) ctx.earn('angling', 2); return;
    }
    k.hits++; k.parried = false;
    if (st) { st.health = clamp(st.health - a.dmg, 0, 100); if (a.soul) st.soul = clamp(st.soul - a.soul, 0, 100); }
    say(f, `It ${a.name}: ${a.dmg} to your health${a.soul ? `, ${a.soul} to your soul` : ''}.`, 'bad');
    if (a.wound && rng(f) < a.wound && ctx && ctx.injure) { const w = ctx.injure(a.cause); if (w) say(f, 'It leaves something in the wound.', 'bad'); f.combat.wounds = (f.combat.wounds || 0) + (w ? 1 : 0); }
    k.ph = 'recover'; k.t = T.hit;
  }

  // strike: reach it, hurt it (a lot more while it is open)
  function strike(f, ctx) {
    if (f.phase !== 'combat' || f.cd > 0) return false;
    const k = f.combat, lvl = (ctx && ctx.level) || 1; f.cd = T.strikeCd;
    if (!reachable(f)) { say(f, 'It is out of reach.', 'info'); return { hit: false }; }
    let dmg = (T.strike + (lvl - 1) * T.perLevel) * (0.8 + 0.4 * rng(f)); if (k.ph === 'recover') dmg *= T.openingBonus;
    k.hp = Math.max(0, k.hp - dmg); say(f, k.ph === 'recover' ? 'A clean blow while it is open.' : 'You strike it.', 'good');
    if (k.hp <= 0) slay(f, ctx);
    return { hit: true, dmg };
  }
  function brace(f) { if (f.phase !== 'combat' || f.braceCd > 0) return false; f.brace = T.brace; f.braceCd = T.braceCd; return true; }
  function retreat(f) { if (f.phase !== 'combat') return false; say(f, 'You cut the line and back off. It slides back into the water.', 'info'); finish(f, 'fled', {}); return true; }
  function slay(f, ctx) {
    const c = CR[f.creature], n = Math.round(between(f, c.yield.n)), items = [{ id: c.yield.id, n }];
    if (ctx && ctx.stock) ctx.stock[c.yield.id] = (ctx.stock[c.yield.id] || 0) + n;
    f.tally[f.creature] = (f.tally[f.creature] || 0) + 1;
    if (ctx && ctx.earn) ctx.earn('angling', c.xp);
    say(f, `${c.name} dead. ${n} to take.`, 'good'); finish(f, 'caught', { items, hurt: f.combat ? f.combat.hits : 0 });
  }

  function step(f, dt, ctx) {
    f.t += dt;
    if (f.phase === 'waiting') {
      f.wait -= dt; f.omen = f.wait <= T.omen;
      if (f.wait <= 0) { f.phase = 'bite'; f.biteT = T.bite; say(f, 'The bobber dips.', 'warn'); }
    } else if (f.phase === 'bite') {
      f.biteT -= dt; if (f.biteT <= 0) { f.phase = 'idle'; say(f, 'It took the bait and was gone.', 'bad'); }
    } else if (f.phase === 'fight') fight(f, dt, ctx);
    else if (f.phase === 'combat') combat(f, dt, ctx);
  }

  const api = { createAngler, cast, hook, setReel, reelIn, strike, brace, retreat, nextCast, step, shadow, zoneOf, chooseCreature, reachable };
  if (isNode) module.exports = api; else root.FishSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
