import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPath, categoryTree, contentHref, fingerprint, formatMoney, groupByMonth, isSafeSlug, isToken, jsonLd, knownStock,
  legacyCandidates, monthRange, normalizeSegments, parseConsent, parseMonth, parsePage, parseQuote, pathCandidates, priceSpan,
  productPrice, productSchema, quoteLineFor, safeAssetUrl, safeExternalUrl, safePaymentPath, searchQuery, seatsLeft, shiftMonth,
  variantPrice, warsawMidnight, withQuery, type ProductDoc,
} from '../../src/lib/presentation'

test('normalizeSegments decodes Unicode, strips .html only from the last segment, keeps the requested form', () => {
  const n = normalizeSegments(['sklep.html', encodeURIComponent('3625-maska-żółta') + '.html'])
  assert.deepEqual(n, { segments: ['sklep.html', '3625-maska-żółta'], path: 'sklep.html/3625-maska-żółta', requested: '/sklep.html/3625-maska-żółta.html' })
  assert.equal(normalizeSegments(['kontakt'])?.path, 'kontakt')
  assert.equal(normalizeSegments(['a', 'B.HTML'])?.path, 'a/B')
})

test('normalizeSegments rejects traversal, encoded separators, control characters and empty names', () => {
  for (const raw of [['..'], ['.'], ['a', '%2E%2E'], ['a%2Fb'], ['a%5Cb'], ['%00x'], ['.html'], [], ['%E0%A4%A']]) {
    assert.equal(normalizeSegments(raw), null, JSON.stringify(raw))
  }
  assert.equal(normalizeSegments(Array(13).fill('a')), null)
})

test('legacy and path candidates cover slash/.html/encoding variants exactly', () => {
  const raw = [encodeURIComponent('łódź') + '.html']
  const n = normalizeSegments(raw)!
  assert.deepEqual(new Set(legacyCandidates(raw, n)), new Set(['/łódź.html', '/%C5%82%C3%B3d%C5%BA.html', 'łódź.html', '%C5%82%C3%B3d%C5%BA.html']))
  assert.deepEqual(pathCandidates('o-nas'), ['o-nas', 'o-nas.html', '/o-nas', '/o-nas.html'])
})

test('isSafeSlug accepts letters in any script and rejects anything that could change the path', () => {
  for (const ok of ['3625-maska-soprastek-corona', 'kategoria/3625-maska', 'płetwy-żółte', 'a_b~c.d']) assert.ok(isSafeSlug(ok), ok)
  for (const bad of ['', '../x', 'a/../b', '/abs', 'a//b', 'a/', 'javascript:alert(1)', 'a b', '%2e', '.hidden', 'a\\b', 'x'.repeat(201)]) {
    assert.equal(isSafeSlug(bad), false, bad)
  }
})

test('contentHref builds site links and refuses external or scheme values', () => {
  assert.equal(contentHref('o-nas'), '/o-nas.html')
  assert.equal(contentHref('/aktualnosci/wpis.html'), '/aktualnosci/wpis.html')
  assert.equal(contentHref('folder/'), '/folder/')
  for (const bad of ['https://evil.example/x', '//evil.example', '///x', 'javascript:alert(1)', 'mailto:a@b', 'a\\b', '', '  ', null]) {
    assert.equal(contentHref(bad), null, String(bad))
  }
})

test('canonicalPath keeps a plain legacy path and ignores query-style or external ones', () => {
  assert.equal(canonicalPath('/new.html', '/3625-old.html'), '/3625-old.html')
  assert.equal(canonicalPath('/new.html', 'index.php?option=com_content&id=3'), '/new.html')
  assert.equal(canonicalPath('/new.html', '/index.php?id=3'), '/new.html')
  assert.equal(canonicalPath('/new.html', '//evil.example/x'), '/new.html')
  assert.equal(canonicalPath('/new.html', null), '/new.html')
})

