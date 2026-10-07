// Camp panels: the plain, readable UI around the scene. The fire gauge (strength, air, fuel, signs), the selected
// vessel's panel, the tray of buttons, the larder drawer, and the notes (scraps of paper, the only words in the
// scene). Builds the screen's markup and keeps it up to date from the camp's state; camp/camp.js wires the input.
(function (root) {
  const V = root.CampView, { S, RES, FIRE, VES, ING, COOK } = V;

  // ---------- the screen's markup: gauge strip, scene, dock (vessel panel, larder), tray ----------
  function markup() {
    const btn = (k, label, cls) => `<button type="button" class="cf-btn ${cls || ''}" data-k="${k}" aria-pressed="false"><canvas width="8" height="8" aria-hidden="true"></canvas><span class="nm">${label}</span><span class="ct"></span></button>`;
    return `<section class="cf-gauge" aria-label="The fire">
        <div class="cf-head"><b class="cf-state">Empty pit</b><span class="cf-trend" aria-hidden="true"></span></div>
        <div class="cf-meter" role="meter" aria-label="Fire strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="cf-fill"></i><i class="cf-mark" style="left:30%"></i><i class="cf-mark" style="left:82%"></i></div>
        <div class="cf-scale" aria-hidden="true"><span>Snuffed</span><span>Steady</span><span>Roaring</span></div>
        <div class="cf-mini"><label>Air</label><div class="cf-bar air" role="meter" aria-label="Air" aria-valuemin="0" aria-valuemax="100"><i></i><b style="left:45%"></b><b style="left:65%"></b></div><span class="cf-airw"></span><label>Fuel</label><div class="cf-bar fuel" role="meter" aria-label="Fuel left" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="cf-time"></span></div>
        <div class="cf-signs"><span data-s="flame">Flame</span><span data-s="embers">Embers</span><span data-s="smoke">Smoke</span></div>
      </section>
      <canvas class="scene" aria-label="The fire pit. Choose something from the tray, then tap the floor or a vessel to use it, or drag it there."></canvas>
      <div class="camp-note" hidden></div>
      <div class="cf-dock">
      <div class="cf-ctx" hidden></div>
      <div class="cf-larder" hidden role="group" aria-label="Larder"><div class="cf-lhead"></div>${V.LARDER.map(k => btn(k, ING[k].name, 'ing')).join('')}<div class="cf-lhead kept">Kept from the fire</div>${Object.keys(RES).map(k => `<div class="cf-btn cf-res" data-r="${k}" title="${RES[k].name}" role="img" aria-label="${RES[k].name}"><canvas width="8" height="8" aria-hidden="true"></canvas><span class="nm">${RES[k].name}</span><span class="ct"></span></div>`).join('')}</div>
      </div>
      <nav class="cf-tray" aria-label="Camp kit">
        <div class="cf-group" role="group" aria-label="Fire">${V.KIT.map(k => btn(k, V.NAMES[k])).join('')}</div>
        <button type="button" class="cf-blow" aria-label="Blow on the fire"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Blow</span></button>
        <div class="cf-group" role="group" aria-label="Vessels">${V.VESK.map(k => btn(k, V.NAMES[k])).join('')}</div>
        <div class="cf-group" role="group" aria-label="Supplies">
          <button type="button" class="cf-btn cf-open" aria-expanded="false" aria-label="Larder: ingredients"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1.5 12h-13zM8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="nm">Larder</span></button>
          <button type="button" class="cf-btn cf-forage" aria-label="Forage in the sack (tiring)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10c0-3 3-5 6-5s6 2 6 5l2 9H4zM9 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="nm">Forage</span></button>
        </div>
      </nav>`;
  }
  // the buttons' little pictures, drawn once
  function paintIcons(el) {
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => { b.querySelector('canvas').getContext('2d').drawImage(V.sprite(b.dataset.k, V.artOf(b.dataset.k)), 0, 0); });
    el.querySelectorAll('.cf-res').forEach(b => { b.querySelector('canvas').getContext('2d').drawImage(V.sprite('res-' + b.dataset.r, RES[b.dataset.r]), 0, 0); });
  }
  // a button's one-off animation (added, refused, puff): restart it even if it is still running
  function pulse(b, cls, off) { b.classList.remove(...(off || [cls])); void b.offsetWidth; b.classList.add(cls); }

  // ---------- notes: scraps of paper over the scene, at a point in it ----------
  let noteTimer = null;
  function note(text, x, y, ms) {
    const { el, cv, LW, LH } = V, n = el.querySelector('.camp-note'), r = cv.getBoundingClientRect();
    n.textContent = text; n.hidden = false;
    const px = r.left + x / LW * r.width, py = r.top + y / LH * r.height;
    n.style.left = Math.max(8, Math.min(r.width - 230, px - 110)) + 'px'; n.style.top = Math.max(8, Math.min(r.height - 90, py - 70)) + 'px';
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.hidden = true; }, ms || 2600);
  }
  // how a charm reads
  const words = {
    health: v => v > 80 ? 'Whole.' : v > 55 ? 'Bruised, steady.' : v > 30 ? 'Hurt.' : v > 10 ? 'Bleeding.' : 'Dying.',
    soul: v => v > 80 ? 'Bright.' : v > 55 ? 'Holding.' : v > 30 ? 'Thinning.' : v > 10 ? 'Guttering.' : 'Almost out.',
    hunger: v => v < 20 ? 'Full.' : v < 45 ? 'Fed.' : v < 70 ? 'Hungry.' : v < 88 ? 'Starving.' : 'Eating itself.',
    thirst: v => v < 20 ? 'Slaked.' : v < 45 ? 'Fine.' : v < 70 ? 'Thirsty.' : v < 88 ? 'Parched.' : 'Cracking.',
    exhaustion: v => v < 20 ? 'Rested.' : v < 45 ? 'Tired.' : v < 70 ? 'Worn.' : v < 88 ? 'Spent.' : 'Falling.',
  };
  const CHARM_NAME = { health: 'Blood vial', soul: 'Soul lantern', hunger: 'Bowl', thirst: 'Waterskin', exhaustion: 'Candle stub' };
  const charmNote = (key, v) => `${CHARM_NAME[key]}. ${words[key](v)}`;

  // ---------- the tray and the larder: counts, what is in hand ----------
  function refresh() {
    const { el, cv, st } = V, c = st.c;
    el.querySelectorAll('.cf-btn[data-k]').forEach(b => {
      const k = b.dataset.k, n = c.stock[k], out = VES[k] && c.vessels.some(v => v.type === k);
      const inf = c.unlimitedFire && FIRE[k];
      b.querySelector('.ct').textContent = inf ? '∞' : n === undefined ? (out ? 'out' : '') : String(n);
      b.classList.toggle('empty', !inf && n === 0); b.classList.toggle('out', !!out);
      const on = st.sel === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      b.title = V.artOf(k).name + (n !== undefined ? ` (${n} left)` : '') + '. ' + (V.artOf(k).note || '');
    });
    cv.style.cursor = st.sel ? 'crosshair' : '';
    el.querySelectorAll('.cf-res').forEach(b => { const n = c.stock[b.dataset.r] || 0; b.querySelector('.ct').textContent = String(n); b.classList.toggle('empty', !n); });
    // the larder is icons only; the one in hand is named
    const lh = el.querySelector('.cf-lhead'); if (lh) lh.textContent = st.sel && ING[st.sel] ? `${ING[st.sel].name} · ${c.stock[st.sel]}` : 'Larder';
  }
  // open or close the larder drawer (toggle when open is not given)
  function larder(open) {
    const { el } = V, L = el.querySelector('.cf-larder'), b = el.querySelector('.cf-open');
    const show = open === undefined ? L.hidden : open; L.hidden = !show; b.setAttribute('aria-expanded', String(show)); b.classList.toggle('on', show); el.classList.toggle('larder-open', show);
  }
  const larderOpen = () => !V.el.querySelector('.cf-larder').hidden;

  // ---------- the fire gauge ----------
  const pct = v => Math.round(Math.max(0, Math.min(1, v)) * 100);
  const FUEL_FULL = 180; // seconds of burning that fill the fuel bar
  function gauge(fs) {
    const { el } = V, G = el.querySelector('.cf-gauge'), [r, gg, b] = V.fireColor(fs.strength, fs.air);
    // state, trend and strength
    G.querySelector('.cf-state').textContent = fs.state;
    G.querySelector('.cf-trend').textContent = fs.trend > 0 ? '▲ rising' : fs.trend < 0 ? '▼ falling' : '';
    G.querySelector('.cf-trend').className = 'cf-trend ' + (fs.trend > 0 ? 'up' : fs.trend < 0 ? 'down' : '');
    const m = G.querySelector('.cf-meter'); m.setAttribute('aria-valuenow', String(pct(fs.strength))); m.setAttribute('aria-valuetext', `${fs.state}, ${pct(fs.strength)}%`);
    const fill = G.querySelector('.cf-fill'); fill.style.width = pct(fs.strength) + '%';
    fill.style.background = `linear-gradient(90deg, rgb(${Math.round(r * 0.45)},${Math.round(gg * 0.35)},${Math.round(b * 0.3)}), rgb(${r},${gg},${b}))`;
    fill.style.boxShadow = fs.strength > 0.05 ? `0 0 ${Math.round(4 + 14 * fs.strength)}px rgba(${r},${gg},${b},${0.3 + 0.5 * fs.strength})` : 'none';
    // air, and the Blow button asking for a breath when it would help
    const air = G.querySelector('.cf-bar.air'), fuel = G.querySelector('.cf-bar.fuel');
    const hot = fs.lit > 0 || fs.state === 'Smouldering', aw = !hot ? 'open' : fs.air < fs.chokeAt ? 'choking' : fs.air < fs.airFull ? 'short' : 'good';
    air.firstChild.style.width = pct(fs.air) + '%'; air.dataset.w = aw; air.setAttribute('aria-valuenow', String(pct(fs.air))); air.setAttribute('aria-valuetext', aw);
    G.querySelector('.cf-airw').textContent = { open: '', choking: 'choking', short: 'short', good: 'good' }[aw];
    G.querySelector('.cf-airw').dataset.w = aw;
    const bl = el.querySelector('.cf-blow'); bl.classList.toggle('want', !!fs.needsAir); bl.querySelector('span').textContent = fs.needsAir ? 'Blow!' : 'Blow';
    // fuel left, as a bar and a time
    fuel.firstChild.style.width = pct(fs.fuel / FUEL_FULL) + '%'; fuel.classList.toggle('low', fs.lit > 0 && fs.fuel < 25); fuel.setAttribute('aria-valuenow', String(pct(fs.fuel / FUEL_FULL)));
    const t = Math.round(fs.fuel); G.querySelector('.cf-time').textContent = fs.fuel > 0.5 ? (t >= 60 ? `~${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s` : `~${t}s`) : '';
    // the signs: flame, embers (or coals), smoke
    const es = G.querySelector('.cf-signs [data-s="embers"]'); es.textContent = fs.coals > 0.05 ? 'Coals' : 'Embers';
    G.querySelectorAll('.cf-signs span').forEach(sp => { const v = fs[sp.dataset.s]; sp.style.setProperty('--v', v.toFixed(2)); sp.classList.toggle('on', v > 0.05); });
    G.dataset.state = fs.state.toLowerCase().replace(/ /g, '-');
  }

  // ---------- the selected vessel: what is in it, how hot, and what you can do with it ----------
  const heatWord = T => T >= 99 ? (T > 160 ? 'searing' : 'boiling hot') : T > 68 ? 'cooking' : T > 40 ? 'warming' : 'cold';
  function ctx() {
    const { el, st } = V, box = el.querySelector('.cf-ctx'), v = st.vsel && st.c.vessels.find(q => q.id === st.vsel);
    if (!v) { st.vsel = null; box.hidden = true; box.dataset.key = ''; return; }
    box.hidden = false;
    const j = S.judge(v), Vt = VES[v.type], stateOf = S.foodState;
    // a pot's water: a gauge of what is left to boil away (one measure per water ingredient), and how rich it will be
    const water = v.type === 'pot' ? (v.water > 0 ? '<span class="wbar"><i></i></span>' : v.items.length ? 'dry: scorching' : 'dry') : '';
    const rich = j.richness ? `<span class="rich ${j.richness}">${j.richness}</span>` : '';
    // a pot's stew: forming (once everything in it is cooked), then formed
    const stewing = j.stewing > 0 ? '<span class="stew"></span>' : '';
    const dish = (j.dish ? `<span class="dish">${j.dish.name}</span>` : j.stew ? '<span class="dish">Stew</span>' : stewing || (j.possible ? `<span class="dish maybe">could be ${j.possible.name}</span>` : '')) + rich;
    // rebuild only when something you can read changes, so the buttons stay put under your finger
    const key = [v.id, water, dish, ...v.items.map(it => it.id + stateOf(it))].join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      const items = v.items.map(it => `<li class="${stateOf(it)}"><span>${ING[it.id].name}</span><i></i><em>${stateOf(it)}</em></li>`).join('');
      box.innerHTML = `<div class="hd"><b>${Vt.name}</b><span class="T"></span>${water ? `<span class="w">${water}</span>` : ''}${dish}</div>${items ? `<ul>${items}</ul>` : `<p>Empty. Open the larder, pick something, and tap the ${Vt.name.toLowerCase()}.</p>`}
        <div class="acts"><button type="button" data-a="eat" ${v.items.length ? '' : 'disabled'}>Eat</button><button type="button" data-a="away" ${v.items.length ? 'disabled' : ''} aria-label="Put away">Away</button><button type="button" data-a="close" aria-label="Close">✕</button></div>`;
    }
    // what changes every moment: stew forming, water left, temperature, each item's cooking and scorching
    const sf = box.querySelector('.stew'); if (sf) sf.textContent = `stew forming ${Math.round(j.stewing * 100)}%`;
    const wb = box.querySelector('.wbar i'); if (wb) { const f = Math.max(0, Math.min(1, v.water / Math.max(1, j.waters))); wb.style.width = Math.round(f * 100) + '%'; wb.parentNode.classList.toggle('low', f < 0.3); }
    const T = box.querySelector('.T'); T.textContent = `${Math.round(v.T)}° · ${heatWord(v.T)}`; T.className = 'T ' + (v.T > Vt.burnAt ? 'hot' : v.T > 68 ? 'warm' : '');
    box.querySelectorAll('li i').forEach((i, n) => { const it = v.items[n]; if (it) { i.style.setProperty('--p', Math.min(1, it.progress).toFixed(3)); i.style.setProperty('--s', Math.min(1, it.scorch / COOK.burnt).toFixed(3)); } });
  }

  root.CampPanels = { markup, paintIcons, pulse, note, charmNote, refresh, larder, larderOpen, gauge, ctx };
})(window);
