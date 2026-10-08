// Fishing data: the pool's zones, the things that live in it, and how the fight is tuned. Nothing here is cozy: what
// bites is not a fish. Each creature has what it likes for bait (an ingredient's tags), where it lives, how hard it
// pulls on the line, how it fights once it is landed (its attacks, each with a cause that can wound you through the
// body screen), and what it gives (an ingredient). No DOM; tests/fishing.js tests the rules that use this.
(function (root) {
  // how far out a cast lands: 0 at the ledge, 1 at the far dark
  const ZONES = [
    { k: 'shallows', name: 'The Shallows', max: 0.38 },
    { k: 'dark', name: 'The Dark', max: 0.7 },
    { k: 'deep', name: 'The Deep', max: 1.01 },
  ];
  // the hours: the underdark has no sun, but the pilgrims keep a bell, and what lives in the pool keeps to it
  // (a day is `DAY` minutes of play). Creatures come more or less at each hour; the scene dims with the bell.
  const DAY = 20, START = 17;
  const PERIODS = [
    { k: 'dawn', name: 'Dawn Bell', from: 5, to: 9, light: 0.85 }, { k: 'day', name: 'Day', from: 9, to: 17, light: 1 },
    { k: 'dusk', name: 'Dusk', from: 17, to: 21, light: 0.75 }, { k: 'night', name: 'Night', from: 21, to: 29, light: 0.45 },
  ];
  const hourOf = seconds => (START + seconds / 60 / DAY * 24) % 24;
  const periodOf = h => PERIODS.find(p => (h >= p.from && h < p.to) || (h + 24 >= p.from && h + 24 < p.to)) || PERIODS[1];
  // look: how it is drawn (shape params for the screen); zones: weight where it lives; likes: bait tags;
  // hp/stamina: how much it takes to kill / tire it; pull: how hard it hauls; moves: what it does on the line;
  // gap: seconds between moves; atk: what it does to you once landed; flies: it leaves the water and takes the air
  const CREATURES = {
    blindShoal: { hours: { day: 2, night: 0.4 }, name: 'Blind Shoal-Thing', note: 'Pale and eyeless, and it sings as it dies. It does not know you are there.', zones: { shallows: 4 }, likes: ['grub', 'hymnGrub'], hp: 6, stamina: 6, pull: 0.3, moves: ['thrash'], gap: [2.5, 4],
      atk: [{ name: 'nips at you', windup: 0.9, dmg: 3, cause: 'thorns', wound: 0.12 }], yield: { id: 'hymnGrub', n: [1, 2] }, xp: 3,
      look: { len: 26, w: 7, color: '#d8d0c0', belly: '#a89c88', eyes: 0, teeth: 8, spikes: 0, tendrils: 0, glow: null } },
    thornLeech: { hours: { dawn: 1.5, dusk: 1.5 }, name: 'Thorn-Leech', note: 'It is mostly mouth, and the mouth has thorns.', zones: { shallows: 3, dark: 1 }, likes: ['meat', 'grub'], hp: 9, stamina: 8, pull: 0.35, moves: ['thrash', 'gnaw'], gap: [2.2, 3.5],
      atk: [{ name: 'latches on', windup: 0.8, dmg: 4, cause: 'thorns', wound: 0.55 }], yield: { id: 'thornLeech', n: [1, 1] }, xp: 5,
      look: { len: 28, w: 6, color: '#5a2e4a', belly: '#8a4a6a', eyes: 0, teeth: 14, spikes: 6, tendrils: 0, glow: null } },
    sporeCarp: { hours: { day: 1.6, dawn: 1.4, night: 0.5 }, name: 'Spore Carp', note: 'Bloated with grey bladders that breathe out when it is hurt.', zones: { shallows: 2, dark: 2 }, likes: ['fungus', 'sporeBladder'], hp: 12, stamina: 10, pull: 0.4, moves: ['thrash', 'dive'], gap: [2.2, 3.6],
      atk: [{ name: 'bursts a spore bladder', windup: 0.9, dmg: 3, cause: 'spores', wound: 0.5 }, { name: 'rams you', windup: 0.7, dmg: 5, cause: 'blunt', wound: 0.3 }], yield: { id: 'sporeBladder', n: [1, 2] }, xp: 7,
      look: { len: 34, w: 12, color: '#8a8a70', belly: '#c9c4a0', eyes: 2, teeth: 4, spikes: 0, tendrils: 4, glow: '#c9a35a' } },
    lanternGape: { hours: { dusk: 1.5, night: 3, day: 0.3 }, name: 'Lantern-Gape', note: 'A great mouth with a green lamp hung in front of it. The lamp is looking at you.', zones: { dark: 3, deep: 1 }, likes: ['sweet', 'eye', 'fruit', 'cometHoney', 'lanternEye'], hp: 14, stamina: 12, pull: 0.45, moves: ['dive', 'thrash'], gap: [2, 3.4],
      atk: [{ name: 'flashes its lamp', windup: 0.7, dmg: 2, soul: 8, cause: 'starlight', wound: 0.55 }, { name: 'gapes', windup: 1, dmg: 6, cause: 'blunt', wound: 0.2 }], yield: { id: 'lanternEye', n: [1, 1] }, xp: 10,
      look: { len: 36, w: 14, color: '#1e2a2a', belly: '#34504a', eyes: 1, teeth: 16, spikes: 3, tendrils: 1, glow: '#6fe0a0' } },
    abyssalEel: { hours: { dawn: 2, dusk: 2, day: 0.6 }, name: 'Abyssal Eel', note: 'It is longer than the corridor, and you have only pulled up the part that was not looking.', zones: { dark: 2, deep: 3 }, likes: ['meat', 'fish'], hp: 18, stamina: 14, pull: 0.6, moves: ['dive', 'thrash', 'gnaw'], gap: [1.8, 3],
      atk: [{ name: 'lashes out', windup: 0.8, dmg: 6, cause: 'blunt', wound: 0.4 }, { name: 'coils round you', windup: 1.1, dmg: 8, cause: 'blunt', wound: 0.6 }], yield: { id: 'eelSlice', n: [1, 2] }, xp: 14,
      look: { len: 52, w: 7, color: '#2a3a4a', belly: '#c9b8d8', eyes: 2, teeth: 10, spikes: 0, tendrils: 0, glow: null } },
    boneEel: { hours: { night: 3, dusk: 1.5, day: 0.2, dawn: 0.5 }, name: 'Bone Eel', note: 'Something dead that learned to swim, and then, with nothing left to stop it, to fly. A snake of small bones, singing in the air.', zones: { dark: 1, deep: 2 }, likes: ['bone', 'meat', 'marrow'], hp: 20, stamina: 12, pull: 0.5, moves: ['dive', 'thrash'], gap: [1.8, 3], flies: true,
      atk: [{ name: 'swoops at you', windup: 1.1, dmg: 6, cause: 'blunt', wound: 0.45 }, { name: 'rattles and sings', windup: 1.2, dmg: 3, soul: 9, cause: 'whispers', wound: 0.4 }], yield: { id: 'marrow', n: [2, 3] }, xp: 20,
      look: { len: 58, w: 5, color: '#e8e0c8', belly: '#a89c80', eyes: 2, teeth: 12, spikes: 0, tendrils: 0, glow: '#c0a0e0', bones: true } },
    ossuaryPike: { hours: { dawn: 2.5, day: 0.8, night: 1.2 }, name: 'Ossuary Pike', note: 'Bone-plated, and old. The plates are other people\'s.', zones: { deep: 3 }, likes: ['bone', 'meat'], hp: 24, stamina: 16, pull: 0.7, moves: ['dive', 'gnaw', 'thrash'], gap: [1.6, 2.8],
      atk: [{ name: 'rams you', windup: 0.9, dmg: 8, cause: 'blunt', wound: 0.55 }, { name: 'snaps its jaws', windup: 0.7, dmg: 7, cause: 'thorns', wound: 0.4 }], yield: { id: 'marrow', n: [1, 2] }, xp: 18,
      look: { len: 48, w: 10, color: '#8a8478', belly: '#c8c0a8', eyes: 2, teeth: 18, spikes: 8, tendrils: 0, glow: null } },
    weepingDrowner: { hours: { dusk: 2, night: 2.5, day: 0.2 }, name: 'Weeping Drowner', note: 'A pilgrim the water kept. It has been waiting for someone to pull.', zones: { deep: 2 }, likes: ['egg', 'eye', 'sweet', 'choirEgg'], hp: 32, stamina: 20, pull: 0.8, moves: ['dive', 'thrash', 'gnaw'], gap: [1.5, 2.6],
      atk: [{ name: 'reaches for you', windup: 1, dmg: 7, soul: 6, cause: 'whispers', wound: 0.5 }, { name: 'drags at you', windup: 1.2, dmg: 10, cause: 'blunt', wound: 0.5 }], yield: { id: 'starGristle', n: [2, 3] }, xp: 28,
      look: { len: 44, w: 13, color: '#5a6a72', belly: '#8aa0a4', eyes: 2, teeth: 6, spikes: 0, tendrils: 8, glow: '#9fd0ff' } },
  };
  // the rules of the fight, in one place
  const TUNING = {
    wait: [4, 10], waitBait: 0.6, waitLiked: 0.6, omen: 1.6, bite: 0.9, // seconds to a bite (faster with bait, faster still if it is liked), the shadow shows this long first, the hooking window
    line: 10, linePerLevel: 0.25, tension: { reel: 0.3, calmPull: 0.25, surge: 0.9, free: 0.55, rate: 2.5, danger: 0.75, slack: 0.12 },
    reel: 0.07, reelTired: 0.6, run: 0.12, farthest: 1.15, // reel speed (as a share of the cast a second), faster when tired; how fast it runs out; past this the line is gone
    lineDamage: 32, gnaw: 1.2, tire: { surge: 1, band: [0.3, 0.7], reel: 0.8 }, hookLoss: 0.25, tell: 1.1, surgeLen: [0.9, 1.6],
    land: 0.04, strikeCd: 0.6, strike: 3, perLevel: 0.4, brace: 0.7, braceCd: 1.4, recover: 1.3, hit: 0.8, gapCombat: [1, 2], flyGap: 1.4, flyWindup: 1.3, near: 0.4, openingBonus: 2, parried: 0.2,
  };
  const api = { FISH_ZONES: ZONES, FISH_CREATURES: CREATURES, FISH_TUNING: TUNING, FISH_PERIODS: PERIODS, FISH_DAY: DAY, fishHourOf: hourOf, fishPeriodOf: periodOf };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