test('asset and external URLs: same-origin paths and https only', () => {
  assert.equal(safeAssetUrl('/media/a.jpg'), '/media/a.jpg')
  assert.equal(safeAssetUrl('https://cdn.example/a.jpg'), 'https://cdn.example/a.jpg')
  for (const bad of ['//evil/a.jpg', '/\\evil', 'http://x/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https:///x']) assert.equal(safeAssetUrl(bad), null, bad)
  assert.equal(safeExternalUrl('javascript:alert(1)'), null)
  assert.equal(safeExternalUrl('https://facebook.com/underwater'), 'https://facebook.com/underwater')
})

test('prices: cents first, złoty fallback, sale only when it is a real reduction', () => {
  assert.deepEqual(productPrice({ priceCents: 12900, price: 1 }), { base: 12900, sale: null, current: 12900 })
  assert.deepEqual(productPrice({ price: 19.99 }), { base: 1999, sale: null, current: 1999 })
  assert.deepEqual(productPrice({ priceCents: 10000, salePriceCents: 8000 }), { base: 10000, sale: 8000, current: 8000 })
  assert.equal(productPrice({ priceCents: 10000, salePriceCents: 10000 }).sale, null)
  assert.equal(productPrice({ priceCents: 10000, salePriceCents: 12000 }).sale, null)
  assert.equal(productPrice({ priceCents: 10000, salePriceCents: 0 }).sale, null)
  assert.equal(productPrice({ priceCents: -5 }).current, null)
  assert.equal(productPrice({ priceCents: 10.5 }).current, null)
  assert.equal(productPrice({ price: Number.NaN }).current, null)
})

test('variant price overrides the product price and its promotion', () => {
  const p = { priceCents: 10000, salePriceCents: 8000 }
  assert.deepEqual(variantPrice(p, { priceCents: 12000 }), { base: 12000, sale: null, current: 12000 })
  assert.deepEqual(variantPrice(p, { priceCents: null }), { base: 10000, sale: 8000, current: 8000 })
  assert.deepEqual(priceSpan({ ...p, variants: [{ priceCents: 12000 }, { priceCents: null }] }), { min: 8000, max: 12000 })
  assert.equal(priceSpan({}), null)
})

test('knownStock sums variants and returns null when the record does not say', () => {
  assert.equal(knownStock({ stock: 3 }), 3)
  assert.equal(knownStock({ stock: null }), null)
  assert.equal(knownStock({ stock: 9, variants: [{ stock: 2 }, { stock: -1 }, { stock: null }] }), 2)
  assert.equal(knownStock({ variants: [{ stock: null }] }), null)
})

test('formatMoney uses Polish formatting from grosze', () => {
  assert.equal(formatMoney(123456).replace(/\s/g, ' '), '1234,56 zł')
  assert.equal(formatMoney(null), '')
})

test('query parsing is bounded', () => {
  assert.equal(parsePage('3'), 3)
  for (const v of [undefined, '', '0', '-1', 'abc', '1.5', '99999']) assert.equal(parsePage(v), 1, String(v))
  assert.equal(parsePage('5000'), 1000)
  assert.equal(parsePage(['4', '9']), 4)
  assert.equal(searchQuery('  maska   pełna '), 'maska pełna')
  assert.equal(searchQuery('a'), '')
  assert.equal(searchQuery('x'.repeat(300)).length, 80)
  assert.equal(withQuery('/sklep-nurkowy.html', { q: 'maska', strona: 1 }), '/sklep-nurkowy.html?q=maska')
  assert.equal(withQuery('/x.html', { strona: 2, org: undefined }), '/x.html?strona=2')
})
test('zero catalogue prices are enquiry-only and do not publish a free offer', () => {
  assert.equal(productPrice({ priceCents: 0 }).current, null)
  assert.equal(variantPrice({ priceCents: 1000 }, { priceCents: 0 }).current, null)
  assert.equal('offers' in productSchema({ id: 1, name: 'TEST', slug: 'test', priceCents: 0 } as any, '/test.html', 'http://localhost'), false)
})

