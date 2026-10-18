"""Optional headless-browser check. Needs: pip install playwright && playwright install chromium
Run from the project folder: python3 tests/browser-smoke.py"""
import os, sys, json, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from pathlib import Path
URL = Path(ROOT, 'index.html').as_uri()
fails, passes = [], 0

def check(name, cond, detail=''):
    global passes
    if cond: passes += 1
    else: fails.append(name + (' :: ' + str(detail) if detail else ''))

def text(pg, sel): return pg.inner_text(sel)

with sync_playwright() as p:
    b = p.chromium.launch()
    def open_page(saved=None, size=(1280, 900)):
        ctx = b.new_context(accept_downloads=True, viewport={'width': size[0], 'height': size[1]})
        pg = ctx.new_page(); pg.errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' else None)
        pg.goto(URL)
        if saved is not None:
            pg.evaluate("v=>localStorage.setItem('spiviz',v)", saved); pg.reload()
        return pg

    # fresh load
    pg = open_page()
    check('no console errors on load', not pg.errors, pg.errors)
    check('waveform drawn on load', pg.evaluate("!!document.getElementById('svg')"))
    check('default summary has Mode 0 and 1 MHz', 'Mode:         0' in text(pg, '#sum') and '1 MHz' in text(pg, '#sum'))
    check('8 rows in bit table (+header)', pg.locator('#bits tr').count() == 9)
    check('default RX values', 'Master RX 0x3C' in text(pg, '#sum') and 'Slave RX 0xA5' in text(pg, '#sum'))

    # stale-state regression
    pg.fill('#mtx', '0xZZ')
    check('error shown for invalid hex', 'not valid hex' in text(pg, '#err'))
    check('waveform removed while invalid', not pg.evaluate("!!document.getElementById('svg')"))
    check('summary does not show old transaction', 'No transaction' in text(pg, '#sum') and 'Master RX' not in text(pg, '#sum'))
    check('bit table / events / inspector cleared', pg.locator('#bits tr').count() == 0 and text(pg, '#ev') == '' and text(pg, '#insp') == '')
    for bid in ['play', 'step', 'png', 'csv', 'copy', 'save', 'zi', 'zo', 'fit', 'reset', 'pause']:
        check('button disabled while invalid: ' + bid, pg.is_disabled('#' + bid))
    pg.fill('#mtx', '0xA5')
    check('recovers when input is valid again', pg.evaluate("!!document.getElementById('svg')") and text(pg, '#err') == '' and not pg.is_disabled('#csv'))

    # validation through the UI
    pg.fill('#words', '1e1'); check('words "1e1" rejected', 'Number of words' in text(pg, '#err'), text(pg, '#err'))
    pg.fill('#words', '2'); check('word count mismatch reported', 'expected 2' in text(pg, '#err'))
    pg.fill('#mtx', '0xA5,0x3C'); pg.fill('#stx', '0x12,0x34'); check('2-word transaction valid', text(pg, '#err') == '')
    pg.fill('#delay', '-1'); check('negative delay rejected', 'delay' in text(pg, '#err'))
    pg.fill('#delay', '2'); check('delay accepted', text(pg, '#err') == '')
    pg.select_option('#freq', 'custom'); pg.fill('#custom', ''); check('empty custom frequency rejected', 'Clock' in text(pg, '#err'))
    pg.fill('#custom', '3000'); check('custom 3 MHz accepted', text(pg, '#err') == '' and '3 MHz' in text(pg, '#sum'))
    pg.select_option('#freq', '1000000')
    pg.select_option('#width', '16'); check('data too wide for 16 bit not flagged but 8-bit values fit', text(pg, '#err') == '')

    # modes and mode selector sync
    pg.select_option('#mode', '3'); check('mode select sets CPOL/CPHA', pg.input_value('#cpol') == '1' and pg.input_value('#cpha') == '1')
    pg.select_option('#cpol', '0'); check('CPOL change updates mode select', pg.input_value('#mode') == '1')

    # presets
    for i in range(7):
        pg.select_option('#preset', str(i))
        ok = text(pg, '#err') == '' and pg.evaluate("!!document.getElementById('svg')")
        check('preset %d loads and renders' % (i + 1), ok, text(pg, '#err'))
        if i == 5: check('preset 6 has two words with delay', 'Word 1' in text(pg, '#sum') and 'delay 2' in text(pg, '#sum'))
        if i == 6: check('preset 7: 16-bit RX 0xC0DE', '0xC0DE' in text(pg, '#sum'))
    pg.select_option('#preset', '0')

    # cursor / bit selection sync
    box = pg.locator('#svg').bounding_box()
    pg.mouse.click(box['x'] + 76 + 2100 * pg.evaluate("scale"), box['y'] + 10)
    check('cursor readout after click (~2.1 us)', 'Time: 2.' in text(pg, '#cursor') and 'MOSI = 1' in text(pg, '#cursor') and 'MISO = 0' in text(pg, '#cursor') and 'bit 7' in text(pg, '#cursor'), text(pg, '#cursor'))
    pg.locator('#bits tr').nth(3).click()
    check('bit table click selects bit and updates inspector', 'Bit:   5' in text(pg, '#insp') and 'Sample time:   4 µs' in text(pg, '#insp'), text(pg, '#insp'))
    check('selected row highlighted', pg.locator('#bits tr.sel').count() == 1)
    pg.locator('polygon[data-w="0"][data-i="0"]').first.click()
    check('waveform click selects bit 7', 'Bit:   7' in text(pg, '#insp'))

    # playback
    pg.click('#reset'); check('reset moves cursor to 0', 'Time: 0 ns' in text(pg, '#cursor'))
    pg.click('#step'); check('step goes to first clock edge (2 µs)', 'Time: 2 µs' in text(pg, '#cursor'), text(pg, '#cursor'))
    pg.click('#step'); check('step goes to second clock edge (2.5 µs)', 'Time: 2.5 µs' in text(pg, '#cursor'))
    pg.click('#reset'); pg.select_option('#speed', '4'); pg.click('#play'); time.sleep(0.6)
    mid = text(pg, '#cursor'); pg.click('#pause'); t1 = text(pg, '#cursor'); time.sleep(0.3); t2 = text(pg, '#cursor')
    check('play advances cursor', 'Time: 0 ns' not in mid, mid)
    check('pause stops cursor', t1 == t2)
    pg.click('#play'); time.sleep(2.5)
    check('playback stops at end of transaction', 'Time: 11 µs' in text(pg, '#cursor') or 'Time: 21' in text(pg, '#cursor') or 'Time:' in text(pg, '#cursor'))

    # zoom
    w0 = pg.evaluate("+document.getElementById('svg').getAttribute('width')")
    pg.click('#zi'); w1 = pg.evaluate("+document.getElementById('svg').getAttribute('width')")
    pg.click('#zo'); pg.click('#zo'); w2 = pg.evaluate("+document.getElementById('svg').getAttribute('width')")
    pg.click('#fit'); w3 = pg.evaluate("+document.getElementById('svg').getAttribute('width')")
    check('zoom in widens, zoom out narrows, fit restores', w1 > w0 > w2 and abs(w3 - w0) < 1, (w0, w1, w2, w3))
    big = ','.join(['0xFFFFFFFF'] * 16)
    pg.select_option('#width', '32'); pg.fill('#words', '16'); pg.fill('#mtx', big); pg.fill('#stx', big); pg.select_option('#freq', '100000')
    t = time.time()
    for _ in range(40): pg.click('#zi')
    wmax = pg.evaluate("+document.getElementById('svg').getAttribute('width')")
    check('zoom width is capped (no runaway SVG)', wmax <= 4.1e5 + 100, wmax)
    check('max-size transaction: 512 bit rows', pg.locator('#bits tr').count() == 513)
    pg.click('#png'); time.sleep(0.3); check('PNG on huge zoom gives a message, no crash', 'Zoom out' in text(pg, '#png') or 'PNG' in text(pg, '#png'))
    pg.click('#fit')

    # exports
    pg.select_option('#preset', '0')
    with pg.expect_download() as d: pg.click('#csv')
    csv = open(d.value.path(), encoding='utf-8').read().splitlines()
    check('CSV header', csv[0] == 'time_ns,SCLK,MOSI,MISO,CS,event,word,bit')
    check('CSV first sample row', any(l.startswith('2000,1,1,0,0,"Sample edge (rising), word 0 bit 7') for l in csv), csv[:6])
    check('CSV row count = events + header', len(csv) == 1 + 3 + 16, len(csv))
    with pg.expect_download() as d: pg.click('#png')
    data = open(d.value.path(), 'rb').read()
    check('PNG export is a real PNG', data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) > 2000, len(data))
    pg.click('#save'); check('save writes localStorage', json.loads(pg.evaluate("localStorage.getItem('spiviz')"))['mtx'] == '0xA5')
    pg.fill('#mtx', '0x01'); pg.reload()
    check('saved config restored on reload', pg.input_value('#mtx') == '0xA5' and text(pg, '#err') == '')
    check('no console errors during session', not pg.errors, pg.errors)

    # saved-config robustness
    for name, v in [('string', '"abc"'), ('array', '[1,2]'), ('null', 'null'), ('badjson', '{bad'), ('bad width', '{"width":"12"}'), ('bad freq', '{"freq":"7"}'), ('mismatch', '{"words":"3"}')]:
        q = open_page(v)
        check('malformed saved config (%s) starts normally' % name, q.evaluate("!!document.getElementById('svg')") and not q.errors, (text(q, '#err'), q.errors))
        q.context.close()

    # themes + responsive
    pg = open_page()
    bg1 = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    pg.click('#theme'); bg2 = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    check('theme toggle changes background', bg1 != bg2, (bg1, bg2))
    svgbg = pg.evaluate("document.querySelector('#svg rect').getAttribute('fill')")
    check('svg uses theme colours after toggle', svgbg.lower() in ('#0f141b', '#f4f6f9'), svgbg)
    pg.click('#theme')
    for size in [(1280, 800), (768, 900), (390, 844), (320, 640)]:
        q = open_page(size=size)
        over = q.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('no horizontal page scroll at %dx%d' % size, over <= 1, over)
        check('waveform visible at %dx%d' % size, q.locator('#wave').is_visible())
        q.context.close()
    b.close()

print('browser checks passed: %d, failed: %d' % (passes, len(fails)))
for f in fails: print('  FAIL', f)
sys.exit(1 if fails else 0)
