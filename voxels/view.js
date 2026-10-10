// Voxels viewer: renders a chunk (pillars from gen.js, or an explorable structure from structures.js)
// as one InstancedMesh with orbit controls, plus debug overlays: markers, walking route, slice.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const { generateVoxels, voxelComponents, generateStructure, walkCheck, STRUCTURE_SHAPES, SVOX: V, SVOX_NAMES, SVOX_SOLID } = window;
const $ = id => document.getElementById(id);
const SHAPE_NAMES = { tower: 'Tower', mega: 'Megastructure', pyramid: 'Pyramid labyrinth', column: 'Sunken column', pillars: 'Pillars and bridges' };

// ---- settings, mirrored into the URL hash ----
const DEF = { shape: 'tower', seed: 1, size: 6, storeys: 8, rooms: 3, shafts: 1, braid: 100, towers: 6, maxh: 40, loops: 25, slice: 63, color: 'type', grid: 0, bounds: 1, edges: 0, spin: 0, markers: 1, path: 1 };
const S = Object.assign({}, DEF);
for (const kv of location.hash.slice(1).split('&')) {
  const [k, v] = kv.split('=');
  if (k in DEF) S[k] = typeof DEF[k] === 'number' ? (Number(v) || 0) : v;
}
if (!SHAPE_NAMES[S.shape]) S.shape = DEF.shape;
const writeHash = () => history.replaceState(null, '', '#' + Object.keys(DEF).map(k => k + '=' + S[k]).join('&'));

// ---- three.js scene ----
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c10);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30281c, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 1, 0.35);
scene.add(sun);

const box = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
let mesh = null, marks = null, edgeLines = null, pathLine = null, gridHelper = null, boundsHelper = null;
let chunk = null, walk = null;

const TYPE_COLORS = {
  [V.GROUND]: 0x3d4b3a, [V.WALL]: 0x8a93a6, [V.FLOOR]: 0x5d6475, [V.DECK]: 0xe08a2e, [V.RAIL]: 0xf2d04b,
  [V.ROOF]: 0xb85a5a, [V.STAIR]: 0xd9a441, [V.SHAFT]: 0xb388ff, [V.DOOR]: 0x4fc3f7, [V.ENTRANCE]: 0x69f0ae, [V.GOAL]: 0xff4d6d
};
const KIND_COLORS = { hall: 0x8a93a6, room: 0x6fa8dc, shaft: 0xb388ff, atrium: 0x4dd0c4, bridge: 0xe08a2e, entrance: 0x69f0ae, goal: 0xff4d6d };
const MARK_SIZE = { [V.SHAFT]: 0.22, [V.DOOR]: 0.32, [V.ENTRANCE]: 0.55, [V.GOAL]: 0.95 };
const OWNER_PALETTE = [0x5fa8e8, 0xe86f5f, 0x6fd08a, 0xc58be8, 0xe8c55f, 0x5fe0d6, 0xe85fb0, 0x9ad05f, 0x8a8ae8, 0xe8995f];

