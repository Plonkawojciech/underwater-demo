import test from 'node:test'
import assert from 'node:assert/strict'
import {
  albumSlice, canonicalPath, categoryTree, contactQuery, contentHref, enquiryHref, fingerprint, formatDateTime, formatMoney, groupByMonth,
  isSafeSlug, isToken, jsonLd, knownStock, legacyCandidates, listCanonical, listingCategoryId, listingIds, listingView, mergeCalendar, monthRange, normalizeSegments, parseConsent,
  parseMonth, parsePage, parseQuote, pathCandidates, phoneParts, priceSpan, productPrice, productSchema, quoteLineFor, safeAssetUrl,
  safeExternalUrl, safePaymentPath, searchQuery, seatsLeft, shiftMonth, STOCK_LABEL, stockState, telHref, tripView, variantPrice,
  warsawMidnight, withQuery, type EventDoc, type PageDoc, type ProductDoc, type SessionDoc, type TripDoc,
} from '../../src/lib/presentation'

test('listingView: page order, unpublished members left out and counted, a range only for one page of several', () => {
  const page: PageDoc = {
    id: 1, title: 'Marka', path: '/1-c/marka.html', kind: 'page', listing: true,
    listingProducts: [3, { id: 1 }, 2, 3],
    listingMissing: [{ title: ' Nieznany model ' }, { title: '' }],
    listingLinks: [{ label: 'Wyniki 4–6', path: '/1-c/marka/results,4-6.html' }, { label: 'Obcy', path: 'javascript:alert(1)' }, { label: ' ', path: '/x.html' }, { label: 'Powtórzone wyniki', path: '/1-c/marka/results,4-6.html' }, { label: 'Ta sama strona', path: '/1-c/marka.html' }],
  }
  assert.deepEqual(listingIds(page), [3, 1, 2])
  // The public query returned 2 and 3 (1 is unpublished); 99 is not a member and never shown.
  const view = listingView(page, [{ id: 2 }, { id: 3 }, { id: 99 }])
  assert.deepEqual(view.products.map((p) => p.id), [3, 2])
  assert.equal(view.hidden, 1)
  assert.deepEqual(view.missing, ['Nieznany model'])
  assert.deepEqual(view.links, [{ label: 'Wyniki 4–6', href: '/1-c/marka/results,4-6.html' }])
  assert.equal(view.range, null)
  assert.equal(listingView({ ...page, listingFrom: 1, listingTo: 3, listingTotal: 3 }, []).range, null, 'a complete single page states no count')
  assert.equal(listingView({ ...page, listingFrom: 4, listingTo: 6, listingTotal: 9 }, []).range, 'Wyniki 4–6 z 9')
  assert.equal(listingView({ ...page, listingFrom: 7, listingTo: 6, listingTotal: 9 }, []).range, null)
  assert.equal(listingView({ ...page, listingProducts: null }, []).hidden, 0)
  assert.equal(listingCategoryId({ listingCategory: { id: 4, name: 'C', slug: 'c' } }), 4)
  assert.equal(listingCategoryId({ listingCategory: null }), null)
  // Members are shown with ProductCard: a zero or missing price stays an enquiry.
  assert.equal(productPrice({ priceCents: 0 }).current, null)
  assert.equal(productPrice({}).current, null)
})

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
  // A known zero next to an unknown variant is not "sold out".
  assert.equal(knownStock({ variants: [{ stock: 0 }, { stock: null }] }), null)
  assert.equal(knownStock({ variants: [{ stock: 0 }, { stock: 0 }] }), 0)
})

