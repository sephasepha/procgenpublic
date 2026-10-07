// Camp simulation: the fire, the vessels on it, and the body eating from them. No DOM; tests/camp.js runs it.
//
// The floor is a plane in metres (x across, z away from you); the fire pit is a ring at PIT.
// Fire: every piece of tinder, kindling or fuel has a temperature and a remaining mass. Burning pieces give off
// heat that warms their neighbours (radiation falls off with distance, conduction only at touching range), and
// a piece catches when it reaches its ignition temperature. Burning needs air: the more mass is packed around a
// piece, the less oxygen it gets, so heaping on kindling or fuel smothers the fire, and a cold log dropped on a
// small flame drains its heat away. A fire that goes out has to be laid and struck again.
// Cooking: a vessel's temperature follows the heat at its spot on the floor; ingredients cook while it is hot
// enough and scorch when it is too hot. A pot holds at a boil while it has water; dry, it climbs and scorches.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const DATA = isNode ? require('./data.js') : root;
  const FIRE = DATA.CAMP_FIRE, VESSELS = DATA.CAMP_VESSELS, ING = DATA.CAMP_INGREDIENTS, DISHES = DATA.CAMP_DISHES, STATS = DATA.CAMP_STATS;

  const PIT = { x: 0, z: 2.0, r: 0.34 };
  const AMBIENT = 12;
  const P = { // fire tuning: temperatures relax towards targets set by the flames around each piece
    reach: 0.07,        // a flame's heat halves at this distance (m)
    sink: 360,          // degrees a kilogram of cold, unlit mass at touching range takes off a piece's target
    sinkReach: 0.03,    // ...falling to half at this distance: a log laid on a flame drains it, one beside it hardly
    crowdR: 0.04,       // air: other material this close (m) takes half its weight's worth of a piece's air...
    airFor: 0.6,        // ...and this much packed mass (kg) halves it, more steeply beyond: stack things up and they smother
    demand: 2000,       // flame output (nearby flames included) that halves the air again: a big fire eats its own air
    airFull: 0.65,      // with at least this much air a piece burns at full vigour; less, it burns weaker
    airFall: 1.2,       // seconds for a piece's air to run down to what it can get...
    airRise: 3.5,       // ...and to come back when given room (a breath tops it up at once)
    catchAir: 0.4,      // needs at least this much air to catch
    outAir: 0.22,       // goes out below this much air
    outAt: 0.62,        // goes out when it cools below this share of its ignition temperature
    vesselReach: 0.12,  // a vessel feels flames to this distance (half-heat)
    ember: { tinder: 0.4, kindling: 0.6, fuel: 0.9 }, // a burnt-out piece glows at this share of its flame...
    emberLife: { tinder: 8, kindling: 40, fuel: 480 }, // ...fading over this many seconds: tinder and kindling leave
                        // embers that are soon gone; a log leaves coals, a bed that cooks and relights for minutes
    coalCook: 2.6,      // a bed of coals gives a vessel set on it this much more of its heat than its glow suggests
    breathLife: 1.3,    // a breath fades over this many seconds
    breathAir: 0.55,    // share of the missing air a full breath restores
    breathEmber: 1.6,   // embers glow this much brighter under a full breath (and burn down faster)
    breathHeat: 140,    // degrees a full breath adds to anything already warm
    breathMax: 1.6,     // breaths stack up to this; past 1 they only last longer
  };
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) / r;
  function createCamp(seed) {
    return {
      t: 0, seed: seed || 1, pieces: [], vessels: [], sparks: [],
      stats: { health: 82, soul: 64, hunger: 46, thirst: 42, exhaustion: 38 },
      stock: { tinder: 6, kindling: 12, fuel: 6, ash: 0, char: 0, ...Object.fromEntries(Object.keys(ING).map(k => [k, 2])) },
      log: [], nextId: 1,
    };
  }

  // ---------- fire ----------
  function placePiece(c, kind, x, z) {
    if (!FIRE[kind] || (!c.unlimitedFire && c.stock[kind] <= 0)) return null;
    if (!c.unlimitedFire) c.stock[kind]--;
    const k = FIRE[kind], p = { id: c.nextId++, kind, x, z, T: AMBIENT, m: k.mass, m0: k.mass, burning: false, ash: false, out: false, smoke: 0 };
    c.pieces.push(p); return p;
  }
  function movePiece(c, id, x, z) { const p = c.pieces.find(q => q.id === id); if (p) { p.x = x; p.z = z; } return p; }
  // an unburnt piece goes back in the kit; anything else is swept away
  function removePiece(c, id) {
    const k = c.pieces.findIndex(q => q.id === id); if (k < 0) return false;
    const p = c.pieces[k];
    if (p.ash && !p.spent) return false; // still glowing: too hot to pick up
    c.pieces.splice(k, 1);
    const got = residueOf(p);
    if (got.ash || got.char) { c.stock.ash = (c.stock.ash || 0) + got.ash; c.stock.char = (c.stock.char || 0) + got.char; return got; }
    if (!p.burning && p.m > p.m0 * 0.9 && !c.unlimitedFire) c.stock[p.kind]++;
    return true;
  }
  // What a piece leaves to keep: a cold heap of ash (more from a log, and a lump of char where its coals went out),
  // or char from a piece that was put out half-burnt. Burning pieces and glowing coals cannot be taken.
  const ASH_YIELD = { tinder: 0, kindling: 1, fuel: 2 };
  function residueOf(p) {
    if (p.spent) return { ash: ASH_YIELD[p.kind], char: p.coal ? 1 : 0 };
    if (!p.ash && !p.burning && p.kind !== 'tinder' && p.T < 60 && 1 - p.m / p.m0 >= 0.2) return { ash: 0, char: 1 };
    return { ash: 0, char: 0 };
  }
  // take what can be kept from a piece (ash heap, coal remains, half-burnt char): null if there is nothing yet
  function collect(c, id) {
    const p = c.pieces.find(q => q.id === id); if (!p) return null;
    const got = residueOf(p); if (!got.ash && !got.char) return null;
    removePiece(c, id); return got;
  }
  // strike over a point: sparks heat the tinder there a lot, anything else a little
  function strike(c, x, z) {
    let hit = 0;
    c.pieces.forEach(p => {
      const d = Math.hypot(p.x - x, p.z - z); if (d > 0.14 || p.ash) return;
      const f = 1 - d / 0.14, k = p.kind === 'tinder' ? 260 : p.kind === 'kindling' ? 45 : 8;
      p.T += k * f; hit++;
    });
    c.sparks.push({ x, z, t: c.t });
    return hit;
  }
  // a burning piece's flame: its kind's flame heat, scaled by its vigour (air, and how hot it is running)
  // what a burnt-out piece leaves behind keeps glowing for a while: an ember bed that feeds logs and cooks food
  function output(p) { return p.burning ? FIRE[p.kind].flame * p.vigour : p.ash ? (p.ember || 0) : 0; }
  const breathed = (c, p) => output(p) * (p.ash ? 1 + P.breathEmber * Math.min(1, c.breath || 0) : 1); // embers under a breath
  // the air a piece can get: less the more material is packed close around it (by distance), and less the harder
  // the flames at and around it are burning. Each piece's air drifts towards this, so it runs down as a fire builds.
  function airAt(c, p, out) {
    let packed = 0, eat = 0;
    c.pieces.forEach((q, j) => {
      if (q === p) { eat += out[j]; return; }
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (!q.ash) packed += q.m * g(d, P.crowdR);
      if (out[j] > 0) eat += out[j] * g(d, P.crowdR * 1.5);
    });
    return 1 / (1 + (packed / P.airFor) ** 2 + eat / P.demand);
  }
  const g = (d, r) => 1 / (1 + (d / r) ** 2);
  function stepFire(c, dt) {
    const ps = c.pieces;
    // a breath: fresh air into the bed, embers flare, a smouldering piece can be coaxed back
    const br = Math.min(1, c.breath || 0);
    c.breath = (c.breath || 0) * Math.exp(-dt / P.breathLife);
    const out = ps.map(p => breathed(c, p));
    ps.forEach((p, i) => {
      if (p.vigour === undefined) p.vigour = 0;
      if (p.ash) { p.air = 1; p.airT = 1; return; }
      let t = airAt(c, p, out); if (br > 0) t += (1 - t) * br * P.breathAir;
      p.airT = t; if (p.air === undefined) p.air = t;
      p.air += (t - p.air) * Math.min(1, dt / (t < p.air ? P.airFall : P.airRise));
    });
    ps.forEach((p, i) => {
      if (p.ash) { p.T += (AMBIENT - p.T) * Math.min(1, dt * 0.05); p.ember = (p.ember || 0) * Math.exp(-dt * (1 + 2 * br) / P.emberLife[p.kind]); if (!p.spent && p.ember < (p.coal ? 60 : 6)) { p.spent = true; p.ember = 0; } return; }
      const k = FIRE[p.kind];
      // target temperature: the flames around it, its own flame, less what the cold mass around it soaks up
      let target = AMBIENT + out[i] * k.self + (br > 0 && p.T > k.ignite * 0.35 ? P.breathHeat * br : 0);
      ps.forEach((o, j) => {
        if (i === j || (o.ash && !(out[j] > 0))) return;
        const d = Math.hypot(p.x - o.x, p.z - o.z);
        if (out[j] > 0) target += out[j] * g(d, P.reach);
        else target -= P.sink * o.m * g(d, P.sinkReach) * Math.max(0, 1 - o.T / Math.max(1, p.T));
      });
      p.target = Math.max(AMBIENT, Math.min(950, target));
      p.T += (p.target - p.T) * Math.min(1, dt / k.tau);
    });
    ps.forEach(p => {
      if (p.ash) return;
      const k = FIRE[p.kind];
      if (!p.burning && p.T >= k.ignite && p.air >= P.catchAir && p.m > 0) { p.burning = true; p.out = false; }
      if (p.burning && (p.T < k.ignite * (k.outAt || P.outAt) || p.air < P.outAir)) { p.burning = false; p.out = true; } // snuffed: it smoulders and smokes
      p.vigour = p.burning ? Math.min(1, p.air / P.airFull) * Math.min(1.25, Math.max(0.5, p.T / k.ignite)) : 0;
      p.m -= (p.burning ? k.burn * p.vigour : 0) * dt;
      p.smoke = Math.max(0, p.smoke - dt * 0.4) + (p.T > k.ignite * 0.45 && (!p.burning || p.air < 0.45) ? dt * 0.8 : 0);
      if (p.m <= 0.002) { p.m = 0; p.burning = false; p.ash = true; p.vigour = 0; p.ember = k.flame * P.ember[p.kind]; p.coal = p.kind === 'fuel'; }
    });
    c.sparks = c.sparks.filter(s => c.t - s.t < 0.6);
    c.pieces = c.pieces.filter(p => !(p.spent && p.kind === 'tinder')); // burnt tinder leaves nothing worth keeping
  }
  // heat at a point on the floor (what a vessel feels), and the fire's total output
  function heatAt(c, x, z) {
    let h = 0; c.pieces.forEach(p => { const o = breathed(c, p) * (p.coal ? P.coalCook : 1); if (o > 0) h += o * g(Math.hypot(p.x - x, p.z - z), P.vesselReach); });
    return h;
  }
  const fireOutput = c => c.pieces.reduce((a, p) => a + breathed(c, p), 0);
  const burning = c => c.pieces.some(p => p.burning);

  // blow on the fire: air for a choking fire, a flare for embers, a second chance for something smouldering. Tiring.
  function blow(c) {
    c.breath = Math.min(P.breathMax, (c.breath || 0) + 0.7);
    c.pieces.forEach(p => { if (!p.ash && p.air !== undefined) p.air += (1 - p.air) * 0.35; }); // fresh air, at once
    applyStats(c, { exhaustion: 0.5 });
    return c.breath;
  }

  // what laying a piece at (x, z) would do: how much heat reaches it from the flames there (will it catch, or is it
  // too far), how much air it would get, and which burning pieces it would crowd into choking
  function preview(c, kind, x, z) {
    const k = FIRE[kind]; if (!k) return null;
    const ps = c.pieces, out = ps.map(p => breathed(c, p)), probe = { x, z, m: k.mass };
    let heat = AMBIENT; ps.forEach((o, j) => { if (out[j] > 0) heat += out[j] * g(Math.hypot(x - o.x, z - o.z), P.reach); });
    const air = airAt({ pieces: ps }, probe, out);
    const withIt = { pieces: [...ps, { x, z, m: k.mass, ash: false }] }, out2 = [...out, 0];
    const smothers = ps.filter(p => p.burning && airAt(withIt, p, out2) < Math.min(0.4, airAt(c, p, out) - 0.12)).map(p => p.id);
    const lit = ps.some(p => p.burning);
    return { heat, ignite: k.ignite, catches: heat >= k.ignite, warm: heat >= k.ignite * 0.6, air, smothers, lit };
  }

  // how the fire is doing, for the gauge: strength (0 snuffed .. 1 roaring), air (how freely it breathes),
  // fuel (seconds of burning left in what is lit or laid in the pit), what is showing (flame, embers, smoke),
  // and a one-word state with what to do about it.
  function fireState(c) {
    const ps = c.pieces, out = fireOutput(c);
    const lit = ps.filter(p => p.burning), smoulder = ps.filter(p => !p.burning && !p.ash && p.T > FIRE[p.kind].ignite * 0.45);
    const embers = ps.reduce((a, p) => a + (p.ash ? p.ember || 0 : 0), 0), coals = ps.reduce((a, p) => a + (p.coal ? p.ember || 0 : 0), 0), smoke = ps.reduce((a, p) => a + (p.smoke || 0), 0);
    const flame = lit.reduce((a, p) => a + output(p), 0);
    const hot = [...lit, ...smoulder];
    // the air the flames are getting (weighted by how much each gives), or what something smouldering is getting
    const wOf = p => p.burning ? output(p) + 1 : p.m, airOf = p => p.air === undefined ? 1 : p.air;
    const air = hot.length ? hot.reduce((a, p) => a + airOf(p) * wOf(p), 0) / Math.max(1e-6, hot.reduce((a, p) => a + wOf(p), 0)) : 1;
    const inPit = p => !p.ash && Math.hypot(p.x - PIT.x, p.z - PIT.z) < PIT.r * 1.15;
    const fuel = ps.reduce((a, p) => a + (p.burning ? p.m / (FIRE[p.kind].burn * Math.max(0.4, p.vigour)) : inPit(p) ? p.m / (FIRE[p.kind].burn * 0.8) : 0), 0);
    const strength = 1 - Math.exp(-out / 1600);
    c.trendOut = c.trendOut === undefined ? out : c.trendOut + (out - c.trendOut) * 0.05;
    const trend = out > c.trendOut * 1.06 + 5 ? 1 : out < c.trendOut * 0.94 - 5 ? -1 : 0;
    let state, hint;
    if (!lit.length) {
      if (coals > 40) { state = 'Coals'; hint = 'A bed of coals: steady heat to cook on. Lay fuel on it to bring it back.'; }
      else if (embers > 40) { state = 'Embers'; hint = 'Still glowing. Lay kindling on the embers and blow.'; }
      else if (smoulder.length) { state = 'Smouldering'; hint = air < 0.45 ? 'Smothered. Take something off, then blow.' : 'Nearly there. Blow on it.'; }
      else if (ps.some(p => p.out && !p.ash)) { state = 'Snuffed out'; hint = 'Too much at once smothered it. Clear some off, lay tinder and strike again.'; }
      else if (ps.some(p => !p.ash)) { state = 'Cold'; hint = ps.some(p => p.kind === 'tinder' && !p.ash) ? 'Strike over the tinder.' : 'It needs tinder to catch.'; }
      else { state = 'Empty pit'; hint = 'Lay tinder in the ring, kindling around it.'; }
    } else if (air < 0.45) { state = 'Choking'; hint = 'Packed too tight to breathe. Blow, or pull something away.'; }
    else if (air < P.airFull) { state = 'Short of air'; hint = 'It wants air. Blow on it, or give it more room.'; }
    else if (strength < 0.3) { state = 'Catching'; hint = 'Feed it kindling, a little at a time.'; }
    else if (fuel < 25) { state = 'Starving'; hint = 'It is burning through. Add fuel soon.'; }
    else if (strength > 0.82) { state = 'Roaring'; hint = 'Hot. Pull food back from the flames.'; }
    else { state = 'Burning steady'; hint = 'Good. Keep it fed.'; }
    // when a breath would help: a lit fire short of air, something smouldering, or embers with something to light
    const needsAir = (lit.length > 0 && air < P.airFull) || smoulder.length > 0 || (embers > 40 && ps.some(p => !p.ash && !p.burning && p.kind !== 'fuel'));
    return { needsAir, airFull: P.airFull, chokeAt: 0.45, strength, out, air, fuel, flame: Math.min(1, flame / 1500), embers: Math.min(1, embers / 400), coals: Math.min(1, coals / 400), smoke: Math.min(1, smoke / 2), breath: Math.min(1, c.breath || 0), trend, state, hint, lit: lit.length };
  }

  // ---------- vessels and cooking ----------
  function placeVessel(c, type, x, z) {
    if (!VESSELS[type] || c.vessels.some(v => v.type === type)) return null;
    const v = { id: c.nextId++, type, x, z, T: AMBIENT, water: 0, items: [], scorch: 0 };
    c.vessels.push(v); return v;
  }
  function moveVessel(c, id, x, z) { const v = c.vessels.find(q => q.id === id); if (v) { v.x = x; v.z = z; } return v; }
  function addToVessel(c, id, ing) {
    const v = c.vessels.find(q => q.id === id), I = ING[ing];
    if (!v || !I || c.stock[ing] <= 0) return false;
    if (I.only && !I.only.includes(v.type)) return false;
    if (v.items.length >= VESSELS[v.type].cap) return false;
    c.stock[ing]--;
    if (I.water) v.water += 1;
    v.items.push({ id: ing, progress: 0, scorch: 0 });
    return true;
  }
  // A pot is two vessels. Dry, it is a Dutch oven: it runs hot and scorches what is in it sooner than a pan.
  // With water it holds at the boil and nothing burns while the water lasts; once everything in it is cooked,
  // simmering brings it together as a stew (STEW_TIME seconds at the boil). Until then the risk is the water
  // boiling away; a stew holds its water better.
  const STEW_TIME = 25;
  function stepVessels(c, dt) {
    c.vessels.forEach(v => {
      const V = VESSELS[v.type], h = heatAt(c, v.x, v.z), dry = V.boils && !(v.water > 0);
      const eq = AMBIENT + h * V.gain; // where the vessel would settle with nothing to hold it back
      // iron holds its heat: it warms at its own pace but cools far more slowly (coolTau)
      v.T += (eq - v.T) * Math.min(1, dt / (eq < v.T ? V.coolTau || V.tau : V.tau));
      // at the boil the water takes the heat and goes: a gentle simmer (just enough heat to boil) loses little,
      // a pot over the flames boils dry fast. Cooking at the boil is the same speed either way.
      if (V.boils && v.water > 0 && v.T >= 99.5) { v.water = Math.max(0, v.water - Math.max(0, eq - 100) * V.boilOff * dt); v.T = Math.min(v.T, 100); }
      v.T = Math.max(AMBIENT, v.T);
      const cookRate = Math.max(0, Math.min(1.5, (v.T - 68) / 55));
      const scorch = Math.max(0, v.T - (dry && V.dryBurnAt ? V.dryBurnAt : V.burnAt)) / 90 * (dry ? 1.6 : 1);
      v.items.forEach(it => {
        const I = ING[it.id];
        // a pan is thin iron on the coals: it heats fast, cooks fast and burns fast (speed)
        it.progress += cookRate / I.cook * dt * (V.speed || 1);
        if (!I.water) it.scorch += scorch * 0.06 * dt * (V.speed || 1);
      });
      v.scorch = v.items.length ? Math.max(...v.items.map(it => it.scorch)) : 0;
      if (V.boils && v.water > 0 && v.T >= 95 && !v.stewed) {
        const solids = v.items.filter(it => !ING[it.id].water);
        if (solids.length && solids.every(it => it.progress >= 1 && it.scorch < 0.35)) { v.stew = Math.min(1, (v.stew || 0) + dt / STEW_TIME); if (v.stew >= 1) v.stewed = true; }
      }
    });
  }
  // how a vessel's contents stand: raw / underdone / cooked / burnt, and the dish they make if any
  // A pot's water is a wager: one measure makes a rich, thick stew but little to boil away before it burns;
  // more is safer and thinner. Pot dishes match on what is in them, however much water.
  const RICHNESS = [null, { name: 'rich', q: 1.5 }, { name: 'thin', q: 1 }, { name: 'watery', q: 0.6 }];
  const recipeKey = (ids, pot) => { const k = ids.slice().sort(); return (pot ? k.filter((id, i) => !(ING[id].water && k.indexOf(id) !== i)) : k).join(','); };
  function judge(v) {
    if (!v.items.length) return { state: 'empty' };
    const minP = Math.min(...v.items.map(it => it.progress)), burnt = v.scorch >= 0.35, potV = !!VESSELS[v.type].boils;
    const ids = recipeKey(v.items.map(it => it.id), potV), dish = DISHES.find(d => d.vessel === v.type && recipeKey(d.items, potV) === ids);
    const waters = v.items.filter(it => ING[it.id].water).length, rich = potV && waters ? RICHNESS[Math.min(3, waters)] : null;
    const pot = VESSELS[v.type].boils, stew = pot && !!v.stewed && !burnt;
    // in a pot, a dish is a stew: it has to have come together, not just be cooked
    const ready = !burnt && minP >= 1 && (!pot || stew);
    return { state: burnt ? 'burnt' : stew ? 'stew' : minP >= 1 ? 'cooked' : minP >= 0.5 ? 'underdone' : 'raw', dish: dish && ready ? dish : null, possible: dish || null, stew, stewing: pot && !stew ? (v.stew || 0) : 0, richness: rich ? rich.name : null, quality: rich ? rich.q : 1, waters };
  }
  // eat everything in a vessel: raw effects fade into cooked effects as it cooks; burnt food hurts
  function eat(c, id) {
    const k = c.vessels.findIndex(q => q.id === id); if (k < 0) return null;
    const v = c.vessels[k], j = judge(v); if (j.state === 'empty') return null;
    const fx = Object.fromEntries(STATS.map(s => [s, 0]));
    v.items.forEach(it => {
      const I = ING[it.id], w = Math.max(0, Math.min(1, it.progress));
      STATS.forEach(s => { fx[s] += (I.raw[s] || 0) * (1 - w) + (I.cooked[s] || 0) * w; });
      if (it.scorch >= 0.35) { STATS.forEach(s => { fx[s] *= 0.75; }); fx.health -= 8 * Math.min(2, it.scorch); fx.thirst += 4; }
    });
    // a dish, or any stew, is worth more the richer it is
    if (j.dish) STATS.forEach(s => { fx[s] += (j.dish.bonus[s] || 0) * (j.stew ? j.quality : 1); });
    else if (j.stew) { const q = j.quality; fx.hunger -= 6 * q; fx.thirst -= 8 * q; fx.soul += 2 * q; if (j.richness === 'rich') fx.health += 3; }
    applyStats(c, fx);
    v.items = []; v.water = 0; v.scorch = 0; v.stew = 0; v.stewed = false;
    c.log.push({ t: c.t, ate: j.dish ? j.dish.name : j.state, fx });
    return { fx, judged: j };
  }
  function removeVessel(c, id) { const k = c.vessels.findIndex(q => q.id === id); if (k < 0) return false; c.vessels.splice(k, 1); return true; }

  // ---------- the body ----------
  function applyStats(c, fx) { STATS.forEach(s => { c.stats[s] = Math.max(0, Math.min(100, c.stats[s] + (fx[s] || 0))); }); }
  function stepBody(c, dt) {
    const m = dt / 60, warm = burning(c), S = c.stats;
    S.hunger += 2.4 * m; S.thirst += 3.2 * m;
    S.exhaustion += (warm ? -2.5 : 1.2) * m;   // resting by a fire restores you; the cold dark does not
    S.soul += (warm ? 0.8 : -1.0) * m;
    if (S.hunger > 85) S.health -= 1.5 * m;
    if (S.thirst > 85) S.health -= 2.5 * m;
    if (S.soul < 10) S.health -= 1 * m;
    if (S.hunger < 50 && S.thirst < 50) S.health += 0.6 * m;
    STATS.forEach(s => { S[s] = Math.max(0, Math.min(100, S[s])); });
  }
  // rummage in the sack: a few things turn up, and it tires you
  function forage(c) {
    let r = (c.seed * 9301 + c.nextId * 49297 + Math.floor(c.t * 7)) % 233280;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    const keys = Object.keys(c.stock), got = [];
    for (let k = 0; k < 4; k++) { const key = keys[Math.floor(rnd() * keys.length)]; c.stock[key]++; got.push(key); }
    c.stock.tinder += 1; c.stock.kindling += 2; got.push('tinder', 'kindling');
    applyStats(c, { exhaustion: 7, hunger: 2, thirst: 2 });
    c.nextId++;
    return got;
  }

  function step(c, dt) { c.t += dt; stepFire(c, dt); stepVessels(c, dt); stepBody(c, dt); }

  const api = { CAMP_PIT: PIT, CAMP_TUNING: P, createCamp, placePiece, movePiece, removePiece, strike, step, heatAt, fireOutput, burning, placeVessel, moveVessel, addToVessel, removeVessel, judge, eat, forage, applyStats, blow, fireState, preview, collect, residueOf };
  if (isNode) module.exports = api; else root.CampSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
