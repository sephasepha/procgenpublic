# Undercroft Workbench

A phone-friendly workbench for procedural dungeon generation: a progression grammar decides how regions connect, a maze layer gives the space its labyrinth texture, and wave function collapse builds the architecture.

**Live:** https://sephasepha.github.io/procgenpublic/

Open it on your phone and use **Add to Home Screen** to install it as an app. It works offline after the first visit and picks up new versions on reload.

## Pages

- **Workbench** (`index.html`): the full pipeline in seven stages: hubs → candidate links → progression rules → style field → corridors and maze → WFC → validation. Two presets:
  - *Generic*: Easy / Medium / Hard tiers with four biomes.
  - *Arsenal*: a dead empire's arsenal with clearance rings, function nodes assigned by doctrine, and a ruin pass that opens breaches.
- **Maze Lab** (`lab.html`): nine classic maze algorithms on a plain grid, with carving replay, solution and distance overlays, and a comparison table across many seeds.

Both pages have an **Explore** mode: you start at the entrance and walk the generated space with an on-screen arrow pad, swipes or the keyboard. A light radius spreads along corridors (never through walls), explored areas stay dimly mapped, **Run** follows a corridor to the next junction, and reaching the goal (the maze exit, or the Vault / deepest hub in a dungeon) shows your steps against the shortest route.

Every setting lives in the page URL, so any generation can be bookmarked, shared or replayed exactly.

## Layout

```
gen/mazes.js      maze algorithms + metrics (no DOM, works in Node)
gen/core.js       pipeline: regions, grammar, field, corridors, WFC, validation (no DOM)
workbench/app.js  workbench UI
lab/lab.js        Maze Lab UI
explore/explore.js  walkable explore mode shared by both pages
assets/           shared styles, icons, service worker registration
tests/run.js      generator test suite
```

No build step: the files are served as-is, so pushing to `main` is the deploy.

## Tests

```
npm test          # full suite, about a minute
QUICK=1 npm test  # short run
```

The suite checks that every maze algorithm yields a perfect maze (also on masked grids), and that every full generation, across both presets, several rule sets and maze algorithms, has every hub reachable, no illegal links between tiers, no branch-cap breaches, no socket mismatches, and is deterministic for a given seed.

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
