import assert from 'node:assert/strict'
import test from 'node:test'
import { capturedAddresses, migrationPackage, requestIdentity, routingProjection, sourceReportIssues } from '../scripts/seo/migration-package'
import type { MigrationProjection } from '../src/lib/seo-migration'

const url = (path: string) => `https://www.underwater.pl${path}`
const fixture = (): MigrationProjection => ({ records: {
  pages: [{ id: 1, published: true, path: 'page', legacyPath: '/old-page.html' }],
  redirects: [
    { id: 1, published: true, from: '/moved.html', to: '/old-page.html' },
    { id: 2, published: true, from: '/outside-crawl.html', to: '/kontakt.html' },
  ],
}, documents: [{ id: 1, legacyPath: '/Załącznik.pdf', url: `/api/documents/file/${'a'.repeat(64)}.pdf` }] })

test('package keeps exact URLs, all published rules and unresolved decisions separate from proposals', async () => {
  const projection = fixture()
  const result = await migrationPackage([
    { url: url('/old-page.html') }, { url: url('/moved.html') },
    { url: url('/missing.html'), final_url: url('/old-page.html') },
    { url: url('/failed.html'), captureState: 'failed' }, { url: url('/account.html') },
  ], projection, [{ url: url('/missing.html'), code: 'record-conflict' }])
  assert.equal(result.sourceCoverage.uniqueSourceUrls, 6)
  assert.deepEqual(result.sourceCoverage.dispositions, { retained200: 2, redirect301: 1, unresolved404: 1, review: 2 })
  assert.equal(result.routes.length, 2)
  assert.equal(result.audit.publishedRulesOutsideCapturedList, 1)
  assert.equal(result.audit.safe, true)
  assert.deepEqual(result.gates, { ownPreviewRoutesReady: true, clientCutoverReady: false })
  assert.ok(result.routes.every((row) => row.queryPolicy === 'preserve' && row.status === 301 && row.source === 'published'))
  assert.equal(result.decisions.length, 3)
  assert.ok(result.decisions.every((row) => row.proposedDestination === null && row.blocksClientCutover))
  assert.deepEqual(result.decisions.find((row) => row.oldUrl === url('/missing.html'))!.sourceIssueCodes, ['record-conflict'])
  assert.equal(result.proposals.length, 1)
  assert.ok(!result.routes.some((row) => row.from === '/missing.html'))
  const document = result.rows.find((row) => row.resolvedKind === 'document')!
  assert.equal(document.oldUrl, url('/Za%C5%82%C4%85cznik.pdf'))
  assert.equal(document.originalPath, '/Za%C5%82%C4%85cznik.pdf')
  assert.equal(document.wirePath, '/Za%C5%82%C4%85cznik.pdf')
  assert.equal(document.oldPath, '/Załącznik.pdf')
  assert.equal(result.clientNetworkRequests, 0)
  assert.equal(result.databaseWrites, 0)
})

test('first-id resolver cannot hide conflicting or duplicate published rules', async () => {
  for (const target of ['/kontakt.html', '/old-page.html']) {
    const projection = fixture()
    projection.records.redirects!.push({ id: 3, published: true, from: '/moved.html/', to: target })
    const result = await migrationPackage([{ url: url('/moved.html') }], projection)
    assert.equal(result.audit.safe, false)
    assert.equal(result.gates.ownPreviewRoutesReady, false)
    assert.ok(result.audit.blockingIssues.some((row) => row.code === (target === '/kontakt.html' ? 'conflicting-rule-destinations' : 'duplicate-rule-key')))
    assert.ok(!result.routes.some((row) => row.from.startsWith('/moved.html')))
  }
})

test('chain, loop, live shadow, encoded private target and canonical alias block route handoff', async () => {
  const projection = fixture()
  projection.records.redirects!.push(
    { id: 3, published: true, from: '/chain.html', to: '/moved.html' },
    { id: 4, published: true, from: '/loop.html', to: '/loop2.html' },
    { id: 5, published: true, from: '/loop2.html', to: '/loop.html' },
    { id: 6, published: true, from: '/old-page.html', to: '/kontakt.html' },
    { id: 7, published: true, from: '/private.html', to: '/%61dmin/collections/users' },
    { id: 8, published: true, from: '/alias-target.html', to: '/page.html' },
  )
  const result = await migrationPackage([{ url: url('/old-page.html') }], projection)
  assert.equal(result.audit.safe, false)
  assert.equal(result.routes.length, 2)
  for (const from of ['/chain.html', '/loop.html', '/loop2.html', '/old-page.html', '/private.html', '/alias-target.html']) assert.ok(result.audit.blockingIssues.some((row) => row.path === from), from)
})