test('categoryTree: ancestors root-first, full subtree, cycles and missing parents are safe', () => {
  const t = categoryTree([
    { id: 1, name: 'Sprzęt', slug: 's' },
    { id: 2, name: 'Maski', slug: 'm', parent: 1 },
    { id: 3, name: 'Maski pełnotwarzowe', slug: 'mp', parent: { id: 2 } },
    { id: 4, name: 'Sierota', slug: 'o', parent: 99 },
    { id: 5, name: 'A', slug: 'a', parent: 6 },
    { id: 6, name: 'B', slug: 'b', parent: 5 },
  ])
  assert.deepEqual(t.ancestors(3).map((c) => c.id), [1, 2])
  assert.deepEqual(t.subtree(1).sort(), [1, 2, 3])
  assert.ok(t.roots.some((r) => r.id === 4), 'unpublished parent makes a root')
  assert.ok(t.ancestors(5).length <= 1)
  assert.deepEqual(t.subtree(5).sort(), [5, 6])
})

test('Warsaw month boundaries follow DST', () => {
  assert.equal(warsawMidnight(2026, 10, 1).toISOString(), '2026-09-30T22:00:00.000Z')
  assert.equal(warsawMidnight(2026, 11, 1).toISOString(), '2026-10-31T23:00:00.000Z')
  assert.equal(warsawMidnight(2026, 3, 29).toISOString(), '2026-03-28T23:00:00.000Z')
  const r = monthRange({ y: 2026, m: 12 })
  assert.equal(r.end.toISOString(), '2026-12-31T23:00:00.000Z')
  assert.deepEqual(shiftMonth({ y: 2026, m: 12 }, 1), { y: 2027, m: 1 })
  assert.deepEqual(shiftMonth({ y: 2026, m: 1 }, -1), { y: 2025, m: 12 })
  assert.deepEqual(parseMonth('2026-10'), { y: 2026, m: 10 })
  for (const bad of ['2026-13', '2026-1', '1999-05', 'x', undefined]) assert.equal(parseMonth(bad), null, String(bad))
})

test('groupByMonth uses Warsaw local time', () => {
  const g = groupByMonth([{ startsAt: '2026-10-31T22:30:00Z' }, { startsAt: '2026-10-31T23:30:00Z' }, { startsAt: 'not a date' }])
  assert.deepEqual(g.map((x) => [x.month.m, x.items.length]), [[10, 1], [11, 1]])
})

test('seatsLeft: null without a limit, never negative', () => {
  assert.equal(seatsLeft({ capacity: null, reserved: 3 }), null)
  assert.equal(seatsLeft({ capacity: 8, reserved: 3 }), 5)
  assert.equal(seatsLeft({ capacity: 4, reserved: 9 }), 0)
  assert.equal(seatsLeft({ capacity: 4, reserved: null }), 4)
})

test('safePaymentPath follows only the same-origin test payment page', () => {
  const o = 'https://underwater-demo.programo.pl'
  assert.equal(safePaymentPath('/platnosc-testowa?token=abc', o), '/platnosc-testowa?token=abc')
  assert.equal(safePaymentPath(`${o}/platnosc-testowa?token=abc`, o), '/platnosc-testowa?token=abc')
  for (const bad of [
    'https://evil.example/platnosc-testowa?token=a', '//evil.example/platnosc-testowa', 'javascript:alert(1)', '/koszyk',
    '/platnosc-testowa/../admin', `https://user:pw@underwater-demo.programo.pl/platnosc-testowa`, 'http://underwater-demo.programo.pl/platnosc-testowa', 42, '',
  ]) assert.equal(safePaymentPath(bad, o), null, String(bad))
})

