import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
const html = (extra = '') => `<div class="portal-real-content"><h1>Kursy</h1><p>${'Treść źródłowa '.repeat(25)}</p><h1>Sklep</h1><h1>Wyprawy</h1><h1>Serwis</h1>${extra}</div>`
const page = (path: string, body = html()) => ({ url: `https://www.underwater.pl${path}`, html: body })
function attach(pages: unknown[], entities: unknown[] = []) {
  const script = `import sys,json\nsys.path.insert(0,'scripts/source')\nfrom captured_home_aliases import attach_verified_home_aliases\ni=json.load(sys.stdin);b={'entities':i['entities']};r=attach_verified_home_aliases(b,i['pages']);json.dump({'entities':b['entities'],'verified':r},sys.stdout)`
  const out = spawnSync('python3', ['-c', script], { input: JSON.stringify({ pages, entities }), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(out.status, 0, out.stderr)
  return JSON.parse(out.stdout)
}
test('home aliases require exact captured main content and retain a deterministic import key', () => {
  const path = '/strona-glowna/stary-adres.html'
  const first = attach([page('/'), page(path)])
  assert.equal(first.entities.length, 1)
  assert.equal(first.entities[0].data.to, '/')
  assert.equal(first.entities[0].data.from, path)
  assert.match(first.entities[0].key, /^public-home-alias:[a-f0-9]{64}$/)
  assert.deepEqual(attach([page('/'), page(path)]), first)
})
test('different content, ambiguous source copies and missing homepage never become aliases', () => {
  const path = '/strona-glowna/stary-adres.html'
  for (const pages of [[page(path)], [page('/'), page(path, html('<p>Inna treść.</p>'))], [page('/'), page(path), page(path, html('<p>Konflikt.</p>'))], [page('/'), page('/', html('<p>Nowszy zapis.</p>')), page(path)]]) assert.deepEqual(attach(pages).entities, [])
})
test('existing source content and redirects are never shadowed by a home alias', () => {
  const path = '/strona-glowna/stary-adres.html'
  for (const entity of [{ collection: 'pages', key: 'page:original', data: { path, title: 'Treść' } }, { collection: 'redirects', key: 'redirect:original', data: { from: path, to: '/cel.html' } }]) {
    const result = attach([page('/'), page(path)], [entity])
    assert.deepEqual(result.entities, [entity]); assert.deepEqual(result.verified, [])
  }
})
test('external, query, private and unrelated addresses cannot gain a home redirect', () => {
  const paths = ['/kursy-nurkowania/navigator.html', '/strona-glowna/stary-adres.html?task=secret', '/admin.html']
  assert.deepEqual(attach([page('/'), ...paths.map(p => page(p)), { url: 'https://foreign.invalid/strona-glowna/x.html', html: html() }]).entities, [])
})
