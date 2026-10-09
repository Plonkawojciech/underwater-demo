import test from 'node:test'
import assert from 'node:assert/strict'
import { capturedMigrationProposals, migrationMap, type MigrationProjection } from '../src/lib/seo-migration'
import { catalogueProductSchema, FIXED_SEO_PATHS, organizationSchema, publicSeoCanonical } from '../src/lib/seo'
import { jsonLd } from '../src/lib/presentation'

const url = (path: string) => `https://www.underwater.pl${path}`
const projection: MigrationProjection = { records: {
  products: [{ id: 1, published: true, slug: 'new-product', legacyPath: '/123-old-product.html' }],
  courses: [{ id: 1, published: true, slug: 'owd', legacyPath: '/kursy-nurkowania/old-owd.html' }],
  pages: [{ id: 1, published: true, path: 'new-page' }, { id: 2, published: false, path: 'draft' }],
  redirects: [
    { id: 1, published: true, from: '/old-product.html', to: '/123-old-product.html' },
    { id: 2, published: true, from: '/123-old-product.html', to: '/kontakt.html' },
    { id: 3, published: true, from: '/chain.html', to: '/old-product.html' },
    { id: 4, published: true, from: '/cycle-a.html', to: '/cycle-b.html' },
    { id: 5, published: true, from: '/cycle-b.html', to: '/cycle-a.html' },
    { id: 6, published: true, from: '/broken.html', to: '/no-destination.html' },
    { id: 7, published: false, from: '/draft-redirect.html', to: '/kontakt.html' },
    { id: 8, published: true, from: '/encoded-unsafe.html', to: '/%61dmin/private' },
  ],
}, documents: [{ id: 1, legacyPath: '/instructions.pdf', url: `/api/documents/file/${'a'.repeat(64)}.pdf` }] }

test('every original crawl URL receives one explicit disposition; retained addresses never get self redirects', async () => {
  const paths = ['/', '/123-old-product.html', '/old-product.html', '/new-page.html', '/draft.html', '/unknown.html', '/index.php', '/instructions.pdf']
  const map = await migrationMap([...paths.map((path) => ({ url: url(path) })), { url: url('/') }], projection, FIXED_SEO_PATHS)
  assert.equal(map.inputRows, 9)
  assert.equal(map.uniqueSourceUrls, 8)
  assert.equal(map.duplicateSourceUrls, 1)
  assert.equal(map.rows.length, 8)
  assert.deepEqual(map.dispositions, { retained200: 4, redirect301: 2, unresolved404: 2, review: 0 })
  const old = map.rows.find((row) => row.oldPath === '/old-product.html')!
  assert.equal(old.newPath, '/123-old-product.html')
  assert.equal(old.currentStatus, 301)
  assert.equal(old.newUrl, url('/123-old-product.html'))
  assert.equal(old.recordId, 1)
  const live = map.rows.find((row) => row.oldPath === '/123-old-product.html')!
  assert.equal(live.currentStatus, 200)
  assert.deepEqual(live.issues, ['stored-redirect-shadowed-by-published-content'])
  assert.ok(map.redirects.every((rule) => rule.from !== rule.to))
  assert.ok(map.redirects.every((rule) => !rule.to.includes('programo')))
  assert.equal(map.rows.find((row) => row.oldPath === '/instructions.pdf')?.reason, 'source-pdf-kept-at-original-path')
  assert.equal(map.clientNetworkRequests, 0)
  assert.equal(map.databaseWrites, 0)
  assert.equal(map.deployedMigrationRules, false)
})

test('chains, loops and broken targets are explicit review/404 entries rather than invented home redirects', async () => {
  const map = await migrationMap(['/chain.html', '/cycle-a.html', '/broken.html', '/draft-redirect.html', '/encoded-unsafe.html'].map((path) => ({ url: url(path) })), projection, FIXED_SEO_PATHS)
  const chain = map.rows.find((row) => row.oldPath === '/chain.html')!
  assert.equal(chain.disposition, 'review')
  assert.equal(chain.redirectHops, 2)
  assert.equal(chain.newPath, '/123-old-product.html')
  assert.ok(chain.issues.includes('existing-redirect-chain-needs-flattening'))
  assert.ok(map.rows.find((row) => row.oldPath === '/cycle-a.html')!.issues.includes('redirect-loop'))
  assert.equal(map.rows.find((row) => row.oldPath === '/broken.html')!.reason, 'stored-redirect-destination-unresolved')
  assert.equal(map.rows.find((row) => row.oldPath === '/draft-redirect.html')!.currentStatus, 404)
  assert.ok(map.rows.find((row) => row.oldPath === '/encoded-unsafe.html')!.issues.includes('unsafe-redirect-target'))
  assert.deepEqual(map.redirects, [])
})

