import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { validateBundle } from '../src/lib/import/bundle'
const bundled = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
test('verified source redirect targets retain their identity, resolve chains and never hide live content', () => {
  const source = 'https://www.underwater.pl'
  const bundle = { version: 1, source: { kind: 'public-pages', manifestHash: 'a'.repeat(64), capturedAt: '2026-10-08T12:00:00Z', complete: false }, media: [], entities: [
    { collection: 'pages', key: 'page:current', data: { title: 'Synthetic page', path: '/current.html', kind: 'page', published: true } },
    { collection: 'redirects', key: 'redirect:alias', data: { from: '/alias.html', to: '/current.html', published: true } },
  ] }
  const pairs = [['/legacy.html', '/current.html'], ['/legacy-chain.html', '/alias.html'], ['/current.html', '/kontakt.html'], ['/unknown.html', '/missing.html'], ['/to-home.html', '/'], ['/conflict.html', '/current.html'], ['/conflict.html', '/kontakt.html'], ['/index.php', '/sklep-nurkowy.html'], ['/api/test.html', '/current.html']]
  const code = "import sys,json;sys.path.insert(0,'scripts/source');from captured_redirects import attach_captured_redirects;d=json.load(sys.stdin);issues=attach_captured_redirects(d['bundle'],d['captures']);print(json.dumps({'bundle':d['bundle'],'issues':issues}))"
  const result = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', code], { input: JSON.stringify({ bundle, captures: pairs.map(([from, to]) => ({ url: source + from, final_url: source + to })) }), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  const redirects = output.bundle.entities.filter((e: any) => e.collection === 'redirects')
  assert.equal(redirects.length, 3)
  assert.deepEqual(redirects.slice(1).map((e: any) => [e.data.from, e.data.to]), [['/legacy-chain.html', '/current.html'], ['/legacy.html', '/current.html']])
  assert.deepEqual(new Set(output.issues.map((r: any) => r.code)), new Set(['source-http-redirect-shadowed', 'source-http-redirect-target-unresolved', 'source-http-redirect-home-review', 'source-http-redirect-conflict', 'source-http-redirect-app-route']))
  validateBundle(output.bundle)
})