test('stock: null stays unknown (enquiry, no sold-out wording), zero is out, only positive is buyable', () => {
  assert.equal(stockState(null), 'unknown')
  assert.equal(stockState(undefined), 'unknown')
  assert.equal(stockState(Number.NaN), 'unknown')
  assert.equal(stockState(0), 'out')
  assert.equal(stockState(-2), 'out')
  assert.equal(stockState(3), 'in')
  assert.equal(STOCK_LABEL.unknown, 'Dostępność do potwierdzenia')
  assert.doesNotMatch(STOCK_LABEL.unknown, /niedostępn/i)
  assert.match(STOCK_LABEL.out, /niedostępny/)
  // Structured data: no availability is published for unknown stock.
  const p: ProductDoc = { id: 1, name: 'M', slug: 'm', priceCents: 100, variants: [{ label: 'S', stock: 0 }, { label: 'L', stock: null }] }
  const offers = (productSchema(p, 'https://example.test/m.html', 'https://example.test') as Record<string, any>).offers
  assert.equal(offers[0].availability, 'https://schema.org/OutOfStock')
  assert.equal(offers[1].availability, undefined)
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
  assert.equal(b.offers.length, 2)
  assert.deepEqual(b.offers.map((offer: any) => [offer['@type'], offer.name, offer.price, offer.availability]), [
    ['Offer', 'S', '100.00', 'https://schema.org/OutOfStock'],
    ['Offer', 'L', '150.00', 'https://schema.org/OutOfStock'],
  ])
  assert.equal('lowPrice' in b.offers, false)
  const c = productSchema({ ...base, priceCents: null, price: null }, 'u', 'o') as Record<string, any>
  assert.equal(c.offers, undefined)
})

test('consent defaults to necessary only', () => {
  assert.deepEqual(parseConsent(null), { analytics: false })
  assert.deepEqual(parseConsent('{bad'), { analytics: false })
  assert.deepEqual(parseConsent('{"analytics":true}'), { analytics: false })
  assert.deepEqual(parseConsent('{"v":1,"analytics":true}'), { analytics: true })
})


test('phone links: each written number keeps its text; Polish numbers get +48; nothing is guessed', () => {
  assert.deepEqual(phoneParts('22 826 47 73, 604 123 456; +48 (22) 111-22-33'), [
    { text: '22 826 47 73', href: 'tel:+48228264773' },
    { text: '604 123 456', href: 'tel:+48604123456' },
    { text: '+48 (22) 111-22-33', href: 'tel:+48221112233' },
  ])
  assert.deepEqual(phoneParts('0048 604 123 456 lub +44 20 7946 0958').map((p) => p.href), ['tel:+48604123456', 'tel:+442079460958'])
  // Extensions, notes and wrong digit counts stay text without a link; no numbers are joined together.
  for (const bad of ['22 826 47 73 wew. 12', '123', '604 123 4567', 'brak', 'tel:604123456', '+0 123 456 789']) {
    assert.equal(phoneParts(bad)[0].href, null, bad)
  }
  assert.equal(telHref('pon-pt; 604 123 456'), 'tel:+48604123456')
  assert.equal(telHref('22 826 47 73, 604 123 456'), 'tel:+48228264773')
  assert.equal(telHref(''), null)
  assert.deepEqual(phoneParts(null), [])
})

test('enquiry links carry only a record id; the query parser accepts positive ids only', () => {
  assert.equal(enquiryHref('product', 42), '/kontakt.html?produkt=42')
  assert.equal(enquiryHref('trip', 7), '/kontakt.html?wyjazd=7')
  assert.equal(enquiryHref('product', -1), '/kontakt.html')
  assert.deepEqual(contactQuery({ produkt: '42' }), { kind: 'product', id: 42 })
  assert.deepEqual(contactQuery({ wyjazd: ['7', '8'] }), { kind: 'trip', id: 7 })
  for (const bad of ['0', '-1', '1.5', 'abc', '99999999999', '42 OR 1=1', '']) assert.equal(contactQuery({ produkt: bad }), null, bad)
  assert.equal(contactQuery({}), null)
})

test('formatDateTime shows Warsaw date and time across DST', () => {
  assert.equal(formatDateTime('2026-11-14T08:00:00Z'), '14 listopada 2026, 09:00')
  assert.equal(formatDateTime('2026-07-01T16:30:00Z'), '1 lipca 2026, 18:30')
  assert.equal(formatDateTime('2026-10-31T23:30:00Z'), '1 listopada 2026, 00:30')
  assert.equal(formatDateTime('nie data'), '')
  assert.equal(formatDateTime(null), '')
})

