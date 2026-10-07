# Camp screen check: plays a scripted session on the camp screen with time and randomness fixed, and records
# what the screen shows at checkpoints (a hash of the scene's pixels, and the visible text of the gauge, the
# vessel panel, the tray, the larder and the notes). Run it against two versions to show a change to the screen's
# code changed nothing a player can see.
#   python3 tools/camp-screen-check.py http://localhost:8765 out.json
#   python3 tools/camp-screen-check.py http://localhost:8766 base.json && diff base.json out.json
import sys, json, hashlib
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
SIZES = [(844, 390, 'landscape'), (450, 840, 'portrait')]

# fixed time and randomness, installed once the world view has been put away
FREEZE = """(() => {
  let s = 12345; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let vt = 100000, q = [], timers = [], id = 1;
  performance.now = () => vt;
  window.requestAnimationFrame = cb => { q.push([id, cb]); return id++; };
  window.cancelAnimationFrame = k => { q = q.filter(e => e[0] !== k); };
  window.setTimeout = (cb, ms) => { timers.push([id, vt + (ms || 0), cb]); return id++; };
  window.clearTimeout = k => { timers = timers.filter(e => e[0] !== k); };
  window.__tick = (frames, ms) => { for (let f = 0; f < frames; f++) {
    vt += ms || 1000 / 60;
    const due = timers.filter(e => e[1] <= vt); timers = timers.filter(e => e[1] > vt); due.forEach(e => e[2]());
    const run = q; q = []; run.forEach(e => e[1](vt)); } };
})()"""

SNAP = """(() => {
  const el = document.querySelector('.fire-screen'), cv = el.querySelector('canvas.scene'), vis = e => e && !e.hidden && getComputedStyle(e).display !== 'none';
  const txt = sel => { const e = el.querySelector(sel); return vis(e) ? e.innerText.replace(/\\s+/g, ' ').trim() : null; };
  return {
    pixels: cv.toDataURL(), size: [cv.width, cv.height],
    gauge: txt('.cf-gauge'), ctx: txt('.cf-ctx'), note: txt('.camp-note'), larder: txt('.cf-larder'),
    tray: [...el.querySelectorAll('.cf-tray .cf-btn, .cf-tray .cf-blow')].filter(b => b.checkVisibility()).map(b => b.innerText.replace(/\\s+/g, ' ').trim() + (b.classList.contains('on') ? ' [on]' : '') + (b.classList.contains('want') ? ' [want]' : '')),
    meter: [...el.querySelectorAll('.cf-fill, .cf-bar i')].map(e => e.style.width),
    mode: Camp.state().mode,
    stock: (() => { const s = Camp.state().c.stock; return [s.ash, s.char, s.lanternEye, s.hymnGrub]; })(),
  };
})()"""

