"""
Visual smoke test: serves ./dist, opens it in headless Chromium with Open-Meteo
responses mocked (deterministic synthetic weather), captures screenshots and
reports console errors.

Usage:  npm run build && python3 scripts/visual_smoke.py [scenario]
Requires: pip install playwright && playwright install chromium
"""
import json, math, sys, time, threading, functools, http.server, socketserver, os
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', 'dist')
PORT = 4179
SCENARIO = sys.argv[1] if len(sys.argv) > 1 else 'mild'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/lumin-shots'
os.makedirs(OUT, exist_ok=True)

PROFILES = {
    'mild':  dict(T=16, W=12, P=0.0, H=70, C=35),
    'gale':  dict(T=4,  W=62, P=1.5, H=90, C=95),
    'cold':  dict(T=-9, W=6,  P=0.0, H=75, C=10),
    'rain':  dict(T=24, W=14, P=6.0, H=97, C=100),
}
prof = PROFILES[SCENARIO]

def hourly(start, hours):
    t, T, W, D, P, H, C, code, day = [], [], [], [], [], [], [], [], []
    for i in range(hours):
        ts = start + i * 3600
        hod = (ts % 86400) / 3600
        t.append(ts)
        T.append(round(prof['T'] + 3 * math.sin((hod - 9) / 24 * 2 * math.pi), 1))
        W.append(round(prof['W'] * (0.8 + 0.4 * abs(math.sin(i * 0.37))), 1))
        D.append(260)
        P.append(round(prof['P'] * (1 if (i % 5) else 0.3), 2))
        H.append(prof['H']); C.append(prof['C'])
        code.append(95 if prof['W'] > 55 else 61 if prof['P'] > 0.2 else 2)
        day.append(1 if 6 <= hod < 19 else 0)
    return dict(time=t, temperature_2m=T, wind_speed_10m=W, wind_direction_10m=D, precipitation=P,
                relative_humidity_2m=H, cloud_cover=C, weather_code=code, is_day=day)

def forecast(q):
    past = int(q.get('past_days', ['1'])[0])
    now = int(time.time())
    start = (now // 86400 - past) * 86400
    h = hourly(start, (past + 1) * 24)
    cur = dict(time=now - now % 900, temperature_2m=prof['T'], wind_speed_10m=prof['W'], wind_direction_10m=260,
               precipitation=prof['P'], relative_humidity_2m=prof['H'], cloud_cover=prof['C'],
               weather_code=h['weather_code'][-1], is_day=1)
    return dict(current=cur, hourly=h, daily=dict(sunrise=[start + 86400 * past + 6 * 3600], sunset=[start + 86400 * past + 19 * 3600]))

def geocode(q):
    return dict(results=[dict(name='Auckland', admin1='Auckland', country='New Zealand', latitude=-36.85, longitude=174.76, timezone='Pacific/Auckland')])

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as httpd:
        httpd.serve_forever()

threading.Thread(target=serve, daemon=True).start()
time.sleep(0.5)

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = browser.new_context(viewport=dict(width=1440, height=900), timezone_id='Pacific/Auckland', device_scale_factor=1)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))

    def route(r):
        u = urlparse(r.request.url); q = parse_qs(u.query)
        if 'geocoding' in u.netloc: body = geocode(q)
        elif 'archive' in u.netloc: body = dict(hourly=hourly(int(time.time()) - 200 * 86400, 24))
        else: body = forecast(q)
        r.fulfill(status=200, content_type='application/json', body=json.dumps(body), headers={'Access-Control-Allow-Origin': '*'})
    page.route('https://*.open-meteo.com/**', route)

    page.goto(f'http://127.0.0.1:{PORT}/')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{SCENARIO}-01-first.png')
    page.wait_for_timeout(5000)
    page.screenshot(path=f'{OUT}/{SCENARIO}-02-settled.png')
    page.mouse.move(820, 430); page.wait_for_timeout(600)
    page.mouse.move(800, 440, steps=10); page.wait_for_timeout(900)
    page.mouse.click(760, 450); page.wait_for_timeout(450)
    page.screenshot(path=f'{OUT}/{SCENARIO}-03-touch.png')
    page.keyboard.press('o'); page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{SCENARIO}-04-observatory.png')
    obs = page.evaluate("document.getElementById('obs-notes').innerText")
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    page.keyboard.press('l'); page.wait_for_timeout(500)
    page.click('#lab-enter'); page.wait_for_timeout(600)
    page.click('[data-preset="gale"]'); page.wait_for_timeout(300)
    page.click('#lab-expose-7'); page.wait_for_timeout(4500)
    page.screenshot(path=f'{OUT}/{SCENARIO}-05-lab.png')
    page.click('#lab-exit'); page.wait_for_timeout(2500)
    status = page.evaluate("document.getElementById('status-text').innerText")
    page.screenshot(path=f'{OUT}/{SCENARIO}-06-back-live.png')
    # Reload: identity must persist.
    name1 = page.evaluate("document.getElementById('specimen-name').innerText")
    page.reload(); page.wait_for_timeout(2500)
    name2 = page.evaluate("document.getElementById('specimen-name').innerText")
    page.set_viewport_size(dict(width=390, height=844)); page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/{SCENARIO}-07-mobile.png')
    fps = page.evaluate("document.getElementById('set-quality-info').textContent")
    browser.close()

print('scenario:', SCENARIO)
print('status after lab:', status)
print('identity persisted:', name1 == name2, name1, name2)
print('quality:', fps)
print('notes:', obs[:600])
print('console problems:', len(errors))
for e in errors[:20]: print('  ', e)
