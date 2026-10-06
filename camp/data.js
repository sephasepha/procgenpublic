// Camp data: fire materials, vessels, the 20 base ingredients and the dishes they make.
// Effects are changes to the five stats: health and soul are good when high; hunger, thirst and exhaustion
// are needs, good when low. Everything down here is grotesque and dangerous raw; cooked, it is barely edible.
(function (root) {
  // 8x8 pixel art, one palette per item ('.' is transparent)
  const FIRE = {
    tinder: { name: 'Tinder', note: 'Dry spore-fluff. Catches a spark.', mass: 0.04, ignite: 170, flame: 380, self: 1.0, burn: 0.002, tau: 1.5,
      pal: { a: '#e0d090', b: '#b8a060', c: '#8a7a48' }, px: ['........', '..a.a...', '.abaaba.', 'aabababa', '.ababaa.', 'abaaaba.', '.cbabc..', '........'] },
    kindling: { name: 'Kindling', note: 'Bone splinters. Takes a small flame.', mass: 0.14, ignite: 210, flame: 260, self: 0.75, burn: 0.0023, tau: 4,
      pal: { a: '#e8e0c8', b: '#a89c80', c: '#6a6050' }, px: ['......ab', '.....ab.', '....ab..', '...ab...', '..ab....', '.ab.....', 'ab......', 'c.......'] },
    fuel: { name: 'Fuel', note: 'A chitin log. Needs a strong bed of embers.', mass: 0.9, ignite: 330, flame: 320, self: 0.7, outAt: 0.75, burn: 0.00375, tau: 14,
      pal: { a: '#3a2a2a', b: '#6a4a3a', c: '#1a1010' }, px: ['........', '..aaaa..', '.abababa', 'abababab', 'babababa', '.ababab.', '..cccc..', '........'] },
  };
  const STRIKER = { name: 'Striker', note: 'Flint on iron. Strike it over tinder.', pal: { a: '#6a6a72', b: '#9a9aa6', c: '#3a3a42', d: '#ffd060' }, px: ['......d.', '.....dbd', '....abb.', '...abb..', '..abb...', '.ccb....', 'cc......', 'c.......'] };

  const VESSELS = {
    pot: { name: 'Pot', note: 'Iron pot. Boils what is in it while there is water; dry, it scorches.', cap: 4, gain: 0.17, tau: 10, burnAt: 150, boils: true,
      pal: { a: '#2a2a30', b: '#4a4a56', c: '#14141a', d: '#6a6a7a' }, px: ['........', '.d....d.', 'dbbbbbbd', 'abbbbbba', 'aaaaaaaa', 'aaaaaaaa', '.aaaaaa.', '..c..c..'] },
    pan: { name: 'Pan', note: 'Blackened pan. Fries fast and burns faster.', cap: 3, gain: 0.25, tau: 6, burnAt: 205,
      pal: { a: '#2a2a30', b: '#4a4a56', c: '#6a4a3a' }, px: ['........', '........', '.bbbbb..', 'abbbbba.', 'aaaaaacc', '.aaaaa..', '........', '........'] },
    skewer: { name: 'Skewer', note: 'A spit of sharpened bone. Holds two things over open flame.', cap: 2, gain: 0.3, tau: 3, burnAt: 230,
      pal: { a: '#e8e0c8', b: '#a89c80' }, px: ['........', '........', '........', 'abbbbbbb', 'aaaaaaaa', '........', '........', '........'] },
  };

  // raw and cooked effects: { health, soul, hunger, thirst, exhaustion }
  const I = (name, theme, note, cook, raw, cooked, pal, px, extra) => ({ name, theme, note, cook, raw, cooked, pal, px, ...extra });
  const INGREDIENTS = {
    lanternEye: I('Lantern Eye', 'cosmic', 'It is still looking. Do not let it look at you raw.', 22,
      { soul: -12, health: -6, hunger: -4 }, { hunger: -14, soul: 4 },
      { a: '#e8e2cf', b: '#c33a3a', c: '#6fe0a0', d: '#0b1a12' }, ['..aaaa..', '.abaaba.', 'aaccccaa', 'acddddca', 'acddddca', 'aaccccaa', '.abaaba.', '..aaaa..'], { tags: ['eye'], glow: '#6fe0a0' }),
    weepingTuber: I('Weeping Tuber', 'growth', 'Black tears run from its eyes, if those are eyes.', 34,
      { health: -8, thirst: -3 }, { hunger: -20, thirst: -5 },
      { a: '#6b4a2e', b: '#4a3020', c: '#0b0b10', d: '#9a7a52' }, ['...ab...', '..adab..', '.aaaaab.', '.adaaab.', '.aaaaab.', '..aaab..', '..c..c..', '..c.....'], { tags: ['root'] }),
    hymnGrub: I('Hymn-Grub', 'shrine', 'It sings a hymn when it warms. Then it stops.', 14,
      { soul: -6, health: -4, hunger: -5 }, { hunger: -12, soul: 6 },
      { a: '#e8d8b0', b: '#c9b48a', c: '#2a1e14', d: '#f3d36b' }, ['........', '.d....d.', '..aaaa..', '.ababab.', 'abababac', '.ababab.', '..aaaa..', '........'], { tags: ['grub'] }),
    starGristle: I('Star-Gristle', 'cosmic', 'Meat with stars in it. The stars move.', 46,
      { health: -14, hunger: -8 }, { hunger: -28, health: 6, exhaustion: -5 },
      { a: '#8a2a3a', b: '#b8434f', c: '#e9e2ff', d: '#f0e0e0' }, ['..abba..', '.abbcba.', 'abbabbaa', 'adaaacba', 'abaaabba', '.abcaaa.', '..addaa.', '...aa...'], { tags: ['meat'] }),
    veinMoss: I('Vein Moss', 'growth', 'Pulses gently. Has a pulse.', 10,
      { health: -3, thirst: 5 }, { thirst: -8, health: 4 },
      { a: '#3f7a3a', b: '#5ea040', c: '#c33a5a' }, ['........', '.abba.b.', 'abcbbab.', 'bbcabcba', 'abacbcbb', '.bbacab.', '..abba..', '........'], { tags: ['green'] }),
    blackWater: I('Black Water', 'deep', 'Drawn from the deep. Something swims in it. Boil it.', 24,
      { thirst: -10, health: -7, soul: -4 }, { thirst: -24 },
      { a: '#3a3530', b: '#8c8476', c: '#0b0b14', d: '#4a4a6a' }, ['...bb...', '...aa...', '..baab..', '.bccccb.', '.bcdccb.', '.bccccb.', '.bccccb.', '..bbbb..'], { tags: ['water'], water: true, only: ['pot'] }),
    sporeBladder: I('Spore Bladder', 'growth', 'Breathes out when squeezed. Do not breathe in.', 18,
      { health: -10, exhaustion: 10 }, { exhaustion: -12, hunger: -6 },
      { a: '#c9a35a', b: '#e0c070', c: '#6a5a2a', d: '#e8e0c8' }, ['.d....d.', '..aaaa..', '.abbaca.', 'aabaaaca', 'acaabaaa', 'aaacaaba', '.aaaaaa.', '..a..a..'], { tags: ['fungus'] }),
    tongueFern: I('Tongue Fern', 'growth', 'The fronds taste you back.', 12,
      { health: -5, soul: -3 }, { hunger: -8, thirst: -4, soul: 2 },
      { a: '#c96a7a', b: '#8a3a4a', c: '#4a6a3a' }, ['.a...a..', 'aab.aab.', '.ab..ab.', '..c.ca..', '.aacc.a.', 'aab.c.ab', '....c...', '....c...'], { tags: ['green'] }),
    hardtack: I('Pilgrim Hardtack', 'pilgrim', 'Stale bread from the Gray Pilgrims. The only honest food here.', 6,
      { hunger: -8, thirst: 6 }, { hunger: -11 },
      { a: '#b08a52', b: '#8a6a3a', c: '#6a4a2a' }, ['........', '.aaaaaa.', 'abacabab', 'aaaaaaca', 'acabaaab', 'abaaacaa', '.bbbbbb.', '........'], { tags: ['grain'] }),
    tideSalt: I('Tide Salt', 'deep', 'Crystals that whisper of a sea that is not there.', 8,
      { thirst: 10, soul: -2 }, { thirst: 4, health: 3, soul: 2 },
      { a: '#d8dce8', b: '#9aa6c8', c: '#6fb3c9' }, ['...c....', '..aab...', '.aaabb.c', '..abb.ab', '.c...aab', '.aab.abb', 'aaabb.b.', '.bbb....'], { tags: ['salt'] }),
    choirEgg: I('Choir Egg', 'shrine', 'Tiny faces press against the shell from inside.', 16,
      { soul: -10, health: -5 }, { hunger: -14, health: 4 },
      { a: '#e8e0c8', b: '#b9b2d8', c: '#2a1e3a' }, ['...aa...', '..aaab..', '.acacab.', '.aaaaab.', 'acacaaab', 'aaaaacab', '.aaaabb.', '..abbb..'], { tags: ['egg'] }),
    marrow: I('Ossuary Marrow', 'shrine', 'From the charnel halls. Nobody asks whose.', 30,
      { soul: -9, health: -6, hunger: -6 }, { hunger: -18, health: 5 },
      { a: '#e8e0c8', b: '#b8ac90', c: '#a03a3a' }, ['aa....aa', 'abaa.aba', '.aacca..', '..acca..', '..acca..', '.aacca..', 'abaa.aba', 'aa....aa'], { tags: ['bone'] }),
    moonlard: I('Moonlard', 'cosmic', 'Pale fat, cold as the space between stars.', 12,
      { health: -4, thirst: 6, hunger: -6 }, { hunger: -12, exhaustion: -4 },
      { a: '#e8eef4', b: '#c8d4e0', c: '#9aa6c8' }, ['........', '.cccccc.', 'cabaabac', 'caabaaac', 'cbaaabac', 'caaabaac', '.cccccc.', '........'], { tags: ['fat'] }),
    thornLeech: I('Thorn Leech', 'deep', 'Still hungry. So are you.', 20,
      { health: -12, hunger: -4 }, { hunger: -12, health: 3, thirst: -3 },
      { a: '#3a2a3a', b: '#6a3a5a', c: '#e0d0b0' }, ['........', '..c.c.c.', '.aaaaaa.', 'abababaa', 'aaaaaaab', '.aaaaaa.', '..c.c.c.', '........'], { tags: ['meat'] }),
    gloamCap: I('Gloam Cap', 'growth', 'Glows in the dark. Glows in you, after.', 14,
      { soul: -8, exhaustion: 6 }, { hunger: -9, soul: 5, exhaustion: -4 },
      { a: '#4a8ac9', b: '#9fd0ff', c: '#e8dcc0' }, ['..aaaa..', '.abaaba.', 'aaaabaaa', 'abaaaaba', '...cc...', '...cc...', '..cccc..', '........'], { tags: ['fungus'], glow: '#9fd0ff' }),
    waxFig: I('Wax Fig', 'shrine', 'Grows from the candles of the Unsealed Shrines.', 9,
      { health: -4, soul: 3, thirst: 4 }, { hunger: -8, soul: 6 },
      { a: '#d9b86a', b: '#b8943a', c: '#f0e0a0', d: '#6a3a2a' }, ['....d...', '...dd...', '..aaaa..', '.acaaba.', 'aacaaaba', 'aacaabba', '.aaabba.', '..cbb...'], { tags: ['fruit'] }),
    eelSlice: I('Abyssal Eel', 'deep', 'A slice of something that was longer than the corridor.', 28,
      { health: -10, soul: -4 }, { hunger: -20, thirst: -3, health: 4 },
      { a: '#2a3a4a', b: '#c9b8d8', c: '#8a7aa8' }, ['..aaaa..', '.abbbba.', 'abbccbba', 'abcbbcba', 'abcbbcba', 'abbccbba', '.abbbba.', '..aaaa..'], { tags: ['meat', 'fish'] }),
    saintsFinger: I("Saint's Finger", 'shrine', 'A root shaped like a finger. It has a nail.', 26,
      { soul: -7, health: -5 }, { hunger: -15, soul: 4, health: 2 },
      { a: '#c9a080', b: '#8a6a4a', c: '#e8d8c0' }, ['...c....', '..aab...', '..aab...', '..ab....', '..aab...', '...ab...', '..aab...', '.bb.bb..'], { tags: ['root'] }),
    emberBeetle: I('Ember Beetle', 'growth', 'Hot to the touch. Hotter inside.', 11,
      { health: -9, thirst: 8 }, { hunger: -9, exhaustion: -8 },
      { a: '#2a1a14', b: '#ff7a30', c: '#ffd060' }, ['.a....a.', '..aaaa..', '.abccba.', 'aabbbbaa', 'aabccbaa', 'aabbbbaa', '.aaaaaa.', 'a..aa..a'], { tags: ['grub'], glow: '#ff7a30' }),
    cometHoney: I('Comet Honey', 'cosmic', 'Sweet, cold, and full of little lights.', 8,
      { soul: -5, thirst: 6, exhaustion: -3 }, { hunger: -7, exhaustion: -9, soul: 3 },
      { a: '#8c8476', b: '#9fb4ff', c: '#e9e2ff' }, ['..aaaa..', '...aa...', '.abbbba.', 'abbcbbba', 'abbbbcba', 'abcbbbba', 'abbbbbba', '.aaaaaa.'], { tags: ['sweet'], glow: '#9fb4ff' }),
  };

  // dishes: a vessel and exactly these ingredients, all cooked and not burnt, earn the dish's bonus on top
  const D = (name, vessel, items, bonus, note) => ({ name, vessel, items, bonus, note });
  const DISHES = [
    D('Eyestew', 'pot', ['blackWater', 'lanternEye', 'weepingTuber'], { soul: 8, hunger: -8 }, 'It stops watching once it has boiled long enough.'),
    D("Pilgrim's Mercy", 'pot', ['blackWater', 'hardtack', 'tongueFern'], { exhaustion: -12, thirst: -6 }, 'What the Gray Pilgrims eat. It tastes of nothing, which is a mercy.'),
    D('Marrow Broth', 'pot', ['blackWater', 'marrow', 'tideSalt'], { health: 12, thirst: -6 }, 'Salt keeps the bone from remembering.'),
    D('Spore Porridge', 'pot', ['blackWater', 'sporeBladder', 'hardtack'], { exhaustion: -14, hunger: -6 }, 'Thick, grey, and it breathes once when you stir it.'),
    D('Choir Skewer', 'skewer', ['hymnGrub', 'hymnGrub'], { soul: 12 }, 'Two voices, then quiet.'),
    D('Leech and Cap', 'skewer', ['thornLeech', 'gloamCap'], { health: 6, soul: 5 }, 'The light from the cap keeps the leech from moving.'),
    D('Gristle Fry', 'pan', ['starGristle', 'moonlard'], { health: 10, exhaustion: -6 }, 'Fried in cold fat, the stars go still.'),
    D('Comet-Glazed Eel', 'pan', ['eelSlice', 'cometHoney'], { soul: 8, hunger: -8 }, 'The glaze glitters long after the eel stops.'),
    D('Shrine Omelette', 'pan', ['choirEgg', 'waxFig', 'moonlard'], { soul: 10, health: 4 }, 'The faces sing once in the pan. Then breakfast.'),
    D('Ember Hash', 'pan', ['emberBeetle', 'saintsFinger', 'veinMoss'], { exhaustion: -10, health: 6 }, 'Warm for hours.'),
  ];
  const STATS = ['health', 'soul', 'hunger', 'thirst', 'exhaustion'];

  const api = { CAMP_FIRE: FIRE, CAMP_STRIKER: STRIKER, CAMP_VESSELS: VESSELS, CAMP_INGREDIENTS: INGREDIENTS, CAMP_DISHES: DISHES, CAMP_STATS: STATS };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
