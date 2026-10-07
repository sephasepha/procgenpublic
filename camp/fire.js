// Camp fire: tinder, kindling and fuel laid on the floor, how they catch, burn, choke and go out, the breath
// that helps them, the coals and embers they leave, and the ash and char you can keep. No DOM; camp/sim.js
// runs it every step, tests/camp.js and tests/camp-golden.js test it.
//
// The floor is a plane in metres: x across, z away from you. The pit is a ring at PIT.
//
// A piece (c.pieces[]) goes through these states:
//   laid        burning false, ash false            cold or warming; catches at its ignition temperature
//   burning     burning true                        gives off flame, loses mass, needs air
//   smouldering out true, hot                       put out (too little air, or cooled), smokes; can catch again
//   glowing     ash true, ember > 0                 burnt out; tinder and kindling leave embers, a log leaves coals
//   cold        ash true, spent true                the glow has gone; a heap of ash (and char from coals) to keep
// and carries:
//   id, kind ('tinder' | 'kindling' | 'fuel'), x, z
//   T           temperature (degrees)        m, m0   mass now, mass when laid (kg)
//   air         air it is getting, 0..1      airT    the air it would settle at
//   vigour      how hard it burns, 0..1.25   target  the temperature it is heading for
//   smoke       smoke it is giving, 0..      ember   the glow left after burning out (flame units)
//   burning, out, ash, coal, spent           flags as above
//
// How it works, each step (stepFire):
//   1. Air. A piece's air falls with the mass packed close around it (by distance, steeply as it piles up) and
//      with how hard the flames at and around it burn. It runs down quickly and comes back slowly; a breath
//      tops it up.
//   2. Heat. A piece's temperature relaxes towards a target: its own flame, plus the flames around it (falling
//      off with distance), less what cold mass beside it soaks up (a cold log on a small flame drains it).
//   3. State. It catches when hot enough with enough air; it goes out when it cools or chokes; burning uses up
//      its mass; when the mass is gone it glows (embers, or coals from a log) and then goes cold.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const DATA = isNode ? require('./data.js') : root;
  const FIRE = DATA.CAMP_FIRE;

  const PIT = { x: 0, z: 2.0, r: 0.34 };
  const AMBIENT = 12;

  // ---------- tuning: every number the fire runs on ----------
  const T = {
    // heat
    reach: 0.07,        // a flame's heat halves at this distance (m)
    sink: 360,          // degrees a kilogram of cold, unlit mass at touching range takes off a piece's target
    sinkReach: 0.03,    // ...falling to half at this distance: a log laid on a flame drains it, one beside it hardly
    maxTarget: 950,     // no piece runs hotter than this
    // air
    crowdR: 0.04,       // other material this close (m) takes half its weight's worth of a piece's air...
    airFor: 0.6,        // ...and this much packed mass (kg) halves it, more steeply beyond: stack things up and they smother
    eatReach: 1.5,      // flames eat the air out to this many crowdR
    demand: 2000,       // flame output (nearby flames included) that halves the air again: a big fire eats its own air
    airFull: 0.65,      // with at least this much air a piece burns at full vigour; less, it burns weaker
    chokeAir: 0.45,     // below this much air a burning piece is choking (it smokes, the gauge says so)
    airFall: 1.2,       // seconds for a piece's air to run down to what it can get...
    airRise: 3.5,       // ...and to come back when given room (a breath tops it up at once)
    catchAir: 0.4,      // needs at least this much air to catch
    outAir: 0.22,       // goes out below this much air
    // burning
    outAt: 0.62,        // goes out when it cools below this share of its ignition temperature (unless its kind says)
    vigourMin: 0.5,     // a burning piece's vigour, from its temperature: at least this...
    vigourMax: 1.25,    // ...at most this
    burntOut: 0.002,    // mass (kg) below which a piece has burnt out
    smokeAt: 0.45,      // a piece hotter than this share of its ignition temperature smokes if unlit or choking...
    smokeRise: 0.8,     // ...this much a second...
    smokeFall: 0.4,     // ...and its smoke clears this fast
    // striking
    strikeReach: 0.14,  // sparks land within this distance (m) of the strike
    strikeHeat: { tinder: 260, kindling: 45, fuel: 8 }, // degrees they add, at the centre
    sparkLife: 0.6,     // seconds a strike's sparks are remembered (for drawing)
    // what is left
    ember: { tinder: 0.4, kindling: 0.6, fuel: 0.9 },   // a burnt-out piece glows at this share of its flame...
    emberLife: { tinder: 8, kindling: 40, fuel: 480 },  // ...fading over this many seconds: tinder and kindling leave
                        // embers that are soon gone; a log leaves coals, a bed that cooks and relights for minutes
    ashCool: 0.05,      // share of the way to ambient a glowing heap cools each second
    coldBelow: { embers: 6, coals: 60 }, // the glow below which embers, or coals, count as gone cold
    coalCook: 2.6,      // a bed of coals gives a vessel set on it this much more of its heat than its glow suggests
    vesselReach: 0.12,  // a vessel feels flames to this distance (half-heat)
    ashYield: { tinder: 0, kindling: 1, fuel: 2 },      // ash from a cold heap (a log's coals leave a char as well)
    charBurnt: 0.2,     // a piece put out with at least this share burnt is char
    charCold: 60,       // ...once it has cooled below this
    // breath
    breathLife: 1.3,    // a breath fades over this many seconds
    breathAdd: 0.7,     // one breath adds this much
    breathMax: 1.6,     // breaths stack up to this; past 1 they only last longer
    breathGulp: 0.35,   // a breath restores this share of every piece's missing air at once...
    breathAir: 0.55,    // ...and this share of what it would settle at, while it lasts
    breathEmber: 1.6,   // embers glow this much brighter under a full breath...
    breathBurn: 2,      // ...and burn down this many times faster
    breathHeat: 140,    // degrees a full breath adds to anything already warm...
    breathWarm: 0.35,   // ...that is, hotter than this share of its ignition temperature
    breathCost: 0.5,    // exhaustion a breath costs
    // placement preview
    warmShare: 0.6,     // a spot this share of the way to catching is "warm"
    smotherAir: 0.4,    // a piece laid so that a burning piece would drop below this much air...
    smotherDrop: 0.12,  // ...and lose at least this much, smothers it
  };
  // how the gauge reads the fire
  const GAUGE = {
    strengthScale: 1600, // output at which strength is 63% of the way to roaring
    flameScale: 1500, glowScale: 400, smokeScale: 2, // what counts as a full flame, glow, smoke
    glowShown: 40,       // embers or coals worth calling the fire's state
    starving: 25,        // seconds of fuel left below which a fire is starving
    catching: 0.3, roaring: 0.82, // strength bands
    trendRate: 0.05, trendUp: 1.06, trendDown: 0.94, trendFloor: 5, // the rising/falling arrow
    inPitReach: 1.15,    // laid pieces within this many pit radii count as fuel waiting
    fuelVigourMin: 0.4, fuelVigourLaid: 0.8, // vigour assumed when estimating time left
  };

  const fall = (d, r) => 1 / (1 + (d / r) ** 2); // a quantity that halves at distance r
  const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

  // ---------- laying, moving, taking away ----------
  function placePiece(c, kind, x, z) {
    if (!FIRE[kind] || (!c.unlimitedFire && c.stock[kind] <= 0)) return null;
    if (!c.unlimitedFire) c.stock[kind]--;
    const k = FIRE[kind];
    const p = { id: c.nextId++, kind, x, z, T: AMBIENT, m: k.mass, m0: k.mass, burning: false, ash: false, out: false, smoke: 0 };
    c.pieces.push(p);
    return p;
  }
  function movePiece(c, id, x, z) {
    const p = c.pieces.find(q => q.id === id);
    if (p) { p.x = x; p.z = z; }
    return p;
  }
  // take a piece away: an unburnt one goes back in the kit, a cold heap or a half-burnt one is kept as ash or
  // char, anything else is swept away. Glowing remains are too hot to pick up (false).
  function removePiece(c, id) {
    const k = c.pieces.findIndex(q => q.id === id); if (k < 0) return false;
    const p = c.pieces[k];
    if (p.ash && !p.spent) return false;
    c.pieces.splice(k, 1);
    const got = residueOf(p);
    if (got.ash || got.char) {
      c.stock.ash = (c.stock.ash || 0) + got.ash;
      c.stock.char = (c.stock.char || 0) + got.char;
      return got;
    }
    if (!p.burning && p.m > p.m0 * 0.9 && !c.unlimitedFire) c.stock[p.kind]++;
    return true;
  }

  // ---------- what a fire leaves to keep ----------
  // A cold heap of ash (more from a log, and a lump of char where its coals went out), or char from a piece put
  // out half-burnt. Burning pieces and glowing remains have nothing to take yet.
  function residueOf(p) {
    if (p.spent) return { ash: T.ashYield[p.kind], char: p.coal ? 1 : 0 };
    const halfBurnt = !p.ash && !p.burning && p.kind !== 'tinder' && p.T < T.charCold && 1 - p.m / p.m0 >= T.charBurnt;
    return halfBurnt ? { ash: 0, char: 1 } : { ash: 0, char: 0 };
  }
  // take what can be kept from a piece: null if there is nothing (yet)
  function collect(c, id) {
    const p = c.pieces.find(q => q.id === id); if (!p) return null;
    const got = residueOf(p); if (!got.ash && !got.char) return null;
    removePiece(c, id);
    return got;
  }

  // ---------- lighting and breathing ----------
  // strike over a point: sparks heat the tinder there a lot, anything else a little
  function strike(c, x, z) {
    let hit = 0;
    c.pieces.forEach(p => {
      const d = dist(p, x, z); if (d > T.strikeReach || p.ash) return;
      p.T += T.strikeHeat[p.kind] * (1 - d / T.strikeReach); hit++;
    });
    c.sparks.push({ x, z, t: c.t });
    return hit;
  }
  // blow on the fire: air for a choking fire, a flare for embers, a second chance for something smouldering.
  // Returns the breath; the cost to the body is applied by the camp (sim.js).
  function blow(c) {
    c.breath = Math.min(T.breathMax, (c.breath || 0) + T.breathAdd);
    c.pieces.forEach(p => { if (!p.ash && p.air !== undefined) p.air += (1 - p.air) * T.breathGulp; });
    return c.breath;
  }

  // ---------- output, air, heat ----------
  // a burning piece's flame is its kind's flame scaled by its vigour; a burnt-out one gives its glow
  function output(p) { return p.burning ? FIRE[p.kind].flame * p.vigour : p.ash ? (p.ember || 0) : 0; }
  // ...and glowing remains flare under a breath
  const breathed = (c, p) => output(p) * (p.ash ? 1 + T.breathEmber * Math.min(1, c.breath || 0) : 1);

  // the air a piece can get: less the more material is packed close around it, and less the harder the flames
  // at and around it burn. out[] is every piece's output this step.
  function airAt(c, p, out) {
    let packed = 0, eaten = 0;
    c.pieces.forEach((q, j) => {
      if (q === p) { eaten += out[j]; return; }
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (!q.ash) packed += q.m * fall(d, T.crowdR);
      if (out[j] > 0) eaten += out[j] * fall(d, T.crowdR * T.eatReach);
    });
    return 1 / (1 + (packed / T.airFor) ** 2 + eaten / T.demand);
  }

  // heat at a point on the floor: what a vessel set there feels (coals give theirs up well)
  function heatAt(c, x, z) {
    let h = 0;
    c.pieces.forEach(p => {
      const o = breathed(c, p) * (p.coal ? T.coalCook : 1);
      if (o > 0) h += o * fall(Math.hypot(p.x - x, p.z - z), T.vesselReach);
    });
    return h;
  }
  const fireOutput = c => c.pieces.reduce((a, p) => a + breathed(c, p), 0);
  const burning = c => c.pieces.some(p => p.burning);

  // ---------- one step ----------
  function stepFire(c, dt) {
    const ps = c.pieces;
    const br = Math.min(1, c.breath || 0);
    c.breath = (c.breath || 0) * Math.exp(-dt / T.breathLife);
    const out = ps.map(p => breathed(c, p));

    // 1. air: each piece drifts towards the air it can get (fast down, slow up; a breath adds to it)
    ps.forEach(p => {
      if (p.vigour === undefined) p.vigour = 0;
      if (p.ash) { p.air = 1; p.airT = 1; return; }
      let t = airAt(c, p, out);
      if (br > 0) t += (1 - t) * br * T.breathAir;
      p.airT = t;
      if (p.air === undefined) p.air = t;
      p.air += (t - p.air) * Math.min(1, dt / (t < p.air ? T.airFall : T.airRise));
    });

    // 2. heat: glowing remains cool and fade (then go cold); everything else heads for its target temperature
    ps.forEach((p, i) => {
      if (p.ash) { stepRemains(p, dt, br); return; }
      const k = FIRE[p.kind];
      let target = AMBIENT + out[i] * k.self + (br > 0 && p.T > k.ignite * T.breathWarm ? T.breathHeat * br : 0);
      ps.forEach((o, j) => {
        if (i === j || (o.ash && !(out[j] > 0))) return;
        const d = Math.hypot(p.x - o.x, p.z - o.z);
        if (out[j] > 0) target += out[j] * fall(d, T.reach);                                        // its flames
        else target -= T.sink * o.m * fall(d, T.sinkReach) * Math.max(0, 1 - o.T / Math.max(1, p.T)); // cold mass
      });
      p.target = Math.max(AMBIENT, Math.min(T.maxTarget, target));
      p.T += (p.target - p.T) * Math.min(1, dt / k.tau);
    });

    // 3. state: catch, go out, burn down, burn out
    ps.forEach(p => {
      if (p.ash) return;
      const k = FIRE[p.kind];
      if (!p.burning && p.T >= k.ignite && p.air >= T.catchAir && p.m > 0) { p.burning = true; p.out = false; }
      if (p.burning && (p.T < k.ignite * (k.outAt || T.outAt) || p.air < T.outAir)) { p.burning = false; p.out = true; }
      p.vigour = p.burning ? Math.min(1, p.air / T.airFull) * Math.min(T.vigourMax, Math.max(T.vigourMin, p.T / k.ignite)) : 0;
      p.m -= (p.burning ? k.burn * p.vigour : 0) * dt;
      const smoking = p.T > k.ignite * T.smokeAt && (!p.burning || p.air < T.chokeAir);
      p.smoke = Math.max(0, p.smoke - dt * T.smokeFall) + (smoking ? dt * T.smokeRise : 0);
      if (p.m <= T.burntOut) {
        p.m = 0; p.burning = false; p.ash = true; p.vigour = 0;
        p.ember = k.flame * T.ember[p.kind];
        p.coal = p.kind === 'fuel';
      }
    });

    c.sparks = c.sparks.filter(s => c.t - s.t < T.sparkLife);
    c.pieces = c.pieces.filter(p => !(p.spent && p.kind === 'tinder')); // burnt tinder leaves nothing worth keeping
  }
  // glowing remains: cool towards ambient, fade (faster under a breath), and go cold
  function stepRemains(p, dt, br) {
    p.T += (AMBIENT - p.T) * Math.min(1, dt * T.ashCool);
    p.ember = (p.ember || 0) * Math.exp(-dt * (1 + T.breathBurn * br) / T.emberLife[p.kind]);
    if (!p.spent && p.ember < (p.coal ? T.coldBelow.coals : T.coldBelow.embers)) { p.spent = true; p.ember = 0; }
  }

  // ---------- reading the fire ----------
  // what laying a piece at (x, z) would do: how much heat reaches it from the flames there (will it catch, or is
  // it too far), how much air it would get, and which burning pieces it would crowd into choking
  function preview(c, kind, x, z) {
    const k = FIRE[kind]; if (!k) return null;
    const ps = c.pieces, out = ps.map(p => breathed(c, p)), probe = { x, z, m: k.mass };
    let heat = AMBIENT;
    ps.forEach((o, j) => { if (out[j] > 0) heat += out[j] * fall(Math.hypot(x - o.x, z - o.z), T.reach); });
    const air = airAt({ pieces: ps }, probe, out);
    const withIt = { pieces: [...ps, { x, z, m: k.mass, ash: false }] }, out2 = [...out, 0];
    const smothers = ps.filter(p => p.burning && airAt(withIt, p, out2) < Math.min(T.smotherAir, airAt(c, p, out) - T.smotherDrop)).map(p => p.id);
    return { heat, ignite: k.ignite, catches: heat >= k.ignite, warm: heat >= k.ignite * T.warmShare, air, smothers, lit: ps.some(p => p.burning) };
  }

  // how the fire is doing, for the gauge: strength (0 snuffed .. 1 roaring), air (how freely it breathes), fuel
  // (seconds of burning left in what is lit or laid in the pit), what is showing (flame, embers or coals, smoke),
  // a one-word state with what to do about it, and whether a breath would help
  function fireState(c) {
    const ps = c.pieces, out = fireOutput(c);
    const lit = ps.filter(p => p.burning);
    const smoulder = ps.filter(p => !p.burning && !p.ash && p.T > FIRE[p.kind].ignite * T.smokeAt);
    const glow = ps.reduce((a, p) => a + (p.ash ? p.ember || 0 : 0), 0);
    const coals = ps.reduce((a, p) => a + (p.coal ? p.ember || 0 : 0), 0);
    const smoke = ps.reduce((a, p) => a + (p.smoke || 0), 0);
    const flame = lit.reduce((a, p) => a + output(p), 0);
    // the air the flames are getting (weighted by how much each gives), or what something smouldering is getting
    const hot = [...lit, ...smoulder];
    const wOf = p => p.burning ? output(p) + 1 : p.m, airOf = p => p.air === undefined ? 1 : p.air;
    const air = hot.length ? hot.reduce((a, p) => a + airOf(p) * wOf(p), 0) / Math.max(1e-6, hot.reduce((a, p) => a + wOf(p), 0)) : 1;
    // seconds of burning left: what is lit at its pace, and what is laid in the pit at an assumed one
    const inPit = p => !p.ash && Math.hypot(p.x - PIT.x, p.z - PIT.z) < PIT.r * GAUGE.inPitReach;
    const fuel = ps.reduce((a, p) => a + (p.burning ? p.m / (FIRE[p.kind].burn * Math.max(GAUGE.fuelVigourMin, p.vigour))
      : inPit(p) ? p.m / (FIRE[p.kind].burn * GAUGE.fuelVigourLaid) : 0), 0);
    const strength = 1 - Math.exp(-out / GAUGE.strengthScale);
    c.trendOut = c.trendOut === undefined ? out : c.trendOut + (out - c.trendOut) * GAUGE.trendRate;
    const trend = out > c.trendOut * GAUGE.trendUp + GAUGE.trendFloor ? 1 : out < c.trendOut * GAUGE.trendDown - GAUGE.trendFloor ? -1 : 0;

    let state, hint;
    if (!lit.length) {
      if (coals > GAUGE.glowShown) { state = 'Coals'; hint = 'A bed of coals: steady heat to cook on. Lay fuel on it to bring it back.'; }
      else if (glow > GAUGE.glowShown) { state = 'Embers'; hint = 'Still glowing. Lay kindling on the embers and blow.'; }
      else if (smoulder.length) { state = 'Smouldering'; hint = air < T.chokeAir ? 'Smothered. Take something off, then blow.' : 'Nearly there. Blow on it.'; }
      else if (ps.some(p => p.out && !p.ash)) { state = 'Snuffed out'; hint = 'Too much at once smothered it. Clear some off, lay tinder and strike again.'; }
      else if (ps.some(p => !p.ash)) { state = 'Cold'; hint = ps.some(p => p.kind === 'tinder' && !p.ash) ? 'Strike over the tinder.' : 'It needs tinder to catch.'; }
      else { state = 'Empty pit'; hint = 'Lay tinder in the ring, kindling around it.'; }
    } else if (air < T.chokeAir) { state = 'Choking'; hint = 'Packed too tight to breathe. Blow, or pull something away.'; }
    else if (air < T.airFull) { state = 'Short of air'; hint = 'It wants air. Blow on it, or give it more room.'; }
    else if (strength < GAUGE.catching) { state = 'Catching'; hint = 'Feed it kindling, a little at a time.'; }
    else if (fuel < GAUGE.starving) { state = 'Starving'; hint = 'It is burning through. Add fuel soon.'; }
    else if (strength > GAUGE.roaring) { state = 'Roaring'; hint = 'Hot. Pull food back from the flames.'; }
    else { state = 'Burning steady'; hint = 'Good. Keep it fed.'; }

    // a breath would help: a lit fire short of air, something smouldering, or a glow with something to light
    const needsAir = (lit.length > 0 && air < T.airFull) || smoulder.length > 0
      || (glow > GAUGE.glowShown && ps.some(p => !p.ash && !p.burning && p.kind !== 'fuel'));
    return {
      needsAir, airFull: T.airFull, chokeAt: T.chokeAir, strength, out, air, fuel,
      flame: Math.min(1, flame / GAUGE.flameScale), embers: Math.min(1, glow / GAUGE.glowScale), coals: Math.min(1, coals / GAUGE.glowScale),
      smoke: Math.min(1, smoke / GAUGE.smokeScale), breath: Math.min(1, c.breath || 0), trend, state, hint, lit: lit.length,
    };
  }

  const api = { PIT, AMBIENT, TUNING: T, GAUGE, placePiece, movePiece, removePiece, residueOf, collect, strike, blow, stepFire, heatAt, fireOutput, burning, preview, fireState };
  if (isNode) module.exports = api; else root.CampFire = api;
})(typeof window !== 'undefined' ? window : globalThis);
