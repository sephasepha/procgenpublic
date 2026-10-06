# Real-time performance in the browser (headless Chromium, phone-sized viewport):
#   python3 tools/bench-browser.py [url]
# Opens the infinite world, walks continuously for a while with a held direction, and reports frame rate,
# per-frame work, view rebuilds, sector generation (WebAssembly or JS) and time to the first sector.
# Results are appended to perf/history.jsonl with the commit, so performance is tracked over time.
import json, subprocess, sys, time, datetime, os
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html#seed=4&preset=underdark'
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALK = """async (ms) => { const st = Infinite.state(), K = (x,y)=>x+','+y, DX=[0,1,0,-1], DY=[-1,0,1,0];
  const own=(gx,gy)=>ownerOf(st.S,Math.floor(gx/3),Math.floor(gy/3));
  const pass=(gx,gy)=>{ const o=own(gx,gy), s=st.sectors.get(K(o[0],o[1])); if(!s||s.failed) return 0; return s.pass[(gy-s.oy*3)*SW+(gx-s.ox*3)]; };
  const end = performance.now() + ms; let d = 2, last = '';
  while (performance.now() < end) {           // hold a direction; at walls turn like a wall-follower, as a player would
    const here = st.gx+','+st.gy;
    if (!st.mv) { const order=[(d+1)&3, d, (d+3)&3, (d+2)&3]; d = order.find(k => pass(st.gx+DX[k], st.gy+DY[k])===1) ?? d; st.held=[d]; }
    await new Promise(r => setTimeout(r, 16));
  }
  st.held = []; return Infinite.perf(); }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization'])
    pg = b.new_page(viewport={'width': 390, 'height': 800}, device_scale_factor=2)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    t0 = time.time(); pg.goto(url)
    pg.wait_for_function('Infinite.state() && Infinite.state().placed', timeout=60000)
    placed = (time.time() - t0) * 1000
    perf = pg.evaluate(WALK, 25000)
    b.close()
commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, cwd=root).stdout.strip()
rec = {'kind': 'browser', 'date': datetime.datetime.now().isoformat(timespec='seconds'), 'commit': commit, 'placedMs': round(placed), **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in perf.items()}, 'errors': errs[:3]}
os.makedirs(os.path.join(root, 'perf'), exist_ok=True)
open(os.path.join(root, 'perf/history.jsonl'), 'a').write(json.dumps(rec) + '\n')
print(json.dumps(rec, indent=1))
