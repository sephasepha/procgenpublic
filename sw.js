// Network first, so every push shows up on the next reload; the cache only answers when offline.
const CACHE = 'undercroft-v69';
const SHELL = ['./', 'index.html', 'delve.html', 'workbench.html', 'lab.html', 'tiles.html', 'voxels.html', 'voxels/gen.js', 'voxels/structures.js', 'voxels/walk.js', 'voxels/dress3d.js', 'voxels/vendor/OBJLoader.js', 'voxels/tiles/arch.obj', 'voxels/tiles/deck_plain.obj', 'voxels/tiles/deck_slats.obj', 'voxels/tiles/door_c.obj', 'voxels/tiles/door_n.obj', 'voxels/tiles/door_p.obj', 'voxels/tiles/entrance.obj', 'voxels/tiles/floor_grate.obj', 'voxels/tiles/floor_hole_r1.obj', 'voxels/tiles/floor_hole_r3.obj', 'voxels/tiles/floor_plain.obj', 'voxels/tiles/goal_beacon.obj', 'voxels/tiles/mass_plain.obj', 'voxels/tiles/mass_ribbed.obj', 'voxels/tiles/rail.obj', 'voxels/tiles/roof_plain.obj', 'voxels/tiles/roof_vents.obj', 'voxels/tiles/shaft_ladder.obj', 'voxels/tiles/stair_r1.obj', 'voxels/tiles/stair_r3.obj', 'voxels/tiles/stair_run.obj', 'voxels/tiles/tileset.json', 'voxels/tiles/wall_banded.obj', 'voxels/tiles/wall_plain.obj', 'voxels/tiles/wall_ribbed.obj', 'voxels/tiles/window_barred.obj', 'voxels/tiles/window_slot.obj', 'voxels/view.js', 'voxels/vendor/three.module.min.js', 'voxels/vendor/OrbitControls.js', 'tiles/tiles.js', 'gen/dressing.js', 'gen/rooms.js', 'assets/style.css', 'gen/mazes.js', 'gen/core.js', 'workbench/app.js', 'lab/lab.js', 'explore/explore.js', 'gen/world.js', 'infinite/infinite.js', 'skills/skills.js', 'skills/bar.js', 'camp/data.js', 'camp/fire.js', 'camp/cooking.js', 'camp/sim.js', 'camp/view.js', 'camp/draw.js', 'camp/panels.js', 'camp/camp.js', 'body/data.js', 'body/sim.js', 'body/chart.js', 'body/body.js', 'fishing/data.js', 'fishing/sim.js', 'fishing/fishing.js', 'walk/spawn.js', 'walk/walk.js', 'mega.html', 'mega/world.js', 'mega/body.js', 'mega/game.js', 'infinite/nav.js', 'infinite/page.js', 'infinite/worker.js', 'gen/wasm.js', 'wasm/gen.wasm', 'assets/sw-register.js', 'assets/build.js', 'manifest.webmanifest', 'assets/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    // 'no-cache' makes the browser revalidate with the server every time, so a deploy is never mixed with old files
    fetch(req, new URL(req.url).origin === location.origin ? { cache: 'no-cache' } : {}).then(res => {
      if (res.ok && new URL(req.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./')))
  );
});
