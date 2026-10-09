import assert from 'node:assert/strict'
import test from 'node:test'
import { consentDecision, createTestMeasurement, measurementPath } from '../src/lib/analytics'
import { courseSchema, publicSeoPath, seoUrl, sitemapPaths, sitemapXml, type SitemapRecords } from '../src/lib/seo'
import { jsonLd, type CourseDoc } from '../src/lib/presentation'
import type { FixedRoute } from '../src/lib/source-routes'

const fixed: Record<FixedRoute, string> = {
  shop: '/sklep-nurkowy.html', courses: '/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html', contact: '/kontakt.html',
  trips: '/wyprawy-nurkowe.html', calendar: '/kalendarz.html', news: '/aktualnosci.html', reports: '/relacje-z-wypraw.html', albums: '/galeria.html',
}

test('sitemap includes reachable published canonicals across every public collection and preserves resolver collision order', async () => {
  const records: SitemapRecords = {
    products: [
      { id: 2, published: true, slug: 'product-new', legacyPath: '/3625-produkt.html' },
      { id: 3, published: true, slug: 'shared', legacyPath: '/kolizja.html' },
      { id: 4, published: false, slug: 'draft' },
      { id: 5, slug: 'missing-published' },
    ],
    categories: [{ id: 1, published: true, slug: 'łódź' }],
    courses: [{ id: 1, published: true, slug: 'owd', legacyPath: '/kursy-nurkowania/stary-owd.html' }],
    pages: [
      { id: 1, published: true, path: 'page' },
      { id: 2, published: true, path: 'shadow-page', legacyPath: '/kolizja.html' },
      { id: 3, published: true, path: 'aktualnosci', legacyPath: '/aktualnosci.html' },
      { id: 4, published: true, path: 'api/private' },
      { id: 5, published: true, path: 'newsletter/confirm' },
      { id: 6, published: true, path: 'token' },
      { id: 7, published: true, path: 'bad', legacyPath: '/missing.html?token=secret' },
      { id: 8, published: true, path: 'bad-dot', legacyPath: '/bad/../outside.html' },
    ],
    trips: [{ id: 1, published: true, path: 'wyprawy/egipt' }],
    albums: [{ id: 1, published: true, path: 'galerie/rafa' }],
    events: [{ id: 1, published: true, path: 'kalendarz/start.html' }, { id: 2, published: true, path: null }],
  }
  const paths = await sitemapPaths(records, fixed)
  for (const path of ['/', ...Object.values(fixed), '/3625-produkt.html', '/kolizja.html', '/łódź.html', '/kursy-nurkowania/stary-owd.html', '/page.html', '/wyprawy/egipt.html', '/galerie/rafa.html', '/kalendarz/start.html', '/bad.html']) assert.ok(paths.includes(path), path)
  for (const path of ['/draft.html', '/missing-published.html', '/product-new.html', '/shadow-page.html', '/api/private.html', '/newsletter/confirm.html', '/token.html', '/missing.html?token=secret', '/bad/../outside.html']) assert.ok(!paths.includes(path), path)
  assert.equal(paths.filter((path) => path === '/kolizja.html').length, 1)
  assert.equal(paths.filter((path) => path === '/aktualnosci.html').length, 1)
  assert.equal(paths.some((path) => path.includes('undefined') || path.includes('null')), false)
})

test('sitemap refuses an unreachable course canonical instead of publishing an alias that resolves to 404', async () => {
  // A malformed deep course slug does not match the two-segment course route.
  const paths = await sitemapPaths({ courses: [{ id: 1, published: true, slug: 'folder/course' }] }, fixed)
  assert.ok(!paths.includes('/kursy-nurkowania/folder/course.html'))
})

test('sitemap chooses the first published id consistently even when a legacy path conflicts with a slug', async () => {
  const paths = await sitemapPaths({ products: [
    { id: 1, published: true, slug: 'first', legacyPath: '/same.html' },
    { id: 2, published: true, slug: 'same', legacyPath: '/second.html' },
  ] }, fixed)
  assert.ok(paths.includes('/same.html'))
  assert.ok(paths.includes('/second.html'))
  assert.ok(!paths.includes('/first.html'))
})

