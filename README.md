# Undercroft Workbench

A phone-friendly workbench for procedural dungeon generation: a progression grammar decides how regions connect, a maze layer gives the space its labyrinth texture, and wave function collapse builds the architecture.

**Live:** https://sephasepha.github.io/procgenpublic/

Open it on your phone and use **Add to Home Screen** to install it as an app. It works offline after the first visit and picks up new versions on reload.

## Pages

- **Infinite** (`index.html`, the home page): an endless world of sectors that generates around you as you walk. It opens straight into a full-screen game view, landscape first: drag anywhere to walk (a thumb-stick appears under your thumb; arrow keys or WASD on a keyboard), round buttons for Light, Map, Tiles, Rules and Perf, the minimap top right, and where you are (stratum, district theme, room) top left. Installed to the home screen it opens full screen in landscape. The menu button (☰) shows world settings and the other tools.
- **Workbench** (`workbench.html`): the full pipeline for one dungeon in seven stages: hubs → candidate links → progression rules → style field → corridors and maze → WFC → validation. Generic, Arsenal and Underdark presets.
- **Maze Lab** (`lab.html`): nine classic maze algorithms on a plain grid, with carving replay, overlays and a comparison table.
- **Tiles** (`tiles.html`): the hand-drawn tilesets and example rooms the dressing WFC learns from, the learned neighbour rules for each tile, and a freshly dressed patch.

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

Each biome's tileset (`gen/dressing.js`) is a **shared structural kit** drawn in the biome's palette (faces, cracked and coursed faces, corners, thin walls, ends, pillars, floor shadows, corridor edges) plus the biome's own details (niches, sconces, furnaces, pipes, banners, moss, runners, rails, drains, carpets, and 2x2 centrepieces). Tiles are 4×4 pixels, or 8×8 for the Underdark strata, which share an 8×8 structural kit. From hand-drawn example rooms the generator learns, for every tile:

- which contexts it appears in, so faces only go on faces, runners in corridors, centrepieces in room centres,
- its orientation, inferred from context: write a tile's letter anywhere and it turns to face the right way,
- which tiles may sit next to it: **strict** tiles (centrepiece quarters, furnace and grate, runners) keep exactly their example neighbours, so they assemble and continue properly; other tiles may meet anything,
- how often it appears.

A WFC pass with backtracking then fills each sector cell by cell. When drawn, plain floor tiles take a random quarter turn and every tile gets a slight brightness jitter, so repeats don't read as repeats.

To add set dressing without drawing new example rooms, give a tile `like: 'X'` and a `share`: it goes wherever tile X was learned (same contexts, same turning) at that share of X's weight, so `like: 'F'` is a floor prop, `like: 'A'` a wall-face variant, `like: 'K'` something standing against a wall. To add art: draw a tile as rows of palette characters, give it an `anchor` if it faces a direction, then use its letter in an example room. `node tools/autotile.js` checks the example rooms and rewrites structural letters to match their geometry. In a 3D engine the same learned rules would place modular meshes.

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

The **Camp** button (♨) in the explorer switches to a second screen: a fixed first-person view down at a fire pit
on the cavern floor. It is two mini-games run by a small simulation (`camp/sim.js`, no DOM, tested in
`tests/camp.js`), and it is entirely diegetic: no bars or menus, only things in the scene.

- **Making and keeping a fire.** Drag tinder, kindling and fuel from the kit cloth onto the floor and draw the
  striker over the tinder. Every piece has a temperature and a remaining mass; its temperature relaxes towards
  what the flames around it give, its own flame if it burns, less what cold mass beside it soaks up. Burning
  needs air, and packing things together takes it away. So tinder lights kindling laid around it; a log on a
  bed of burning kindling catches; a lone log dies; logs in pairs keep each other going; and heaping on kindling
  or fuel, or dropping a log on a small flame, smothers the fire, which then has to be laid and struck again.
  Burnt-out pieces leave embers that fade over a minute or so. A tended fire burns for as long as you feed it.
- **Cooking.** Put out the pot, pan or skewer and drag ingredients onto it. A vessel's temperature follows the heat
  where it stands: right over the flames a pan burns its contents in seconds, at the edge it fries them, too far
  and nothing happens. A pot holds at the boil while it has water and scorches once it boils dry. Juggling the
  vessels while feeding the fire is the game.
- **Eating.** Draw a vessel to your hands at the bottom of the view. Raw food is dangerous, cooked food is barely
  edible, burnt food hurts. 20 base ingredients across six themes (cosmic, growth, shrine, deep, pilgrim...) make
  10 dishes, each a vessel and an exact set of ingredients, cooked and not burnt, for a bonus.
- **The body.** Five charms hang at the edge of sight: a blood vial (health), the soul lantern (SOUL), a bowl
  (hunger), a waterskin (thirst) and a candle stub (exhaustion). Hunger and thirst grow with time; resting by a
  burning fire eases exhaustion and feeds the soul; the cold dark does the opposite.
- **Everything else is in the scene too:** counts are tally notches on the cloths, cooking shows as browning,
  steam, bubbles and smoke, the sack beside the pit is foraging, the tunnel in the wall is the way back, and
  touching anything leaves a scrawled paper note about it.

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
gen/wasm.js         loads wasm/gen.wasm and swaps in the WebAssembly kernels
wasm/               C sources of the WebAssembly kernels and build.sh
tools/bench.js, tools/bench-browser.py, tools/profile.js   performance tracking
tiles/              Tiles page
tools/autotile.js   authoring helper for example rooms
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
