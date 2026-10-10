# Undercroft Workbench

A phone-friendly workbench for procedural dungeon generation: a progression grammar decides how regions connect, a maze layer gives the space its labyrinth texture, and wave function collapse builds the architecture.

**Live:** https://sephasepha.github.io/procgenpublic/

Open it on your phone and use **Add to Home Screen** to install it as an app. It works offline after the first visit and picks up new versions on reload.

## Pages

- **Infinite** (`index.html`, the home page): an endless world of sectors that generates around you as you walk. It opens straight into a full-screen game view, landscape first: tap a spot to walk there by the shortest route (dots show the way and a ring marks where you are going; a tap on a wall goes to the nearest floor, and the map view works too), or drag anywhere to steer (a thumb-stick appears under your thumb; arrow keys or WASD on a keyboard). Steering or a key cancels a tapped route, round buttons for Light, Map, Tiles, Rules and Perf, the minimap top right, and where you are (stratum, district theme, room) top left. Installed to the home screen it opens full screen in landscape. The menu button (☰) shows world settings and the other tools.
- **Workbench** (`workbench.html`): the full pipeline for one dungeon in seven stages: hubs → candidate links → progression rules → style field → corridors and maze → WFC → validation. Generic, Arsenal and Underdark presets.
- **Maze Lab** (`lab.html`): nine classic maze algorithms on a plain grid, with carving replay, overlays and a comparison table.
- **Tiles** (`tiles.html`): the hand-drawn tilesets and example rooms the dressing WFC learns from, the learned neighbour rules for each tile, and a freshly dressed patch.
- **Voxels** (`voxels.html`): the debug 3D blocking-in layer that WFC will skin. Three explorable structures share one cell grid (each cell a 3×3 interior plus a wall line, one 4-voxel storey tall): a **Tower** with a ground-floor entrance, a **Megastructure** (not a building but a volume: habitation clusters floating at many heights, joined by bridges and long zig-zag stairways routed across the void by A*, with monoliths of solid mass standing in the gulfs and propping up some clusters), a **Pyramid labyrinth** narrowing from a triangular base to a single top cell, and a **Sunken column** entered by a stair from the surface. Cells are grouped into halls, rooms and climbable shafts. A spanning tree over the regions plus braiding makes everything reachable with few or no dead ends, and storeys connect by 3-step stairs or shafts. Each voxel carries a label (wall, floor, stair, door, shaft, entrance, goal…), and each cell records its region, its kind and a socket on each of its six faces, which is everything WFC needs. A walk check moves a two-voxel-tall explorer through the voxels (walking, stepping up and down, dropping, climbing shafts) and confirms every cell can be reached and left again; its route to the goal is drawn in red. A slice bar on the right edge of the diorama hides everything above a height (snapping to storeys) to look inside, and arrows either side step through the structures. The earlier **Pillars and bridges** chunk is still there. Generators are in `voxels/structures.js`, `voxels/walk.js` and `voxels/gen.js`, tested in `tests/structures.js` and `tests/voxels.js`. Rendering uses Three.js, vendored in `voxels/vendor/` so it works offline.

  **3D tile kit.** The **Tiles** toggle swaps the voxels for modular OBJ pieces, the technical pipeline for skinning the structures with WFC. `tools/make-tiles.js` (`npm run tiles`) writes the kit to `voxels/tiles/`: walls (plain, ribbed, banded), windows (slot, barred), doors (centred or offset), arch, entrance, rail, floors (plain, grate, with a stair hole), roofs, walkway decks, in-cell stairs, stair runs, a shaft ladder, monolith mass and a goal beacon. It also writes `tileset.json`, which holds each piece's file and family, which family dresses each socket, and the WFC adjacency rules. Conventions: 1 unit = 1 voxel, a cell is 4×4×4, +Y up, side pieces are authored on the +Z face and rotated 0/90/180/270° about Y, and the pivot is the centre of the cell floor. For Unreal, import with Z-up conversion and a scale for the voxel size. `voxels/dress3d.js` places pieces from each cell's sockets, then runs a wave function collapse over the variant slots: pilasters run the full height of a facade, bands its full width, there is one kind of window per ribbon, and a monolith keeps one finish. `tests/dress3d.js` checks that the OBJs are well formed, that every socket has a piece, that the rules hold, and that door, stair and stair-run pieces line up with the voxels.

The Workbench and Maze Lab also have a simple **Explore** mode. Every setting lives in the page URL, so any generation can be bookmarked, shared or replayed exactly.

## The Underdark (default preset)

The labyrinthine underdark is a cosmic space of unknown making, built in strata that repeat as you go deeper:

| Stratum | Architecture | Tiles (8×8) | Landmark |
| --- | --- | --- | --- |
| Constellation of Mazes | engraved galleries and twisting star warrens; the unexplored dark is a field of stars | maze reliefs, watching eyes, gold leaves, engraved paths | **EY** watching eye, under a star chart |
| Uncontrollable Growth | open caverns, with old halls the growth broke into | vines, tall grass, flowers, root runs, overgrown pillars | **BL** bloom heart |
| Unsealed Shrines | candlelit symmetric halls | candle alcoves, heather, stepping stones, shrine pillars | **SH** shrine around an opened pit |

Progression stays legible:

- **Seals (SE)** divide one stratum from the next; **pits (PT)** lead from the Shrines down to where the strata begin again, one level deeper (Constellation of Mazes II, …).
- Near every seal and pit the next stratum's tiles **creep** in, in blobs that thicken towards the doorway, and the **Gray Pilgrims' lavender fog** rises. The pilgrims themselves keep vigil at each seal and camp at the start (**PG**).
- Each stratum has its own **atmosphere**: void colour, light tint, particles (gold motes, spores, dust) and glowing tiles (eyes, bloom hearts, candles, pits).
- Light falls off with walking distance from you; places you have seen stay dimly remembered.
- The close view is drawn in a slight **3/4 perspective**: walls rise above the floor, so their tops sit higher and their front faces show; floors darken where they meet walls, and figures cast small shadows. It is a render-time extrusion of the same tiles, the 2D stand-in for meshes with height.

## Room-based sectors: themes, a room grammar, districts

Underdark sectors are laid out as believable buildings rather than caverns (`gen/rooms.js`; the WFC cavern
layout is still used by the Arsenal and Generic presets, and by the Underdark with `layout=caverns`):

1. **Theme.** Each stratum has three sector themes (Observatory, Glyph labyrinth, Archive; Greenhouse, Root
   cellars, Overgrown halls; Reliquary, Pilgrim hostel, Ossuary), chosen from the sector's coordinates.
2. **Room grammar.** A theme is a small grammar over room types (each with a size range, a shape: rect, pillared,
   colonnaded hall, octagon, round, cloister, cross; and public or private access). Expanding it from the start
   room gives the mission graph, e.g. Reliquary: antechamber → nave → 2–4 side chapels + the sanctum.
3. **Suites.** Rooms are placed next to their parent, separated by one wall with a door, or a short corridor
   away. The spine from the start room to the goal room grows towards the sector's way onward.
4. **Progression.** The doorways onward to the next stratum (seals and pits) are reached only from the goal room,
   by private corridors; private rooms open only onto their parent. With the goal room closed, the way onward is
   unreachable (`tests/world.js` checks this on every sector).
5. **Wings and districts.** The sector splits into 2–3 districts, each with its own theme; wings (a root room
   with its own children, from the district's grammar) pack the space, half of them grown off existing public
   rooms into building complexes. Near a seal, a district may belong to the neighbouring stratum, so the next
   stratum is felt a region before it is reached. Strata change every two sectors.
6. **Corridors.** The space between is filled with corridors on a lattice whose spacing the theme sets (2 for the
   dense Glyph labyrinth, 6 for building-like themes, leaving room between hallways), straightened per theme,
   joined to public rooms by connector doors and trimmed back. As in a real building, hallways have doors along
   them: every stretch of about eight cells opens into a room already across the wall or into a small room built
   off it from the district's theme (studies, vestries, tool stores, closets), and blind ends finish in a room.
   `tests/world.js` measures this: long straight hallways need a door into a room every 10 cells.
   Halls also look different from rooms: corridors and the walls lining them use a hall variant of the stratum's
   tileset (darker, worn floors, another stone).
7. **Crossings.** Every doorway into the next sector is a processional hall three cells wide through the border,
   opening into a gate room on each side, sized from the shared border key so the halves mirror each other. It
   is dressed with its own **Threshold** tiles (runner, banners, braziers, sigils), the same in every stratum.
8. **Materials.** Floors and walls get structured surfaces laid per room and district at render time (slabs,
   herringbone, concentric tiles, chequer; ashlar, coursed brick, bands), aligned to the world in 2x2-tile
   repeats: one masonry per building, one floor per room.

## Dressing: example-driven tile WFC

Every cell of a finished layout has a **context** read from the floor/wall pattern around it: a wall with floor below is a south face, a floor with walls left and right is a corridor, and so on (wall faces, outer and inner corners, thin walls, wall ends, pillars, wall shadows, corner shadows, corridors, dead ends, room centres).

Each biome's tileset (`gen/dressing.js`) is a **shared structural kit** drawn in the biome's palette (faces, cracked and coursed faces, corners, thin walls, ends, pillars, floor shadows, corridor edges) plus the biome's own details (niches, sconces, furnaces, pipes, banners, moss, runners, rails, drains, carpets, and 2x2 centrepieces). Tiles are 4×4 pixels, or 8×8 for the Underdark strata. From hand-drawn example rooms the generator learns, for every tile:

- which contexts it appears in, so faces only go on faces, runners in corridors, centrepieces in room centres,
- its orientation, inferred from context: write a tile's letter anywhere and it turns to face the right way,
- which tiles may sit next to it: **strict** tiles (centrepiece quarters, furnace and grate, runners) keep exactly their example neighbours, so they assemble and continue properly; other tiles may meet anything,
- how often it appears.

A WFC pass with backtracking then fills each sector cell by cell. When drawn, plain floor tiles take a random quarter turn and every tile gets a slight brightness jitter, so repeats don't read as repeats.

To add set dressing without drawing new example rooms, give a tile `like: 'X'` and a `share`: it goes wherever tile X was learned (same contexts, same turning) at that share of X's weight, so `like: 'F'` is a floor prop, `like: 'A'` a wall-face variant, `like: 'K'` something standing against a wall. To add art: draw a tile as rows of palette characters, give it an `anchor` if it faces a direction, then use its letter in an example room. `node tools/autotile.js` checks the example rooms and rewrites structural letters to match their geometry. In a 3D engine the same learned rules would place modular meshes.

### Each stratum its own architecture

The three Underdark strata share example rooms, letters, contexts and learned rules, but each draws its structural
kit differently, so their spaces look built by different hands rather than recoloured:

- **Constellation of Mazes**: crisp ashlar. Square-cut faces and corners, a starfield void.
- **Uncontrollable Growth**: no masonry at all. Hedge-and-canopy banks of leaf and root, burrows with ragged
  sides, trunks for pillars, a mycelium floor, earth and roots for the void.
- **Unsealed Shrines**: dressed temple stone. Coffered tops, dentil cornices, pilasters and plinths, arcades and
  balustrades, fluted columns, lozenge-tiled floors, buried masonry for the void.

Their surface materials follow suit: the Growth's floors and walls grow (mycelium nets, root mats, soil strata,
spore beds, root tangle, bark), and the Shrines' are set out by masons (lozenge and hex mosaics, sunbursts, flutes,
key-pattern friezes). Halls keep their stratum's kit in their own palette. `tests/dressing.js` checks that the
strata really draw each piece with different shapes.