test('mergeCalendar: one dated list, a session or trip already shown as its event appears once, undated trips are left out', () => {
  const course = { id: 9, name: 'Open Water Diver', slug: 'owd' }
  const sessions = [
    { id: 1, title: 'OWD listopad', course, startsAt: '2026-11-14T08:00:00Z' },
    { id: 2, title: 'Open Water Diver', course, startsAt: '2026-11-02T08:00:00Z' },
    { id: 3, title: 'Bez kursu', course: 99, startsAt: '2026-11-20T08:00:00Z' },
  ] as SessionDoc[]
  const trips = [
    { id: 5, title: 'Egipt', path: 'egipt', startsAt: '2026-11-10T00:00:00Z' },
    { id: 6, title: 'Chorwacja', path: 'chorwacja', startsAt: '2026-11-03T00:00:00Z' },
    { id: 7, title: 'Stara wyprawa', path: 'stara', startsAt: null },
  ] as TripDoc[]
  const events = [
    { id: 11, title: 'Start kursu OWD', startsAt: '2026-11-14T08:00:00Z', courseSession: { id: 1 } as SessionDoc },
    { id: 12, title: 'Wyjazd do Egiptu', startsAt: '2026-11-10T00:00:00Z', trip: 5 },
  ] as EventDoc[]
  const list = mergeCalendar({ events, sessions, trips }, { event: () => '/e.html', session: (s) => `/s${s.id}.html`, trip: (t) => `/${t.path}.html` })
  assert.deepEqual(list.map((e) => e.key), ['course-2', 'trip-6', 'event-12', 'event-11', 'course-3'])
  const owd = list.find((e) => e.key === 'course-2')!
  assert.equal(owd.title, 'Open Water Diver')
  assert.equal(owd.detail, null)
  assert.equal(list.find((e) => e.key === 'course-3')!.title, 'Bez kursu')
  assert.equal(list.find((e) => e.key === 'trip-6')!.href, '/chorwacja.html')
})

test('list canonicals keep the page number; search and course filters point at the list itself', () => {
  assert.equal(listCanonical('/galeria.html', 'paged', { strona: '3' }), '/galeria.html?strona=3')
  assert.equal(listCanonical('/galeria.html', 'paged', { strona: '1' }), '/galeria.html')
  assert.equal(listCanonical('/galeria.html', 'paged', { strona: 'x' }), '/galeria.html')
  assert.equal(listCanonical('/sklep-nurkowy.html', 'shop', { strona: '2' }), '/sklep-nurkowy.html?strona=2')
  assert.equal(listCanonical('/sklep-nurkowy.html', 'shop', { strona: '2', q: 'maska' }), '/sklep-nurkowy.html')
  assert.equal(listCanonical('/k.html', 'courses', { strona: '2', org: 'PADI' }), '/k.html')
  assert.equal(listCanonical('/wyprawy-nurkowe.html', 'trips', { strona: '2', widok: 'minione' }), '/wyprawy-nurkowe.html?widok=minione&strona=2')
  assert.equal(listCanonical('/wyprawy-nurkowe.html', 'trips', { widok: 'cokolwiek' }), '/wyprawy-nurkowe.html')
  assert.equal(tripView('bez-daty'), 'undated')
  assert.equal(tripView(undefined), 'upcoming')
})

test('albumSlice pages photo rows and clamps the page; every photo is on exactly one page', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i)
  const p3 = albumSlice(rows, 3, 48)
  assert.deepEqual([p3.page, p3.pages, p3.total, p3.rows], [3, 3, 100, [96, 97, 98, 99]])
  assert.equal(albumSlice(rows, 99, 48).page, 3)
  assert.deepEqual([1, 2, 3].flatMap((n) => albumSlice(rows, n, 48).rows), rows)
  assert.deepEqual(albumSlice(null, 1, 48), { rows: [], page: 1, pages: 1, total: 0 })
})
