import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const bundled = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
test('public capture follows verified event details and rejects unbounded calendar views', () => {
  const urls = ['https://www.underwater.pl/kalendarz.html', 'https://www.underwater.pl/kalendarz/eventdetail/32907/-/kurs-padi-efr.html', 'https://www.underwater.pl/kalendarz/week.listevents/2026/10/12/-.html', 'https://www.underwater.pl/kalendarz/eventsbyweek/2026/10/12/-.html', 'https://www.underwater.pl/component/jevents/week.listevents/2026/10/12/-.html', 'https://www.underwater.pl/kalendarz/monthcalendar/2026/10/-.html', 'https://www.underwater.pl/administrator/index.php', 'https://www.underwater.pl/produkt.html?task=checkout']
  const r = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', "import sys,json;sys.path.insert(0,'scripts/source');from public_capture import allowed;print(json.dumps([allowed(u) for u in json.load(sys.stdin)]))"], { input: JSON.stringify(urls), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [true, true, false, false, false, false, false, false])
  const encoded = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', "import sys,json;sys.path.insert(0,'scripts/source');from public_capture import allowed;print(json.dumps([allowed(u) for u in json.load(sys.stdin)]))"], { input: JSON.stringify(['https://www.underwater.pl/comp%6fnent/jevents/week.listevents/2026/10/12/-.html', 'https://www.underwater.pl/kalendarz%2Feventsbyweek/2026/10/12/-.html', 'https://www.underwater.pl/%6cogout.html']), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(encoded.status, 0, encoded.stderr)
  assert.deepEqual(JSON.parse(encoded.stdout), [false, false, false])
})