### Transitions: a WFC over corners

Where areas meet (strata bleeding into each other near the seals, borrowed districts, the Threshold's processional
halls), a second WFC grows the transition (`blend` in `gen/dressing.js`, and `wasm/blend.c`, bit-identical):

- Every tile corner takes one area. A corner more than two cells from any boundary is its own area; nearer, it may
  be either side (the ecotone).
- The rule every cell enforces on its four corners is **no saddle**: diagonal corners alike while the diagonals
  differ. Materials therefore meet along continuous fronts, never in a chequer.
- Collapse is lowest-entropy first. Each corner is weighted towards the area it sits in and towards corners already
  decided beside it, so fronts meander instead of following the grid. Contradictions return a corner to its own
  area.
- The dressing WFC then honours it: cells with mixed corners take only the plain structural kit (no prop is cut in
  half). Pinned pieces (centrepieces, runners, braziers) keep their own area.
- The renderer draws a mixed cell pixel by pixel, from whichever area's corners weigh most there, using that area's
  own piece for the same letter and turn. How the front looks depends on what is coming in: the Growth creeps in
  organic lobes, the Shrines and Threshold in stepped, mason-cut edges, the Constellation in crisp blocks. The near
  side of a front is shaded, so one surface reads as laid over the other.

It costs about 2 to 8 ms a sector in WebAssembly. `tests/dressing.js` checks there are no saddles, that blending
stays near boundaries, that pinned cells and props are kept out of it, and `tests/wasm.js` checks JS/wasm parity.

## Infinite world

The world is an endless grid of sectors, each a full dungeon from the Workbench pipeline (regions, corridors, maze layer, WFC). Sectors are generated in background workers around the player and evicted far away. They regenerate identically, so what you have seen is remembered.

The grammar holds globally even though no sector ever sees the whole world:

- **Connectivity:** every sector links to a parent one step closer to the start, chosen from its own coordinates. All sectors form one tree rooted at the start, so everything is reachable.
- **Tiers:** a sector's tier comes from its distance to the start (`band` sectors per tier, at least 2; 2 by default for the Underdark), cycling through the preset's three tiers (Mazes → Growth → Shrines, or Outer → Works → Keep), then on into the next level. Neighbours differ by at most one tier, so nothing can skip one.
- **Caps:** extra loop doorways only join sectors of the same tier, and the parent choice avoids axis sectors, so no sector has more than two cross-tier branches.
- **Seams you don't notice:** sector grids overlap their neighbours by a few cells, and each shared border has one contract, computed from that border's coordinates: a wobbly line (up to ±4 cells) that decides which sector owns each overlapping cell, whether the border is open, and where its doorways are. Same-tier borders usually open with several narrow doorways; borders between tiers keep a single designed seal. Both neighbours compute the contract independently, so generation order never matters, and the border reads as one more irregular wall of the labyrinth.
- **Doctrine (Arsenal):** you enter the Keep only through Checkpoints, you leave it only through a Vault, which is the descent to the next level's Gatehouse, and Works sectors place foundries with power and cooling, away from magazines.
- **Validation:** each sector is checked as it generates: every hub and doorway inside must connect, and otherwise it retries deterministically.

The **Rules** panel in the explorer re-checks these live against every loaded sector. `tests/world.js` checks them over every sector within a few steps of the start: doorways meet edge to edge, every cell belongs to exactly one sector, floors of two sectors only ever touch at a doorway, and sectors come out identical in any generation order.

## Camp: fire and cooking

The **Camp** tab (♨) switches to a second screen: a fixed first-person view down at a fire pit on the cavern floor.
It is two mini-games run by a small simulation with no DOM, so it carries over to a 3D build as it is. The scene is
the pit, the vessels and the fire; what you use and what you need to know are plain, readable controls around it.

**Where the code is:**