test('isToken accepts opaque link tokens only', () => {
  assert.ok(isToken('abcDEF0123456789_-.~'))
  for (const bad of ['short', 'has space 1234567890', 'a'.repeat(513), '<script>alert(1)</script>', 123]) assert.equal(isToken(bad), false)
})

test('fingerprint ignores key order and changes with content', () => {
  assert.equal(fingerprint({ a: 1, b: [1, { c: 2, d: 3 }] }), fingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }))
  assert.notEqual(fingerprint({ items: [{ id: 1, qty: 1 }] }), fingerprint({ items: [{ id: 1, qty: 2 }] }))
  assert.equal(fingerprint({ a: 1, b: undefined }), fingerprint({ a: 1 }))
})

test('parseQuote rejects malformed responses; quoteLineFor matches by variant id, then label', () => {
  const quote = {
    items: [
      { product: 1, name: 'Maska', variantId: 'v1', variant: 'Czarna', qty: 1, unitPriceCents: 100, lineTotalCents: 100 },
      { product: 2, name: 'Fajka', variant: 'Żółta', qty: 2, unitPriceCents: 50, lineTotalCents: 100 },
    ],
    subtotalCents: 200, deliveryCents: 0, totalCents: 200, currency: 'PLN',
    deliveryMethods: [{ id: 'odbior', label: 'Odbiór osobisty', priceCents: 0 }], deliveryMethod: 'odbior',
  }
  assert.ok(parseQuote(quote))
  assert.equal(parseQuote({ ...quote, totalCents: 1.5 }), null)
  assert.equal(parseQuote({ ...quote, items: [{ product: 1 }] }), null)
  assert.equal(parseQuote(null), null)
  assert.equal(quoteLineFor(quote.items, { id: 1, variantId: 'v1', variant: 'Inna nazwa' })?.qty, 1)
  assert.equal(quoteLineFor(quote.items, { id: 1, variantId: 'v2' }), undefined)
  assert.equal(quoteLineFor(quote.items, { id: 2, variant: 'Żółta' })?.qty, 2)
})

test('jsonLd cannot close the script element', () => {
  const s = jsonLd({ name: '</script><script>alert(1)</script>', x: 'a b&c' })
  assert.ok(!s.includes('<') && !s.includes('>') && !s.includes('&') && !s.includes(' '))
  assert.deepEqual(JSON.parse(s), { name: '</script><script>alert(1)</script>', x: 'a b&c' })
})

test('productSchema: catalogue fields only, no ratings, availability only when stock is known', () => {
  const base: ProductDoc = { id: 1, name: 'Maska', slug: 'm', priceCents: 12900, images: [{ url: '/media/m.jpg' }], manufacturer: 'Cressi' }
  const a = productSchema(base, 'https://x.pl/m.html', 'https://x.pl') as Record<string, any>
  assert.equal(a.offers.price, '129.00')
  assert.equal(a.offers.availability, undefined)
  assert.deepEqual(a.image, ['https://x.pl/media/m.jpg'])
  assert.equal(a.aggregateRating, undefined)
  assert.equal(a.review, undefined)
  const b = productSchema({ ...base, variants: [{ label: 'S', priceCents: 10000, stock: 0 }, { label: 'L', priceCents: 15000, stock: 0 }] }, 'u', 'o') as Record<string, any>
  assert.equal(b.offers['@type'], 'AggregateOffer')
  assert.equal(b.offers.availability, 'https://schema.org/OutOfStock')
  const c = productSchema({ ...base, priceCents: null, price: null }, 'u', 'o') as Record<string, any>
  assert.equal(c.offers, undefined)
})

test('consent defaults to necessary only', () => {
  assert.deepEqual(parseConsent(null), { analytics: false })
  assert.deepEqual(parseConsent('{bad'), { analytics: false })
  assert.deepEqual(parseConsent('{"analytics":true}'), { analytics: false })
  assert.deepEqual(parseConsent('{"v":1,"analytics":true}'), { analytics: true })
})
