// Infinite page: world settings, a live preview of the sector tree, and the Descend button.
(() => {
  const $ = id => document.getElementById(id);
  const S = { ...WORLD_DEFAULTS };
  const TIER_COL = ['#a8d672', '#f0b34b', '#e05a5a'];
  const ALGOS = ['backtracker', 'growing', 'huntkill', 'prim', 'kruskal', 'wilson', 'aldous', 'binary', 'sidewinder'];
  const NUM = { seed: [1, 1e9], band: [1, 6], loops: [0, 100], doors: [0, 4], hubs: [5, 14], maze: [0, 100], ruin: [0, 40] };

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    Object.entries(NUM).forEach(([k, [lo, hi]]) => { if (p.has(k) && isFinite(+p.get(k))) S[k] = Math.min(hi, Math.max(lo, +p.get(k))); });
    if (PRESETS[p.get('preset')]) S.preset = p.get('preset');
    if (MAZE_ALGOS[p.get('algo')]) S.algo = p.get('algo');
  }
  function writeHash() {
    const h = Object.keys(NUM).map(k => `${k}=${S[k]}`).concat(`preset=${S.preset}`, `algo=${S.algo}`).join('&');
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* ignore */ }
  }

  // ---------- preview of the sector tree ----------
  const cv = $('preview'), g = cv.getContext('2d');
  function preview() {
    setPreset(S.preset);
    const R = 6, n = 2 * R + 1, w = cv.parentElement.clientWidth || 360, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = cv.width;
    const cell = cv.width / n;
    g.fillStyle = '#0b0c10'; g.fillRect(0, 0, cv.width, cv.height);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const inf = sectorInfo(S, x, y), px = (x + R) * cell, py = (y + R) * cell;
      g.fillStyle = TIER_COL[inf.type]; g.globalAlpha = Math.max(0.25, 0.8 - 0.18 * (inf.level - 1));
      g.fillRect(px + cell * 0.2, py + cell * 0.2, cell * 0.6, cell * 0.6); g.globalAlpha = 1;
      if (inf.type === 0 && inf.depth % (S.band * 3) === 0) { // first sector of each new level
        g.fillStyle = '#0b0c10'; g.font = `500 ${Math.round(cell * 0.28)}px "IBM Plex Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(['I', 'II', 'III', 'IV', 'V'][inf.level - 1] || inf.level, px + cell / 2, py + cell / 2 + 1);
      }
    }
    g.lineCap = 'round';
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) for (const d of [1, 2]) {
      const nx = x + (d === 1 ? 1 : 0), ny = y + (d === 2 ? 1 : 0); if (nx > R || ny > R) continue;
      const e = edgeContract(S, x, y, nx, ny); if (!e.open) continue;
      const px = (x + R + 0.5) * cell, py = (y + R + 0.5) * cell;
      g.strokeStyle = e.tree ? 'rgba(230,225,213,0.8)' : 'rgba(243,211,107,0.8)';
      g.lineWidth = Math.max(1, cell * (e.tree ? 0.07 : 0.05)); g.setLineDash(e.tree ? [] : [cell * 0.1, cell * 0.1]);
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + (nx - x) * cell, py + (ny - y) * cell); g.stroke();
    }
    g.setLineDash([]);
    const c = (R + 0.5) * cell;
    g.strokeStyle = '#f3d36b'; g.lineWidth = Math.max(1.5, cell * 0.08); g.strokeRect(c - cell * 0.42, c - cell * 0.42, cell * 0.84, cell * 0.84);
    const P = PRESETS[S.preset];
    $('key').innerHTML = P.tiers.map((t, i) => `<span><i style="border-top-color:${TIER_COL[i]};border-top-width:6px"></i>${t.name}</span>`).join('') + '<span>gold box: start</span><span>roman numeral: new level begins</span>';
  }

  function refresh() {
    $('seedOut').textContent = S.seed;
    $('heroWorld').textContent = `World ${S.seed} · ${S.preset === 'arsenal' ? 'Arsenal' : 'Generic'}`;
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === S.preset));
    $('ruinCtl').hidden = S.preset !== 'arsenal';
    $('algos').innerHTML = ALGOS.map(k => `<button type="button" data-algo="${k}" class="${k === S.algo ? 'on' : ''}">${MAZE_ALGOS[k].short}</button>`).join('');
    preview(); writeHash();
  }
  readHash();
  const bind = (id, key, fmt) => { const el = $('p' + id), out = $('v' + id); el.value = S[key]; out.textContent = fmt(S[key]); el.addEventListener('input', () => { S[key] = +el.value; out.textContent = fmt(S[key]); refresh(); }); };
  bind('Band', 'band', v => v);
  bind('Loops', 'loops', v => v + '%');
  bind('Doors', 'doors', v => '+' + v);
  bind('Hubs', 'hubs', v => v);
  bind('Maze', 'maze', v => v + '%');
  bind('Ruin', 'ruin', v => v + '%');
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { S.preset = b.dataset.preset; refresh(); });
  $('algos').addEventListener('click', e => { const b = e.target.closest('[data-algo]'); if (b) { S.algo = b.dataset.algo; refresh(); } });
  $('reseed').onclick = $('reseedTop').onclick = () => { S.seed = 1 + Math.floor(Math.random() * 999999); refresh(); };
  $('descend').onclick = () => Infinite.open({ ...S });
  window.addEventListener('resize', preview);
  refresh();
  // the infinite world is the main event: open straight into it
  Infinite.open({ ...S });
})();