| File | What it holds |
|---|---|
| `camp/fire.js` | The fire: laying, striking, air, heat, catching and going out, breath, embers and coals, ash and char, the placement preview and the gauge's reading. Its header documents a piece's states and fields and how a step works; every number it runs on is in its tuning table (`TUNING`) or the gauge's (`GAUGE`). |
| `camp/cooking.js` | Pots, pans and skewers: temperature, water and boil-off, cooking and scorching, stews, what the contents amount to (`judge`, `foodState`) and what eating does. Its tuning is `COOK`; each vessel's own properties are in `camp/data.js`. |
| `camp/sim.js` | The camp as a whole: its state, one step (fire, then vessels, then body), the body's needs, foraging, and the cost of blowing and the effect of eating. It exports everything as `CampSim`. |
| `camp/data.js` | Fire supplies, vessels, the 20 ingredients, the dishes, ash and char. |
| `camp/view.js` | What the screen's parts share (`CampView`): the live state (canvas, size, the camp, what is being dragged), the projection from the floor to the scene, sprites, layout and hit-testing. It reads its thresholds (choking, smouldering, burnt) from the simulation, so what the screen shows always agrees with what happens. |
| `camp/draw.js` | Painting the scene: the floor, the pit, pieces, vessels, particles, firelight and darkness, hands and charms, and the placement ring for what is in hand. |
| `camp/panels.js` | The readable UI: the screen's markup, the Fire/Cook modes, the fire gauge, the vessel panel, the tray and larder counts, and notes. |
| `camp/camp.js` | Opens and closes the screen, runs its loop, and turns input (taps, drags, keys) into actions on the camp. |

`tests/camp.js` tests the rules (over 400 checks); `tests/camp-golden.js` replays a scripted session (fire, coals,
stews, a pan, a skewer, eating, foraging, ash and char) and compares its state exactly with `tests/camp-golden.json`,
so a refactor can prove it changed nothing (`node tests/camp-golden.js --record` rewrites it when a change is meant).

- **Fire or Cook: one at a time.** Tending the fire and cooking are separate modes, switched by the **Fire** and
  **Cook** tabs at the left of the tray, so neither mode's controls take room from the other:
  - *Fire*: Tinder, Kindling, Fuel and Strike, the large **Blow** button, the full gauge, and the fire's pieces
    answer to touch (move them, gather ash and char). Air rings show only here.
  - *Cook*: the Pot, Pan and Skewer, the **Larder** drawer (all 20 ingredients) and Forage; the dock with the
    selected vessel and the larder; the gauge cut to its state and strength bar. Only the vessels answer to touch.
  - Touching a vessel while tending the fire switches to cooking (where a piece and a vessel overlap, the one in
    front is touched). Switching puts down whatever the other mode had in hand and closes what it had open. The Fire
    tab pulses while you cook if the fire wants air or fuel. Esc in Cook with nothing in hand goes back to Fire.
- **Using things.** Tap a tray button to pick it up (it stays in hand, so you can lay several pieces), then tap the
  floor or a vessel to use it. Tap it again, or press Esc, to put it down. You can also drag straight from a button
  into the scene. Drag a piece or an empty vessel back onto the tray to take it back.
- **Arranging the fire.** Press and drag any unburnt piece in the pit (or a vessel) to move it, even with an item in
  hand: a press that moves drags, a press that doesn't is a tap. Pieces are picked by the nearest within a finger's
  reach, stay where you took hold of them, lift with a shadow while held, and show the same catch/air/smother ring
  where they are. What has burnt down (embers, coals, ash) stays where it lies: touching it is only ever a tap.
- **Larder:** a compact grid of icons with counts; the ingredient in hand is named above it. With a pot, pan or
  skewer selected (it is selected when you set it down or tap it), tapping an ingredient puts it straight in; the
  button flashes when it goes in and shakes when it can't (full, or water in a pan).
- **Layout: nothing sits over the fire.** The screen is bands: a slim fire-status strip across the top, the scene,
  a dock for the larder and the selected vessel (below the scene in portrait, a column beside it in landscape), and
  the tray. Opening the larder or a vessel resizes the scene rather than covering it, and the scene always renders
  at its own aspect.
- **Prototype settings:** tinder, kindling and fuel are unlimited (∞ on their buttons). Food can be dragged from
  the larder straight onto a pot, pan or skewer, or picked and then tapped onto one.
- **The fire gauge** (the strip across the top) shows how the fire is doing:
  - a strength bar from Snuffed through Steady to Roaring, coloured like the fire (dull red, orange, yellow-white);
  - Air (it turns red and blinks when the fire is smothered) and Fuel, with an estimate of how long it will last;
  - which signs are showing: flame, embers, smoke;
  - its state: Empty pit, Cold, Catching, Burning steady, Short of air, Roaring, Starving, Choking, Smouldering,
    Embers, Snuffed out, and a trend arrow for whether it is rising or falling.

  This is a prototype for testing mechanics, so there is no onboarding: no instruction notes or hints. Paper notes
  only report what happened (what you ate, what you foraged, what you inspected). The tray wraps to as many rows as
  the screen needs, and the scene and panels lay out above it, so nothing is clipped at any size.
- **The fire itself shows its health.** Flames are taller, denser and whiter the harder it burns, and small, low and
  red when it is weak or starved of air. A choking fire throws thick dark smoke, a warming log thin grey wisps.
  Embers glow and pulse in the bed, and a breath brightens them.
- **Making and keeping a fire: spacing matters both ways.** Every piece has a temperature, a remaining mass and
  its own air.
  - **Heat falls off with distance.** A flame warms what is a few centimetres away a lot and what is 15 cm away
    hardly at all, so a piece laid too far from the flames never catches.
  - **Air falls off with crowding.** Each piece's air depends on how much material is packed close around it,
    weighted by distance (anything within about 4 cm counts heavily, and the penalty rises steeply as mass piles
    up), and on how hard the flames at and around it are burning. Air runs down over a second or so as a fire
    builds and comes back slowly when given room. Below about 65% a piece burns weaker; below about 22% it goes
    out.
  - So kindling laid around tinder catches, logs laid either side of a kindling fire catch, and logs stacked on top
    of the kindling smother it. A cold log laid on a small flame also drains its heat.
