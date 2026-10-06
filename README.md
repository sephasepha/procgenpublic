# Undercroft Workbench

A phone-friendly workbench for procedural dungeon generation: a progression grammar decides how regions connect, a maze layer gives the space its labyrinth texture, and wave function collapse builds the architecture.

**Live:** https://sephasepha.github.io/procgenpublic/

Open it on your phone and use **Add to Home Screen** to install it as an app. It works offline after the first visit and picks up new versions on reload.

## Pages

- **Infinite** (`index.html`, the home page): an endless world of sectors that generates around you as you walk. It opens straight into the explorer; the menu button (☰) shows world settings and the other tools.
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

## Dressing: example-driven tile WFC

Every cell of a finished layout has a **context** read from the floor/wall pattern around it: a wall with floor below is a south face, a floor with walls left and right is a corridor, and so on (wall faces, outer and inner corners, thin walls, wall ends, pillars, wall shadows, corner shadows, corridors, dead ends, room centres).

Each biome's tileset (`gen/dressing.js`) is a **shared structural kit** drawn in the biome's palette (faces, cracked and coursed faces, corners, thin walls, ends, pillars, floor shadows, corridor edges) plus the biome's own details (niches, sconces, furnaces, pipes, banners, moss, runners, rails, drains, carpets, and 2x2 centrepieces). Tiles are 4×4 pixels, or 8×8 for the Underdark strata, which share an 8×8 structural kit. From hand-drawn example rooms the generator learns, for every tile:

- which contexts it appears in, so faces only go on faces, runners in corridors, centrepieces in room centres,
- its orientation, inferred from context: write a tile's letter anywhere and it turns to face the right way,
- which tiles may sit next to it: **strict** tiles (centrepiece quarters, furnace and grate, runners) keep exactly their example neighbours, so they assemble and continue properly; other tiles may meet anything,
- how often it appears.

A WFC pass with backtracking then fills each sector cell by cell. When drawn, plain floor tiles take a random quarter turn and every tile gets a slight brightness jitter, so repeats don't read as repeats.

To add art: draw a tile as four rows of palette characters, give it an `anchor` if it faces a direction, then use its letter in an example room. `node tools/autotile.js` checks the example rooms and rewrites structural letters to match their geometry. In a 3D engine the same learned rules would place modular meshes.

## Infinite world

The world is an endless grid of sectors, each a full dungeon from the Workbench pipeline (regions, corridors, maze layer, WFC). Sectors are generated in background workers around the player and evicted far away. They regenerate identically, so what you have seen is remembered.

The grammar holds globally even though no sector ever sees the whole world:

- **Connectivity:** every sector links to a parent one step closer to the start, chosen from its own coordinates. All sectors form one tree rooted at the start, so everything is reachable.
- **Tiers:** a sector's tier comes from its distance to the start (`band` sectors per tier, at least 3), cycling through the preset's three tiers (Mazes → Growth → Shrines, or Outer → Works → Keep), then on into the next level. Neighbours differ by at most one tier, so nothing can skip one.
- **Caps:** extra loop doorways only join sectors of the same tier, and the parent choice avoids axis sectors, so no sector has more than two cross-tier branches.
- **Seams you don't notice:** sector grids overlap their neighbours by a few cells, and each shared border has one contract, computed from that border's coordinates: a wobbly line (up to ±4 cells) that decides which sector owns each overlapping cell, whether the border is open, and where its doorways are. Same-tier borders usually open with several narrow doorways; borders between tiers keep a single designed seal. Both neighbours compute the contract independently, so generation order never matters, and the border reads as one more irregular wall of the labyrinth.
- **Doctrine (Arsenal):** you enter the Keep only through Checkpoints, you leave it only through a Vault, which is the descent to the next level's Gatehouse, and Works sectors place foundries with power and cooling, away from magazines.
- **Validation:** each sector is checked as it generates: every hub and doorway inside must connect, and otherwise it retries deterministically.

The **Rules** panel in the explorer re-checks these live against every loaded sector. `tests/world.js` checks them over every sector within a few steps of the start: doorways meet edge to edge, every cell belongs to exactly one sector, floors of two sectors only ever touch at a doorway, and sectors come out identical in any generation order.

## Layout

```
gen/mazes.js      maze algorithms + metrics (no DOM, works in Node)
gen/core.js       pipeline: regions, grammar, field, corridors, WFC, validation (no DOM)
workbench/app.js  workbench UI
lab/lab.js        Maze Lab UI
explore/explore.js  walkable explore mode shared by both pages
gen/world.js        infinite world: sector tree, tiers, border contracts, sector generation
infinite/           streaming explorer, generation worker, home page
gen/dressing.js     tilesets, example rooms, learning, dressing WFC
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
