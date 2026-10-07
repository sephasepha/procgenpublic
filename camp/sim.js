// Camp simulation: the camp as a whole. It holds the camp's state (createCamp), runs a step of the fire
// (camp/fire.js), the vessels on it (camp/cooking.js) and the body (here), and applies what blowing and eating
// do to you. No DOM. Everything the camp screen and the tests use is exported here as CampSim, unchanged
// whichever module does the work.
//
// A camp (createCamp) carries:
//   t, seed, nextId          time (s), the camp's seed, the next id for a piece or vessel
//   pieces[], sparks[]       the fire (see camp/fire.js)       breath   the last breath, fading
//   vessels[]                pots, pans, skewers (see camp/cooking.js)
//   stats                    health, soul, hunger, thirst, exhaustion (0..100)
//   stock                    what you carry: fire supplies, ingredients, ash and char
//   unlimitedFire            prototype setting: tinder, kindling and fuel never run out
//   log[]                    what you ate
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const DATA = isNode ? require('./data.js') : root;
  const F = isNode ? require('./fire.js') : root.CampFire;
  const K = isNode ? require('./cooking.js') : root.CampCooking;
  const ING = DATA.CAMP_INGREDIENTS, STATS = DATA.CAMP_STATS;

  // ---------- the body: how time and the fire treat you ----------
  const BODY = {
    hungerRate: 2.4, thirstRate: 3.2,       // a minute's worth
    restWarm: -2.5, restCold: 1.2,          // exhaustion a minute beside a burning fire, or in the cold dark
    soulWarm: 0.8, soulCold: -1.0,          // soul a minute, likewise
    starving: 85, starveHurt: 1.5,          // hunger above this costs health a minute
    parched: 85, thirstHurt: 2.5,           // thirst above this likewise
    soulless: 10, soulHurt: 1,              // soul below this likewise
    fed: 50, mend: 0.6,                     // fed and watered (both below this), you mend a little a minute
  };
  const FORAGE = { finds: 4, tinder: 1, kindling: 2, never: ['ash', 'char'], cost: { exhaustion: 7, hunger: 2, thirst: 2 } };

  function createCamp(seed) {
    return {
      t: 0, seed: seed || 1, pieces: [], vessels: [], sparks: [],
      stats: { health: 82, soul: 64, hunger: 46, thirst: 42, exhaustion: 38 },
      stock: { tinder: 6, kindling: 12, fuel: 6, ash: 0, char: 0, ...Object.fromEntries(Object.keys(ING).map(k => [k, 2])) },
      log: [], nextId: 1,
    };
  }
  function applyStats(c, fx) { STATS.forEach(s => { c.stats[s] = Math.max(0, Math.min(100, c.stats[s] + (fx[s] || 0))); }); }
  function stepBody(c, dt) {
    const m = dt / 60, warm = F.burning(c), S = c.stats, B = BODY;
    S.hunger += B.hungerRate * m; S.thirst += B.thirstRate * m;
    S.exhaustion += (warm ? B.restWarm : B.restCold) * m;
    S.soul += (warm ? B.soulWarm : B.soulCold) * m;
    if (S.hunger > B.starving) S.health -= B.starveHurt * m;
    if (S.thirst > B.parched) S.health -= B.thirstHurt * m;
    if (S.soul < B.soulless) S.health -= B.soulHurt * m;
    if (S.hunger < B.fed && S.thirst < B.fed) S.health += B.mend * m;
    STATS.forEach(s => { S[s] = Math.max(0, Math.min(100, S[s])); });
  }
  // rummage in the sack: a few things turn up, and it tires you
  function forage(c) {
    let r = (c.seed * 9301 + c.nextId * 49297 + Math.floor(c.t * 7)) % 233280;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    const keys = Object.keys(c.stock).filter(k => !FORAGE.never.includes(k)), got = []; // the sack holds no ash or char
    for (let k = 0; k < FORAGE.finds; k++) { const key = keys[Math.floor(rnd() * keys.length)]; c.stock[key]++; got.push(key); }
    c.stock.tinder += FORAGE.tinder; c.stock.kindling += FORAGE.kindling; got.push('tinder', 'kindling');
    applyStats(c, FORAGE.cost);
    c.nextId++;
    return got;
  }

  // ---------- what you do that costs or feeds you ----------
  function blow(c) { const b = F.blow(c); applyStats(c, { exhaustion: F.TUNING.breathCost }); return b; }
  function eat(c, id) {
    const r = K.eat(c, id); if (!r) return null;
    applyStats(c, r.fx);
    c.log.push({ t: c.t, ate: r.judged.dish ? r.judged.dish.name : r.judged.state, fx: r.fx });
    return r;
  }

  // ---------- one step: the fire, then what sits on it, then you ----------
  function step(c, dt) { c.t += dt; F.stepFire(c, dt); K.stepVessels(c, dt); stepBody(c, dt); }

  const api = {
    CAMP_PIT: F.PIT, CAMP_TUNING: F.TUNING, CAMP_GAUGE: F.GAUGE, CAMP_COOK: K.TUNING, CAMP_BODY: BODY,
    createCamp, step, applyStats, forage, blow, eat,
    // the fire
    placePiece: F.placePiece, movePiece: F.movePiece, removePiece: F.removePiece, residueOf: F.residueOf, collect: F.collect,
    strike: F.strike, heatAt: F.heatAt, fireOutput: F.fireOutput, burning: F.burning, preview: F.preview, fireState: F.fireState,
    // the vessels
    placeVessel: K.placeVessel, moveVessel: K.moveVessel, removeVessel: K.removeVessel, addToVessel: K.addToVessel, tend: K.tend,
    judge: K.judge, foodState: K.foodState, windowOf: K.windowOf,
  };
  if (isNode) module.exports = api; else root.CampSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