- **While you hold a piece of tinder, kindling or fuel over the floor**, a ring under it shows what would happen
  there: green will catch and breathe, amber is short of air or too far to catch, red will smother the flames
  (and the burning pieces it would choke are ringed in red). Rings around the burning pieces show their air.
- **Blowing** (the Blow button, or B or Space) tops up every piece's air at once, adds heat to anything already
  warm, makes embers flare (and burn down faster), and can coax a smouldering piece back to flame. The button
  glows and reads **Blow!** when a breath would help: the flames are short of air, something is smouldering, or
  embers could light something laid on them. The Air bar is marked at "short" and "choking". Each breath tires
  you a little.
- **Cooking.** Set a vessel down and add ingredients. A vessel's temperature follows the heat where it stands: right
  over the flames a pan burns its contents in seconds, at the edge it fries them, too far and nothing happens. A pot
  holds at the boil while it has water and scorches once it boils dry. **A dry pot is a Dutch oven:** it runs hot and
  scorches what is in it (sooner than a pan). **With water, a stew has to come together:** nothing burns while the water
  lasts, and once everything in it is cooked, about 25 seconds more at the boil turns it into a stew (the panel shows
  "stew forming"). Until then the risk is the water boiling away; a finished stew holds its water better. Pot dishes
  are stews, and any stew is a little kinder to eat than plain boiled food.
- **Water is a wager.** Each water ingredient is one measure to boil away. Water boils off in proportion to how much
  heat the pot gets beyond what it needs to boil: set back at a gentle simmer it keeps for minutes, over the flames
  one measure is gone in under a minute. One measure makes a **rich** stew (half again as good, and it mends a
  little health) with little margin before it boils dry and burns; two make a **thin** one with plenty of margin;
  three or more a **watery** one, worth less. A pot dish is the same dish however much water is in it; its worth
  scales with richness. The panel shows the water left and the richness.
- **Burning.** Food burns three ways (`camp/cooking.js`), each scaled by the ingredient's texture: delicate (eggs,
  greens, fruit, honey, eel) burns half again as fast and has the narrowest window, tough (roots, bone, salt) a
  little over half as fast with the widest, fat (Moonlard) melts into the pan and never dries out.
  - **Sticking.** Cooking without water (a pan, a skewer, a dry or nearly dry pot), food sticks to the metal above
    100°, and stuck food scorches above 140°. **Flip** the pan, **Turn** the skewer or **Stir** the pot (the button in
    the vessel panel, or F) to free it; each costs the vessel a few degrees. The button pulses and the item's bar
    glows red when something is stuck and catching. Fat in a pan greases it: everything sticks and scorches less.
  - **Overcooking.** Each item has a window past done (the green band on its bar). Cooked dry past it, food dries
    out (overdone) and the extra cooking turns to scorch, so food left on the heat creeps from done to overdone to
    burnt even on steady 180° coals, faster the hotter it is. Food in water does not overcook.
  - **Searing.** Above a vessel's burn point (a pan 190°, a skewer 230°, a pot 150°, a dry pot 118°) everything
    scorches regardless: a pan right over the flames burns food before it is done.
  - So a gentle heat is slow and forgiving and a hot one fast and tight: steak-hot coals at 180° with a flip every
    few seconds give a gristle about eight good seconds, 130° about ten, and left alone it burns within about twenty.
  - Food states: raw, cooking, nearly, done, **overdone** (dried out or a little scorched: it does 85% of what it
    would, and a dish with anything overdone gives 75% of its bonus), burnt. Smoke over a vessel builds as it
    catches: wisps where food sticks, then darker smoke as it scorches, then flames licking up from what is burning.
    Food darkens to brown when dried out and black as it burns.
- **Pots and pans hold their heat.** They warm at their own pace but cool slowly (a pot over about a minute, a pan
  over about twenty seconds), so food pulled off the fire keeps cooking, and keeps burning.
- **Coals.** A log that burns out leaves a bed of coals, not quick embers: they glow for many minutes, give a vessel
  set on them strong, steady heat (enough to keep a pot at the boil and a pan frying for minutes after the flames are
  gone), and relight fuel laid on them. Tinder and kindling leave embers that are soon gone.
- **Ash and char.** When the glow goes out, the fire leaves something to keep: tap (or drag to the tray) a cold heap to
  gather it, with anything cold lying beside it. Kindling leaves ash, a log ash and a lump of char where its coals
  went out, and a stick or log put out half-burnt is char. Glowing coals are too hot to pick up. What you keep shows
  under the larder ("Kept from the fire"). Tap a vessel to open its panel: its
  temperature, each ingredient's cooking progress (and scorch), the dish it is becoming, and **Eat** and **Put
  away** buttons. Drawing a vessel to your hands also eats from it.
- **Eating.** Raw food is dangerous, cooked food is barely edible, burnt food hurts. The 20 base ingredients span six
  themes (cosmic, growth, shrine, deep, pilgrim and others) and make 10 dishes. Each dish is a vessel and an exact
  set of ingredients, cooked and not burnt, and gives a bonus.
- **The body.** Five charms hang at the edge of sight: a blood vial (health), the soul lantern (SOUL), a bowl
  (hunger), a waterskin (thirst) and a candle stub (exhaustion). Tap one for how you are.

## Screens bar

