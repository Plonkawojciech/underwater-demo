import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'
import { NextRequest } from 'next/server'
import { resolveSourceRoute } from '../src/lib/source-routes'
import { sitemapPaths, type SitemapDocument } from '../src/lib/seo'

const root = mkdtempSync(path.join(tmpdir(), 'underwater-seo-runtime-'))
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, {
  UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root,
  DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`,
  UNDERWATER_ORIGIN: 'http://localhost:3011', NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011',
  PAYLOAD_SECRET: 'synthetic-seo-runtime-secret-not-used-in-runtime',
})
let payload: Payload
let query: typeof import('../src/views/query')
let meta: typeof import('../src/views/meta')
let proxy: typeof import('../src/proxy')

test.before(async () => {
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  query = await import('../src/views/query')
  meta = await import('../src/views/meta')
  proxy = await import('../src/proxy')
})
test.after(async () => {
  try { if (payload) await payload.destroy() }
  finally { rmSync(root, { recursive: true, force: true }) }
})

const fixedPaths = () => Object.fromEntries(Object.entries(meta.FIXED_META).map(([key, value]) => [key, value.path])) as Parameters<typeof sitemapPaths>[1]

test('actual Payload public route and sitemap pick the same first published event when paths collide', async () => {
  await payload.create({ collection: 'events', data: { title: 'TEST hidden collision', startsAt: '2099-01-01T10:00:00.000Z', path: 'test-shared-event', published: false } })
  const first = await payload.create({ collection: 'events', data: { title: 'TEST first collision', startsAt: '2099-01-01T10:00:00.000Z', path: 'test-shared-event', published: true } })
  const later = await payload.create({ collection: 'events', data: { title: 'TEST later collision', startsAt: '2099-01-02T10:00:00.000Z', path: 'test-shared-event', legacyPath: '/test-later-event.html', published: true } })
  assert.ok(first.id < later.id)
  const actual = await resolveSourceRoute('test-shared-event.html', query.publicFirst, { redirects: false, depth: false })
  assert.equal(actual?.kind, 'event')
  assert.equal(actual && actual.kind === 'event' ? actual.doc.id : null, first.id)
  assert.equal(actual ? meta.hrefOf(actual) : null, '/test-shared-event.html')
  const records = await query.publicFind<SitemapDocument>('events', { where: { id: { in: [first.id, later.id] } }, limit: 500, depth: 0, sort: 'id', select: { id: true, published: true, path: true, legacyPath: true } })
  const paths = await sitemapPaths({ events: records.docs }, fixedPaths())
  assert.ok(paths.includes('/test-shared-event.html'))
  assert.ok(paths.includes('/test-later-event.html'))
  for (const canonical of paths.filter((item) => item.startsWith('/test-'))) {
    const resolved = await resolveSourceRoute(canonical.slice(1), query.publicFirst, { redirects: false, depth: false })
    assert.equal(resolved ? meta.hrefOf(resolved) : null, canonical, 'live page canonical must agree with generated sitemap')
  }
})

test('actual Payload legacy collision agrees across page lookup, proxy live finder and generated sitemap', async () => {
  // A previously valid redirect can become stale when content is imported later.
  // The real proxy must preserve live content even with this stored redirect present.
  await payload.create({ collection: 'redirects', data: { from: '/test-shared-legacy.html', to: '/kontakt.html', published: true } })
  const first = await payload.create({ collection: 'events', data: { title: 'TEST first legacy', startsAt: '2099-02-01T10:00:00.000Z', path: 'test-first-legacy', legacyPath: '/test-shared-legacy.html', published: true } })
  const later = await payload.create({ collection: 'events', data: { title: 'TEST later legacy', startsAt: '2099-02-02T10:00:00.000Z', path: 'test-later-legacy', legacyPath: '/test-shared-legacy.html', published: true } })
  const fromPage = await resolveSourceRoute('test-shared-legacy.html', query.publicFirst, { redirects: false, depth: false })
  const fromProxy = await proxy.proxy(new NextRequest('http://localhost:3011/test-shared-legacy.html', { headers: { host: 'localhost:3011' } }))
  assert.equal(fromPage?.kind, 'event')
  assert.equal(fromPage && fromPage.kind === 'event' ? fromPage.doc.id : null, first.id)
  assert.equal(fromProxy.status, 200)
  assert.equal(fromProxy.headers.get('x-middleware-next'), '1')
  assert.equal(fromProxy.headers.get('location'), null)
  const records = await query.publicFind<SitemapDocument>('events', { where: { id: { in: [first.id, later.id] } }, limit: 500, depth: 0, sort: 'id', select: { id: true, published: true, path: true, legacyPath: true } })
  const paths = await sitemapPaths({ events: records.docs }, fixedPaths())
  assert.equal(paths.filter((item) => item === '/test-shared-legacy.html').length, 1)
  assert.ok(!paths.includes('/test-first-legacy.html'))
  assert.ok(!paths.includes('/test-later-legacy.html'))
})

test('actual trailing-slash legacy record uses one served canonical in metadata and sitemap', async () => {
  const event = await payload.create({ collection: 'events', data: { title: 'TEST trailing canonical', startsAt: '2099-03-01T10:00:00.000Z', path: 'test-trailing', legacyPath: '/test-trailing/', published: true } })
  const resolved = await resolveSourceRoute('test-trailing', query.publicFirst, { redirects: false, depth: false })
  assert.equal(resolved?.kind, 'event')
  assert.equal(resolved && resolved.kind === 'event' ? resolved.doc.id : null, event.id)
  assert.equal(resolved ? meta.hrefOf(resolved) : null, '/test-trailing')
  const records = await query.publicFind<SitemapDocument>('events', { where: { id: { equals: event.id } }, limit: 500, depth: 0, sort: 'id', select: { id: true, published: true, path: true, legacyPath: true } })
  const paths = await sitemapPaths({ events: records.docs }, fixedPaths())
  assert.ok(paths.includes('/test-trailing'))
  assert.ok(!paths.includes('/test-trailing/'))
})

test('actual captured fixed section normalizes its trailing-slash canonical as other pages do', async () => {
  const page = await payload.create({ collection: 'pages', data: { title: 'TEST captured news section', path: 'aktualnosci', kind: 'page', legacyPath: '/aktualnosci/', published: true } })
  const resolved = await resolveSourceRoute('aktualnosci.html', query.publicFirst, { redirects: false, depth: false })
  assert.equal(resolved?.kind, 'fixed')
  assert.equal(resolved && resolved.kind === 'fixed' ? resolved.source?.id : null, page.id)
  assert.equal(resolved ? meta.hrefOf(resolved) : null, '/aktualnosci')
  const records = await query.publicFind<SitemapDocument>('pages', { where: { id: { equals: page.id } }, limit: 500, depth: 0, sort: 'id', select: { id: true, published: true, path: true, legacyPath: true } })
  const paths = await sitemapPaths({ pages: records.docs }, fixedPaths())
  assert.ok(paths.includes('/aktualnosci'))
  assert.ok(!paths.includes('/aktualnosci/'))
  assert.ok(!paths.includes('/aktualnosci.html'))
})
