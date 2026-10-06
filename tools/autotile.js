// Authoring helper: fix the structural letters of example rooms from their floor/wall geometry.
//   node tools/autotile.js            prints corrected example grids for every tileset
// Detail letters you placed (lowercase, digits, F/G/X floor variants, A/Y/S/B face variants) are kept
// when they fit their context; structural kit letters are rewritten to match the geometry.
const D = require('../gen/dressing.js');

const STRUCT = c => {
  const floor = c & 256, m = c & 15, dg = (c >> 4) & 15;
  const n = (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1);
  const opp = m === 5 || m === 10, dn = (dg & 1) + (dg >> 1 & 1) + (dg >> 2 & 1) + (dg >> 3 & 1);
  if (floor) return n === 0 ? (dn === 1 ? 'I' : 'F') : n === 1 ? 'K' : n === 2 ? (opp ? 'C' : 'L') : n === 3 ? 'Z' : 'F';
  return n === 0 ? (dn === 0 ? 'R' : dn === 1 ? 'D' : 'E') : n === 1 ? 'A' : n === 2 ? (opp ? 'H' : 'Q') : n === 3 ? 'J' : 'P';
};
const KITLETTERS = new Set('FGXKLCZIREAYSBQHJPD'.split(''));
const FLOOR_FREE = new Set(['F', 'G', 'X']);

function fixGrid(set, rows) {
  const tiles = set.tiles, H = rows.length, W = rows[0].length;
  const grid = rows.map(r => r.split(''));
  const walk = (x, y) => tiles[grid[y][x]].walk;
  const notes = [];
  const out = grid.map((row, y) => row.map((L, x) => {
    const t = tiles[L], c = D.classAt(walk, W, H, x, y), s = STRUCT(c);
    const fits = t.anchor !== undefined ? [0, 1, 2, 3].some(r => D.rotCls(t.anchor, r) === c)
      : (FLOOR_FREE.has(L) ? s === 'F' || s === 'I' : KITLETTERS.has(L) ? L === s : true);
    if (fits) return L;
    if (KITLETTERS.has(L)) return s;
    notes.push(`${L} at ${x},${y} does not fit its context`);
    return L;
  }).join(''));
  return { out, notes };
}

if (require.main === module) {
  D.DRESS_SETS.forEach(set => {
    console.log(`// ${set.key}`);
    set.examples.forEach(ex => {
      const { out, notes } = fixGrid(set, ex);
      console.log('[' + out.map(r => `'${r}'`).join(',\n ') + '],');
      notes.forEach(n => console.log('//  ! ' + n));
    });
  });
}
module.exports = { fixGrid, STRUCT };