Along the bottom of every game screen is a bar for moving between the three screens at any time: **Delve** (the
world), **Camp** and **Body**. Keys 1, 2 and 3 do the same. The Camp tab glows while the fire is alight, and the Body
tab shows how many afflictions have taken hold. The world keeps its place while you are away.

### Experience

The right of the screens bar holds one **experience bar**. Each kind of work has its own skill, level and experience
(`skills/skills.js`), and the bar swaps its name, level and fill to whichever skill last earned something, with what
was just earned beside it; it lights up on a new level. Levels need 30 experience at first, rising (`30 × level^1.4`).

| Skill | Earned by |
| --- | --- |
| Firemaking | each piece catching (tinder 1, kindling 2, fuel 4), coals forming (3), a breath when the fire wanted one (1), gathering ash and char (1 each) |
| Cooking | food cooking: 8 for each item taken from raw to done, earned as it goes, unburnt only; freeing stuck food with a flip or stir (1); eating a dish (10) or a stew (6) |
| Medicine | each right step of a treatment (3, plus 2 per stage), finding out a step (5), a cure (6 per stage) |

The amounts are in `Skills.XP`. Camp time runs through `Camp.advance`, so food cooking and the fire catching earn
experience whichever screen is open. `tests/skills.js` covers levelling.

- **Stirring a pot** shares cooking between its items (half the gap to the average, total kept), so a quick thing slows and a slow thing catches up; scorch stays put.
- **Cooking speed classes.** Ingredients are grouped by how long they take to cook (`CAMP_CLASSES` in `camp/data.js`): **Quick** (up to 13), **Steady** (14 to 25), **Slow** (26 and over), and Water. The larder is laid out in those groups, each item carries its class colour, and a dry vessel mixing classes says "Cooks unevenly": the quick will burn before the slow is done, so fry like with like (or flip and move things along).

- **Meals: worth, names and selling.** A cooked meal has a worth in coin (`worth` in `camp/cooking.js`): each ingredient's price (dearer for what takes longer to cook), by how well it was cooked (most when just done, less overdone, little burnt, none raw), a dish worth more than its parts, a stew by richness. Any burnt item spoils the meal. It is shown in the vessel panel with a grade (Plain, Good, Fine, Superb, or Dry and Spoiled) and a procedural name made from the ingredients, vessel and quality (a known dish keeps its name). **Sell** pays coin (`coin` on the camp, saved) and empties the vessel.

- **Medical is its own class,** like water: anything with `craft` or `liquid` (the Mycelial Lattice, Black Water, Clear Seep, Moon-Milk) gets the `medical` cooking class, its own larder group and mark colour, and is left out of the "cooks unevenly" hint. Water behaviour still follows `water`, so the liquids boil as before.
- **Boiling things down (crafting).** An ingredient with `craft` (the Mycelial Lattice, `craft: 'bandage'`) boiled in a pot with liquids until the pot has come together as a stew becomes goods of that kind instead of a meal: the pot shows its name and a **Take** button. The liquids carry `liquid: { potency, trait }` (Black Water -0.3 Tainted, Clear Seep 0.4 Clean, Moon-Milk 1.0 Soothing); the score is 1 plus their mean potency (thinner with more water), and its tier (`CAMP_CRAFTS`: Poor 0.85, Good 1.4, Excellent 2.0 power) and traits go into each bandage. Kept bandages (`goods` on the camp, saved) appear on the Body screen's roll as the Boiled Bandage, which binds like gauze and gives its dressing to the wound: a healing wound heals `power` times as fast, and says so in its panel and in the medical history. **Any other food boiled in with the lattice adds its balm** (`balm` on each ingredient, table `CAMP_BALMS`; every food has its own): `power` heals faster throughout, `stage` faster while the wound mends back down its stages, `benign` faster while the mark fades, `tonic` gives back health or spirit each minute it heals. Balms add up (capped), their names go into the bandage's name and traits, and the Body screen's dressing note and time-left show them. Burnt food in the pot spoils it. New kinds of goods are a row in `CAMP_CRAFTS` and a material with `craft`.

## Fishing: the black pool

The fourth screen (**Fish**, key 4). It is not a cozy fishing game: what bites is not a fish. `fishing/data.js` (zones, creatures, hours, tuning), `fishing/sim.js` (the rules, no DOM, tested in `tests/fishing.js`), `fishing/fishing.js` (the screen).

- **Cast, wait, hook.** Hold **Cast** to throw further (the shallows, the dark, the deep), with or without bait from your stock (grubs, meat, fungus, sweets, eggs, bone, eyes, fat). A shadow shows under the bobber before the dip; hook at the dip, not before and not after.
- **Bait and the hour decide what bites.** Each creature has what it likes (bait tags, and the exact thing counts for more: marrow for the bone eel, comet honey for the lantern-gape, grubs for the shoal-things) and the hours it keeps (the bell: Dawn, Day, Dusk, Night; a day is 20 minutes of play). The bone eel and the drowner come at night; the pike and eel more by day and at the dawn bell.
- **Every move is told first.** About a second before a thrash, dive or gnaw, the creature tenses: a banner and countdown say what is coming, a ghost marker on the strain gauge shows where the strain would climb if you kept reeling (red when that would harm the line), the line and creature shudder, the screen edge pulses, the phone buzzes, and the Reel button turns red and says **Ease off!**. No pull and no line damage happens during the tell.
- **The fight on the line.** Hold **Reel** and ease off when it surges: a strain gauge, the line's strength, how tired it is, how near. Thrashes and dives (let it run, but not past the end), gnawing at the line. Too much strain breaks the line; too much slack and it spits the hook.
- **The fight on the ledge.** Landed, it is alive: **Strike**, **Brace** (a brace on its attack parries it, and leaves it open for a double blow) or **Cut loose** (losing it). Its attacks cost health and soul, and can wound you through the body screen with a cause (blunt impact, thorn bite, spore cloud, starlight, whispering voices), so a fishing trip ends up in the medical history. Down at zero health, you collapse and lose it.
- **The bone eel** is the one that flies: a snake of small bones that takes the air and circles out of reach. It can only be hit as it swoops in, or when a parry leaves it open.
- **Spoils.** What you kill goes to your stock as ingredients (marrow, eel, leech, spore bladders, lantern eyes, star-gristle), for cooking. Angling is a skill with its own experience.

