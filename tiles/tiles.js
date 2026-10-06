// Tile Dressing page: shows each tileset, its example rooms, what was learned, and a fresh dressed patch.
(() => {
  const $ = id => document.getElementById(id);
  const DIRS = ['Above', 'Right', 'Below', 'Left'];
  let cur = 0, sel = null, seed = 1, layoutKind = 'maze';

  // tiles are 4x4 or 8x8 pixels (v.size)
  function tileCanvas(v, scale) {
    const N = v.size || 4, c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    v.rgb.forEach((p, k) => { img.data.set([p[0], p[1], p[2], 255], k * 4); });
    g.putImageData(img, 0, 0);
    if (scale) { c.style.width = c.style.height = scale + 'px'; }
    return c;
  }
  function drawTiles(canvas, W, H, idAt, N) {
    canvas.width = W * N; canvas.height = H * N;
    const g = canvas.getContext('2d'), img = g.createImageData(W * N, H * N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = idAt(x, y); if (!v) continue;
      v.rgb.forEach((p, k) => { const o = ((y * N + ((k / N) | 0)) * W * N + x * N + (k % N)) * 4; img.data[o] = p[0]; img.data[o + 1] = p[1]; img.data[o + 2] = p[2]; img.data[o + 3] = 255; });
    }
    g.putImageData(img, 0, 0);
  }

  // a fresh layout to dress: a braided maze turned into floor/wall blocks, or open rooms joined by corridors
  function layout(W, H) {
    const rng = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(seed * 977);
    const pass = new Uint8Array(W * H);
    if (layoutKind === 'maze') {
      const cw = (W - 1) >> 1, ch = (H - 1) >> 1;
      const mz = generateMaze({ W: cw, H: ch, rng, algo: 'growing', braid: 0.4, straight: () => 0.5 });
      for (let c = 0; c < cw * ch; c++) {
        const x = 2 * (c % cw) + 1, y = 2 * ((c / cw) | 0) + 1;
        pass[y * W + x] = 1; if (mz[c] & 2) pass[y * W + x + 1] = 1; if (mz[c] & 4) pass[(y + 1) * W + x] = 1;
      }
      // open a few rooms so wide-space tiles show up too
      for (let k = 0; k < 3; k++) { const rw = 4 + (rng() * 4 | 0), rh = 3 + (rng() * 3 | 0), x0 = 1 + (rng() * (W - rw - 2) | 0), y0 = 1 + (rng() * (H - rh - 2) | 0); for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) pass[y * W + x] = 1; }
    } else {
      const rooms = [];
      for (let k = 0; k < 5; k++) { const rw = 5 + (rng() * 6 | 0), rh = 4 + (rng() * 5 | 0), x0 = 1 + (rng() * (W - rw - 2) | 0), y0 = 1 + (rng() * (H - rh - 2) | 0); rooms.push([x0 + (rw >> 1), y0 + (rh >> 1)]); for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) pass[y * W + x] = 1; }
      for (let k = 1; k < rooms.length; k++) { let [x, y] = rooms[k - 1]; const [tx, ty] = rooms[k]; while (x !== tx) { pass[y * W + x] = 1; x += Math.sign(tx - x); } while (y !== ty) { pass[y * W + x] = 1; y += Math.sign(ty - y); } }
    }
    return pass;
  }

  function generate() {
    const W = 33, H = 41, pass = layout(W, H), setOf = new Uint8Array(W * H).fill(cur);
    const t0 = performance.now(), r = dress(pass, setOf, W, H, seed * 131 + cur);
    const ms = performance.now() - t0;
    drawTiles($('gen'), W, H, (x, y) => { const v = DRESS_TILES[r.tiles[y * W + x]], h = cellHash(x, y); return v.spins ? { rgb: v.spins[h & 3] } : v; }, DRESS_SETS[cur].size);
    $('gen').style.width = '100%';
    $('genNote').textContent = `${W}×${H} tiles · ${ms.toFixed(0)} ms · ${r.fallbacks} fallbacks`;
  }

  function render() {
    const s = DRESS_SETS[cur];
    $('sets').innerHTML = DRESS_SETS.map((t, i) => `<button type="button" data-i="${i}" class="${i === cur ? 'on' : ''}">${t.name}</button>`).join('');
    $('tilesEyebrow').textContent = `${s.name} (${s.size}×${s.size} px): ${Object.keys(s.tiles).length} drawn tiles → ${s.n} variants in ${s.classMask.size} contexts · tap one to see its neighbours`;
    // one card per drawn tile (its first rotation)
    const first = {}; s.variants.forEach((v, i) => { if (first[v.letter] === undefined) first[v.letter] = i; });
    const grid = $('tiles'); grid.innerHTML = '';
    Object.entries(first).forEach(([L, i]) => {
      const v = s.variants[i], b = document.createElement('button');
      b.type = 'button'; b.className = 'tile' + (sel === i ? ' on' : '');
      const rots = s.variants.filter(x => x.letter === L).length;
      b.appendChild(tileCanvas(v));
      const kind = v.strict ? ' · strict' : v.cls !== null ? ' · oriented' : v.spin ? ' · spins' : '';
      b.insertAdjacentHTML('beforeend', `<b>${L}</b><span>${v.name}${kind}${v.walk ? '' : ' · solid'}</span>`);
      b.onclick = () => { sel = sel === i ? null : i; render(); };
      grid.appendChild(b);
    });
    // learned neighbours of the selected tile
    const nb = $('nbrs'); nb.innerHTML = '';
    if (sel !== null) {
      for (let d = 0; d < 4; d++) {
        const row = document.createElement('div'); row.className = 'nbr';
        row.innerHTML = `<span>${DIRS[d]}</span><div></div>`;
        const m = s.allow[d][sel], all = s.variants.every((_, t) => (m[t >> 5] >>> (t & 31)) & 1);
        if (all || !s.variants[sel].strict) row.lastChild.insertAdjacentHTML('beforeend', '<em class="note">anything (not a strict tile)</em>');
        else for (let t = 0; t < s.n; t++) if ((m[t >> 5] >>> (t & 31)) & 1) row.lastChild.appendChild(tileCanvas(s.variants[t]));
        nb.appendChild(row);
      }
    }
    // example rooms
    const ex = $('examples'); ex.innerHTML = '';
    s.examples.forEach((rows, ei) => {
      const wrap = document.createElement('div'); wrap.style.display = 'grid'; wrap.style.gap = '6px';
      const c = document.createElement('canvas'); c.className = 'pix';
      wrap.appendChild(c);
      const code = document.createElement('div'); code.className = 'code'; code.textContent = rows.join('\n');
      wrap.appendChild(code); ex.appendChild(wrap);
      drawTiles(c, rows[0].length, rows.length, (x, y) => s.variants[s.exampleIds[ei][y][x]], s.size);
      c.style.width = Math.min(rows[0].length * 20, 340) + 'px';
    });
    generate();
  }

  $('sets').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { cur = +b.dataset.i; sel = null; render(); } });
  $('regen').onclick = () => { seed++; generate(); };
  $('layoutBtn').onclick = () => { layoutKind = layoutKind === 'maze' ? 'rooms' : 'maze'; $('layoutBtn').textContent = 'Layout: ' + layoutKind; generate(); };
  render();
})();