test('query-specific identities remain decisions and never become path-wide redirects', async () => {
  const result = await migrationPackage([
    { url: url('/moved.html?option=com_content&id=5') }, { url: url('/index.php?option=com_content&id=5') },
    { url: url('/index.php') }, { url: url('/kontakt.html?token=synthetic') },
  ], fixture())
  assert.equal(result.decisions.length, 3)
  assert.ok(result.decisions.every((row) => row.reason === 'source-query-needs-explicit-route-mapping'))
  assert.equal(result.rows.find((row) => row.oldUrl.endsWith('/index.php'))!.currentStatus, 301)
  assert.ok(result.routes.every((row) => !row.from.includes('?') && !row.to.includes('?')))
  assert.deepEqual(result.builtInRoutes, [{ from: '/index.php', to: '/', status: 301, queryPolicy: 'empty-only', source: 'runtime-proxy' }])
  assert.deepEqual(requestIdentity(url('/Za%C5%82%C4%85cznik.pdf?strona=2#test')), { originalPath: '/Za%C5%82%C4%85cznik.pdf', wirePath: '/Za%C5%82%C4%85cznik.pdf', query: '?strona=2', fragment: '#test' })
})

test('a sitemap collision cannot produce another unreachable canonical or private path', async () => {
  const projection = fixture()
  projection.records.products = [{ id: 1, published: true, slug: 'first', legacyPath: '/shared.html' }, { id: 2, published: true, slug: 'second', legacyPath: '/shared.html' }]
  projection.records.pages!.push({ id: 2, published: true, path: 'api/private' })
  const result = await migrationPackage([{ url: url('/shared.html') }], projection)
  assert.ok(result.sitemap.includes('/shared.html'))
  assert.equal(result.sitemap.filter((path) => path === '/shared.html').length, 1)
  assert.ok(!result.sitemap.includes('/second.html'))
  assert.ok(!result.sitemap.some((path) => path.startsWith('/api/')))
  assert.equal(result.audit.safe, true)
})

test('routing inputs reject customer fields, duplicate IDs and nonboolean publication values', () => {
  assert.throws(() => routingProjection({ records: { orders: [] } }))
  assert.throws(() => routingProjection({ records: { pages: [{ id: 1, path: 'a', email: 'synthetic@example.test' }] } }))
  assert.throws(() => routingProjection({ records: { pages: [{ id: 1 }, { id: 1 }] } }))
  assert.throws(() => routingProjection({ records: { pages: [{ id: 1, published: 'true' }] } }))
  assert.equal(routingProjection({ records: { pages: [{ id: 1, published: 1, path: 'a' }] } }).records.pages![0].published, true)
  assert.deepEqual(capturedAddresses({ captures: [{ url: url('/'), final_url: url('/'), bytes: 999 }], failed: [{ url: url('/failed'), error_type: 'PermissionError' }], excludedNavigation: [url('/excluded')] }), [
    { url: url('/'), final_url: url('/'), captureState: 'captured' }, { url: url('/failed'), captureState: 'failed' }, { url: url('/excluded'), captureState: 'excluded' },
  ])
})

test('conversion conflict evidence uses exact URL pairs and keeps editorial detail out of the handoff', () => {
  const issues = sourceReportIssues({ unresolved: [
    { code: 'conflicting-source-content', url: null, detail: `${url('/first.html')} | ${url('/second.html')}` },
    { code: 'shop-component-missing', url: url('/empty.html'), detail: 'Source page text stays private' },
    { code: 'other', url: 'https://external.example/page.html' },
  ], excludedNavigation: [url('/kalendarz/eventsbyweek/2026/10/12/-.html')] })
  assert.deepEqual(issues, [
    { url: url('/first.html'), code: 'conflicting-source-content' }, { url: url('/second.html'), code: 'conflicting-source-content' },
    { url: url('/empty.html'), code: 'shop-component-missing' }, { url: url('/kalendarz/eventsbyweek/2026/10/12/-.html'), code: 'calendar-navigation-excluded' },
  ])
  assert.ok(!JSON.stringify(issues).includes('Source page text'))
})