## Body: afflictions and treatment

The ✚ Body screen: a table by candlelight with **The Pilgrim's Body**, an anatomical chart on which whatever has
taken hold of you shows as living ink, the surgeon's roll of tools, the omen bones and an hourglass. Your needs run
along the top: **HP** and **SOUL** large, with what the afflictions are draining from them a minute, then hunger,
thirst and fatigue.

- **Examining (the X-ray).** Touch an afflicted part and the screen becomes a cure screen after Metal Gear Solid 3:
  an X-ray of the part (skeleton showing through, a scan sweeping down) with the wound circled and a line to its
  status beside it: the ailment's name, its stage, how close it is to worsening, its **condition** (what it looks
  like) and its **cure**, step by step, the current step marked. Several afflictions on one part get tabs; touching
  another afflicted part in the X-ray examines it; ◂ or Escape goes back to the chart.
- **Treat by trying.** Tap a tool to try it as if dragged (on the wound being examined, else the worst active one), or drag a tool onto the X-ray or the panel to use it on that wound (or onto the chart, for the
  worst on that part). You do not know any treatment at first: an ailment is **???** and each step **?** until you
  find the right tool for it. The right tool does the step and reveals it, and the ailment's name with it; a wrong
  one hurts (health and SOUL) but is not used up, and stays listed, crossed out, beside the step you tried it on.
  Each stage of an ailment is learnt separately; once all of a stage's steps are known the pilgrims' note on it
  appears. What you have learnt is kept with the body (`known`, `tried` in `body/sim.js`, read through `chart()`).
- **Ten afflictions** (`body/data.js`), each with three stages: Star-Rot, the Whispering Cyst, Glyph-Burn, the Lantern
  Gaze (head only), Bloom, the Thorn-Leech (limbs), the Bone Choir (limbs), Tide-Lung (torso), the Hollow Hunger
  (torso) and the Fade. Every stage has its own look, a drain on health, SOUL, hunger, thirst and exhaustion, the
  minutes before it worsens, and a chance per minute to **spread to a neighbouring part**. If a stage advances
  mid-treatment, the treatment starts over. The **cautery iron** only works while the camp fire is burning.
- **Healing.** A fully treated wound does not vanish: it **heals** (a stage lower every 1.5 minutes, no draining, spreading
  or worsening), then becomes a **benign** mark of itself (Star-Rot becomes Starmarks, a cyst a Quiet Scar, ...) for 3
  minutes, then is gone (`HEAL` in `body/sim.js`). Only active afflictions drain you or count on the Body tab.
- **Test buttons.** Top right of the Body screen: **Full heal** sets HP and SOUL to 100 and hunger, thirst and
  exhaustion to 0; **+ Wound** rolls a random new affliction.
- **Icons on the chart.** Each affected part wears a small badge per affliction, drawn by kind (`drawIcon` in `body/chart.js`): its colour with stage pips while active, green while healing, grey and faint when benign.
- **Causes and medical history.** Wounds have causes (`BODY_CAUSES`, `BodySim.injure`): a blunt impact breaks a limb's bone or bruises a lung through the chest, a thorn bite leaves a leech burrow, spores a bloom, and so on; where it lands decides which. The **History** button (top right) opens the medical history: one entry per wound, newest first, such as "Blunt impact, chest", with what it was (once you have worked it out), the worst stage it reached, and whether it is untreated, healing, benign or healed (and what it left). Spread wounds read "Spread from left arm, chest". The omen bones and + Wound use `injure`.
- **Tools by kind of work, and wounds that hint.** The roll is grouped and labelled by kind (`BODY_CATS`): **Cutting** (knife, tweezers: swollen, tight or growing things, and what is lodged), **Cleansing** (salt, spirits: what pools, or is foul), **Closing** (thread for edges that will meet, the iron for what is rotting, nested or overgrown), **Herbal** (moss: hot, raw, hungry), **Binding** (gauze or bandage to cover what weeps, splint for what bends wrong) and **Rites** (hymnal, blindfold, wax: what hums, whispers, watches or writes). Every stage's description carries a cue for each tool kind its treatment needs (tests check this), so a player can reason from the description to the kind of tool.
- **Twelve tools**: knife, tweezers, cautery, hymnal and blindfold, plus limited spirits, salt, moss, thread, wax,
  splint and gauze (tally notches show how many are left).
- **The omen bones** roll on the ailment table. **The hourglass** lets five minutes pass for both the body and the camp.
- The stats are shared with the camp, and both keep running: afflictions go on draining you while you cook, and the
  fire goes on burning while you treat yourself. `tests/body.js` covers progression, spread, treatment, discovery and
  the table.

