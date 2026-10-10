// Voxel Pillars viewer: renders the chunk from gen.js as one InstancedMesh with orbit controls.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const { generateVoxels, voxelComponents, VOXEL, VOXEL_NAMES } = window;
const $ = id => document.getElementById(id);

// ---- settings, mirrored into the URL hash ----
const DEF = { seed: 1, towers: 6, maxh: 40, loops: 25, slice: 47, color: 'type', grid: 1, bounds: 1, edges: 0, spin: 0 };
const S = Object.assign({}, DEF);
for (const kv of location.hash.slice(1).split('&')) {
  const [k, v] = kv.split('=');
  if (k in DEF) S[k] = typeof DEF[k] === 'number' ? (Number(v) || 0) : v;
}
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
let mesh = null, edgeLines = null, gridHelper = null, boundsHelper = null, chunk = null;

const TYPE_COLORS = {
  [VOXEL.GROUND]: 0x3d4b3a, [VOXEL.WALL]: 0x8a93a6, [VOXEL.FLOOR]: 0x5d6475,
  [VOXEL.DECK]: 0xe08a2e, [VOXEL.RAIL]: 0xf2d04b, [VOXEL.ROOF]: 0xb85a5a
};
const OWNER_PALETTE = [0x5fa8e8, 0xe86f5f, 0x6fd08a, 0xc58be8, 0xe8c55f, 0x5fe0d6, 0xe85fb0, 0x9ad05f, 0x8a8ae8, 0xe8995f];

