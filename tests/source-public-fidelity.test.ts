import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Synthetic fixtures shaped like the captured JEvents, VirtueMart browse, blog and contact pages.
// They carry no real contact data; the parser never sees encrypted captures or the network.
const PARSER = 'scripts/source/content_parser.py'
const FIXTURES = 'tests/fixtures/source-content'
const ORIGIN = 'https://www.underwater.pl'
const HASH = 'a'.repeat(64)
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
const CLOAK = '<span id="cloak1">Ten adres pocztowy jest chroniony przed spamowaniem. Aby go zobaczyć, konieczne jest włączenie obsługi JavaScript.</span>'

type Page = { url: string; html: string; sha256: string }
type Entity = { collection: string; key: string; data: Record<string, any>; relations?: Record<string, any> }
type Result = { bundle: { entities: Entity[] }; unresolved: Array<{ code: string; url: string | null; key: string | null; detail: string }>; counts: Record<string, any> }
// Shape of the authenticated capture manifest rows public_bundle.py passes (state['files']).
type Capture = { url: string; final_url?: string }

const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')
const page = (pathname: string, html: string): Page => ({ url: ORIGIN + pathname, html, sha256: createHash('sha256').update(html, 'utf8').digest('hex') })
function convert(pages: Page[], redirects?: Capture[]): Result {
  const loader = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location('content_parser', '${PARSER}')`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'request = json.load(sys.stdin)',
    "json.dump(module.convert_pages(request['pages'], '2026-10-09T08:00:00Z', request['hash'], request.get('redirects')), sys.stdout, ensure_ascii=False)",
  ].join('\n')
  const result = spawnSync('python3', ['-c', loader], { input: JSON.stringify({ pages, hash: HASH, redirects: redirects ?? null }), encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const of = (result: Result, collection: string) => result.bundle.entities.filter(item => item.collection === collection)
const reported = (result: Result, code: string) => result.unresolved.filter(item => item.code === code)

// ------------------------------------------------------------------ events

const EVENT = (id: number | string) => `/kalendarz/eventdetail/${id}/-/wydarzenie-testowe.html`
function eventHtml(o: { evid: number | string; title?: string; date: string; spans?: string; content?: string; search?: string }) {
  const title = o.title ?? 'Wydarzenie Testowe'
  const spans = o.spans ?? `<span>Miejsce testowe</span><br><span>tel. 000 000 000, e-mail: ${CLOAK}</span>`
  const search = o.search ?? `<link href="https://www.underwater.pl/index.php?Itemid=57&amp;option=com_search&amp;task=icalrepeat.detail&amp;evid=${o.evid}&amp;format=opensearch&amp;view=search" rel="search">`
  return `<html><head><title>${title}</title><meta name="description" content="Opis testowy serwisu.">${search}</head><body>`
    + '<div class="portal-real-content"><div class="portal-center-site-bar"><div class="breadcrumbs"><a href="/">Strona główna</a> <span>Kalendarz</span></div>'
    + '<div class="jeventpage" id="jevents_header"><h2 class="contentheading">Kalendarz</h2></div>'
    + `<div class="contentpaneopen  jeventpage" id="jevents_body"><table><tbody><tr><td><h1><span>${title}</span></h1></td><td><p><span>${o.date}<br><br></span>${spans}</p></td></tr></tbody></table>`
    + `<div>${o.content ?? '<p>Opis wydarzenia testowego.</p>'}</div>    <p>\n<a class="jev_back" title="Wróć">Wróć</a>\n</p>\n</div></div></div></body></html>`
}
const eventPage = (id: number, date: string, extra: Partial<Parameters<typeof eventHtml>[0]> = {}) => page(EVENT(id), eventHtml({ evid: id, date, ...extra }))

test('event pages: the three JEvents header forms become exact Warsaw instants with the printed year', () => {
  const result = convert([
    eventPage(101, 'Od Piątek, 2. październik 2026 -  16:00<br>Do Niedziela, 4. październik 2026 - 21:00'),
    eventPage(102, 'Środa, 26. sierpień 2026, 19:00 - 20:00'),
    eventPage(103, 'Piątek, 24. kwiecień 2026, 09:00'),
    eventPage(104, 'Poniedziałek, 7. grudzień 2026, 18:00'),
  ])
  const events = new Map(of(result, 'events').map(item => [item.key, item]))
  assert.equal(events.size, 4, JSON.stringify(result.unresolved))
  const range = events.get('jevents-detail:101')!
  assert.deepEqual([range.data.startsAt, range.data.endsAt], ['2026-10-02T14:00:00.000Z', '2026-10-04T19:00:00.000Z'])
  assert.deepEqual([events.get('jevents-detail:102')!.data.startsAt, events.get('jevents-detail:102')!.data.endsAt], ['2026-08-26T17:00:00.000Z', '2026-08-26T18:00:00.000Z'])
  assert.equal(events.get('jevents-detail:103')!.data.startsAt, '2026-04-24T07:00:00.000Z')
  assert.equal('endsAt' in events.get('jevents-detail:103')!.data, false, 'no end is invented')
  assert.equal(events.get('jevents-detail:104')!.data.startsAt, '2026-12-07T17:00:00.000Z', 'winter offset')
  assert.equal(range.data.title, 'Wydarzenie Testowe')
  assert.equal(range.data.location, 'Miejsce testowe')
  assert.equal(range.data.path, EVENT(101))
  assert.equal(range.data.legacyPath, EVENT(101))
  assert.deepEqual(range.data.seo, { title: 'Wydarzenie Testowe', description: 'Opis testowy serwisu.' })
  // The contact line leads the body; the cloaked address is neither decoded nor shown as a JavaScript notice.
  // The link names the contact form: the organiser's address is not claimed to be on that page.
  assert.equal(range.data.body, '<p>tel. 000 000 000, e-mail: <a href="/kontakt.html">Formularz kontaktowy</a></p><p>Opis wydarzenia testowego.</p>')
  for (const marker of ['JavaScript', 'Wróć', 'Kalendarz', 'Piątek', 'Strona główna']) assert.ok(!JSON.stringify(of(result, 'events')).includes(marker), marker)
  assert.ok(reported(result, 'email-cloak-not-recovered').length > 0)
  assert.equal(of(result, 'pages').length, 0)
})

test('event pages: inexact dates and IDs keep the literal header as a page and report why', () => {
  const cases: Array<[number, string, string, Partial<Parameters<typeof eventHtml>[0]>?]> = [
    [201, 'Sobota, 2. październik 2026, 16:00', 'event-date-weekday-mismatch'],
    [202, 'Piątek, 2. października 2026, 16:00', 'event-date-month-unknown'],
    [203, 'Piątek, 2. październik 2026', 'event-date-missing-time'],
    [204, 'Niedziela, 25. październik 2026, 02:30', 'event-date-invalid'],
    [205, 'Niedziela, 29. marzec 2026, 02:30', 'event-date-invalid'],
    [206, 'Środa, 26. sierpień 2026, 20:00 - 19:00', 'event-date-end-before-start'],
    [207, 'Od Niedziela, 4. październik 2026 - 21:00<br>Do Piątek, 2. październik 2026 - 16:00', 'event-date-end-before-start'],
    [208, 'Piątek, 2. październik 2026, 16:00', 'event-id-mismatch', { evid: 999 }],
    [209, 'Piątek, 2. październik 2026, 24:00', 'event-date-invalid'],
  ]
  const result = convert(cases.map(([id, date, , extra]) => eventPage(id, date, extra)))
  assert.deepEqual(of(result, 'events'), [], 'no date is guessed')
  for (const [id, date, code] of cases) {
    const fallback = of(result, 'pages').find(item => item.data.path === EVENT(id))
    assert.ok(fallback, `${id} ${code}`)
    assert.equal(fallback.data.kind, 'page')
    assert.equal(fallback.data.title, 'Wydarzenie Testowe')
    assert.ok(fallback.data.body.includes(date.split('<br>')[0]), `${id}: the header stays literal`)
    assert.ok(fallback.data.body.includes('Opis wydarzenia testowego.'))
    assert.ok(!fallback.data.body.includes('Wróć'))
    assert.ok(reported(result, code).some(item => item.url === ORIGIN + EVENT(id)), `${id} reported as ${code}`)
  }
})

test('event pages: foreign, repeated or conflicting search metadata is not an event ID', () => {
  const date = 'Piątek, 2. październik 2026, 16:00'
  const own = (query: string) => `<link href="https://www.underwater.pl/index.php?${query}" rel="search">`
  const cases: Array<[number, string]> = [
    [501, own('option=com_search&amp;evid=501&amp;evid=501&amp;view=search')],
    [502, '<link href="https://example.com/index.php?option=com_search&amp;evid=502&amp;view=search" rel="search">'],
    [503, own('option=com_search&amp;evid=503&amp;view=search') + own('option=com_search&amp;evid=599&amp;view=search')],
    [504, '<link href="https://user@www.underwater.pl/index.php?option=com_search&amp;evid=504&amp;view=search" rel="search">'],
    [505, ''],
  ]
  const result = convert(cases.map(([id, search]) => page(EVENT(id), eventHtml({ evid: id, date, search }))))
  assert.deepEqual(of(result, 'events'), [], 'no event ID without one exact own search link')
  for (const [id] of cases) {
    assert.ok(of(result, 'pages').some(item => item.data.path === EVENT(id)), `${id} kept as a page`)
    assert.ok(reported(result, 'event-id-mismatch').some(item => item.url === ORIGIN + EVENT(id)), `${id} reported`)
  }
})

const CALENDAR = (day: string, label: string, id = 301, href = EVENT(id)) => `<html><body><div class="portal-real-content"><table><tr><td><a class="cal_daylink" href="/kalendarz/eventsbyday/${day}/-.html">2</a><a class="cal_titlelink" href="${href}">${label}</a></td></tr></table></div></body></html>`

test('event pages fill the month-calendar entry with the same address and start, keeping its import key', () => {
  const alone = convert([page('/kalendarz.html', CALENDAR('2026/10/2', '16:00 Wydarzenie skr.'))])
  const [row] = of(alone, 'events')
  assert.match(row.key, /^public-calendar-event:/)
  const result = convert([page('/kalendarz.html', CALENDAR('2026/10/2', '16:00 Wydarzenie skr.')), eventPage(301, 'Od Piątek, 2. październik 2026 - 16:00<br>Do Niedziela, 4. październik 2026 - 21:00')])
  const events = of(result, 'events')
  assert.equal(events.length, 1, 'one record per source event')
  assert.equal(events[0].key, row.key, 'the existing key stays, no orphaned record')
  assert.equal(events[0].data.title, 'Wydarzenie Testowe', 'the event page title, not the shortened cell')
  assert.deepEqual([events[0].data.startsAt, events[0].data.endsAt, events[0].data.path, events[0].data.location], ['2026-10-02T14:00:00.000Z', '2026-10-04T19:00:00.000Z', EVENT(301), 'Miejsce testowe'])
  assert.equal(reported(result, 'calendar-title-differs').length, 1)
  assert.equal(of(result, 'pages').length, 0)
})

test('an event page at another time than its month-calendar entry leaves the entry and becomes a page', () => {
  const result = convert([page('/kalendarz.html', CALENDAR('2026/10/2', '15:00 Wydarzenie skr.')), eventPage(301, 'Piątek, 2. październik 2026, 16:00')])
  const events = of(result, 'events')
  assert.equal(events.length, 1)
  assert.equal(events[0].data.title, 'Wydarzenie skr.')
  assert.equal(events[0].data.startsAt, '2026-10-02T13:00:00.000Z')
  assert.equal('path' in events[0].data, false, 'the calendar entry is unchanged')
  const [fallback] = of(result, 'pages')
  assert.equal(fallback.data.path, EVENT(301))
  assert.match(fallback.data.body, /Piątek, 2\. październik 2026, 16:00/)
  assert.equal(reported(result, 'calendar-detail-conflict').length, 1)
})

test('a month cell naming the event page by a captured redirect or a second capture fills the same entry and keeps its key', () => {
  const date = 'Piątek, 2. październik 2026, 16:00'
  const ALIAS = '/kalendarz/eventdetail/301/-/stary-alias.html'
  const cell = page('/kalendarz.html', CALENDAR('2026/10/2', '16:00 Wydarzenie skr.', 301, ALIAS))
  const detail = eventPage(301, date)
  const [row] = of(convert([cell]), 'events')

  const unmatched = convert([cell, detail])
  assert.equal(of(unmatched, 'events').length, 2, 'without the redirect the addresses differ and nothing is guessed')

  const redirected = convert([cell, detail], [{ url: ORIGIN + ALIAS, final_url: ORIGIN + EVENT(301) }, { url: ORIGIN + EVENT(301) }])
  const events = of(redirected, 'events')
  assert.equal(events.length, 1, JSON.stringify(redirected.unresolved))
  assert.equal(events[0].key, row.key, 'the monthly import key stays')
  assert.deepEqual([events[0].data.path, events[0].data.startsAt, events[0].data.title], [EVENT(301), '2026-10-02T14:00:00.000Z', 'Wydarzenie Testowe'])
  assert.equal(reported(redirected, 'calendar-href-redirect-resolved').length, 1)
  assert.deepEqual(of(redirected, 'redirects'), [], 'the redirect record itself is attached later by attach_captured_redirects')

  // The same event page captured under a second, longer address: the cell names that address.
  const SECOND = '/kalendarz/eventdetail/301/-/wydarzenie-testowe-drugi-adres.html'
  const twice = convert([page('/kalendarz.html', CALENDAR('2026/10/2', '16:00 Wydarzenie skr.', 301, SECOND)), detail, page(SECOND, eventHtml({ evid: 301, date }))])
  const merged = of(twice, 'events')
  assert.equal(merged.length, 1, JSON.stringify(twice.unresolved))
  assert.equal(merged[0].key, row.key)
  assert.equal(merged[0].data.path, EVENT(301))
  const [alias] = of(twice, 'redirects')
  assert.deepEqual([alias.data.from, alias.data.to], [SECOND, EVENT(301)])
})

const LEGACY_COURSE = '/kursy-nurkowania/kurs-syntetyczny-ows.html'
const COURSE_NAME = 'Kurs Syntetyczny OPEN WATER (OWS)'

test('an event page names a course term only for the exact course name and start; no duplicate calendar entry', () => {
  const linked = convert([page(LEGACY_COURSE, fixture('course-legacy.html')), eventPage(401, 'Poniedziałek, 12. październik 2026, 18:30', { title: COURSE_NAME })])
  const sessions = of(linked, 'course-sessions')
  assert.equal(sessions.length, 1)
  const events = of(linked, 'events')
  assert.equal(events.length, 1, 'the course fallback calendar entry is replaced by the event page')
  assert.equal(events[0].key, 'jevents-detail:401')
  assert.equal(events[0].relations?.courseSession, 'course-sessions:' + sessions[0].key)

  const other = convert([page(LEGACY_COURSE, fixture('course-legacy.html')), eventPage(402, 'Poniedziałek, 12. październik 2026, 19:30', { title: COURSE_NAME })])
  const unlinked = of(other, 'events')
  assert.equal(unlinked.length, 2)
  assert.equal(unlinked.find(item => item.key === 'jevents-detail:402')?.relations, undefined)
  assert.ok(unlinked.some(item => item.key.startsWith('public-course-calendar:')))
  assert.equal(of(other, 'course-sessions').length, 1)
  assert.equal(reported(other, 'event-course-not-linked').length, 1)
})

// ---------------------------------------------------------------- listings

const PRODUCT = '/1115-maska-testowa-syntetyczna.html'
const NESTED = '/sklep-nurkowy/12-akcesoria/34-skrzyd%C5%82a-i-uprz%C4%99%C5%BCe/1115-maska-testowa-syntetyczna.html'
const MASK = '/3625-maska-soprastek-corona.html'
const MASKS = '/80-maski-i-fajki/139-maski-nurkowe'
const SEARCH = (query: string) => `<link href="https://www.underwater.pl/index.php?${query}" rel="search">`
// The captured category pages carry their own ID only in this head link (proof: 470 of 471 routes).
const CATEGORY_SEARCH = (id: number | string, extra = '') => SEARCH(`option=com_search&amp;view=category&amp;virtuemart_category_id=${id}${extra}&amp;Itemid=56&amp;format=opensearch`)
const categoryHtml = (head: string, title = 'Maski nurkowe') => `<html><head><title>${title}</title>${head}</head><body><div class="portal-real-content"><div class="fl center-sitebar"><h1 class="shop-kateory-title">${title}</h1><div class="category_description">\n</div></div></div></body></html>`
const card = (href: string, name: string, price = '') => `<div class="row"><div class="browseProductContainer"><div class="title"><h2 class="browseProductTitle"><a href="${href}">${name}</a></h2></div><div class="browseProductImageContainer"><a href="${href}"><img src="/components/com_virtuemart_images/shop_image/product/resized/x_122x122.jpg" alt="${name}"></a></div><div class="browsePriceContainer">${price ? `<span class="price-red">${price}</span>` : ''}</div></div></div>`
function browseHtml(o: { title?: string; range?: string; cards?: string[]; pagination?: string[]; ids?: [number, number]; search?: string }) {
  const [category, maker] = o.ids ?? [17, 3]
  const search = o.search ?? SEARCH(`option=com_search&amp;view=category&amp;virtuemart_category_id=${category}&amp;virtuemart_manufacturer_id=${maker}&amp;Itemid=56&amp;format=opensearch`)
  return `<html><head><title>Lista testowa</title><meta name="description" content="Opis listy testowej.">${search}</head><body>`
    + '<div class="portal-real-content"><div class="fl left-sitebar2"><div class="moduletable"><p>LEFT-MENU</p></div></div>'
    + `<div class="fl center-sitebar"><h1 class="shop-kateory-title">${o.title ?? 'Marka Testowa'}</h1><div class="category_description">\n</div><div class="browse-view">`
    + `<div class="orderby-displaynumber"><div class="orderlistcontainer"><a href="${MASKS}/marka.html?orderby=product_name">Nazwa</a></div>${o.range ? `<div class="display-number">${o.range}<br></div>` : ''}<div class="vm-pagination">${(o.pagination ?? []).join('')}<span></span></div></div>`
    + (o.cards ?? []).join('')
    + '</div></div></div>'
    + `<div class="portal-content-footer"><div class="vmproductbox2"><div class="featuredProductTitle"><a href="${PRODUCT}">Promocja testowa</a></div><div class="featuredProductPrice"><span class="price-red">9,00 zł</span></div></div></div></body></html>`
}
const catalogue = () => [page(PRODUCT, fixture('product.html')), page(NESTED, fixture('product.html')), page(MASK, fixture('product-root-category.html'))]

test('browse pages: members in page order by exact address or redirect, promotions and unknown cards excluded', () => {
  const listingPath = `${MASKS}/marka.html`
  const listing = browseHtml({ range: 'Wyników 1 - 3 z 3', cards: [card(MASK, 'Maska z listy', '1,00 zł'), card('/9999-nieznany-produkt.html', 'Nieznany produkt'), card(NESTED, 'Maska pod drugim adresem')] })
  const masks = page(`${MASKS}.html`, categoryHtml(CATEGORY_SEARCH(17)))
  const without = convert([...catalogue(), masks])
  const result = convert([...catalogue(), masks, page(listingPath, listing)])
  const pages = of(result, 'pages')
  assert.equal(pages.length, 1, JSON.stringify(result.unresolved))
  const [list] = pages
  assert.deepEqual(list.data, {
    title: 'Marka Testowa', path: listingPath, kind: 'page', listing: true, published: true, legacyPath: listingPath,
    listingFrom: 1, listingTo: 3, listingTotal: 3, seo: { title: 'Lista testowa', description: 'Opis listy testowej.' },
    listingMissing: [{ title: 'Nieznany produkt', legacyPath: '/9999-nieznany-produkt.html' }],
  })
  assert.deepEqual(list.relations, {
    listingProducts: ['products:vm-product:3625', 'products:vm-product:1482'],
    listingCategory: 'categories:category:80-maski-i-fajki/139-maski-nurkowe',
  })
  assert.ok(!JSON.stringify(list).includes('Promocja testowa'))
  // A list never changes what the catalogue says about a product or a category.
  for (const collection of ['products', 'categories', 'redirects']) assert.deepEqual(of(result, collection), of(without, collection), collection)
  assert.equal(reported(result, 'listing-product-unresolved').length, 1)
  assert.equal(reported(result, 'listing-price-differs').length, 1)
})

test('browse pages: count mismatch drops the range, an empty list stays an explicit empty listing', () => {
  const mismatch = convert([page(`${MASKS}/marka.html`, browseHtml({ range: 'Wyników 1 - 5 z 5', cards: [card('/1-a.html', 'A'), card('/2-b.html', 'B')] }))])
  const [list] = of(mismatch, 'pages')
  assert.equal(list.data.listing, true)
  for (const field of ['listingFrom', 'listingTo', 'listingTotal']) assert.equal(field in list.data, false, field)
  assert.deepEqual(list.data.listingMissing.map((row: { title: string }) => row.title), ['A', 'B'], 'page order')
  assert.equal(reported(mismatch, 'listing-count-mismatch').length, 1)

  const empty = convert([page('/117-torby-i-pojemniki/aqualung.html', browseHtml({ title: 'Torby i pojemniki' }))])
  const [none] = of(empty, 'pages')
  assert.deepEqual(none.data, { title: 'Torby i pojemniki', path: '/117-torby-i-pojemniki/aqualung.html', kind: 'page', listing: true, published: true, legacyPath: '/117-torby-i-pojemniki/aqualung.html', seo: { title: 'Lista testowa', description: 'Opis listy testowej.' } })
  assert.equal(none.relations, undefined)
  assert.deepEqual(empty.unresolved.filter(item => item.code.startsWith('listing-')), [])
})

test('browse pages: results links only to captured pages of the same filter; commas stay in the address', () => {
  const first = `${MASKS}/marka.html`
  const second = `${MASKS}/marka/results,4-6.html`
  const otherFilter = `${MASKS}/inna-marka/results,4-6.html`
  const cards = (start: number) => [0, 1, 2].map(index => card(`/${start + index}-pozycja.html`, `Pozycja ${start + index}`))
  const result = convert([
    page(first, browseHtml({ range: 'Wyników 1 - 3 z 6', cards: cards(1), pagination: [`<a href="${second}">2</a>`, `<a href="${MASKS}/marka/results,7-9.html">3</a>`, `<a href="${first}?start=3">dalej</a>`, `<a href="${otherFilter}">obca</a>`] })),
    page(second, browseHtml({ range: 'Wyników 4 - 6 z 6', cards: cards(4), pagination: [`<a href="${first}">1</a>`] })),
    page(otherFilter, browseHtml({ range: 'Wyników 4 - 6 z 6', cards: cards(4), ids: [17, 4] })),
  ])
  const byPath = new Map(of(result, 'pages').map(item => [item.data.path, item]))
  assert.equal(byPath.size, 3, JSON.stringify(result.unresolved))
  assert.deepEqual(byPath.get(first)!.data.listingLinks, [{ label: 'Wyniki 4–6', path: second }])
  assert.deepEqual(byPath.get(second)!.data.listingLinks, [{ label: 'Wyniki 1–3', path: first }])
  assert.equal('listingLinks' in byPath.get(otherFilter)!.data, false)
  assert.match(byPath.get(second)!.key, /^page-sha256:[a-f0-9]{40}$/, 'a comma is not a key character; the path keeps it')
  assert.equal(reported(result, 'listing-link-other-filter').length, 1)
})

test('a captured category address stays with its category record, even with captured browse content', () => {
  const result = convert([...catalogue(), page(`${MASKS}.html`, browseHtml({ title: 'Maski nurkowe', range: 'Wyników 1 - 1 z 1', cards: [card(MASK, 'Maska')] }))])
  assert.equal(of(result, 'pages').length, 0)
  assert.ok(of(result, 'categories').some(item => item.data.legacyPath === `${MASKS}.html`))
  assert.ok(result.counts.skipped['category-listing'] >= 1)
})

test('a category takes its source ID only from its own exact category search link, never from the slug or loose metadata', () => {
  const masksOf = (head: string) => {
    const result = convert([page(MASK, fixture('product-root-category.html')), page(`${MASKS}.html`, categoryHtml(head))])
    return { result, category: of(result, 'categories').find(item => item.data.slug === MASKS.slice(1))! }
  }
  assert.equal(masksOf(CATEGORY_SEARCH(139)).category.data.vmId, 139)
  assert.equal(masksOf(CATEGORY_SEARCH(139, '&amp;virtuemart_manufacturer_id=0')).category.data.vmId, 139, 'manufacturer zero is no filter')
  assert.equal(masksOf(CATEGORY_SEARCH(2147483647)).category.data.vmId, 2147483647)
  // '139' in the address is not evidence; a manufacturer filter names a filtered list; a search without option is not com_search.
  for (const head of ['', CATEGORY_SEARCH(139, '&amp;virtuemart_manufacturer_id=3'), SEARCH('view=category&amp;virtuemart_category_id=139')]) {
    const { result, category } = masksOf(head)
    assert.equal('vmId' in category.data, false, head)
    assert.deepEqual(reported(result, 'category-search-id-rejected'), [], head)
  }
  const rejected = [
    CATEGORY_SEARCH(139, '&amp;virtuemart_category_id=139'),
    CATEGORY_SEARCH(139, '&amp;option=com_search'),
    CATEGORY_SEARCH(0), CATEGORY_SEARCH(2147483648), CATEGORY_SEARCH('0139'), CATEGORY_SEARCH('139x'),
    CATEGORY_SEARCH(139) + CATEGORY_SEARCH(140),
    '<link href="https://example.com/index.php?option=com_search&amp;view=category&amp;virtuemart_category_id=139" rel="search">',
    '<link href="https://user@www.underwater.pl/index.php?option=com_search&amp;view=category&amp;virtuemart_category_id=139" rel="search">',
    '<link href="https://www.underwater.pl:8443/index.php?option=com_search&amp;view=category&amp;virtuemart_category_id=139" rel="search">',
  ]
  for (const head of rejected) {
    const { result, category } = masksOf(head)
    assert.equal('vmId' in category.data, false, head)
    assert.equal(reported(result, 'category-search-id-rejected').length, 1, head)
  }
})

test('a manufacturer list joins its address category only when both pages show the same source category ID', () => {
  const listingPath = `${MASKS}/marka.html`
  const run = (categoryHead: string, list: Parameters<typeof browseHtml>[0]) => {
    const result = convert([...catalogue(), page(`${MASKS}.html`, categoryHtml(categoryHead)), page(listingPath, browseHtml(list))])
    return { result, list: of(result, 'pages').find(item => item.data.path === listingPath)! }
  }
  const same = run(CATEGORY_SEARCH(17), { ids: [17, 3] })
  assert.equal(same.list.relations?.listingCategory, 'categories:category:80-maski-i-fajki/139-maski-nurkowe')

  const unknown = run('', { ids: [17, 3] })
  assert.equal(unknown.list.relations, undefined, 'the longest address prefix alone is not proof')
  assert.equal(reported(unknown.result, 'listing-category-unverified').length, 1)

  const mismatch = run(CATEGORY_SEARCH(18), { ids: [17, 3] })
  assert.equal(mismatch.list.relations, undefined)
  assert.equal(reported(mismatch.result, 'listing-category-mismatch').length, 1)

  for (const search of [
    SEARCH('option=com_search&amp;view=category&amp;virtuemart_category_id=17&amp;virtuemart_category_id=17&amp;virtuemart_manufacturer_id=3'),
    SEARCH('option=com_search&amp;view=category&amp;virtuemart_category_id=17&amp;virtuemart_manufacturer_id=3') + SEARCH('option=com_search&amp;view=category&amp;virtuemart_category_id=18&amp;virtuemart_manufacturer_id=3'),
    '<link href="https://example.com/index.php?option=com_search&amp;view=category&amp;virtuemart_category_id=17&amp;virtuemart_manufacturer_id=3" rel="search">',
  ]) {
    const loose = run(CATEGORY_SEARCH(17), { search })
    assert.equal(loose.list.relations, undefined, search)
    assert.equal(reported(loose.result, 'listing-source-ids-rejected').length, 1, search)
    assert.equal(reported(loose.result, 'listing-category-unverified').length, 1, search)
  }
})

test('captured HTTP redirects resolve list cards to the exact product before relations; cycles, conflicts and live pages are not followed', () => {
  const listingPath = `${MASKS}/marka.html`
  const OLD = '/stary-adres-maski.html'
  const about = '<html><head><title>O nas</title></head><body><div class="portal-real-content"><div class="item-page"><h1>O nas</h1><p>Treść testowa.</p></div></div></body></html>'
  const cards = [card(OLD, 'Maska pod starym adresem', '1,00 zł'), card('/petla-a.html', 'Pętla'), card('/konflikt.html', 'Konflikt'), card('/o-nas.html', 'Strona treści'), card('/z-zapytaniem.html', 'Zapytanie')]
  const pages = [...catalogue(), page(`${MASKS}.html`, categoryHtml(CATEGORY_SEARCH(17))), page('/o-nas.html', about), page(listingPath, browseHtml({ range: 'Wyników 1 - 5 z 5', cards }))]
  const redirects: Capture[] = [
    { url: ORIGIN + OLD, final_url: ORIGIN + MASK },
    { url: ORIGIN + '/petla-a.html', final_url: ORIGIN + '/petla-b.html' },
    { url: ORIGIN + '/petla-b.html', final_url: ORIGIN + '/petla-a.html' },
    { url: ORIGIN + '/konflikt.html', final_url: ORIGIN + MASK },
    { url: ORIGIN + '/konflikt.html', final_url: ORIGIN + PRODUCT },
    { url: ORIGIN + '/o-nas.html', final_url: ORIGIN + MASK },
    { url: ORIGIN + '/z-zapytaniem.html', final_url: ORIGIN + MASK + '?tmpl=component' },
    { url: 'https://user@www.underwater.pl/z-loginem.html', final_url: ORIGIN + MASK },
    { url: ORIGIN + '/obcy.html', final_url: 'https://example.com' + MASK },
    { url: ORIGIN + MASK },
  ]
  const without = convert(pages)
  const result = convert(pages, redirects)
  const listOf = (output: Result) => of(output, 'pages').find(item => item.data.path === listingPath)!
  assert.deepEqual(listOf(without).relations?.listingProducts, undefined)
  const list = listOf(result)
  assert.deepEqual(list.relations?.listingProducts, ['products:vm-product:3625'])
  assert.deepEqual(list.data.listingMissing.map((row: { legacyPath: string }) => row.legacyPath), ['/petla-a.html', '/konflikt.html', '/o-nas.html', '/z-zapytaniem.html'])
  // The redirect changes no product, category or redirect record: no price, stock or address is invented.
  for (const collection of ['products', 'categories', 'redirects']) assert.deepEqual(of(result, collection), of(without, collection), collection)
  const mask = of(result, 'products').find(item => item.key === 'vm-product:3625')!
  assert.equal(mask.data.stock, null)
  assert.equal(reported(result, 'listing-card-redirect-resolved').length, 1)
  assert.equal(reported(result, 'listing-price-differs').length, 1, 'the card price is only compared')
  assert.equal(reported(result, 'captured-redirect-cycle').length, 2)
  assert.equal(reported(result, 'captured-redirect-conflict').length, 1)
  assert.equal(reported(result, 'captured-redirect-shadowed').length, 1)
  assert.equal(reported(result, 'captured-redirect-rejected').length, 3)
  assert.ok(!JSON.stringify(result.unresolved).includes('tmpl=component'), 'rejected query values are not reported')
})

// ---------------------------------------------------------- blog, contact

test('a Joomla category blog is a page even at a course-like address; article counters are not copied', () => {
  const blog = '<html><head><title>Kursy - test</title></head><body><div class="portal-real-content"><div class="fl left-sitebar"><table class="moduletable"><tr><td>LEFT-MARKER</td></tr></table></div>'
    + '<div class="fr right-sitebar"><div class="breadcrumbs"><a href="/">Strona główna</a></div><div class="blog"><h2><span class="subheading-category">Kursy nurkowania</span></h2><div class="category-desc"><div class="clr"></div></div>'
    + '<div class="cat-children"><h3>Podkategorie</h3><ul><li class="first"><span class="item-title"><a href="/kursy-nurkowania/padi-boat-diver.html">Kursy nurkowania</a></span><dl><dt>Liczba artykułów:</dt><dd>17</dd></dl></li></ul></div></div></div></div></body></html>'
  const result = convert([page('/kursy-nurkowania/kursy-nurkowania.html', blog)])
  assert.deepEqual(of(result, 'courses'), [])
  const [entry] = of(result, 'pages')
  assert.equal(entry.key, 'page:kursy-nurkowania/kursy-nurkowania.html')
  assert.equal(entry.data.title, 'Kursy nurkowania')
  assert.equal(entry.data.kind, 'page')
  assert.match(entry.data.body, /<a href="\/kursy-nurkowania\/padi-boat-diver.html">\s*Kursy nurkowania<\/a>/)
  for (const marker of ['Liczba artykułów', '17', 'LEFT-MARKER', 'Strona główna', 'subheading']) assert.ok(!entry.data.body.includes(marker), marker)
  assert.equal(reported(result, 'blog-imported-as-page').length, 1)
})

test('a Joomla contact person page keeps its public details, drops the old form and links the site form', () => {
  const contact = '<html><head><title>Underwater test</title></head><body><div class="portal-real-content"><div class="portal-center-site-bar"><div class="contact"><h2><span class="contact-name">Osoba TESTOWA</span></h2>'
    + '<div id="contact-slider" class="pane-sliders"><div class="panel"><h3 class="pane-toggler title" id="basic-details"><a><span>Kontakt</span></a></h3><div class="pane-slider content"><div class="contact-contactinfo"><p><span class="contact-webpage"><a href="https://plus.google.com/+Testowa">https://plus.google.com/+Testowa</a></span></p></div></div></div>'
    + '<div class="panel"><h3 class="pane-toggler title" id="display-form"><a><span>Formularz kontaktowy</span></a></h3><div class="pane-slider content"><div class="contact-form"><form action="/stary"><input type="hidden" name="token" value="SECRET-SYNTHETIC"></form></div></div></div>'
    + '<div class="panel"><h3 class="pane-toggler title" id="display-misc"><a><span>Dodatkowe informacje</span></a></h3><div class="pane-slider content"><div class="contact-miscinfo"><div class="contact-misc"><p>Miscellanous info</p></div></div></div></div></div></div></div></div></body></html>'
  const result = convert([page('/contact/intro-nurkowe/osoba-testowa.html', contact)])
  const [entry] = of(result, 'pages')
  assert.equal(entry.data.title, 'Osoba TESTOWA')
  assert.equal(entry.data.kind, 'page')
  assert.match(entry.data.body, /https:\/\/plus\.google\.com\/\+Testowa/, 'the address stays as text')
  assert.doesNotMatch(entry.data.body, /href="https:\/\/plus/)
  assert.ok(entry.data.body.endsWith('<p><a href="/kontakt.html">Formularz kontaktowy</a></p>'))
  assert.equal(entry.data.body.split('Formularz kontaktowy').length, 2, 'only the link to the site form')
  for (const marker of ['<form', '<input', 'SECRET-SYNTHETIC', 'Miscellanous', 'Dodatkowe informacje', 'stary', '@']) assert.ok(!entry.data.body.includes(marker), marker)
  assert.equal(reported(result, 'contact-placeholder-omitted').length, 1)
  assert.equal(reported(result, 'dead-external-link').length, 1)
})

// Shapes of the sanitized source samples edge-6 and edge-14..17 (right-hand blog column, current
// breadcrumb item as a plain span, Artio credit after the component), with synthetic text.
const CRUMBS = (current: string) => `<div class="portal-breadcrumb"><div class="breadcrumbs"><span class="showHere">Jesteś tutaj: </span><a href="/" class="pathway">Strona główna</a> <img src="/media/system/images/arrow.png" alt=""> <span>${current}</span></div></div>`
const ARTIO = '<div><a href="http://www.artio.net" title="Web development">Joomla SEF URLs by Artio</a></div>'
function blogPage(o: { title?: string; crumb?: string; inner: string }) {
  return `<html><head><title>${o.title ?? ''}</title></head><body><div class="portal-real-content"><div class="fl left-sitebar"><table class="moduletable"><tr><td>LEFT-MARKER</td></tr></table></div>`
    + `<div class="fr right-sitebar">${o.crumb === undefined ? '' : CRUMBS(o.crumb)}﻿<div class="blog">${o.inner}</div>${ARTIO}</div></div><div class="portal-content-footer">FOOTER-MARKER</div></body></html>`
}
const REPORTS_BLOG = (intro = '<div class="clr"></div>') => `<h1>\n\t\tRelacje z wypraw testowych\t</h1><div class="category-desc">${intro}</div><div class="blog_more"><ul>`
  + '<li><a class="blogsection" href="/relacje-z-wypraw/wyprawa-testowa-a.html">\n\t\t\t2013/10 Wyprawa testowa A</a></li>'
  + '<li><a class="blogsection" href="/relacje-z-wypraw/wyprawa-testowa-b.html">\n\t\t\t2013/07 Wyprawa testowa B</a></li></ul></div>'
const PAGINATION = '<div class="pagination"><p class="counter">Strona 2 z 2</p><ul class="pagination"><li>«</li><li> <strong><a href="/wyprawy-nurkowe.html" title="Start">Start</a></strong> </li>'
  + '<li> <strong><a href="/wyprawy-nurkowe.html" title="poprz.">poprz.</a></strong> </li><li> <strong><a href="/wyprawy-nurkowe.html" title="1">1</a></strong> </li><li> <span>2</span> </li><li> <span>nast.</span> </li><li> <span>Zakończenie</span> </li><li>»</li></ul></div>'
const ARTICLE = (title: string) => `<html><head><title>${title}</title></head><body><div class="portal-real-content"><div class="item-page"><h1>${title}</h1><p>Treść relacji.</p></div></div></body></html>`

test('a source blog at a fixed section gives its literal H1, SEO and introduction, not a copy of the list the section renders', () => {
  const reports = convert([
    page('/relacje-z-wypraw.html', blogPage({ title: 'Relacje z wypraw testowych - Underwater.pl', crumb: 'Relacje', inner: REPORTS_BLOG() })),
    page('/relacje-z-wypraw/wyprawa-testowa-a.html', ARTICLE('Wyprawa testowa A')),
  ])
  const section = of(reports, 'pages').find(item => item.data.path === '/relacje-z-wypraw.html')!
  assert.ok(section, JSON.stringify(reports.unresolved))
  assert.equal(section.key, 'page:relacje-z-wypraw.html')
  assert.deepEqual(section.data, { title: 'Relacje z wypraw testowych', path: '/relacje-z-wypraw.html', kind: 'page', published: true, legacyPath: '/relacje-z-wypraw.html', seo: { title: 'Relacje z wypraw testowych - Underwater.pl' } }, 'an empty description adds no body')
  for (const collection of ['courses', 'trips']) assert.deepEqual(of(reports, collection), [], collection)
  assert.equal(reported(reports, 'source-section-teasers-omitted').length, 1)
  const unresolved = reported(reports, 'source-section-teaser-unresolved')
  assert.equal(unresolved.length, 1, 'only the list link without an imported record')
  assert.match(unresolved[0].detail, /wyprawa-testowa-b\.html/)

  const withIntro = convert([page('/relacje-z-wypraw.html', blogPage({ title: 'Relacje', crumb: 'Relacje', inner: REPORTS_BLOG('<p>Wstęp sekcji testowej.</p>') }))])
  const [intro] = of(withIntro, 'pages')
  assert.equal(intro.data.body, '<p>Wstęp sekcji testowej.</p>')
})

test('a source blog with an H1 outside a fixed section keeps its list as a page body, never a course', () => {
  const result = convert([page('/kursy-nurkowania/archiwum-relacji.html', blogPage({ title: 'Archiwum', crumb: 'Relacje', inner: REPORTS_BLOG() }))])
  assert.deepEqual(of(result, 'courses'), [])
  const [entry] = of(result, 'pages')
  assert.equal(entry.data.title, 'Relacje z wypraw testowych')
  assert.match(entry.data.body, /<a href="\/relacje-z-wypraw\/wyprawa-testowa-a\.html">\s*2013\/10 Wyprawa testowa A<\/a>/)
  assert.match(entry.data.body, /wyprawa-testowa-b\.html/)
  for (const marker of ['<h1', '<h2', 'Relacje z wypraw testowych', 'LEFT-MARKER', 'FOOTER-MARKER', 'Strona główna', 'Artio']) assert.ok(!entry.data.body.includes(marker), marker)
  assert.equal(reported(result, 'blog-imported-as-page').length, 1)
})

test('a blog results page holding only pagination: literal breadcrumb or SEO title and its own links, nothing invented', () => {
  const planned = '/wyprawy-nurkowe/planowane-wyprawy/page-3.html'
  const iantd = '/wyprawy-nurkowe/kursy-nurkowania-iantd/blog/page-5.html'
  const result = convert([
    page(planned, blogPage({ title: 'Wyprawy Nurkowe - Underwater.pl', crumb: 'Wyprawy nurkowe', inner: PAGINATION })),
    page(iantd, blogPage({ title: 'Wyprawy Nurkowe - Underwater.pl', inner: PAGINATION })),
    page('/wyprawy-nurkowe/bez-tytulu/page-2.html', blogPage({ inner: PAGINATION })),
    page('/wyprawy-nurkowe/pusty/page-2.html', blogPage({ title: 'Pusty', crumb: 'Wyprawy nurkowe', inner: '<div class="pagination"><p class="counter">Strona 2 z 2</p></div>' })),
  ])
  const byPath = new Map(of(result, 'pages').map(item => [item.data.path, item]))
  const links = '<ul><li><a href="/wyprawy-nurkowe.html">Start</a></li></ul>'
  assert.deepEqual(byPath.get(planned)!.data, { title: 'Wyprawy nurkowe', path: planned, kind: 'page', body: links, published: true, legacyPath: planned, seo: { title: 'Wyprawy Nurkowe - Underwater.pl' } })
  assert.deepEqual([byPath.get(iantd)!.data.title, byPath.get(iantd)!.data.body], ['Wyprawy Nurkowe - Underwater.pl', links])
  assert.equal(byPath.size, 2, 'no title or no own link: reported, not imported')
  for (const collection of ['trips', 'courses', 'events']) assert.deepEqual(of(result, collection), [], collection)
  assert.ok(!JSON.stringify(result.bundle).includes('Strona 2 z 2'))
  assert.equal(reported(result, 'blog-title-from-breadcrumb').length, 1)
  assert.equal(reported(result, 'blog-title-from-seo').length, 1)
  assert.equal(reported(result, 'blog-navigation-only').length, 2)
  assert.ok(reported(result, 'blog-missing-title').some(item => item.url === ORIGIN + '/wyprawy-nurkowe/bez-tytulu/page-2.html'))
  assert.ok(reported(result, 'empty-main-content').some(item => item.url === ORIGIN + '/wyprawy-nurkowe/pusty/page-2.html'))
})

test('the Xmap sitemap keeps its nested lists under the literal breadcrumb title, without page chrome', () => {
  const xmap = '<div id="xmap"><div><h2 class="menutitle">Portal Menu</h2><ul class="level_0"><li><a href="/" title="Strona główna">Strona główna</a><ul class="level_1">'
    + '<li><a href="/wyprawy-nurkowe/wyprawa-testowa.html" title="Wyprawa testowa">Wyprawa testowa</a></li></ul></li><li><a href="/aktualnosci.html" title="Aktualności">Aktualności</a></li></ul></div>'
    + '<div><h2 class="menutitle"></h2></div><div><h2 class="menutitle">Sklep</h2><ul class="level_0"><li><a href="/9-akcesoria-testowe.html" title="Akcesoria testowe">Akcesoria testowe</a><ul class="level_1">'
    + '<li><a href="/9-akcesoria-testowe/11-bojki-testowe.html" title="Bojki testowe">Bojki testowe</a></li></ul></li></ul></div>'
    + '<div class="muted">Powered by <a href="http://www.jooxmap.com/">Xmap</a></div><span class="article_separator"> </span></div>'
  const html = '<html><head><title></title></head><body><div class="portal-menu"><ul class="menu"><li><a href="/kontakt.html">MENU-MARKER</a></li></ul></div>'
    + `<div class="portal-real-content"><div class="portal-center-site-bar">${CRUMBS('Mapa serwisu')}<div class="portal-message"><div id="system-message-container"></div></div>${xmap}${ARTIO}</div></div></body></html>`
  const result = convert([page('/mapa-serwisu.html', html)])
  const [entry] = of(result, 'pages')
  assert.ok(entry, JSON.stringify(result.unresolved))
  assert.equal(entry.data.title, 'Mapa serwisu')
  assert.equal(entry.data.kind, 'page')
  assert.equal('seo' in entry.data, false, 'the empty source title is not invented')
  assert.ok(entry.data.body.includes('<h2>Portal Menu</h2><ul><li><a href="/" title="Strona główna">Strona główna</a><ul><li><a href="/wyprawy-nurkowe/wyprawa-testowa.html" title="Wyprawa testowa">Wyprawa testowa</a></li></ul></li>'), entry.data.body)
  assert.ok(entry.data.body.includes('<a href="/9-akcesoria-testowe/11-bojki-testowe.html" title="Bojki testowe">Bojki testowe</a>'))
  for (const marker of ['Powered', 'Xmap', 'MENU-MARKER', 'Jesteś tutaj', 'Artio', '<h2></h2>', '<div></div>']) assert.ok(!entry.data.body.includes(marker), marker)
  assert.deepEqual(of(result, 'categories'), [], 'sitemap links are not shop navigation')
  assert.equal(reported(result, 'sitemap-imported-as-page').length, 1)
})

test('a Joomla error response, old account forms and shop chrome without a list are explicit exclusions', () => {
  const error = '<br><b>jos-Error</b>: Nie znaleziono widoku [nazwa, typ, przedrostek]: category, php, contentView<br>\n<br>\nJSite -&gt; dispatch() @ /home/users/test/public_html/index.php:42<br>\nJError :: raise() @ /home/users/test/public_html/libraries/joomla/error/error.php:251'
  const form = '<form action="/logowanie/reset.html?task=reset.request" method="post"><input type="text" name="jform[email]"><input type="hidden" name="SYNTHETICTOKEN" value="1"><button type="submit">Wyślij</button></form>'
  const account = (inner: string, head = '') => `<html><head><title>Logowanie</title>${head}</head><body><div class="portal-real-content"><div class="portal-center-site-bar">${CRUMBS('Logowanie')}${inner}${ARTIO}</div></div></body></html>`
  const shop = `<html><head><title>Sklep Nurkowy Warszawa</title>${SEARCH('option=com_search&amp;virtuemart_manufacturer_id=70&amp;Itemid=56&amp;format=opensearch&amp;view=search')}</head><body><div class="portal-real-content">`
    + '<div class="fl left-sitebar"><div class="moduletable"><ul class="VMmenu"><li class="VmClose"><a href="/9-akcesoria-testowe.html">Akcesoria testowe</a></li></ul></div></div>'
    + '<div class="fl center-sitebar"><div class="breadcrumbs"><span class="showHere">Jesteś tutaj: </span><a href="/" class="pathway">Strona główna</a> <span>Sklep nurkowy</span></div><div class="custom"><p>Gwarancja testowa.</p></div></div></div></body></html>'
  const result = convert([
    page('/aktualnosci/page-5.html', error),
    page('/logowanie/reset.html', account(`<div class="reset"><p>Nie pamiętasz hasła? Tekst testowy.</p>${form}</div>`)),
    page('/logowanie/remind.html', account(`<div class="remind"><p>Nie pamiętasz nazwy? Tekst testowy.</p>${form}</div>`)),
    page('/logowanie/registration.html', account(`<div class="registration"><h1>Rejestracja użytkownika</h1>${form}</div>`)),
    page('/account.html', account('<h1>Twoje dane</h1><h2>Rejestruj</h2>', SEARCH('option=com_search&amp;layout=default&amp;view=user&amp;Itemid=519&amp;format=opensearch'))),
    page('/list-all-products/marka-testowa.html', shop),
  ])
  assert.deepEqual(of(result, 'pages'), [])
  assert.equal(result.bundle.entities.some(item => /logowanie|account|list-all-products|aktualnosci/.test(JSON.stringify(item.data))), false)
  assert.equal(result.counts.skipped['source-error-response'], 1)
  assert.equal(result.counts.skipped['legacy-account-requires-source-database'], 4)
  assert.equal(result.counts.skipped['shop-component-missing'], 1)
  const serialized = JSON.stringify(result)
  for (const marker of ['jos-Error', 'public_html', 'dispatch', 'SYNTHETICTOKEN', 'task=reset', 'jform', '<form']) assert.ok(!serialized.includes(marker), marker)
})


test('the fixed calendar keeps its literal source heading and SEO without the old month table', () => {
  const markup = CALENDAR('2026/10/2', '16:00 Wydarzenie skr.').replace('<html>', '<html><head><title>Kalendarz testowy</title><meta name="description" content="Opis testowy kalendarza."></head>').replace('<div class="portal-real-content">', '<div class="portal-real-content"><div id="jevents_header" class="jeventpage"><h2 class="contentheading">Kalendarz</h2></div>')
  const result = convert([page('/kalendarz.html', markup)])
  const [section] = of(result, 'pages')
  assert.deepEqual(section.data, { title: 'Kalendarz', path: '/kalendarz.html', kind: 'page', published: true, legacyPath: '/kalendarz.html', seo: { title: 'Kalendarz testowy', description: 'Opis testowy kalendarza.' } })
  assert.equal(of(result, 'events').length, 1, 'monthly event extraction stays independent')
  assert.equal(reported(result, 'no-main-content').length, 0)
})