| File | What it holds |
| --- | --- |
| `body/data.js` | Parts, tools and the ailment table. |
| `body/sim.js` | Afflictions advancing, draining and spreading; treatment; what you have learnt (`chart()`). No DOM. |
| `body/chart.js` | Drawing the body in chart space: parts, the marks afflictions leave, the skeleton for the X-ray. |
| `body/body.js` | The screen: the chart, the X-ray and status panel, the needs, the roll, input. |

## Real time and WebAssembly

The explorer is a real-time game loop, rendered like a game: the view renders at a capped resolution (at most 2x, about 1800 px wide) and is upscaled crisply, and the stratum's tint and your light are baked into the small tile layer rather than blended over the whole screen each frame. Input: input is state (held directions plus one buffered tap, so a turn pressed
just before a junction is taken there), movement is one tile per step at a constant speed, chained smoothly
while a direction is held, and the view renders at the display's full rate. Sectors stream in from background
workers that run the generator in **WebAssembly**:

- `wasm/*.c` holds C ports of the two hot kernels, the layout WFC (domains, weights and solve) and the dressing
  WFC. `npm run build` compiles them with clang straight to `wasm/gen.wasm` (no libc, about 20 KB, under a second).
  The .wasm is committed, so the site still needs no build step.
- The ports are **bit-identical** to the JavaScript: same RNG calls in the same order, float32 where the JS uses
  Float32Arrays, and fdlibm's `log` (the algorithm behind V8's `Math.log`). `tests/wasm.js` checks every tile of
  whole sectors in all three presets on every test run, so the JS stays as a reference and a fallback.

### Performance tracking

| Metric | Budget | Where |
| --- | --- | --- |
| Sector generation p95 (WebAssembly, after warm-up) | < 150 ms | `npm run bench` (Node), Perf panel, browser bench |
| Frame interval p95 | < 25 ms (60 fps target) | Perf panel, `npm run bench:browser` (a phone held sideways, 844x390 at 3x) |
| Main-thread work per frame p95 | < 8 ms | Perf panel, browser bench |
| First sector ready after opening | < 1.5 s | Perf panel, browser bench |
| Any single sector (tests) | < 3 s | `tests/world.js` |

`npm run bench` and `npm run bench:browser` (headless Chromium at phone size, walking for 15 s) append a record
with the commit to `perf/history.jsonl` (each worker's first two sectors run slower while the JavaScript stages compile, so the browser bench reports steady-state p95 alongside the overall figure), so every build's numbers stay comparable. In the app, the **Perf** chip
shows the same numbers live, red when over budget.

## Layout

```
gen/mazes.js      maze algorithms + metrics (no DOM, works in Node)
gen/core.js       pipeline: regions, grammar, field, corridors, WFC, validation (no DOM)
workbench/app.js  workbench UI
lab/lab.js        Maze Lab UI
explore/explore.js  walkable explore mode shared by both pages
gen/world.js        infinite world: sector tree, tiers, border contracts, sector generation
infinite/           streaming explorer, generation worker, home page
gen/dressing.js     tilesets, example rooms, materials, learning, dressing WFC
gen/rooms.js        room-based sector layout: themes, room grammar, suites, districts, crossings
camp/               the camp screen: data (fire, vessels, 20 ingredients, dishes), simulation, view
body/               the body screen: ailments, treatment and discovery, the chart and X-ray
skills/             skills and experience, and the experience bar
gen/wasm.js         loads wasm/gen.wasm and swaps in the WebAssembly kernels
wasm/               C sources of the WebAssembly kernels and build.sh
tools/bench.js, tools/bench-browser.py, tools/profile.js   performance tracking
tiles/              Tiles page
tools/autotile.js   authoring helper for example rooms
tools/camp-screen-check.py   plays a scripted camp session with time and randomness fixed and records what the screen shows; diff two builds to prove a change to the screen code changed nothing visible
assets/           shared styles, icons, service worker registration
tests/run.js      generator test suite
```

No build step: the files are served as-is, so pushing to `main` is the deploy.

## Tests

```
npm test            # fast tier: every suite on a small window, about 30 seconds
npm run test:full   # full tier: wider windows, more seeds, a few minutes (run it in the background)
```

Each world run also reports sector generation time (median, p95, max) and fails any sector over a 3 second budget, so real-time streaming stays fast. The suite checks that every maze algorithm yields a perfect maze (also on masked grids), and that every full generation, across both presets, several rule sets and maze algorithms, has every hub reachable, no illegal links between tiers, no branch-cap breaches, no socket mismatches, and is deterministic for a given seed.

## Maze algorithms

| Key | Character |
| --- | --- |
| `backtracker` | Long winding corridors, few branches, long dead-end rivers |
| `growing` | Growing tree, 80% newest / 20% random: winding but bushier |
| `huntkill` | Long corridors, very few dead ends |
| `prim` | Random frontier: short dead ends, radiating texture |
| `kruskal` | Uniform, many short dead ends |
| `wilson` | Loop-erased random walks: an unbiased sample of all mazes |
| `aldous` | Random walk: unbiased, slow to finish |
| `binary` | Fast, strong diagonal bias, open north and east edges |
| `sidewinder` | Horizontal grain, open top row |

In the workbench, the chosen algorithm grows from the pinned corridors through each biome, and each biome still applies its own straightness and braid.