function hash3(x, y, z) { let h = x * 374761393 + y * 668265263 + z * 2147483647; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const isStructure = () => S.shape !== 'pillars';

function colorFor(t, own, x, y, z, out) {
  const ground = t === V.GROUND;
  if (S.color === 'height' && !ground) out.setHSL(0.7 - 0.7 * (y / chunk.H), 0.65, 0.55);
  else if (S.color === 'kind' && !ground && isStructure() && own >= 0) {
    out.setHex(t === V.STAIR ? TYPE_COLORS[V.STAIR] : KIND_COLORS[chunk.regionKind[own]] || 0xffffff);
  } else if (S.color === 'owner' && !ground) {
    if (t === V.DECK || t === V.RAIL) out.setHex(0xffffff).lerp(new THREE.Color(OWNER_PALETTE[(own + 3) % OWNER_PALETTE.length]), 0.55);
    else out.setHex(OWNER_PALETTE[Math.max(0, own) % OWNER_PALETTE.length]);
  } else out.setHex(TYPE_COLORS[t] || 0xff00ff);
  out.multiplyScalar(0.9 + 0.12 * hash3(x, y, z)); // tiny per-voxel jitter keeps voxels readable
  if (ground && (x + z) % 2) out.multiplyScalar(0.88);
}

function build() {
  if (isStructure()) {
    chunk = generateStructure(S.shape, { seed: S.seed, size: S.size, storeys: S.storeys, rooms: S.rooms, shafts: S.shafts, braid: S.braid });
    walk = walkCheck(chunk);
    // region kind per region, with the entrance and goal regions called out
    chunk.regionKind = chunk.regions.map(r => r.kind);
    for (const c of chunk.cells) if (c.kind === 'entrance' || c.kind === 'goal') chunk.regionKind[c.region] = c.kind;
  } else {
    chunk = generateVoxels({ seed: S.seed, towers: S.towers, maxH: S.maxh, loops: S.loops });
    chunk.focusY = 14; walk = null;
  }
  // the slice bar runs from the ground (or the bottom of a sunken structure) to the top of the content
  let top = 0;
  for (let i = chunk.vox.length - 1; i >= 0; i--) if (SVOX_SOLID[chunk.vox[i]]) { top = Math.floor(i / (chunk.W * chunk.D)); break; }
  sliceMax = top; sliceMin = 0;
  if (S.slice > sliceMax || S.slice < sliceMin) S.slice = sliceMax;
  sliceBar();
  rebuildMesh();
  fitHelpers();
  updateHud();
  legend();
}

// ---- slice bar (in the diorama) ----
let sliceMax = 63, sliceMin = 0;
const bar = $('slicebar');
function sliceBar() {
  const span = Math.max(1, sliceMax - sliceMin), f = (S.slice - sliceMin) / span;
  $('sliceThumb').style.bottom = (f * 100) + '%';
  $('sliceFill').style.height = (f * 100) + '%';
  $('sliceThumb').textContent = S.slice >= sliceMax ? 'all' : S.slice;
  bar.setAttribute('aria-valuemin', sliceMin); bar.setAttribute('aria-valuemax', sliceMax); bar.setAttribute('aria-valuenow', S.slice);
  bar.setAttribute('aria-valuetext', S.slice >= sliceMax ? 'showing everything' : 'hiding above ' + S.slice);
  // a tick at the top of each storey's headroom, so one tap lands on a clean cut through that storey
  let ticks = '';
  if (chunk && chunk.cells) {
    const ys = [...new Set(chunk.cells.map(c => c.origin[1] + chunk.S - 1))];
    for (const y of ys) ticks += `<div class="tick" style="bottom:${((y - sliceMin) / span) * 100}%"></div>`;
  }
  $('sliceTicks').innerHTML = ticks;
}
let sliceQueued = false;
function setSlice(v, snap) {
  v = Math.max(sliceMin, Math.min(sliceMax, Math.round(v)));
  if (snap && chunk.cells) {
    // land on the nearest storey tick when close to one
    for (const c of chunk.cells) { const y = c.origin[1] + chunk.S - 1; if (Math.abs(y - v) <= 1) { v = y; break; } }
  }
  if (v === S.slice) return;
  S.slice = v; sliceBar();
  if (!sliceQueued) { sliceQueued = true; requestAnimationFrame(() => { sliceQueued = false; rebuildMesh(); updateHud(); writeHash(); }); }
}
const sliceFromY = clientY => { const r = bar.getBoundingClientRect(); return sliceMin + (1 - (clientY - r.top) / r.height) * (sliceMax - sliceMin); };
bar.addEventListener('pointerdown', e => { bar.setPointerCapture(e.pointerId); bar.dataset.drag = '1'; setSlice(sliceFromY(e.clientY)); e.preventDefault(); });
bar.addEventListener('pointermove', e => { if (bar.dataset.drag) setSlice(sliceFromY(e.clientY)); });
const endDrag = e => { if (!bar.dataset.drag) return; delete bar.dataset.drag; setSlice(sliceFromY(e.clientY), true); };
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', () => { delete bar.dataset.drag; });
bar.addEventListener('keydown', e => {
  const step = e.shiftKey ? 4 : 1;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setSlice(S.slice + step);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setSlice(S.slice - step);
  else if (e.key === 'Home') setSlice(sliceMin); else if (e.key === 'End') setSlice(sliceMax);
  else return;
  e.preventDefault();
});

function rebuildMesh() {
  const { W, H, D, vox, owner } = chunk;
  const cut = S.slice;
  const solid = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < W && z < D && y < H && y <= cut && SVOX_SOLID[vox[x + z * W + y * W * D]] === 1;
  const list = [], markList = [];
  for (let y = 0; y < H && y <= cut; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = x + z * W + y * W * D, t = vox[i];
    if (!t) continue;
    if (!SVOX_SOLID[t]) { if (S.markers && MARK_SIZE[t]) markList.push(i); continue; }
    // only voxels with at least one open face; the underside of the ground plate counts as closed
    if (solid(x + 1, y, z) && solid(x - 1, y, z) && solid(x, y + 1, z) && (t === V.GROUND || solid(x, y - 1, z)) && solid(x, y, z + 1) && solid(x, y, z - 1)) continue;
    list.push(i);
  }
  for (const o of [mesh, marks]) if (o) { scene.remove(o); o.dispose(); }
  if (edgeLines) { scene.remove(edgeLines); edgeLines.geometry.dispose(); edgeLines = null; }
  const m = new THREE.Matrix4(), c = new THREE.Color(), ox = -W / 2 + 0.5, oz = -D / 2 + 0.5;
  const dec = i => { const y = Math.floor(i / (W * D)), r = i % (W * D); return [r % W, y, Math.floor(r / W)]; };
  mesh = new THREE.InstancedMesh(box, mat, Math.max(1, list.length));
  mesh.count = list.length;
  list.forEach((i, n) => {
    const [x, y, z] = dec(i);
    m.makeTranslation(x + ox, y + 0.5, z + oz); mesh.setMatrixAt(n, m);
    colorFor(vox[i], owner[i], x, y, z, c); mesh.setColorAt(n, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  marks = new THREE.InstancedMesh(box, markMat, Math.max(1, markList.length));
  marks.count = markList.length;
  markList.forEach((i, n) => {
    const [x, y, z] = dec(i), s = MARK_SIZE[vox[i]];
    m.makeScale(s, s, s).setPosition(x + ox, y + 0.5, z + oz); marks.setMatrixAt(n, m);
    marks.setColorAt(n, c.setHex(TYPE_COLORS[vox[i]]));
  });
  marks.instanceMatrix.needsUpdate = true;
  if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
  marks.renderOrder = 2;
  scene.add(marks);

  if (S.edges) {
    const e = new THREE.EdgesGeometry(box), base = e.attributes.position.array, pts = [];
    for (const i of list) {
      if (vox[i] === V.GROUND) continue; // the plate would be thousands of lines for no information
      const [x, y, z] = dec(i);
      for (let k = 0; k < base.length; k += 3) pts.push(base[k] + x + ox, base[k + 1] + y + 0.5, base[k + 2] + z + oz);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    edgeLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    scene.add(edgeLines);
  }

  if (pathLine) { scene.remove(pathLine); pathLine.geometry.dispose(); pathLine = null; }
  if (S.path && walk && walk.path.length) {
    // the route an explorer walks from outside the entrance to the goal, drawn through walls
    const pts = walk.path.map(([x, y, z]) => new THREE.Vector3(x + ox, y + 0.45, z + oz));
    pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff4d6d, depthTest: false, transparent: true, opacity: 0.9 }));
    pathLine.renderOrder = 3;
    scene.add(pathLine);
  }
  $('hud').dataset.drawn = list.length;
}

function fitHelpers() {
  const { W, H, D } = chunk;
  if (gridHelper) scene.remove(gridHelper);
  if (boundsHelper) scene.remove(boundsHelper);
  gridHelper = new THREE.GridHelper(Math.max(W, D), Math.max(W, D), 0x7a6a3a, 0x2a2e38);
  gridHelper.position.y = (chunk.groundY || 0) + 1.01;
  gridHelper.visible = !!S.grid;
  scene.add(gridHelper);
  boundsHelper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-W / 2, 0, -D / 2), new THREE.Vector3(W / 2, H, D / 2)), 0x4a5a8a);
  boundsHelper.visible = !!S.bounds;
  scene.add(boundsHelper);
  resetCamera();
}

