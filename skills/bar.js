// The experience bar: one bar in the screens bar that shows whichever skill last earned experience. Its name,
// level and fill swap to that skill as it moves, with what was just earned beside it, and it lights up on a new
// level. Reads Skills (skills/skills.js).
(function (root) {
  const K = root.Skills;
  let el = null, shown = null, plus = {}, plusTimer = null, upTimer = null;

  function build() {
    const nav = document.querySelector('nav.screens'); if (!nav) return void setTimeout(build, 200);
    el = document.createElement('div'); el.className = 'xpbar'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<b class="ic" aria-hidden="true"></b><div class="xb"><div class="xt"><span class="nm"></span><span class="lv"></span></div><div class="track" role="meter" aria-valuemin="0" aria-valuemax="100"><i></i></div></div><span class="plus" aria-hidden="true"></span>';
    nav.appendChild(el);
    show(K.last());
    K.on(r => show(r.key, r));
  }
  function show(key, r) {
    const S = K.SKILLS[key], k = K.all()[key], need = K.need(k.level), f = Math.max(0, Math.min(1, k.xp / need));
    if (shown !== key) { // a different skill: swap to it
      el.dataset.k = key; el.querySelector('.ic').textContent = S.icon; el.querySelector('.nm').textContent = S.name;
      if (shown) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
      shown = key; plus = {};
    }
    el.querySelector('.lv').textContent = `Lv ${k.level}`;
    const t = el.querySelector('.track'); t.firstChild.style.width = (f * 100).toFixed(1) + '%';
    t.setAttribute('aria-valuenow', String(Math.round(f * 100))); t.setAttribute('aria-valuetext', `${S.name}, level ${k.level}, ${Math.floor(k.xp)} of ${need}`);
    el.title = `${S.name}: level ${k.level}, ${Math.floor(k.xp)} / ${need} experience`;
    if (!r) return;
    // what was just earned, added up while it keeps coming
    plus[key] = (plus[key] || 0) + r.gained;
    const p = el.querySelector('.plus'); p.textContent = `+${Math.max(1, Math.round(plus[key]))}`; p.classList.add('on');
    clearTimeout(plusTimer); plusTimer = setTimeout(() => { p.classList.remove('on'); plus = {}; }, 1600);
    el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain');
    if (r.levelled) {
      el.classList.add('up'); p.textContent = `Level ${k.level}!`;
      clearTimeout(upTimer); upTimer = setTimeout(() => el.classList.remove('up'), 2400);
    }
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})(window);