test('the exact proxy from path must exist; broad resolver aliases do not invent a current HTTP 301', async () => {
  const map = await migrationMap([{ url: url('/old-product') }, { url: url('/new-product.html') }], projection, FIXED_SEO_PATHS)
  assert.equal(map.rows.find((row) => row.oldPath === '/old-product')?.disposition, 'unresolved404')
  const alias = map.rows.find((row) => row.oldPath === '/new-product.html')!
  assert.equal(alias.disposition, 'retained200')
  assert.equal(alias.canonicalPath, '/123-old-product.html')
  assert.ok(alias.issues.includes('served-alias-canonical-elsewhere'))
  assert.deepEqual(map.redirects, [])
})

test('queries, missing source capture, account forms and unsafe URLs remain visible in the complete map', async () => {
  const addresses = [
    { url: url('/kontakt.html'), captureState: 'failed' as const }, { url: url('/kontakt.html?token=test') },
    { url: url('/account.html') }, { url: url('/logowanie/reset.html') }, { url: url('/admin') },
    { url: 'https://other.example/x.html' }, { url: url('/a/%2e%2e/kontakt.html') }, { url: url('/x%3ftoken=test') },
  ]
  const map = await migrationMap(addresses, projection, FIXED_SEO_PATHS)
  assert.equal(map.uniqueSourceUrls, addresses.length)
  assert.equal(map.dispositions.review, addresses.length)
  assert.equal(map.rows.find((row) => row.oldUrl === url('/kontakt.html'))!.currentStatus, 200)
  assert.equal(map.rows.find((row) => row.oldUrl.includes('?token='))!.newUrl, null)
  assert.deepEqual(map.redirects, [])
})

test('duplicate capture metadata preserves the captured entry, and malformed destination canonicals require review', async () => {
  const map = await migrationMap([{ url: url('/kontakt.html'), captureState: 'captured' }, { url: url('/kontakt.html'), captureState: 'failed' }], projection, FIXED_SEO_PATHS)
  assert.equal(map.rows[0].captureState, 'captured')
  assert.equal(map.rows[0].disposition, 'retained200')
  const broken: MigrationProjection = { records: { products: [{ id: 1, published: true, slug: 'good', legacyPath: '/unreachable.html' }] } }
  // A collision claims this record's canonical, so the served alias cannot be declared canonically sound.
  broken.records.products!.push({ id: 2, published: true, slug: 'other', legacyPath: '/unreachable.html' })
  const collision = await migrationMap([{ url: url('/other.html') }], broken, FIXED_SEO_PATHS)
  assert.equal(collision.rows[0].disposition, 'review')
  assert.ok(collision.rows[0].issues.includes('canonical-does-not-resolve-to-same-record'))
})

test('metadata accepts a safe canonical and bounded page query without exporting private request parameters', () => {
  assert.equal(publicSeoCanonical('/łódź.html?strona=2'), '/łódź.html?strona=2')
  assert.equal(publicSeoCanonical('/x.html?strona=1'), '/x.html')
  assert.equal(publicSeoCanonical('/x.html?strona=1000'), '/x.html?strona=1000')
  for (const path of ['/x.html?token=test', '/x.html?strona=2&token=test', '/x.html?strona=0', '/x.html?strona=1001', '/x.html?strona=02', '/x.html?strona=2?', '/admin', '/a/%2e%2e/b', '//outside.example/x']) assert.equal(publicSeoCanonical(path), null, path)
})

test('new 301 proposals require an exact source HTTP final URL and an already published canonical destination', async () => {
  const map = await migrationMap([
    { url: url('/') }, { url: url('/old-product.html') },
    { url: url('/missing-original.html'), final_url: url('/old-product.html') },
    { url: url('/missing-other.html'), final_url: url('/unknown.html') },
    { url: url('/failed-capture.html'), final_url: url('/'), captureState: 'failed' },
    { url: url('/missing-private.html'), final_url: url('/admin') },
  ], projection, FIXED_SEO_PATHS)
  const proposals = capturedMigrationProposals(map.rows)
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].from, '/missing-original.html')
  assert.equal(proposals[0].to, '/123-old-product.html')
  assert.equal(proposals[0].currentStatus, 404)
  assert.equal(proposals[0].deployed, false)
  assert.equal(map.rows.find((row) => row.oldPath === '/missing-original.html')!.disposition, 'unresolved404', 'a proposal cannot masquerade as a current live rule')
})