test('SEO URLs reject private, encoded private, token, traversal and external paths', () => {
  for (const value of ['//evil.example/x', 'https://evil.example/x', '/api/x', '/%61dmin/x', '/platnosc-testowa?token=x', '/platnosc-testowa', '/zgloszenie/potwierdz', '/component/users/reset.html', '/a/%2e%2e/b', '/a%2fb', '/x\\y', '/x?token=secret', '/x%3ftoken=secret', '/x%253ftoken=secret', '/x#secret', '/x%23secret', '/x%20secret', '/x%00', '/100%25.html', '/literal%.html']) assert.equal(publicSeoPath(value), null, value)
  assert.equal(seoUrl('/łódź.html', 'https://underwater-demo.programo.pl'), 'https://underwater-demo.programo.pl/%C5%82%C3%B3d%C5%BA.html')
  for (const origin of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/base', 'https://example.com?x=1', 'https://example.com#x']) assert.equal(seoUrl('/x.html', origin), null, origin)
})

test('XML escapes path ampersands, deduplicates URLs and refuses guessed source timestamps', () => {
  const xml = sitemapXml(['/', '/a&b.html', '/a&b.html', '/api/private', '/x?token=secret'], 'https://underwater-demo.programo.pl')
  assert.equal(xml.match(/<url>/g)?.length, 2)
  assert.match(xml, /a&amp;b\.html/)
  assert.doesNotMatch(xml, /token|private|lastmod|priority|changefreq/)
  assert.throws(() => sitemapXml(['/x.html'], ''), /configured sitemap origin/)
  assert.throws(() => sitemapXml(Array.from({ length: 50_001 }, (_, id) => `/page-${id}.html`), 'https://underwater-demo.programo.pl'), /Sitemap index required/)
})

test('Course JSON-LD contains only visible factual content, safe canonical and images; no invented price/rating/schedule', () => {
  const course: CourseDoc = { id: 1, published: true, name: 'Open Water Diver', slug: 'owd', legacyPath: '/kursy-nurkowania/owd-stary.html', lead: '<p>Opis &amp; warunki</p>', image: { url: '/media/owd.jpg' }, price: 1500, org: 'PADI' }
  const schema = courseSchema(course, 'https://underwater-demo.programo.pl')!
  assert.equal(schema['@type'], 'Course')
  assert.equal(schema.name, course.name)
  assert.equal(schema.description, 'Opis & warunki')
  assert.equal(schema.url, 'https://underwater-demo.programo.pl/kursy-nurkowania/owd-stary.html')
  assert.equal(schema.image, 'https://underwater-demo.programo.pl/media/owd.jpg')
  assert.deepEqual(schema.provider, { '@type': 'Organization', name: 'Underwater.pl', url: 'https://underwater-demo.programo.pl' })
  for (const key of ['offers', 'aggregateRating', 'review', 'hasCourseInstance', 'coursePrerequisites', 'courseCode', 'educationalCredentialAwarded']) assert.equal(key in schema, false, key)
  const unsafe = courseSchema({ ...course, name: '</script><script>alert(1)</script>' }, 'https://underwater-demo.programo.pl')
  assert.doesNotMatch(jsonLd(unsafe), /<|>|&/)
  assert.equal(courseSchema({ ...course, published: false }, 'https://underwater-demo.programo.pl'), null)
  assert.equal(courseSchema(course, ''), null)
})

test('only explicit valid consent dismisses the first-visit banner; malformed stored input never enables measurement', () => {
  for (const raw of [null, '', '{bad', '{}', '{"v":1}', '{"v":2,"analytics":true}', '{"v":1,"analytics":"true"}', '[]']) assert.deepEqual(consentDecision(raw), { decided: false, analytics: false }, String(raw))
  assert.deepEqual(consentDecision('{"v":1,"analytics":false}'), { decided: true, analytics: false })
  assert.deepEqual(consentDecision('{"v":1,"analytics":true}'), { decided: true, analytics: true })
})

test('test measurement is consent-gated, removes query secrets, excludes private flows and clears on revoke', () => {
  const measurement = createTestMeasurement()
  assert.equal(measurement.pageView('/produkt.html'), false)
  assert.deepEqual(measurement.snapshot(), { mode: 'local-test', consent: false, events: [] })
  measurement.setConsent(true)
  assert.equal(measurement.pageView('/produkt.html?email=private@example.com#secret'), true)
  assert.equal(measurement.pageView('/produkt.html?utm_source=other'), false)
  for (const path of ['/admin', '/%61dmin/collections/users', '/newsletter/potwierdz?token=secret', '/zgloszenie/potwierdz?token=secret', '/platnosc-testowa?token=secret', '/api/orders', '/a/../b', '/a%3ftoken=secret', '//evil.example', 'https://evil.example/x']) assert.equal(measurement.pageView(path), false, path)
  assert.deepEqual(measurement.snapshot().events, [{ name: 'page_view', path: '/produkt.html' }])
  measurement.setConsent(false)
  assert.equal(measurement.pageView('/kurs.html'), false)
  assert.deepEqual(measurement.snapshot(), { mode: 'local-test', consent: false, events: [] })
})

test('test measurement exposes copied, bounded events and never retains a visitor identifier', () => {
  const measurement = createTestMeasurement()
  measurement.setConsent(true)
  for (let id = 0; id < 80; id++) measurement.pageView(`/page-${id}.html`)
  const snapshot = measurement.snapshot()
  assert.equal(snapshot.events.length, 50)
  assert.deepEqual(snapshot.events[0], { name: 'page_view', path: '/page-30.html' })
  snapshot.events[0].path = '/modified.html'
  snapshot.events.length = 0
  assert.equal(measurement.snapshot().events.length, 50)
  assert.equal(measurement.snapshot().events[0].path, '/page-30.html')
  assert.equal(measurementPath('/x%00'), null)
})