function hash3(x, y, z) { let h = x * 374761393 + y * 668265263 + z * 2147483647; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function colorFor(t, own, x, y, z, out) {
  if (S.color === 'height' && t !== VOXEL.GROUND) out.setHSL(0.7 - 0.7 * (y / chunk.H), 0.65, 0.55);
  else if (S.color === 'owner' && t !== VOXEL.GROUND) {
    if (t === VOXEL.DECK || t === VOXEL.RAIL) out.setHex(0xffffff).lerp(new THREE.Color(OWNER_PALETTE[(own + 3) % OWNER_PALETTE.length]), 0.55);
    else out.setHex(OWNER_PALETTE[Math.max(0, own) % OWNER_PALETTE.length]);
  } else out.setHex(TYPE_COLORS[t] || 0xff00ff);
  // tiny per-voxel jitter so individual voxels stay readable
  out.multiplyScalar(0.9 + 0.12 * hash3(x, y, z));
  if (t === VOXEL.GROUND && (x + z) % 2) out.multiplyScalar(0.88);
}

function build() {
  chunk = generateVoxels({ seed: S.seed, towers: S.towers, maxH: S.maxh, loops: S.loops });
  rebuildMesh();
  fitHelpers();
  updateHud();
}

function rebuildMesh() {
  const { W, H, D, vox, owner } = chunk;
  const cut = S.slice;
  const solid = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < W && z < D && y < H && y <= cut && vox[x + z * W + y * W * D] !== 0;
  // Only voxels with at least one open face; the bottom of the ground plate counts as closed
  const list = [];
  for (let y = 0; y < H && y <= cut; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = x + z * W + y * W * D;
    if (!vox[i]) continue;
    if (solid(x + 1, y, z) && solid(x - 1, y, z) && solid(x, y + 1, z) && (y === 0 || solid(x, y - 1, z)) && solid(x, y, z + 1) && solid(x, y, z - 1)) continue;
    list.push(i);
  }
  if (mesh) { scene.remove(mesh); mesh.dispose(); }
  if (edgeLines) { scene.remove(edgeLines); edgeLines.geometry.dispose(); edgeLines = null; }
  mesh = new THREE.InstancedMesh(box, mat, Math.max(1, list.length));
  mesh.count = list.length;
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const ox = -W / 2 + 0.5, oz = -D / 2 + 0.5;
  list.forEach((i, n) => {
    const y = Math.floor(i / (W * D)), r = i % (W * D), z = Math.floor(r / W), x = r % W;
    m.makeTranslation(x + ox, y + 0.5, z + oz);
    mesh.setMatrixAt(n, m);
    colorFor(vox[i], owner[i], x, y, z, c);
    mesh.setColorAt(n, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  if (S.edges) {
    // Outline every drawn voxel above the ground (skip the plate: thousands of lines, little information)
    const e = new THREE.EdgesGeometry(box), base = e.attributes.position.array, pts = [];
    for (const i of list) {
      const y = Math.floor(i / (W * D)); if (y === 0) continue;
      const r = i % (W * D), z = Math.floor(r / W), x = r % W;
      for (let k = 0; k < base.length; k += 3) pts.push(base[k] + x + ox, base[k + 1] + y + 0.5, base[k + 2] + z + oz);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    edgeLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    scene.add(edgeLines);
  }
  $('hud').dataset.drawn = list.length;
}

function fitHelpers() {
  const { W, H, D } = chunk;
  if (gridHelper) scene.remove(gridHelper);
  if (boundsHelper) scene.remove(boundsHelper);
  gridHelper = new THREE.GridHelper(Math.max(W, D), Math.max(W, D), 0x7a6a3a, 0x2a2e38);
  gridHelper.position.y = 1.01;
  gridHelper.visible = !!S.grid;
  scene.add(gridHelper);
  boundsHelper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-W / 2, 0, -D / 2), new THREE.Vector3(W / 2, H, D / 2)), 0x4a5a8a);
  boundsHelper.visible = !!S.bounds;
  scene.add(boundsHelper);
  if (!fitHelpers.done) { resetCamera(); fitHelpers.done = true; }
}

function resetCamera() {
  // back off on narrow (portrait) views so the whole chunk fits across
  const s = (chunk ? Math.max(chunk.W, chunk.D) : 64) * Math.max(1, 1.1 / camera.aspect);
  camera.position.set(s * 0.95, s * 0.85, s * 0.95);
  controls.target.set(0, 14, 0);
  controls.update();
}

function updateHud() {
  const comps = voxelComponents(chunk);
  const loops = chunk.bridges.filter(b => !b.tree).length;
  $('hud').innerHTML =
    `<b>${chunk.W}×${chunk.H}×${chunk.D}</b> chunk<br>` +
    `${chunk.towers.length} towers · ${chunk.bridges.length} bridges (${loops} loop)<br>` +
    `${chunk.count.toLocaleString()} voxels · ${Number($('hud').dataset.drawn).toLocaleString()} drawn<br>` +
    (comps === 1 ? 'all towers connected' : `<b>${comps} disconnected groups</b>`);
  $('seedOut').textContent = S.seed;
}

function legend() {
  const L = $('legend');
  if (S.color === 'type') L.innerHTML = Object.entries(TYPE_COLORS).map(([t, col]) => `<span><i style="background:#${col.toString(16).padStart(6, '0')}"></i>${VOXEL_NAMES[t]}</span>`).join('');
  else if (S.color === 'owner') L.innerHTML = '<span>Each tower its own colour; bridges a pale tint</span>';
  else L.innerHTML = '<span><i style="background:hsl(252,65%,55%)"></i>low</span><span><i style="background:hsl(0,65%,55%)"></i>high</span>';
}

// ---- controls panel ----
const sliders = [['pTowers', 'vTowers', 'towers', true], ['pMaxH', 'vMaxH', 'maxh', true], ['pLoops', 'vLoops', 'loops', true, '%'], ['pSlice', 'vSlice', 'slice', false]];
for (const [inp, out, key, regen, unit] of sliders) {
  const el = $(inp);
  el.value = S[key]; $(out).textContent = S[key] + (unit || '');
  el.addEventListener('input', () => {
    S[key] = Number(el.value); $(out).textContent = S[key] + (unit || '');
    if (regen) build(); else { rebuildMesh(); updateHud(); }
    writeHash();
  });
}
function chipGroup(id, isOn, onClick) {
  const btns = [...$(id).querySelectorAll('button')];
  const sync = () => btns.forEach(b => b.classList.toggle('on', isOn(b.dataset.v)));
  btns.forEach(b => b.addEventListener('click', () => { onClick(b.dataset.v); sync(); writeHash(); }));
  sync();
}
chipGroup('colorBy', v => S.color === v, v => { S.color = v; rebuildMesh(); legend(); });
chipGroup('toggles', v => !!S[v], v => {
  S[v] = S[v] ? 0 : 1;
  if (v === 'grid') gridHelper.visible = !!S.grid;
  if (v === 'bounds') boundsHelper.visible = !!S.bounds;
  if (v === 'edges') rebuildMesh();
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

resize(); build(); legend(); writeHash();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
window.VoxelView = { state: () => ({ S, towers: chunk.towers.length, bridges: chunk.bridges.length, drawn: mesh.count, components: voxelComponents(chunk) }) };