test('an exact captured HTTP final URL may use an audited published destination absent from the original crawl list', async () => {
  const main = await migrationMap([{ url: url('/missing-alias.html'), final_url: url('/old-product.html') }], projection, FIXED_SEO_PATHS)
  const known = await migrationMap([{ url: url('/old-product.html') }], projection, FIXED_SEO_PATHS)
  assert.equal(capturedMigrationProposals(main.rows).length, 0)
  assert.deepEqual(capturedMigrationProposals(main.rows, known.rows).map((row) => [row.from, row.to]), [['/missing-alias.html', '/123-old-product.html']])
})

test('runtime Product schema keeps safe canonical, truthful per-variant prices and availability, omitting free/unknown prices', () => {
  const product = { id: 1, published: true, name: 'TEST Product', slug: 'new', legacyPath: '/123-old.html', priceCents: 12345, short: '<p>Opis &amp; dane</p>', variants: [
    { label: 'Small', priceCents: 12000, stock: 2 }, { label: 'Large', priceCents: 15000, stock: null }, { label: 'On request', priceCents: 0, stock: 1 },
  ] }
  const schema = catalogueProductSchema(product, 'https://underwater-demo.programo.pl')!
  assert.equal(schema.url, 'https://underwater-demo.programo.pl/123-old.html')
  assert.equal(schema.description, 'Opis & dane')
  assert.ok(Array.isArray(schema.offers))
  const offers = schema.offers as { '@type': string; price: string; availability?: string }[]
  assert.equal(offers.length, 2)
  assert.equal(offers[0]['@type'], 'Offer')
  assert.equal(offers[0].price, '120.00')
  assert.equal(offers[0].availability, 'https://schema.org/InStock')
  assert.equal(offers[1].price, '150.00')
  assert.equal(offers[1].availability, undefined)
  assert.doesNotMatch(jsonLd(schema), /AggregateOffer|aggregateRating|reviewCount/)
  assert.equal(catalogueProductSchema({ ...product, published: false }, 'https://underwater-demo.programo.pl'), null)
  assert.equal(catalogueProductSchema({ ...product, legacyPath: '/api/orders' }, 'https://underwater-demo.programo.pl'), null)
  assert.equal(catalogueProductSchema(product, 'https://user:password@example.test'), null)
})

test('Organization uses only visible brand, configured origin and contact fields; absent/unsafe facts are omitted', () => {
  const schema = organizationSchema({ phone: '22 826 47 73, 604 123 456', email: 'kontakt@example.test', address: 'Ulica TEST 1\nWarszawa', facebook: 'https://www.facebook.com/example', youtube: 'https://www.youtube.com/@example' }, 'https://underwater-demo.programo.pl')!
  assert.equal(schema['@type'], 'Organization')
  assert.equal(schema.name, 'Underwater.pl')
  assert.equal(schema.url, 'https://underwater-demo.programo.pl')
  assert.equal(schema.email, 'kontakt@example.test')
  assert.equal(schema.address, 'Ulica TEST 1\nWarszawa')
  assert.equal(schema.telephone?.length, 2)
  assert.equal(schema.sameAs?.length, 2)
  for (const key of ['logo', 'legalName', 'vatID', 'openingHours', 'geo', 'aggregateRating']) assert.equal(key in schema, false)
  const minimal = organizationSchema({ email: 'invalid email', facebook: 'https://user:password@example.test', youtube: 'javascript:alert(1)' }, 'https://underwater-demo.programo.pl')!
  assert.equal('email' in minimal, false)
  assert.equal('sameAs' in minimal, false)
  assert.equal('telephone' in minimal, false)
  assert.doesNotMatch(jsonLd(organizationSchema({ address: '</script><script>TEST</script>' }, 'https://underwater-demo.programo.pl')), /<|>/)
  assert.equal(organizationSchema({}, 'https://user:password@example.test'), null)
})