function resetCamera() {
  // frame the structure (or the whole chunk for pillars), backing off on narrow portrait views
  let cx = 0, cz = 0, ext = chunk ? Math.max(chunk.W, chunk.D) : 64, fy = chunk ? chunk.focusY : 14;
  if (chunk && chunk.bounds) {
    const b = chunk.bounds;
    cx = (b.x0 + b.x1) / 2 - chunk.W / 2; cz = (b.z0 + b.z1) / 2 - chunk.D / 2;
    ext = Math.max(b.x1 - b.x0, b.z1 - b.z0, (b.y1 - b.y0) * 1.1) * 1.25 + 8;
  }
  const s = ext * Math.max(1, 1.1 / camera.aspect);
  // from the front-right, where the ground-floor entrances face
  camera.position.set(cx + s * 0.95, fy + s * 0.7, cz - s * 0.95);
  controls.target.set(cx, fy, cz);
  controls.update();
}

function updateHud() {
  let html = `<b>${SHAPE_NAMES[S.shape]}</b> · ${chunk.W}×${chunk.H}×${chunk.D}<br>`;
  if (isStructure()) {
    const k = { hall: 0, room: 0, shaft: 0, bridge: 0 }; for (const r of chunk.regions) k[r.kind] = (k[r.kind] || 0) + 1;
    html += `${chunk.cells.length} cells · ${k.hall} halls · ${k.room} rooms · ${k.shaft} shafts` + (k.bridge ? ` · ${k.bridge} bridges` : '') + '<br>' +
      `${chunk.stairs} stairs · ${chunk.deadEnds} dead end${chunk.deadEnds === 1 ? '' : 's'}<br>` +
      (walk.ok ? `walk check ✓ all ${walk.cells} cells reachable and returnable` : `<b>walk check ✗ ${walk.bad.length} cells unreachable</b>`) + '<br>' +
      (walk.path.length ? `route to goal: ${walk.path.length} steps` : '<b>no route to goal</b>');
  } else {
    const comps = voxelComponents(chunk), loops = chunk.bridges.filter(b => !b.tree).length;
    html += `${chunk.towers.length} towers · ${chunk.bridges.length} bridges (${loops} loop)<br>` +
      (comps === 1 ? 'all towers connected' : `<b>${comps} disconnected groups</b>`);
  }
  html += `<br>${chunk.count.toLocaleString()} voxels · ${Number($('hud').dataset.drawn).toLocaleString()} drawn`;
  $('hud').innerHTML = html;
  $('seedOut').textContent = S.seed;
  $('shapeName').innerHTML = `${SHAPE_NAMES[S.shape]}<small>${SHAPE_ORDER.indexOf(S.shape) + 1} / ${SHAPE_ORDER.length}</small>`;
}

