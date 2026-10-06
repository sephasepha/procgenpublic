// Generation benchmark: node tools/bench.js
// Times sector generation over a 7x7 window around the start (room and cavern layouts, JavaScript and
// WebAssembly), and appends
// the result to perf/history.jsonl with the commit, so speed is tracked from build to build.
// Budgets (real time): a sector must stream in long before the player can cross one, so p95 < 150 ms.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
require('../gen/wasm.js');
const W = require('../gen/world.js');
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(1); };
const rec = { kind: 'node', date: new Date().toISOString().slice(0, 19), commit: '' };
try { rec.commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { /* not a repo */ }
// the Underdark's room layout and the Arsenal's WFC cavern layout, each in JS and in WebAssembly
for (const preset of ['underdark', 'arsenal']) for (const wasm of [false, true]) {
  const S = { ...W.WORLD_DEFAULTS, preset, seed: 4, wasm }, T = { total: [], layout: [], dress: [] };
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) { const r = W.genSector(S, x, y); for (const k in T) if (r.timing && r.timing[k] !== undefined) T[k].push(r.timing[k]); }
  const tag = (preset === 'underdark' ? 'rooms' : 'caverns') + '_' + (wasm ? 'wasm' : 'js');
  for (const k in T) if (T[k].length) { rec[`${tag}_${k}_median`] = q(T[k], 0.5); rec[`${tag}_${k}_p95`] = q(T[k], 0.95); }
  rec[`${tag}_total_max`] = q(T.total, 1);
}
rec.speedup_rooms = +(rec.rooms_js_total_median / rec.rooms_wasm_total_median).toFixed(2);
rec.speedup_caverns = +(rec.caverns_js_total_median / rec.caverns_wasm_total_median).toFixed(2);
rec.budget_ok = rec.rooms_wasm_total_p95 < 150 && rec.caverns_wasm_total_p95 < 150;
fs.mkdirSync(path.join(__dirname, '../perf'), { recursive: true });
fs.appendFileSync(path.join(__dirname, '../perf/history.jsonl'), JSON.stringify(rec) + '\n');
console.log(rec);
if (!rec.budget_ok) { console.log('OVER BUDGET: a wasm sector p95 >= 150 ms'); process.exit(1); }
