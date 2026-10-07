// Camp cooking: the pot, pan and skewer, how their contents cook and burn, how a pot of water becomes a stew,
// what a vessel's contents amount to (judge), and what eating them does. No DOM; camp/sim.js runs it every step
// with the fire's heatAt, tests/camp.js and tests/camp-golden.js test it.
//
// A vessel (c.vessels[]) carries:
//   id, type ('pot' | 'pan' | 'skewer'), x, z     where it stands on the floor
//   T           its temperature                  water   measures of water left to boil away (pot)
//   items[]     { id, progress, scorch }          progress 1 = cooked; scorch at BURNT = burnt
//   scorch      the worst item's scorch          stew, stewed   how far a pot has come together as a stew
// Its type's properties (capacity, heat gain, heating and cooling times, burn points, boil-off, speed) are in
// camp/data.js (CAMP_VESSELS); everything else it runs on is in COOK below.
//
// Each step (stepVessels):
//   1. Temperature. A vessel heads for the heat where it stands (eq): warming at its own pace, cooling slowly.
//   2. Water. At the boil a pot holds at 100 degrees and the water takes the extra heat and boils away: a gentle
//      simmer loses little, a pot over the flames boils dry fast.
//   3. Cooking. Food cooks faster the hotter the vessel (from COOK.cookFrom degrees up) and scorches above the
//      vessel's burn point. A dry pot is a Dutch oven: it scorches sooner. A pan does both at its speed.
//   4. Stew. In a pot with water, once everything is cooked, simmering brings it together over COOK.stewTime.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const DATA = isNode ? require('./data.js') : root;
  const FIREMOD = isNode ? require('./fire.js') : root.CampFire;
  const VESSELS = DATA.CAMP_VESSELS, ING = DATA.CAMP_INGREDIENTS, DISHES = DATA.CAMP_DISHES, STATS = DATA.CAMP_STATS;
  const AMBIENT = FIREMOD.AMBIENT;

  // ---------- tuning ----------
  const COOK = {
    boil: 100,          // the boil (degrees)
    atBoil: 99.5,       // a pot this hot with water is at the boil
    stewHeat: 95,       // a stew comes together above this
    cookFrom: 68,       // food starts to cook above this...
    cookSpan: 55,       // ...at full rate this many degrees above it...
    cookMax: 1.5,       // ...and no faster than this
    scorchSpan: 90,     // scorch rate grows by one per this many degrees over the burn point...
    scorchRate: 0.06,   // ...times this
    dryScorch: 1.6,     // a dry pot scorches this much faster
    stewTime: 25,       // seconds at the boil, once all is cooked, for a stew to come together
    // what the contents amount to
    burnt: 0.35,        // scorch at which food is burnt
    underdone: 0.5,     // progress at which food is nearly cooked
    warming: 0.05,      // progress at which food has started to cook
    // one measure of water makes a rich stew, two a thin one, three or more a watery one
    richness: [null, { name: 'rich', q: 1.5 }, { name: 'thin', q: 1 }, { name: 'watery', q: 0.6 }],
    // eating
    burntKeep: 0.75,    // burnt food keeps this share of what it would have done...
    burntHurt: 8,       // ...and hurts this much health per unit of scorch (up to two)...
    burntThirst: 4,     // ...and leaves you this much thirstier
    stewBonus: { hunger: -6, thirst: -8, soul: 2 }, // any stew, scaled by its richness...
    richHealth: 3,      // ...and a rich one mends a little
  };

  // ---------- setting out and filling ----------
  function placeVessel(c, type, x, z) {
    if (!VESSELS[type] || c.vessels.some(v => v.type === type)) return null;
    const v = { id: c.nextId++, type, x, z, T: AMBIENT, water: 0, items: [], scorch: 0 };
    c.vessels.push(v);
    return v;
  }
  function moveVessel(c, id, x, z) {
    const v = c.vessels.find(q => q.id === id);
    if (v) { v.x = x; v.z = z; }
    return v;
  }
  function removeVessel(c, id) {
    const k = c.vessels.findIndex(q => q.id === id); if (k < 0) return false;
    c.vessels.splice(k, 1);
    return true;
  }
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

  // ---------- one step ----------
  function stepVessels(c, dt) {
    c.vessels.forEach(v => {
      const V = VESSELS[v.type], dry = V.boils && !(v.water > 0);
      // 1. temperature: towards the heat where it stands, warming at its own pace, cooling slowly
      const eq = AMBIENT + FIREMOD.heatAt(c, v.x, v.z) * V.gain;
      v.T += (eq - v.T) * Math.min(1, dt / (eq < v.T ? V.coolTau || V.tau : V.tau));
      // 2. water: at the boil it takes the extra heat and boils away
      if (V.boils && v.water > 0 && v.T >= COOK.atBoil) {
        v.water = Math.max(0, v.water - Math.max(0, eq - COOK.boil) * V.boilOff * dt);
        v.T = Math.min(v.T, COOK.boil);
      }
      v.T = Math.max(AMBIENT, v.T);
      // 3. cooking and scorching
      const cookRate = Math.max(0, Math.min(COOK.cookMax, (v.T - COOK.cookFrom) / COOK.cookSpan));
      const burnAt = dry && V.dryBurnAt ? V.dryBurnAt : V.burnAt;
      const scorch = Math.max(0, v.T - burnAt) / COOK.scorchSpan * (dry ? COOK.dryScorch : 1);
      v.items.forEach(it => {
        const I = ING[it.id];
        it.progress += cookRate / I.cook * dt * (V.speed || 1);
        if (!I.water) it.scorch += scorch * COOK.scorchRate * dt * (V.speed || 1);
      });
      v.scorch = v.items.length ? Math.max(...v.items.map(it => it.scorch)) : 0;
      // 4. stew: a pot of cooked food, simmering, comes together
      if (V.boils && v.water > 0 && v.T >= COOK.stewHeat && !v.stewed) {
        const solids = v.items.filter(it => !ING[it.id].water);
        if (solids.length && solids.every(it => it.progress >= 1 && it.scorch < COOK.burnt)) {
          v.stew = Math.min(1, (v.stew || 0) + dt / COOK.stewTime);
          if (v.stew >= 1) v.stewed = true;
        }
      }
    });
  }

  // ---------- what it amounts to ----------
  // one item: 'raw' | 'cooking' | 'nearly' | 'done' | 'burnt' (the words the camp shows)
  function foodState(it) {
    return it.scorch >= COOK.burnt ? 'burnt' : it.progress >= 1 ? 'done' : it.progress >= COOK.underdone ? 'nearly' : it.progress > COOK.warming ? 'cooking' : 'raw';
  }
  // a recipe's key: its ingredients, sorted; in a pot, water counts once however much there is
  const recipeKey = (ids, pot) => {
    const k = ids.slice().sort();
    return (pot ? k.filter((id, i) => !(ING[id].water && k.indexOf(id) !== i)) : k).join(',');
  };
  // a vessel's contents: raw / underdone / cooked / stew / burnt, the dish they make (a pot's dish has to have
  // come together as a stew), how far a stew has come, and how rich it is
  function judge(v) {
    if (!v.items.length) return { state: 'empty' };
    const pot = !!VESSELS[v.type].boils;
    const minP = Math.min(...v.items.map(it => it.progress)), burnt = v.scorch >= COOK.burnt;
    const ids = recipeKey(v.items.map(it => it.id), pot);
    const dish = DISHES.find(d => d.vessel === v.type && recipeKey(d.items, pot) === ids);
    const waters = v.items.filter(it => ING[it.id].water).length;
    const rich = pot && waters ? COOK.richness[Math.min(3, waters)] : null;
    const stew = pot && !!v.stewed && !burnt;
    const ready = !burnt && minP >= 1 && (!pot || stew);
    const state = burnt ? 'burnt' : stew ? 'stew' : minP >= 1 ? 'cooked' : minP >= COOK.underdone ? 'underdone' : 'raw';
    return {
      state, dish: dish && ready ? dish : null, possible: dish || null,
      stew, stewing: pot && !stew ? (v.stew || 0) : 0,
      richness: rich ? rich.name : null, quality: rich ? rich.q : 1, waters,
    };
  }
  // what eating a vessel's contents does to you: raw effects fade into cooked ones as it cooks, burnt food hurts,
  // and a dish or any stew adds its bonus, worth more the richer it is. Empties the vessel; the camp applies fx.
  function eat(c, id) {
    const v = c.vessels.find(q => q.id === id); if (!v) return null;
    const j = judge(v); if (j.state === 'empty') return null;
    const fx = Object.fromEntries(STATS.map(s => [s, 0]));
    v.items.forEach(it => {
      const I = ING[it.id], w = Math.max(0, Math.min(1, it.progress));
      STATS.forEach(s => { fx[s] += (I.raw[s] || 0) * (1 - w) + (I.cooked[s] || 0) * w; });
      if (it.scorch >= COOK.burnt) {
        STATS.forEach(s => { fx[s] *= COOK.burntKeep; });
        fx.health -= COOK.burntHurt * Math.min(2, it.scorch);
        fx.thirst += COOK.burntThirst;
      }
    });
    if (j.dish) STATS.forEach(s => { fx[s] += (j.dish.bonus[s] || 0) * (j.stew ? j.quality : 1); });
    else if (j.stew) {
      const q = j.quality, B = COOK.stewBonus;
      fx.hunger += B.hunger * q; fx.thirst += B.thirst * q; fx.soul += B.soul * q;
      if (j.richness === 'rich') fx.health += COOK.richHealth;
    }
    v.items = []; v.water = 0; v.scorch = 0; v.stew = 0; v.stewed = false;
    return { fx, judged: j };
  }

  const api = { TUNING: COOK, placeVessel, moveVessel, removeVessel, addToVessel, stepVessels, foodState, judge, eat };
  if (isNode) module.exports = api; else root.CampCooking = api;
})(typeof window !== 'undefined' ? window : globalThis);
