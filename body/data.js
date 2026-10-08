// Body data: the parts of the body, the surgeon's tools, and the table of ailments.
// Ailments advance through stages on their own, drain the body, and spread to neighbouring parts; each stage is
// treated by an exact sequence of tools (as in Metal Gear Solid 3's cure screen). Treated, an ailment heals back
// down through its stages, becomes its benign form (a scar, an ache), and then is gone. The pilgrims' notes on each
// stage say, in their own words, what to do.
(function (root) {
  // parts on the anatomical chart (chart space 100 x 140, the body seen from the front), and what touches what
  const PARTS = {
    head: { name: 'Head', site: 'head', adj: ['torso'], shape: { e: [50, 15, 9, 11] } },
    torso: { name: 'Torso', site: 'chest', adj: ['head', 'armL', 'armR', 'legL', 'legR'], shape: { p: [[37, 27], [63, 27], [66, 70], [34, 70]] } },
    armL: { name: 'Left arm', site: 'left arm', adj: ['torso'], shape: { p: [[64, 28], [71, 30], [80, 70], [73, 72], [65, 42]] } },
    armR: { name: 'Right arm', site: 'right arm', adj: ['torso'], shape: { p: [[36, 28], [29, 30], [20, 70], [27, 72], [35, 42]] } },
    legL: { name: 'Left leg', site: 'left leg', adj: ['torso', 'legR'], shape: { p: [[51, 71], [66, 71], [64, 132], [54, 132]] } },
    legR: { name: 'Right leg', site: 'right leg', adj: ['torso', 'legL'], shape: { p: [[34, 71], [49, 71], [46, 132], [36, 132]] } },
  };

  // the surgeon's roll: 8x8 art; uses: how many (Infinity for instruments)
  const T = (name, note, uses, pal, px, extra) => ({ name, note, uses, pal, px, ...extra });
  const TOOLS = {
    knife: T('Bone Knife', 'For cutting away, lancing and draining.', Infinity, { a: '#e8e0c8', b: '#a89c80', c: '#5a4a3a' }, ['......a.', '.....ab.', '....ab..', '...ab...', '..ab....', '.cc.....', 'cc......', 'c.......']),
    tweezers: T('Tweezers', 'For pulling out what should not be in you.', Infinity, { a: '#9a9aa6', b: '#6a6a72' }, ['a......a', '.a....a.', '.a....a.', '..a..a..', '..a..a..', '...ab...', '...bb...', '...bb...']),
    cautery: T('Cautery Iron', 'Must be red from the camp fire to do any good.', Infinity, { a: '#3a3a42', b: '#6a6a72', c: '#ff7a30', d: '#5a4030' }, ['......cc', '.....cc.', '....bb..', '...bb...', '..bb....', '.dd.....', 'dd......', 'd.......'], { needsFire: true }),
    hymnal: T('Hymnal', 'A verse sung over the wound. Some things only listen to singing.', Infinity, { a: '#5a3a2a', b: '#d8ccb0', c: '#f3d36b' }, ['........', '.aaaaaa.', '.abbbba.', '.abccba.', '.abbbba.', '.abbbba.', '.aaaaaa.', '........']),
    blindfold: T('Blindfold', 'For eyes that should not be open.', Infinity, { a: '#2a2026', b: '#4a3a46' }, ['........', '........', 'aaaaaaaa', 'abababab', 'aaaaaaaa', '.a....a.', 'a......a', '........']),
    spirits: T('Black Spirits', 'Burns going in. Washes a wound clean of what lives in it.', 6, { a: '#3a3530', b: '#8c8476', c: '#1a1018', d: '#6a4a8a' }, ['...bb...', '...aa...', '..baab..', '.bccccb.', '.bcdccb.', '.bccccb.', '.bccccb.', '..bbbb..']),
    salt: T('Salt Poultice', 'Tide salt in cloth. Draws things out of the flesh.', 5, { a: '#d8dce8', b: '#9aa6c8', c: '#8a7a5a' }, ['........', '.cccccc.', 'cabaabac', 'caabaaac', 'cbaaabac', 'caaabaac', '.cccccc.', '........']),
    moss: T('Moss Poultice', 'Vein moss, chewed and packed. Soothes and knits.', 5, { a: '#3f7a3a', b: '#5ea040', c: '#c33a5a' }, ['........', '.abba.b.', 'abcbbab.', 'bbcabcba', 'abacbcbb', '.bbacab.', '..abba..', '........']),
    thread: T('Pilgrim Thread', 'Grey hair from the pilgrims. Sews shut what was opened.', 6, { a: '#b9b2d8', b: '#6e6a7c', c: '#d8d0c0' }, ['....c...', '...c.c..', '..aaaa..', '.aabbaa.', '.abaaba.', '.aabbaa.', '..aaaa..', '........']),
    wax: T('Shrine Wax', 'Seals what is written on you so it cannot be read.', 5, { a: '#d9b86a', b: '#b8943a', c: '#a0182a' }, ['........', '..aaaa..', '.abbbba.', 'abbccbba', 'abccccba', 'abbccbba', '.abbbba.', '..aaaa..']),
    splint: T('Bone Splint', 'Holds a singing bone still until it forgets the tune.', 4, { a: '#e8e0c8', b: '#a89c80', c: '#6a5438' }, ['ab....ab', 'ab....ab', 'abccccab', 'ab....ab', 'ab....ab', 'abccccab', 'ab....ab', 'ab....ab']),
    bandage: T('Boiled Bandage', 'A lattice boiled soft in something. Binds like gauze, and what it was boiled in goes into the wound; the better it was made, the faster the wound heals under it.', 0, { a: '#c9bfa0', b: '#9a9078', c: '#6fb3c9' }, ['........', '.aaaaaa.', 'abababab', 'accccccb', 'babababa', 'aaaaaaaa', '.bbbbbb.', '........'], { crafted: true }),
    gauze: T('Gauze Wrap', 'Binds it all up. Always last.', 8, { a: '#e8e2cf', b: '#b8ac90' }, ['........', '.aaaaaa.', 'abababab', 'aaaaaaaa', 'babababa', 'aaaaaaaa', '.bbbbbb.', '........']),
  };

  // the tools by kind of work, so a player can reason from a wound's description to the kind of tool it wants
  const CATS = {
    cutting: { name: 'Cutting', color: '#d8d0b8', note: 'Opens and removes. For what is swollen, tight or growing, and for what is lodged where it should not be.' },
    cleansing: { name: 'Cleansing', color: '#8fb8e8', note: 'Washes and draws out. For what is foul, festering, or pooling under the skin.' },
    closing: { name: 'Closing', color: '#f0a060', note: 'Shuts what is open. Thread for edges that will meet; the red iron for what is rotting, nested or overgrown.' },
    herbal: { name: 'Herbal', color: '#7fcf7a', note: 'Cools and feeds. For what is hot, raw or hungry.' },
    binding: { name: 'Binding', color: '#e8e2cf', note: 'Holds. A wrap covers what weeps; a splint holds what bends wrong.' },
    rites: { name: 'Rites', color: '#c0a0e0', note: 'For what is not only of the flesh: what hums, whispers, watches or writes.' },
  };
  const CAT_OF = {"knife": "cutting", "tweezers": "cutting", "salt": "cleansing", "spirits": "cleansing", "thread": "closing", "cautery": "closing", "moss": "herbal", "gauze": "binding", "splint": "binding", "hymnal": "rites", "blindfold": "rites", "wax": "rites"};
  CAT_OF.bandage = 'binding';
  Object.entries(CAT_OF).forEach(([k, c]) => { TOOLS[k].cat = c; });

  // ailments: parts it may start on; stages with drain per minute, minutes to the next stage, chance per minute of
  // spreading to a neighbouring part, the tools in order that treat it, and the pilgrims' note
  const S = (name, look, drain, minutes, spread, treat, lore) => ({ name, look, drain, minutes, spread, treat, lore });
  const AILMENTS = {
    starRot: { name: 'Star-Rot', parts: 'any', mark: '#9fb4ff', kind: 'specks', benign: { name: 'Starmarks', look: 'Faint pale points where the stars were. They no longer shine.' },
      stages: [
      S('speckled', 'Pale points like stars, pooling under unbroken skin. The light wants drawing out, and the place covering after.', { health: -0.4 }, 5, 0, ['salt', 'gauze'], 'Starlight under the skin. Draw it out with salt, then bind it.'),
      S('weeping', 'The specks have joined into swollen constellations that weep light. The swelling is foul, and the edges gape.', { health: -1, soul: -0.6 }, 6, 0.12, ['knife', 'spirits', 'thread', 'gauze'], 'Cut away what weeps, wash it in spirits, sew it shut, and bind it.'),
      S('hollow', 'The flesh has opened onto a night sky: rotting at the edges, too wide to stitch, foul, and bleeding light.', { health: -2.2, soul: -1.5 }, 0, 0.3, ['cautery', 'spirits', 'gauze'], 'The night has opened in you. Close it with a red iron, wash it, bind it.'),
    ] },
    cyst: { name: 'Whispering Cyst', parts: 'any', mark: '#c96a7a', kind: 'mouth', benign: { name: 'Quiet Scar', look: 'A puckered scar. It no longer murmurs.' },
      stages: [
      S('murmuring', 'A swelling that murmurs when it is quiet. Tight under the skin, and it smells foul. It will want opening, and covering after.', { soul: -0.5 }, 5, 0, ['knife', 'spirits', 'gauze'], 'Lance it before it learns words. Wash, bind.'),
      S('in chorus', 'Several swellings murmuring together, each with a small tongue lodged inside. They are foul, and whatever opens must be sealed so it cannot speak.', { soul: -1.2, exhaustion: 0.6 }, 7, 0.15, ['knife', 'tweezers', 'spirits', 'wax'], 'Lance it, pull out the tongue inside, wash it, and seal it with wax so it cannot speak again.'),
      S('a mouth', 'It has opened into a mouth that says your name. It is swollen, speaking, with a tongue lodged in it, and will not be touched until it is quiet.', { soul: -2.4, health: -1 }, 0, 0.3, ['hymnal', 'knife', 'tweezers', 'wax'], 'Sing it to sleep first. Then cut, pull the tongue, and seal it.'),
    ] },
    glyphBurn: { name: 'Glyph Burn', parts: 'any', mark: '#ffb040', kind: 'glyph', benign: { name: 'Glyph Scar', look: 'The glyph is a pale scar now. Nobody can read it.' },
      stages: [
      S('smouldering', 'A shrine glyph burnt into the skin, hot and raw to the touch. It is written there, and could be read.', { health: -0.4, soul: -0.3 }, 6, 0, ['moss', 'wax'], 'Cool it with moss, then seal it in wax so it cannot be read.'),
      S('spreading script', 'The glyph is writing more of itself. The skin is hot and raw, the script spreading, and weeping.', { health: -0.8, soul: -0.8 }, 6, 0.18, ['moss', 'wax', 'gauze'], 'Moss, wax, and bind it tight. It writes faster unbound.'),
      S('living text', 'The words move, and murmur as they read you. The skin is hot and raw, the script written deep, and weeping.', { soul: -2, health: -1 }, 0, 0.35, ['hymnal', 'moss', 'wax', 'gauze'], 'Sing over it until the words stop, then moss, wax and bind.'),
    ] },
    gaze: { name: 'Lantern Gaze', parts: ['head'], mark: '#6fe0a0', kind: 'eye', benign: { name: 'Closed Lid', look: 'A seam above the brow, shut and still.' },
      stages: [
      S('itching', 'An itch above the brow. Something under it is looking out, and the skin is hot.', { soul: -0.4, exhaustion: 0.3 }, 6, 0, ['blindfold', 'moss'], 'Cover it so it sees nothing, and soothe it with moss.'),
      S('opening', 'A third eye, half open, green and wet, looking out. The flesh around it is swollen and foul, and weeping.', { soul: -1.2, exhaustion: 0.8 }, 8, 0, ['blindfold', 'knife', 'spirits', 'gauze'], 'Blind it, cut it out, wash the socket, bind it.'),
      S('watching', 'A third eye fully open, watching, and humming low in the bone. The flesh around it is swollen and rotting, and weeping.', { soul: -2.5, exhaustion: 1.5 }, 0, 0.2, ['blindfold', 'hymnal', 'knife', 'cautery', 'gauze'], 'Blind it and sing to it, then cut it out and close the socket with the red iron. Bind it.'),
    ] },
    bloom: { name: 'Mycelial Bloom', parts: 'any', mark: '#c9a35a', kind: 'threads', benign: { name: 'Grey Freckles', look: 'A dusting of grey under the skin where the threads were.' },
      stages: [
      S('threading', 'Fine grey threads lodged under the skin, barbed like hair. The flesh where they come from is damp, and will want covering.', { health: -0.3, hunger: 0.4 }, 4, 0.05, ['tweezers', 'salt', 'gauze'], 'Pull the threads, salt the place they came from, bind it.'),
      S('fruiting', 'Small caps have pushed through, swollen on the surface. The place beneath is damp, and will want covering.', { health: -0.9, hunger: 0.8 }, 5, 0.22, ['knife', 'salt', 'gauze'], 'Cut the caps away at the root, salt it, bind it.'),
      S('overgrown', 'It is more garden than limb: overgrown, rotting at the root, damp and weeping.', { health: -1.8, hunger: 1.4, exhaustion: 1 }, 0, 0.45, ['cautery', 'salt', 'gauze'], 'Burn it back with the red iron, salt it, bind it.'),
    ] },
    leech: { name: 'Thorn-Leech Burrow', parts: ['armL', 'armR', 'legL', 'legR'], mark: '#6a3a5a', kind: 'burrow', benign: { name: 'Thorn Scars', look: 'A ring of small white punctures, closing clean.' },
      stages: [
      S('bitten', 'A thorned mouth has latched on, and the flesh around it is pooling. It must be made to let go, then pulled, and the bite bound.', { health: -0.5, thirst: 0.5 }, 3, 0, ['salt', 'tweezers', 'gauze'], 'Salt makes it let go. Pull it, bind the bite.'),
      S('burrowed', 'It is under the skin now, moving, and the skin over it is tight. It is lodged deep, and the hole will be foul and bleeding.', { health: -1.2, thirst: 1 }, 5, 0.2, ['knife', 'tweezers', 'spirits', 'gauze'], 'Open the skin, pull it out whole, wash the hole, bind it.'),
      S('nested', 'It has young, moving out along the limb under rotting skin. They are lodged, and the wound is foul and bleeding.', { health: -2.2, thirst: 1.6 }, 0, 0.5, ['cautery', 'tweezers', 'spirits', 'gauze'], 'Burn them out with the red iron, pull what is left, wash, bind.'),
    ] },
    boneChoir: { name: 'Bone Choir', parts: ['armL', 'armR', 'legL', 'legR'], mark: '#e8e0c8', kind: 'crack', benign: { name: 'Knitting Bone', look: 'It aches in the cold. It has forgotten the tune.' },
      stages: [
      S('humming', 'The bone hums faintly, in tune with something far away.', { exhaustion: 0.5 }, 6, 0, ['hymnal'], 'Sing it a different tune and it will forget this one.'),
      S('resonant fracture', 'The bone has cracked along the note and hums in pain. The limb bends where it should not, and wants holding and covering.', { exhaustion: 1.2, health: -0.7 }, 7, 0.1, ['hymnal', 'splint', 'gauze'], 'Sing it quiet, splint it still, bind it.'),
      S('shattered hymn', 'It hums in pieces, and the pieces want to be elsewhere. The limb bends wrong in many places and the skin is torn: it wants opening to set the bone, its edges will not meet, and it will bleed.', { exhaustion: 2, health: -1.5 }, 0, 0.25, ['hymnal', 'knife', 'splint', 'thread', 'gauze'], 'Sing, open it to set the pieces, splint it, sew it, bind it.'),
    ] },
    tideLung: { name: 'Tide Lung', parts: ['torso'], mark: '#2d5f7a', kind: 'water', benign: { name: 'Salt Breath', look: 'Your breath tastes of salt. Only that.' },
      stages: [
      S('damp', 'A wet weight in the chest, pooling. It tastes of salt, and hums with the tide when you breathe.', { thirst: 0.6, exhaustion: 0.5 }, 6, 0, ['salt', 'hymnal'], 'Salt on the chest to draw the tide, and sing it out.'),
      S('brine cough', 'You cough up black water and small shells, foul on the tongue, and the chest still hums with the tide.', { thirst: 1.2, exhaustion: 1, health: -0.6 }, 7, 0, ['salt', 'spirits', 'hymnal'], 'Salt, a mouthful of spirits, and sing until it stops.'),
      S('drowning inside', 'There is a sea in there with a tide. The chest is swollen tight, the sea is foul, and once opened the edges will gape. It hums as it moves, and will weep.', { thirst: 2, exhaustion: 2, health: -1.6 }, 0, 0.15, ['knife', 'spirits', 'thread', 'hymnal', 'gauze'], 'Open the side to let the sea out, wash it, sew it, sing, bind.'),
    ] },
    hunger: { name: 'Hollow Hunger', parts: ['torso'], mark: '#8a2a3a', kind: 'hollow', benign: { name: 'Old Hollow', look: 'An ache under the ribs, like a memory of hunger.' },
      stages: [
      S('gnawing', 'A hunger that eating does not touch. A hollow under the ribs, a gap that hums.', { hunger: 1.2 }, 6, 0, ['wax', 'hymnal'], 'Seal the hollow with wax and sing it full.'),
      S('chewing', 'Something inside is eating you back, raw and hungry. The hollow still gapes, and hums.', { hunger: 2, health: -0.6 }, 7, 0, ['moss', 'wax', 'hymnal'], 'Feed it moss, then seal it and sing.'),
      S('a second mouth', 'A second mouth, hungry for the rest of you, humming. It is tight and swollen, its edges gape, it speaks hunger, and it bleeds.', { hunger: 3, health: -1.4, soul: -0.8 }, 0, 0.2, ['hymnal', 'knife', 'thread', 'wax', 'gauze'], 'Sing it still, open it, sew it closed, seal it, bind it.'),
    ] },
    fade: { name: "Pilgrim's Fade", parts: 'any', mark: '#b9b2d8', kind: 'fade', benign: { name: 'Grey Patch', look: 'Still a little grey, but yours again.' },
      stages: [
      S('greying', 'The skin has gone grey, like the pilgrims, and hums faintly with something far away. It wants singing to, and keeping covered.', { soul: -0.6 }, 6, 0.04, ['hymnal', 'gauze'], 'Sing to it so it remembers it is yours, and bind it.'),
      S('translucent', 'You can see the floor through it, thin and raw. It hums away from you, and wants covering.', { soul: -1.4, exhaustion: 0.6 }, 7, 0.14, ['hymnal', 'moss', 'gauze'], 'Sing, pack it with moss to give it weight, bind it.'),
      S('gone quiet', 'It does not answer when you move it. Thin and raw, drifting, humming, and it needs sealing so it cannot go, and covering after.', { soul: -2.4, exhaustion: 1.2 }, 0, 0.3, ['hymnal', 'moss', 'wax', 'gauze'], 'Sing, moss, seal it so it cannot drift, bind it.'),
    ] },
  };

  // what can happen to you: each cause lists the ailments it may leave, by weight. Where it lands decides which
  // (a blow breaks a limb's bone but bruises a lung through the chest). The medical history records cause and site.
  const CAUSES = {
    blunt: { name: 'Blunt impact', results: { boneChoir: 3, tideLung: 3, fade: 0.4 } },
    thorns: { name: 'Thorn bite', results: { leech: 1 } },
    spores: { name: 'Spore cloud', results: { bloom: 2, tideLung: 1 } },
    starlight: { name: 'Starlight exposure', results: { starRot: 3, gaze: 1 } },
    ward: { name: 'Ward backlash', results: { glyphBurn: 1 } },
    whispers: { name: 'Whispering voices', results: { cyst: 1 } },
    hunger: { name: 'Long hunger', results: { hunger: 2, fade: 1 } },
    spread: { name: 'Spread', results: {} },
    unknown: { name: 'Unknown cause', results: {} },
  };

  const api = { BODY_PARTS: PARTS, BODY_TOOLS: TOOLS, BODY_CATS: CATS, BODY_AILMENTS: AILMENTS, BODY_CAUSES: CAUSES };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
