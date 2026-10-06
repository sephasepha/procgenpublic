// Where sector generation time goes: node tools/profile.js [js]
// Wraps each pipeline stage and reports the mean ms per sector over a 5x5 window.
const useJs = process.argv[2] === 'js';
if (!useJs) require('../gen/wasm.js');
const W = require('../gen/world.js');
const names = ['ownedMask', 'genCandidates', 'genGrammar', 'genField', 'genCorridors', 'genMaze', 'buildSub', 'validate', 'centrepieceAt', 'makeNoise'];
const T = {}, hr = () => Number(process.hrtime.bigint()) / 1e6;
names.forEach(n => { const f = globalThis[n]; if (!f) return; T[n] = 0; globalThis[n] = function (...a) { const t = hr(); const r = f.apply(this, a); T[n] += hr() - t; return r; }; });
const P = globalThis.WFC.prototype;
['buildInit', 'buildWeights', 'solve'].forEach(m => { const f = P[m]; T['WFC.' + m] = 0; P[m] = function (...a) { const t = hr(); const r = f.apply(this, a); T['WFC.' + m] += hr() - t; return r; }; });
const S = { ...W.WORLD_DEFAULTS, seed: 4, wasm: !useJs }, n = 25, tot = { total: 0, dress: 0 };
for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) { const r = W.genSector(S, x, y); tot.total += r.timing.total; tot.dress += r.timing.dress; }
const rows = Object.entries({ ...T, dress: tot.dress }).sort((a, b) => b[1] - a[1]);
let known = 0; rows.forEach(([k, v]) => { known += v; console.log(k.padEnd(18), (v / n).toFixed(1).padStart(7), 'ms'); });
console.log('other'.padEnd(18), ((tot.total - known) / n).toFixed(1).padStart(7), 'ms');
console.log('TOTAL'.padEnd(18), (tot.total / n).toFixed(1).padStart(7), 'ms', useJs ? '(JS)' : '(wasm)');