function legend() {
  const L = $('legend');
  const sw = (col, label) => `<span><i style="background:#${col.toString(16).padStart(6, '0')}"></i>${label}</span>`;
  if (S.color === 'type') {
    const present = new Set(chunk.vox);
    L.innerHTML = Object.entries(TYPE_COLORS).filter(([t]) => present.has(Number(t))).map(([t, col]) => sw(col, SVOX_NAMES[t] + (SVOX_SOLID[t] ? '' : ' ◦'))).join('') +
      (isStructure() ? '<span>◦ marker, not solid</span>' : '');
  } else if (S.color === 'kind') L.innerHTML = Object.entries(KIND_COLORS).map(([k, col]) => sw(col, k)).join('') + sw(TYPE_COLORS[V.STAIR], 'stair');
  else if (S.color === 'owner') L.innerHTML = '<span>Each tower, bridge or region its own colour</span>';
  else L.innerHTML = '<span><i style="background:hsl(252,65%,55%)"></i>low</span><span><i style="background:hsl(0,65%,55%)"></i>high</span>';
}

// ---- controls panel ----
const sliders = [
  ['pTowers', 'vTowers', 'towers', true], ['pMaxH', 'vMaxH', 'maxh', true], ['pLoops', 'vLoops', 'loops', true, '%'],
  ['pSize', 'vSize', 'size', true], ['pStoreys', 'vStoreys', 'storeys', true], ['pRooms', 'vRooms', 'rooms', true],
  ['pShafts', 'vShafts', 'shafts', true], ['pBraid', 'vBraid', 'braid', true, '%']
];
const syncSliders = () => { for (const [inp, out, key, , unit] of sliders) { $(inp).value = S[key]; $(out).textContent = S[key] + (unit || ''); } };
for (const [inp, out, key, regen, unit] of sliders) {
  const el = $(inp);
  el.addEventListener('input', () => {
    S[key] = Number(el.value); $(out).textContent = S[key] + (unit || '');
    if (regen) build(); else { rebuildMesh(); updateHud(); }
    writeHash();
  });
}
syncSliders();
const showShapeControls = () => document.querySelectorAll('[data-shapes]').forEach(el => { el.hidden = !el.dataset.shapes.split(' ').includes(S.shape); });
function chipGroup(id, isOn, onClick) {
  const btns = [...$(id).querySelectorAll('button')];
  const sync = () => btns.forEach(b => b.classList.toggle('on', isOn(b.dataset.v)));
  btns.forEach(b => b.addEventListener('click', () => { onClick(b.dataset.v); sync(); writeHash(); }));
  sync();
  return sync;
}
const SHAPE_ORDER = ['tower', 'mega', 'pyramid', 'column', 'pillars'];
function setShape(v) {
  if (S.shape === v) return;
  S.shape = v;
  const d = STRUCTURE_SHAPES[v];
  if (d) Object.assign(S, { size: d.size, storeys: d.storeys, rooms: d.rooms, shafts: d.shafts, braid: d.braid });
  S.slice = 999; // a new structure starts uncut
  syncSliders(); showShapeControls(); build(); syncShapeChips();
}
const syncShapeChips = chipGroup('shapes', v => S.shape === v, setShape);
const stepShape = d => { setShape(SHAPE_ORDER[(SHAPE_ORDER.indexOf(S.shape) + d + SHAPE_ORDER.length) % SHAPE_ORDER.length]); writeHash(); };
$('prevShape').addEventListener('click', () => stepShape(-1));
$('nextShape').addEventListener('click', () => stepShape(1));
chipGroup('colorBy', v => S.color === v, v => { S.color = v; rebuildMesh(); legend(); });
chipGroup('toggles', v => !!S[v], v => {
  S[v] = S[v] ? 0 : 1;
  if (v === 'grid') gridHelper.visible = !!S.grid;
  if (v === 'bounds') boundsHelper.visible = !!S.bounds;
  if (v === 'edges' || v === 'markers' || v === 'path') rebuildMesh();
  if (v === 'spin') controls.autoRotate = !!S.spin;
});
$('regen').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 99999); build(); writeHash(); });
$('resetCam').addEventListener('click', resetCamera);
controls.autoRotate = !!S.spin;
controls.addEventListener('start', () => { if (S.spin) { S.spin = 0; controls.autoRotate = false; $('toggles').querySelector('[data-v=spin]').classList.remove('on'); writeHash(); } });

// ---- size + loop ----
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

resize(); showShapeControls(); build(); writeHash();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
window.VoxelView = {
  state: () => ({ S, drawn: mesh.count, marks: marks.count, walk: walk && { ok: walk.ok, bad: walk.bad.length, path: walk.path.length }, deadEnds: chunk.deadEnds }),
  chunk: () => chunk
};
