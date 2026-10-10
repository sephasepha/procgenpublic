// The screens bar: a strip along the bottom of every game screen (the world, the camp, the body, the pool) to move between
// them at any time. Which screen is showing is read from the page itself, so the bar can never disagree with it.
// Keys 1 to 4 do the same.
(function (root) {
  const TABS = [
    { k: 'map', icon: '◈', name: 'Delve', title: 'The world (1)' },
    { k: 'camp', icon: '♨', name: 'Camp', title: 'The fire and cooking (2)' },
    { k: 'body', icon: '✚', name: 'Body', title: 'Afflictions and treatment (3)' },
    { k: 'fish', icon: '≋', name: 'Fish', title: 'Fishing the black pool (4)' },
  ];
  const vis = sel => { const e = document.querySelector(sel); return !!(e && !e.hidden); };
  const current = () => vis('.fish-screen') ? 'fish' : vis('.camp:not(.body-screen):not(.fish-screen)') ? 'camp' : vis('.body-screen') ? 'body' : 'map';
  let bar = null;

  // back to the world: whatever screen was showing has already closed itself
  const home = () => { if (root.Infinite) Infinite.resume(); paint(); };

  function go(k) {
    if (root.Walk && Walk.active()) return; // the first-person view has its own way back
    const from = current();
    if (k === from || !document.documentElement.classList.contains('xp-open')) return;
    if (from === 'camp') Camp.leave(true);
    else if (from === 'body') Body.leave(true);
    else if (from === 'fish') Fishing.leave(true);
    else if (root.Infinite) Infinite.suspend();
    if (k === 'map') home();
    else if (k === 'camp' && root.Camp) Camp.open(home);
    else if (k === 'body' && root.Body) Body.open(home);
    else if (k === 'fish' && root.Fishing) Fishing.open(home);
    paint();
  }

  function paint() {
    if (!bar) return;
    const cur = current();
    bar.querySelectorAll('button').forEach(b => { const on = b.dataset.go === cur; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    // a little of each screen's state shows on its tab: the fire alight, how many things have taken hold
    let lit = false, n = 0;
    try { const c = root.Camp && Camp.state() && Camp.state().c; lit = !!(c && root.CampSim && CampSim.burning(c)); } catch (e) { /* not ready */ }
    try { const s = root.Body && Body.state(); n = s && s.b ? s.b.afflictions.filter(a => !a.phase).length : 0; /* only what is still active, not what is healing */ } catch (e) { /* not ready */ }
    bar.querySelector('[data-go="camp"]').classList.toggle('lit', lit);
    const badge = bar.querySelector('[data-go="body"] i');
    badge.textContent = n ? String(n) : ''; badge.hidden = !n;
  }

  function build() {
    bar = document.createElement('nav'); bar.className = 'screens'; bar.setAttribute('aria-label', 'Screens');
    bar.innerHTML = TABS.map(t => `<button type="button" data-go="${t.k}" title="${t.title}"><b>${t.icon}</b><span>${t.name}</span>${t.k === 'body' ? '<i hidden></i>' : ''}</button>`).join('');
    document.body.appendChild(bar);
    document.documentElement.classList.add('has-screens');
    bar.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    window.addEventListener('keydown', e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !document.documentElement.classList.contains('xp-open')) return;
      const t = TABS[+e.key - 1]; if (t) { e.preventDefault(); go(t.k); }
    });
    setInterval(paint, 300);
    paint();
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  root.Nav = { go, current, paint };
})(window);