def run(page):
    page.goto(URL + '/index.html#seed=4&preset=underdark')
    page.evaluate("localStorage.clear()")
    page.wait_for_function('Infinite.state() && Infinite.state().placed', timeout=60000)
    page.evaluate("Infinite.suspend()")
    page.evaluate(FREEZE)
    page.evaluate("Camp.open(() => {})")
    out = []
    tick = lambda n: page.evaluate(f"__tick({n})")
    def snap(label):
        page.wait_for_timeout(80)  # let the scene band settle (a resize re-renders it at its new size)
        tick(1)
        s = page.evaluate(SNAP); s['pixels'] = hashlib.sha1(s['pixels'].encode()).hexdigest()[:16]; s['at'] = label; out.append(s)
    at = lambda x, z: (lambda q: (q['x'], q['y']))(page.evaluate(f"Camp.at({x},{z})"))
    btn = lambda k: page.click(f'.fire-screen .cf-btn[data-k={k}]')
    tick(30); snap('open')
    btn('tinder'); page.mouse.click(*at(0, 2)); tick(2)
    btn('kindling')
    for (x, z) in [(-0.035, 1.99), (0.035, 2.0), (0, 2.035), (0.13, 2.0)]: page.mouse.click(*at(x, z)); tick(2)
    snap('laid')
    page.mouse.move(*at(0.05, 2.05)); tick(2); snap('preview kindling')
    btn('kindling'); btn('striker'); page.mouse.click(*at(0, 2)); btn('striker'); tick(2); snap('struck')
    for k in range(6): tick(30); snap(f'catching {k}')
    sx, sy = at(0.13, 2.0); ex, ey = at(0.05, 2.03)
    page.mouse.move(sx, sy - 3); page.mouse.down(); page.mouse.move((sx + ex) / 2, (sy + ey) / 2 - 3, steps=3); tick(1); snap('dragging'); page.mouse.move(ex, ey - 3, steps=3); page.mouse.up(); tick(2); snap('dragged')
    page.click('.cf-blow'); tick(10); snap('blow'); page.click('.cf-blow'); tick(40); snap('blow 2')
    btn('fuel'); page.mouse.move(*at(0, 2)); tick(2); snap('fuel over fire'); page.mouse.move(*at(0.07, 2.0)); tick(2); snap('fuel beside')
    page.mouse.click(*at(0.07, 2.0)); btn('fuel'); tick(2)
    page.click('.fire-screen .cf-mode [data-mode=cook]'); tick(2); snap('cook mode')
    btn('pot'); page.mouse.click(*at(0.16, 1.88)); tick(2); snap('pot down')
    page.click('.cf-open'); tick(2); snap('larder')
    page.click('.cf-larder .cf-btn[data-k=blackWater]'); page.click('.cf-larder .cf-btn[data-k=lanternEye]'); tick(2); snap('tapped in')
    bb = page.locator('.cf-larder .cf-btn[data-k=weepingTuber]').bounding_box(); px, py = at(0.16, 1.92)
    page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down(); page.mouse.move(px, py, steps=6); tick(1); snap('dragging food'); page.mouse.up(); tick(2); snap('dropped food')
    page.click('.cf-open'); tick(2)
    btn('pan'); page.mouse.click(*at(-0.14, 1.9)); tick(2); page.click('.cf-open'); page.click('.cf-larder .cf-btn[data-k=starGristle]'); page.click('.cf-larder .cf-btn[data-k=blackWater]'); page.click('.cf-open'); tick(2); snap('pan')
    for k in range(8): tick(90); snap(f'cooking {k}')
    page.mouse.click(*at(0.16, 1.9)); tick(2); snap('pot selected')
    page.evaluate("(() => { const c = Camp.state().c; for (let t = 0; t < 900; t++) CampSim.step(c, 0.1); })()"); tick(30); snap('later')
    page.keyboard.press('Escape'); tick(2); snap('escape')
    page.click('.fire-screen .cf-mode [data-mode=fire]'); tick(2); snap('fire mode');
    page.mouse.click(*at(-0.14, 1.9)); tick(2); snap('pan touched from fire'); page.click('.cf-ctx [data-a=eat]'); tick(2); snap('ate pan')
    page.click('.cf-forage'); tick(2); snap('foraged')
    page.mouse.click(*at(0.16, 1.9)); tick(2); page.click('.cf-ctx [data-a=eat]'); tick(2); snap('ate pot')
    page.evaluate("(() => { const c = Camp.state().c; for (let t = 0; t < 4000; t++) CampSim.step(c, 0.1); })()"); tick(30); snap('coals')
    page.evaluate("(() => { const c = Camp.state().c; for (let t = 0; t < 12000; t++) CampSim.step(c, 0.1); })()"); tick(30); snap('cold')
    page.click('.fire-screen .cf-mode [data-mode=fire]'); tick(2)
    for (x, z) in page.evaluate("Camp.state().c.pieces.filter(p => p.spent).map(p => [p.x, p.z])"): page.mouse.click(at(x, z)[0], at(x, z)[1] - 2); tick(2)
    snap('gathered')
    page.click('.fire-screen .cf-mode [data-mode=cook]'); page.click('.cf-open'); tick(2); snap('kept')
    ch = page.evaluate("(() => { const b = Camp.state().L.charms[1], r = document.querySelector('.fire-screen canvas.scene').getBoundingClientRect(), cv = document.querySelector('.fire-screen canvas.scene'); return [r.left + (b.x + 5) * r.width / cv.width, r.top + (b.y + 8) * r.height / cv.height]; })()")
    page.mouse.click(*ch); tick(2); snap('charm')
    return out

with sync_playwright() as p:
    b = p.chromium.launch()
    result = {}
    for (w, h, tag) in SIZES:
        page = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        result[tag] = run(page); result[tag + ' errors'] = errs
        page.close()
    b.close()
json.dump(result, open(OUT, 'w'), indent=1)
print(f"{sum(len(v) for k, v in result.items() if not k.endswith('errors'))} snapshots", {k: v for k, v in result.items() if k.endswith('errors')})
