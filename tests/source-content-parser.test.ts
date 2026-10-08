import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Synthetic fixtures only; the converter never sees encrypted captures or the network.
const PARSER = 'scripts/source/content_parser.py'
const FIXTURES = 'tests/fixtures/source-content'
const ORIGIN = 'https://www.underwater.pl'
const HASH = 'a'.repeat(64)
const CAPTURED = '2026-10-08T12:00:00Z'
const PRODUCT = '/1115-maska-testowa-syntetyczna.html'
const NESTED = '/sklep-nurkowy/12-akcesoria/34-skrzyd%C5%82a-i-uprz%C4%99%C5%BCe/1115-maska-testowa-syntetyczna.html'
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }

type Page = { url: string; html: string; sha256: string; charset?: string }
type Entity = { collection: string; key: string; data: Record<string, any>; relations?: Record<string, string> }
type Result = { bundle: { version: number; source: Record<string, unknown>; media: unknown[]; entities: Entity[] }; media_urls: Array<Record<string, any>>; unresolved: Array<{ code: string; url: string | null; key: string | null; detail: string }>; counts: Record<string, any> }

const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')
const page = (pathname: string, html: string): Page => ({ url: ORIGIN + pathname, html, sha256: createHash('sha256').update(html, 'utf8').digest('hex') })

function python(source: string, input: unknown) {
  const loader = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location('content_parser', '${PARSER}')`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'request = json.load(sys.stdin)',
    source,
  ].join('\n')
  const result = spawnSync('python3', ['-c', loader], { input: JSON.stringify(input), encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const convert = (pages: Page[]): Result => python("json.dump(module.convert_pages(request['pages'], request['capturedAt'], request['manifestHash']), sys.stdout, ensure_ascii=False)", { pages, capturedAt: CAPTURED, manifestHash: HASH })
const entity = (result: Result, collection: string, key: string) => result.bundle.entities.find(item => item.collection === collection && item.key === key)
const codes = (result: Result) => new Set(result.unresolved.map(item => item.code))

const shop = () => convert([page(PRODUCT, fixture('product.html')), page(NESTED, fixture('product.html'))])

test('public homepage company block supplies contact settings without inspecting source configuration', () => {
  const home = '<div class="custombox4">ul. Testowa 1<br>00-001 Miasto<br>NIP: PL1234567890<br>Regon: 123456789<h3>tel. +48 000 000 000</h3><p>e-mail: public@example.invalid</p></div>'
  const result = convert([page('/', home)])
  assert.deepEqual((result.bundle as any).settings, { address: 'ul. Testowa 1 00-001 Miasto', nip: 'PL1234567890', phone: '+48 000 000 000', email: 'public@example.invalid' })
  assert.equal(result.bundle.entities.length, 0)
  const ambiguous = convert([page('/', home + home)])
  assert.equal('settings' in ambiguous.bundle, false)
})

test('legacy contact preserves the public staff cell and excludes the old form and hidden inputs', () => {
  const result = convert([page('/kontakt.html', fixture('contact-staff-legacy.html'))])
  const contact = result.bundle.entities.find(item => item.collection === 'pages' && item.data.path === '/kontakt.html')
  assert.ok(contact)
  assert.equal(contact.data.title, 'Kontakt')
  assert.match(contact.data.body, /kwalifikacja dokładnie ze źródła/)
  assert.match(contact.data.body, /mailto:synthetic@example.invalid/)
  assert.doesNotMatch(contact.data.body, /STARY FORMULARZ|SECRET-SYNTHETIC|<form|<input|<button/)
  assert.equal(result.media_urls.length, 1)
})

test('product identity comes from the VirtueMart ID on the page, not from the URL prefix', () => {
  const result = shop()
  const products = result.bundle.entities.filter(item => item.collection === 'products')
  assert.equal(products.length, 1)
  const product = products[0]
  assert.equal(product.key, 'vm-product:1482')
  assert.equal(product.data.vmId, 1482)
  assert.equal(product.data.slug, '1115-maska-testowa-syntetyczna')
  assert.equal(product.data.legacyPath, PRODUCT)
  assert.equal(product.data.name, 'Maska Testowa Syntetyczna')
  assert.equal(product.data.short, 'Krótki syntetyczny opis maski.')
  // The related product (ID 999, 99,00 zł) inside the container must not leak in.
  assert.equal(product.data.priceCents, 129900)
  assert.ok(!JSON.stringify(product).includes('999'))
})

test('nested Unicode categories keep their decoded paths and parent chain', () => {
  const result = shop()
  const parent = entity(result, 'categories', 'category:sklep-nurkowy/12-akcesoria')
  const child = entity(result, 'categories', 'category:sklep-nurkowy/12-akcesoria/34-skrzydła-i-uprzęże')
  assert.ok(parent && child)
  assert.equal(child.data.name, 'Skrzydła i uprzęże')
  assert.equal(child.data.legacyPath, '/sklep-nurkowy/12-akcesoria/34-skrzydła-i-uprzęże.html')
  assert.equal(child.data.slug, 'sklep-nurkowy/12-akcesoria/34-skrzydła-i-uprzęże')
  assert.equal(child.relations?.parent, 'categories:category:sklep-nurkowy/12-akcesoria')
  assert.equal(parent.relations, undefined)
  // The URL number is not proof of a database ID, so categories carry no vmId from links.
  assert.equal('vmId' in child.data, false)
  assert.equal(entity(result, 'products', 'vm-product:1482')?.relations?.category, 'categories:' + child.key)
  // The sidebar listed another category; it is imported even without products.
  assert.ok(entity(result, 'categories', 'category:sklep-nurkowy/56-pianki'))
})

test('no stock, tax or surcharge is synthesised from qualitative page text', () => {
  const product = entity(shop(), 'products', 'vm-product:1482')!
  assert.equal(product.data.stock, null)
  for (const field of ['taxRate', 'salePriceCents', 'salePrice', 'sku', 'price', 'specs', 'features', 'warranty']) assert.equal(field in product.data, false, field)
  assert.deepEqual(product.data.variants.map((variant: Record<string, unknown>) => variant.label), ['S', 'M', 'XL (+20,00 zł)'])
  for (const variant of product.data.variants) {
    assert.equal(variant.stock, null)
    assert.equal('priceCents' in variant, false)
    assert.match(variant.legacyKey, /^public-option:[a-f0-9]{64}$/)
  }
  assert.equal(new Set(product.data.variants.map((variant: Record<string, unknown>) => variant.legacyKey)).size, 3)
  assert.ok(codes(shop()).has('variant-price-text-not-imported'))
})

test('Polish price notation converts to exact cents and rejects anything ambiguous', () => {
  const values = python("json.dump([module.parse_pln_cents(value) for value in request], sys.stdout)", ['299,00 zł', '1 299,00 zł', '1 299,00 zł', '1.299,00 zł', '299 zł', '12 345,67 PLN', '299.00 zł', '299,0 zł', '299,00', 'od 299 zł', ''])
  assert.deepEqual(values, [29900, 129900, 129900, 129900, 29900, 1234567, null, null, null, null, null])
})

test('bodies keep source text and links but drop scripts, embeds, forms, sidebar and footer', () => {
  const body: string = entity(shop(), 'products', 'vm-product:1482')!.data.body
  assert.match(body, /Syntetyczny opis: szkło hartowane/)
  assert.match(body, /<a href="\/kontakt.html">Zapytaj<\/a>/)
  assert.match(body, /<a href="\/poradnik.html">poradnik<\/a>/, 'relative link resolved against <base href>')
  assert.doesNotMatch(body, /^\s*<span>Opis/, 'VirtueMart section label is not content')
  for (const marker of ['SCRIPT-MARKER', 'IFRAME-MARKER', 'FORM-MARKER', 'SIDEBAR-MARKER', 'FOOTER-MARKER', 'NAV-MARKER', '<script', '<iframe', '<form', '<style', 'onclick', 'style=', 'javascript:', 'Dodaj do koszyka']) assert.ok(!body.includes(marker), marker)

  const course = entity(convert([page('/kursy-nurkowania/kurs-testowy-syntetyczny.html', fixture('course.html'))]), 'courses', 'course:kurs-testowy-syntetyczny')!
  assert.match(course.data.body, /<h3>Wymagania<\/h3>/)
  assert.match(course.data.body, /href="\/kursy-nurkowania\/kurs-inny.html"/)
  for (const marker of ['SIDEBAR-MARKER', 'FOOTER-MARKER', 'PAGENAV-MARKER', 'Opublikowano', 'Kurs Testowy Syntetyczny</h1>']) assert.ok(!course.data.body.includes(marker), marker)
})

test('courses keep name, slug and source text without guessed structured fields', () => {
  const result = convert([page('/kursy-nurkowania/kurs-testowy-syntetyczny.html', fixture('course.html'))])
  const course = entity(result, 'courses', 'course:kurs-testowy-syntetyczny')!
  assert.equal(course.data.name, 'Kurs Testowy Syntetyczny')
  assert.equal(course.data.slug, 'kurs-testowy-syntetyczny')
  assert.equal(course.data.published, true)
  assert.equal(course.data.legacyPath, '/kursy-nurkowania/kurs-testowy-syntetyczny.html')
  assert.equal(course.data.org, null, 'explicit null prevents the PADI collection default')
  for (const field of ['price', 'nextDate', 'minAge', 'maxDepth', 'level', 'sections', 'includes', 'publishedAt']) assert.equal(field in course.data, false, field)
  assert.match(course.data.body, /Cena: 1 450 zł, termin: 14 listopada/)
  assert.equal(result.bundle.entities.some(item => item.collection === 'course-sessions' || item.collection === 'events'), false)
})

test('media URLs are limited to safe same-host image paths and descriptors stay empty', () => {
  const result = shop()
  assert.deepEqual(result.bundle.media, [])
  const byPath = new Map(result.media_urls.map(item => [item.path, item]))
  assert.deepEqual([...byPath.keys()].sort(), ['images/opisy/maska-szczegół.jpg', 'images/stories/virtuemart/product/maska-bok.png', 'images/stories/virtuemart/product/maska-testowa.jpg'])
  const main = byPath.get('images/stories/virtuemart/product/maska-testowa.jpg')!
  assert.equal(main.url, 'https://www.underwater.pl/images/stories/virtuemart/product/maska-testowa.jpg', 'full-size original behind the thumbnail')
  assert.equal(main.alt, 'Maska Testowa Syntetyczna')
  assert.deepEqual(main.targets, [{ collection: 'products', key: 'vm-product:1482', field: 'images', order: 0 }])
  assert.equal(byPath.get('images/stories/virtuemart/product/maska-bok.png')!.url.startsWith('https://www.underwater.pl/'), true, 'same-host HTTP upgraded')
  assert.equal(byPath.get('images/opisy/maska-szczegół.jpg')!.targets[0].field, 'body')
  for (const item of result.media_urls) {
    assert.match(item.key, /^public-image:[a-f0-9]{40}$/)
    assert.ok(!item.path.startsWith('/') && !item.path.split('/').some((part: string) => part === '..' || part.startsWith('.')))
    assert.match(item.path, /\.(?:jpe?g|png|webp|gif|avif)$/i)
    assert.equal(new URL(item.url).protocol, 'https:')
  }
  const body: string = entity(result, 'products', 'vm-product:1482')!.data.body
  assert.match(body, /<img src="https:\/\/www.underwater.pl\/images\/opisy\/maska-szczeg%C3%B3%C5%82.jpg" alt="Szczegół" width="300" height="200">/)
  for (const leaked of ['evil.example.org', 'cdn.example.com', '.env', 'z-query', 'userinfo', 'plik.svg', 'sidebar-promo', 'inna.jpg', 'user:pw']) assert.ok(!JSON.stringify(result.media_urls).includes(leaked) && !body.includes(leaked), leaked)
  for (const code of ['media-external-host', 'media-traversal', 'media-query', 'media-userinfo', 'media-hidden-or-empty-segment', 'media-extension']) assert.ok(codes(result).has(code), code)
  assert.ok(!JSON.stringify(result.unresolved).includes('user:pw'), 'credentials are not echoed into the report')
})

test('the same product at two public URLs becomes one record plus a redirect', () => {
  const result = shop()
  const redirects = result.bundle.entities.filter(item => item.collection === 'redirects')
  assert.equal(redirects.length, 1)
  assert.equal(redirects[0].data.from, decodeURIComponent(NESTED))
  assert.equal(redirects[0].data.to, PRODUCT, 'rel=canonical decides which address stays')
  assert.equal(redirects[0].data.published, true)
})

test('conflicting content for one source ID or one path is reported, never merged', () => {
  const html = fixture('product.html')
  const changed = html.replace('1&nbsp;299,00 zł', '1&nbsp;199,00 zł')
  const byId = convert([page(PRODUCT, html), page(NESTED, changed)])
  assert.equal(byId.bundle.entities.some(item => item.collection === 'products' || item.collection === 'redirects'), false)
  assert.ok(byId.unresolved.some(item => item.code === 'conflicting-source-content' && item.key === 'products:vm-product:1482'))

  const byPath = convert([page(PRODUCT, html), page(PRODUCT, changed)])
  assert.equal(byPath.bundle.entities.some(item => item.collection === 'products'), false)
  assert.ok(codes(byPath).has('conflicting-source-content'))

  const identical = convert([page(PRODUCT, html), page(PRODUCT, html)])
  assert.equal(identical.bundle.entities.filter(item => item.collection === 'products').length, 1)
  assert.equal(identical.counts.skipped['duplicate-page-capture'], 1)
})

test('several option fields are reported instead of inventing variant combinations', () => {
  const result = convert([page('/2001-pianka-testowa.html', fixture('product-two-fields.html')), page(PRODUCT, fixture('product.html'))])
  const product = entity(result, 'products', 'vm-product:2002')!
  assert.equal(product.data.slug, '2001-pianka-testowa')
  assert.equal(product.data.priceCents, 54900)
  assert.equal('variants' in product.data, false)
  assert.match(product.data.body, /rozmiary i kolory/)
  assert.ok(result.unresolved.some(item => item.code === 'ambiguous-variants' && item.key === 'vm-product:2002'))
})

test('a product without ID, name, price or category is reported and skipped', () => {
  const html = fixture('product.html')
  const cases: Array<[string, string]> = [
    ['product-missing-price', html.replace(/<span class="PricesalesPrice">[^<]*<\/span>/g, '')],
    ['product-missing-vmid', html.replace(/productPrice1482/g, 'productPrice').replace(/name="virtuemart_product_id\[\]" value="1482"/, 'name="virtuemart_product_id[]" value=""')],
    ['product-missing-name', html.replace('<h1>Maska Testowa Syntetyczna</h1>', '')],
    ['product-category-unresolved', html.replace(/<div class="breadcrumbs">[\s\S]*?<\/div>/, '').replace(/<ul class="VMmenu">[\s\S]*?<\/ul>\s*<\/li>[\s\S]*?<\/ul>/, '')],
    ['product-vmid-conflict', html.replace('value="1482"', 'value="1483"')],
  ]
  for (const [code, variant] of cases) {
    const result = convert([page(PRODUCT, variant)])
    assert.equal(result.bundle.entities.some(item => item.collection === 'products'), false, code)
    assert.ok(result.unresolved.some(item => item.code === code && item.url === ORIGIN + PRODUCT), `${code}: ${JSON.stringify(result.unresolved.map(item => item.code))}`)
  }
})

test('an explicit 0,00 zł is a known price (enquiry only in the app); a missing price is not', () => {
  const zero = convert([page(PRODUCT, fixture('product.html').replace('1&nbsp;299,00 zł', '0,00 zł'))])
  const product = entity(zero, 'products', 'vm-product:1482')!
  assert.equal(product.data.priceCents, 0)
  assert.equal(product.data.stock, null)
  assert.equal('price' in product.data, false, 'the importer derives price from priceCents')
  assert.equal(codes(zero).has('product-zero-price'), false)
  const missing = convert([page(PRODUCT, fixture('product.html').replace(/<span class="PricesalesPrice">[^<]*<\/span>/g, '<span class="PricesalesPrice"></span>'))])
  assert.equal(missing.bundle.entities.some(item => item.collection === 'products'), false)
  assert.ok(codes(missing).has('product-unparsed-price'))
})

test('home tiles, article pages, trips, albums and fixed routes are routed explicitly', () => {
  const result = convert([
    page('/', fixture('home.html')),
    page('/portal-testowy.html', fixture('home.html')),
    page('/regulamin-sklepu.html', fixture('article.html')),
    page('/aktualnosci/12-nowy-sezon.html', fixture('article.html')),
    page('/kontakt.html', fixture('article.html')),
    page('/wyprawy-nurkowe/egipt-testowy.html', fixture('article.html')),
    page('/galeria/album-testowy.html', fixture('gallery.html')),
    page('/sklep-nurkowy/56-pianki.html', '<html><body><div class="category-view"><h1>Pianki</h1></div></body></html>'),
  ])
  assert.equal(result.counts.skipped['home-landing'], 1)
  assert.ok(result.unresolved.some(item => item.code === 'ambiguous-main-content' && item.url === ORIGIN + '/portal-testowy.html'))
  assert.equal(result.bundle.entities.some(item => item.data.title === 'Kursy nurkowania' || item.data.name === 'Promocja tygodnia'), false)
  assert.equal(entity(result, 'pages', 'page:regulamin-sklepu.html')?.data.kind, 'legal')
  assert.equal(entity(result, 'pages', 'page:aktualnosci/12-nowy-sezon.html')?.data.kind, 'news')
  const article = entity(result, 'pages', 'page:regulamin-sklepu.html')!
  assert.equal(article.data.title, 'Artykuł Testowy Syntetyczny')
  assert.equal(article.data.path, '/regulamin-sklepu.html')
  assert.equal('publishedAt' in article.data, false)
  for (const marker of ['ASIDE-MARKER', 'MODULE-MARKER']) assert.ok(!article.data.body.includes(marker), marker)
  assert.ok(entity(result, 'pages', 'page:kontakt.html'))
  assert.ok(result.unresolved.some(item => item.code === 'source-section-content' && item.url === ORIGIN + '/kontakt.html'))
  assert.equal(codes(result).has('fixed-route-shadows-source-page'), false)
  const trip = entity(result, 'trips', 'trip:wyprawy-nurkowe/egipt-testowy.html')!
  assert.equal(trip.data.path, '/wyprawy-nurkowe/egipt-testowy.html')
  for (const field of ['startsAt', 'endsAt', 'priceCents', 'location']) assert.equal(field in trip.data, false, field)
  const album = entity(result, 'albums', 'album:galeria/album-testowy.html')!
  assert.equal(album.data.title, 'Album Testowy Syntetyczny')
  assert.equal('date' in album.data, false)
  const photos = result.media_urls.filter(item => item.targets.some((target: Record<string, string>) => target.field === 'photos'))
  assert.deepEqual(photos.map(item => item.path), ['images/phocagallery/album/zdjecie-1.jpg', 'images/phocagallery/album/zdjecie-2.jpg'])
  assert.equal(photos[0].targets[0].caption, 'Rafa koralowa')
  assert.equal(result.counts.skipped['category-listing'], 1)
  assert.equal(entity(result, 'categories', 'category:sklep-nurkowy/56-pianki')?.data.name, 'Pianki')
})

const LEGACY_COURSE = '/kursy-nurkowania/kurs-syntetyczny-ows.html'

test('older Joomla layout: title from the sibling h2.contentheading, body from .article-content', () => {
  const result = convert([page(LEGACY_COURSE, fixture('course-legacy.html'))])
  const course = entity(result, 'courses', 'course:kurs-syntetyczny-ows')!
  assert.ok(course, JSON.stringify(result.unresolved))
  assert.equal(course.data.name, 'Kurs Syntetyczny OPEN WATER (OWS)', 'the in-body h1 callout is not the title')
  assert.equal(course.data.org, null)
  assert.deepEqual(course.data.seo, { title: 'Kurs Syntetyczny Open Water - Underwater', description: 'Syntetyczny opis SEO kursu w starym układzie.' })
  const body: string = course.data.body
  assert.match(body, /Najbliższy kurs rozpoczyna się: <span>2026-10-12 o godz. 18:30.<\/span>/, 'source sentence stays in the body')
  assert.match(body, /<h2>Zadzwoń: 000 000 000 CALLOUT-MARKER<\/h2>/, 'body h1 kept as a section heading')
  assert.match(body, /Cena kursu: 1 234 zł, wiek od 10 lat/)
  assert.match(body, /href="\/kursy-nurkowania\/inny.html"/)
  // The PDF is not part of the import: its text stays, the dead link goes to review.
  assert.match(body, /<p>Plan kursu<\/p>/)
  assert.ok(!body.includes('plan-kursu.pdf'))
  assert.ok(!body.includes('OPEN WATER (OWS)'), 'title is not repeated in the body')
  for (const marker of ['HEADER-MARKER', 'LEFT-MARKER', 'LEFT-HEADING-MARKER', 'LEFT-ARTICLE-MARKER', 'RIGHT-MARKER', 'RIGHT-HEADING-MARKER', 'FOOTER-MARKER', 'FOOTER-ARTICLE-MARKER', 'META-MARKER', 'Strona główna', 'left-promo']) assert.ok(!JSON.stringify(result).includes(marker), marker)
  // The thumbnail links to its full-size file: that file is the image, and the dead link is dropped.
  assert.match(body, /<h3>Dlaczego warto\? <img src="https:\/\/www.underwater.pl\/images\/stories\/Kursy_nurkowania\/Syntetyczny\/kurs_ows_big.jpg" alt="Kurs na basenie" width="200" height="150"><\/h3>/)
  assert.deepEqual(result.media_urls.map(item => [item.path, item.targets]), [['images/stories/Kursy_nurkowania/Syntetyczny/kurs_ows_big.jpg', [{ collection: 'courses', key: course.key, field: 'body', order: 0 }]]])
  // The exact source start is also a term and calendar record, without inferred capacity or end.
  assert.equal(course.data.nextDate, '2026-10-12T16:30:00.000Z')
  const session = result.bundle.entities.find(item => item.collection === 'course-sessions')!
  const event = result.bundle.entities.find(item => item.collection === 'events')!
  assert.equal(session.data.startsAt, course.data.nextDate)
  assert.equal(session.relations?.course, 'courses:' + course.key)
  assert.equal('capacity' in session.data, false)
  assert.equal('endsAt' in session.data, false)
  assert.equal(event.relations?.courseSession, 'course-sessions:' + session.key)
  for (const field of ['price', 'minAge', 'maxDepth', 'level', 'sections', 'includes', 'lead']) assert.equal(field in course.data, false, field)
  assert.deepEqual(result.bundle.entities.map(item => item.collection).sort(), ['course-sessions', 'courses', 'events'])
  assert.deepEqual(result.unresolved, [{ code: 'internal-link-unresolvable', url: ORIGIN + LEGACY_COURSE, key: course.key, detail: 'https://www.underwater.pl/images/stories/plan-kursu.pdf text: Plan kursu' }])
})

test('older layout: blog lists, title-less bodies and form-only sections are reported, not invented', () => {
  const html = fixture('course-legacy.html')
  const blog = html.replace('<span class="article_separator">', '<h2 class="contentheading">Drugi wpis</h2><div class="article-content"><p>Drugi wpis listy.</p></div><span class="article_separator">')
  const untitled = html.replace('<h2 class="contentheading">Kurs Syntetyczny OPEN WATER (OWS)</h2>', '')
  const result = convert([
    page('/wyprawy-nurkowe.html', blog),
    page(LEGACY_COURSE, untitled),
    page('/kontakt.html', fixture('contact-legacy.html')),
  ])
  assert.deepEqual(result.bundle.entities, [])
  const byUrl = new Map(result.unresolved.map(item => [item.url, item.code]))
  assert.equal(byUrl.get(ORIGIN + '/wyprawy-nurkowe.html'), 'ambiguous-main-content')
  assert.equal(byUrl.get(ORIGIN + LEGACY_COURSE), 'missing-title', 'the body h1 callout does not stand in for a missing title')
  assert.equal(byUrl.get(ORIGIN + '/kontakt.html'), 'no-main-content')
  assert.ok(!JSON.stringify(result).includes('Formularz kontaktowy'))
})

test('sidebars are recognised in the source spelling without pruning the centre column', () => {
  const names = ['left-sitebar', 'right-sitebar', 'sidebar-right', 'portal-left-site-bar', 'col_sidebar', 'center-sitebar', 'portal-center-site-bar', 'centre_sidebar', 'article-content']
  const chrome = python("json.dump({name: module.is_chrome(module.Node('div', {'class': 'fl ' + name}, None)) for name in request}, sys.stdout)", names)
  assert.deepEqual(chrome, { 'left-sitebar': true, 'right-sitebar': true, 'sidebar-right': true, 'portal-left-site-bar': true, col_sidebar: true, 'center-sitebar': false, 'portal-center-site-bar': false, centre_sidebar: false, 'article-content': false })
})

const OWD = '/kursy-nurkowania/padi-open-water-diver.html'

test('live course layout: a right-sitebar holding the title and article is the main column', () => {
  const result = convert([page(OWD, fixture('course-right-column.html'))])
  const course = entity(result, 'courses', 'course:padi-open-water-diver')!
  assert.ok(course, JSON.stringify(result.unresolved))
  assert.equal(course.data.name, 'Kurs nurkowania PADI OPEN WATER Diver (OWD)', 'the in-body h1 callout is not the title')
  assert.equal(course.data.legacyPath, OWD)
  assert.equal(course.data.nextDate, '2026-11-16T17:00:00.000Z')
  assert.match(course.data.body, /^<h2>Zadzwoń: 000 000 000 CALLOUT-MARKER<\/h2>/)
  assert.match(course.data.body, /href="\/kursy-nurkowania\/padi-advanced-open-water-diver.html"/)
  // The side menu, its module article, the aside and the page chrome stay out.
  for (const marker of ['MENU-MARKER', 'MENU-ITEM-MARKER', 'LEFT-HEADING-MARKER', 'LEFT-ARTICLE-MARKER', 'ASIDE-HEADING-MARKER', 'ASIDE-ARTICLE-MARKER', 'HEADER-MARKER', 'FOOTER-MARKER', 'Strona główna', '(OWD)</h2>']) assert.ok(!JSON.stringify(course).includes(marker), marker)
  assert.deepEqual(result.unresolved, [])

  // A list in that column is still a list: two articles are reported, never one picked.
  const blog = fixture('course-right-column.html').replace('<span class="article_separator">', '<h2 class="contentheading">Drugi wpis</h2><div class="article-content"><p>Drugi wpis.</p></div><span class="article_separator">')
  const listed = convert([page(OWD, blog)])
  assert.deepEqual(listed.bundle.entities, [])
  assert.ok(listed.unresolved.some(item => item.code === 'ambiguous-main-content' && item.url === ORIGIN + OWD), JSON.stringify(listed.unresolved))
})

test('a side-named node is main content only with its own title then article children', () => {
  const article = '<h2 class="contentheading">T</h2><div class="article-content">x</div>'
  const cases = {
    column: `<div class="fr right-sitebar">${article}</div>`,
    breadcrumbFirst: `<div class="fr right-sitebar"><div class="portal-breadcrumb"><div class="breadcrumbs"></div></div>${article}</div>`,
    articleBeforeTitle: '<div class="fr right-sitebar"><div class="article-content">x</div><h2 class="contentheading">T</h2></div>',
    titleOnly: '<div class="fr right-sitebar"><h2 class="contentheading">T</h2></div>',
    nestedInModule: `<div class="fr right-sitebar"><div class="custom">${article}</div></div>`,
    aside: `<aside class="right-sitebar">${article}</aside>`,
    module: `<div class="right-sitebar moduletable">${article}</div>`,
    byId: `<div id="right-sitebar">${article}</div>`,
    menuId: `<div id="menu-right" class="right-sitebar">${article}</div>`,
    empty: '<div class="fr right-sitebar"></div>',
  }
  const chrome = python("json.dump({name: module.is_chrome(module.parse_html(markup).elements()[0]) for name, markup in request.items()}, sys.stdout)", cases)
  assert.deepEqual(chrome, { column: false, breadcrumbFirst: false, articleBeforeTitle: true, titleOnly: true, nestedInModule: true, aside: true, module: true, byId: false, menuId: true, empty: true })
})

const MASK = '/3625-maska-soprastek-corona.html'
const MASK_NESTED = '/80-maski-i-fajki/139-maski-nurkowe/3625-maska-soprastek-corona.html'

test('root-form shop categories from the shop breadcrumb trail and VirtueMart menu keep slug, path and parent', () => {
  const html = fixture('product-root-category.html')
  const result = convert([page(MASK, html), page(MASK_NESTED, html)])
  const product = entity(result, 'products', 'vm-product:3625')!
  assert.ok(product, JSON.stringify(result.unresolved))
  assert.equal(product.data.slug, '3625-maska-soprastek-corona')
  assert.equal(product.data.legacyPath, MASK)
  assert.equal(product.relations?.category, 'categories:category:80-maski-i-fajki/139-maski-nurkowe', 'last category in the breadcrumb trail')
  const masks = entity(result, 'categories', 'category:80-maski-i-fajki/139-maski-nurkowe')!
  assert.deepEqual(masks.data, { name: 'Maski nurkowe', slug: '80-maski-i-fajki/139-maski-nurkowe', legacyPath: '/80-maski-i-fajki/139-maski-nurkowe.html', published: true }, 'no vmId from the URL number')
  assert.equal(masks.relations?.parent, 'categories:category:80-maski-i-fajki')
  const top = entity(result, 'categories', 'category:80-maski-i-fajki')!
  assert.deepEqual(top.data, { name: 'Maski i fajki', slug: '80-maski-i-fajki', legacyPath: '/80-maski-i-fajki.html', published: true })
  assert.equal(top.relations, undefined, 'Sklep nurkowy is the shop, not a parent category')
  assert.equal(entity(result, 'categories', 'category:80-maski-i-fajki/140-fajki')?.relations?.parent, 'categories:category:80-maski-i-fajki')
  assert.ok(entity(result, 'categories', 'category:81-pletwy'))
  assert.equal(result.bundle.entities.filter(item => item.collection === 'categories').length, 4)
  const redirect = result.bundle.entities.find(item => item.collection === 'redirects')!
  assert.deepEqual([redirect.data.from, redirect.data.to], [MASK_NESTED, MASK])
})

test('a root-form address is a category only when shop navigation names it, never a product page', () => {
  const html = fixture('product-root-category.html')
  const listing = '<html><body><div class="portal-real-content"><div class="category-view"><h1>Maski i fajki</h1><input type="hidden" name="virtuemart_category_id" value="17"></div></div></body></html>'
  const unnamed = '<html><body><div class="portal-real-content"><div class="category-view"><h1>Nieznana</h1></div></div></body></html>'
  const blog = '<html><body><div class="breadcrumbs"><a href="/">Strona główna</a> <a href="/45-blog-klubowy.html">Blog</a></div><div class="portal-real-content"><article><h1>Wpis klubowy</h1><p>Treść wpisu.</p></article></div></body></html>'
  const result = convert([page(MASK, html), page('/80-maski-i-fajki.html', listing), page('/99-nieznana.html', unnamed), page('/45-blog-klubowy/7-wpis.html', blog)])
  assert.equal(result.counts.skipped['category-listing'], 1)
  assert.equal(entity(result, 'categories', 'category:80-maski-i-fajki')?.data.vmId, 17, 'vmId only from the listing input')
  assert.equal(result.bundle.entities.some(item => item.data.legacyPath === '/80-maski-i-fajki.html' && item.collection !== 'categories'), false)
  assert.equal(entity(result, 'categories', 'category:99-nieznana'), undefined)
  assert.ok(result.unresolved.some(item => item.code === 'no-main-content' && item.url === ORIGIN + '/99-nieznana.html'))
  assert.equal(entity(result, 'categories', 'category:45-blog-klubowy'), undefined, 'a trail that never enters the shop names no category')
  assert.ok(entity(result, 'pages', 'page:45-blog-klubowy/7-wpis.html'))

  // A menu entry pointing at a captured product page does not turn the product into a category.
  const linked = convert([page(MASK, html.replace('<a href="/81-pletwy.html">Płetwy</a>', `<a href="${MASK}">Maska</a>`))])
  assert.ok(entity(linked, 'products', 'vm-product:3625'))
  assert.equal(entity(linked, 'categories', 'category:3625-maska-soprastek-corona'), undefined)
  assert.ok(linked.unresolved.some(item => item.code === 'category-link-is-product-page'))

  // Without the shop in the trail and without the menu, a numeric root path is not a category.
  const bare = convert([page(MASK, html.replace(/<ul class="VMmenu">[\s\S]*?<\/ul>\s*<\/li>[\s\S]*?<\/ul>/, '').replace('<a href="/sklep-nurkowy.html">Sklep nurkowy</a>', ''))])
  assert.equal(bare.bundle.entities.length, 0)
  assert.ok(bare.unresolved.some(item => item.code === 'product-category-unresolved' && item.url === ORIGIN + MASK))
})

test('VirtueMart catalogue images are accepted by exact directory; other component assets are not', () => {
  const html = fixture('product-root-category.html')
  const result = convert([page(MASK, html)])
  const DIR = 'components/com_virtuemart_images/shop_image/product/'
  assert.deepEqual(result.media_urls.map(item => [item.path, item.targets.map((target: Record<string, string>) => target.field)]), [
    [DIR + 'maska_corona_detal.jpg', ['body']],
    [DIR + 'maska_corona_full.jpg', ['images']], // the full file behind the thumbnail link
    [DIR + 'resized/maska_corona_bok_90x90.jpg', ['images']], // no original shown: the thumbnail stays
  ])
  assert.equal(result.media_urls[1].url, ORIGIN + '/' + DIR + 'maska_corona_full.jpg')
  for (const leaked of ['RELATED-MARKER', 'CART-ICON-MARKER', 'shop_image/category', 'maska_corona_200x200']) assert.ok(!JSON.stringify(result.bundle).includes(leaked) && !JSON.stringify(result.media_urls).includes(leaked), leaked)
  assert.deepEqual(result.unresolved.filter(item => item.code === 'media-template-asset').map(item => item.detail).sort(), ['/components/com_virtuemart/themes/default/images/CART-ICON-MARKER.png', '/components/com_virtuemart_images/shop_image/category/maski.jpg'])

  const srcs = [
    '/components/com_virtuemart_images/shop_image/product/a.jpg',
    'http://underwater.pl/components/com_virtuemart/shop_image/product/resized/a_90x90.png',
    '/components/com_virtuemart_images/shop_image/product/a.php',
    '/components/com_virtuemart_images/shop_image/product/a.jpg.php',
    '/components/com_virtuemart_images/shop_image/product/../../../configuration.jpg',
    '/components/com_virtuemart_images/shop_image/product/%2e%2e/a.jpg',
    '/components/com_virtuemart_images/shop_image/product/a.jpg?w=90',
    '/Components/com_virtuemart_images/shop_image/product/a.jpg',
    '/components/com_virtuemart_images/shop_image/products/a.jpg',
    '/components/com_virtuemart/js/a.jpg',
    '/templates/underwater/images/product/a.jpg',
    'https://example.com/components/com_virtuemart_images/shop_image/product/a.jpg',
    'https://www.underwater.pl:8443/components/com_virtuemart_images/shop_image/product/a.jpg',
    '/components/com_virtuemart_images/shop_image/product/.a.jpg',
    '/components/com_virtuemart_images/shop_image/product//a.jpg',
  ]
  const reasons = python(`json.dump([module.media_ref(src, '${ORIGIN}${MASK}')[1] for src in request], sys.stdout)`, srcs)
  assert.deepEqual(reasons, [null, null, 'media-extension', 'media-extension', 'media-traversal', 'media-encoded-separator', 'media-query', 'media-template-asset', 'media-template-asset', 'media-template-asset', 'media-template-asset', 'media-external-host', 'media-port', 'media-hidden-or-empty-segment', 'media-hidden-or-empty-segment'])

  // Catalogue images outside the known holders are reported instead of attached to the product.
  const loose = convert([page(MASK, html.replace('class="main-image"', 'class="vm-image"').replace('class="additional-images"', 'class="vm-more"').replace(/class="product-image" src="\/components\/com_virtuemart_images\/shop_image\/product\/resized\/maska/, 'src="/components/com_virtuemart_images/shop_image/product/resized/maska'))])
  assert.equal(loose.media_urls.some(item => item.targets.some((target: Record<string, string>) => target.field === 'images')), false)
  assert.ok(loose.unresolved.some(item => item.code === 'product-images-outside-holder' && item.detail.startsWith('2 ')), JSON.stringify(loose.unresolved))
})

test('a course start date is taken only from one exact Warsaw-time sentence', () => {
  const phrase = (value: string) => `Opis. Najbliższy kurs rozpoczyna się: ${value} Zapraszamy.`
  const cases = [
    phrase('2026-10-12 o godz. 18:30.'), // CEST, UTC+2
    phrase('2026-12-01 o godz. 18:30'), // CET, UTC+1
    phrase('2026-03-29 o godz. 03:00'), // first valid minute after the spring gap
    phrase('2026-02-30 o godz. 18:30'),
    phrase('2026-10-12 o godz. 24:00'),
    phrase('2026-03-29 o godz. 02:30'), // skipped hour
    phrase('2026-10-25 o godz. 02:30'), // repeated hour
    phrase('12 października o godz. 18:30'),
    phrase('2026-10-12 o godz. 9:30'),
    phrase('2026-10-12 o godz. 18:30') + ' ' + phrase('2026-11-09 o godz. 18:30'),
    phrase('2026-10-12 o godz. 18:30') + ' Najbliższy kurs rozpoczyna się wkrótce.',
    'Kurs startuje 2026-10-12 o godz. 18:30.',
  ]
  const values: Array<[string | null, string | null]> = python('json.dump([module.course_next_date(text) for text in request], sys.stdout, ensure_ascii=False)', cases)
  assert.deepEqual(values.slice(0, 3).map(([value]) => value), ['2026-10-12T16:30:00.000Z', '2026-12-01T17:30:00.000Z', '2026-03-29T01:00:00.000Z'])
  for (const [value, reason] of values.slice(3, 11)) assert.ok(value === null && reason, JSON.stringify([value, reason]))
  assert.deepEqual(values[11], [null, null], 'no phrase, no date and no report')

  const ambiguous = convert([page(LEGACY_COURSE, fixture('course-legacy.html').replace('<p>Syntetyczny opis', '<p>Najbliższy kurs rozpoczyna się: 2026-11-09 o godz. 18:30.</p><p>Syntetyczny opis'))])
  const course = entity(ambiguous, 'courses', 'course:kurs-syntetyczny-ows')!
  assert.equal('nextDate' in course.data, false)
  assert.match(course.data.body, /2026-10-12 o godz. 18:30[\s\S]*2026-11-09 o godz. 18:30/, 'both sentences stay in the body')
  assert.ok(ambiguous.unresolved.some(item => item.code === 'course-date-not-imported' && item.key === course.key))
})

test('section paths and course overviews become pages that the application sections read', () => {
  const legacy = fixture('course-legacy.html')
  const result = convert([
    page('/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html', legacy),
    page('/kursy-nurkowania/kursy-nurkowania-techniczne.html', legacy.replace('kurs_ows_', 'kurs_tech_')),
    page('/wyprawy-nurkowe.html', fixture('article.html')),
    page('/relacje-z-wypraw.html', fixture('article.html').replace('Artykuł Testowy', 'Relacje Testowe')),
    page('/galeria.html', fixture('gallery.html').replace('<div class="phocagallery">', '<article><h1>Galerie testowe</h1><p>Wstęp.</p></article><div class="phocagallery">')),
    page('/wyprawy.html', fixture('article.html').replace('Artykuł Testowy', 'Wyprawy Testowe')),
  ])
  assert.equal(result.bundle.entities.some(item => item.collection !== 'pages'), false, 'no fake course, trip or album for a section path')
  for (const path of ['/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html', '/wyprawy-nurkowe.html', '/relacje-z-wypraw.html', '/galeria.html', '/wyprawy.html']) {
    const section = entity(result, 'pages', 'page:' + path.slice(1))!
    assert.ok(section, path)
    assert.equal(section.data.legacyPath, path)
    assert.equal(section.data.kind, 'page')
    assert.ok(result.unresolved.some(item => item.code === 'source-section-content' && item.url === ORIGIN + path), path)
  }
  assert.equal(entity(result, 'pages', 'page:kursy-nurkowania/kursy-nurkowania-padi-warszawa.html')!.data.title, 'Kurs Syntetyczny OPEN WATER (OWS)')
  assert.equal('nextDate' in entity(result, 'pages', 'page:kursy-nurkowania/kursy-nurkowania-padi-warszawa.html')!.data, false)
  assert.equal(entity(result, 'pages', 'page:galeria.html')!.data.title, 'Galerie testowe')
  assert.ok(entity(result, 'pages', 'page:kursy-nurkowania/kursy-nurkowania-techniczne.html'))
  assert.ok(result.unresolved.some(item => item.code === 'course-landing-page' && item.url === ORIGIN + '/kursy-nurkowania/kursy-nurkowania-techniczne.html'))
  assert.equal(codes(result).has('fixed-route-shadows-source-page'), false)
})

test('the bundle header is public-pages and never claims a complete source', async () => {
  const result = convert([
    page(PRODUCT, fixture('product.html')), page('/kursy-nurkowania/kurs-testowy-syntetyczny.html', fixture('course.html')),
    page(OWD, fixture('course-right-column.html')), page(MASK, fixture('product-root-category.html')), page(MASK_NESTED, fixture('product-root-category.html')),
  ])
  assert.equal(result.bundle.entities.filter(item => item.collection === 'products').length, 2)
  assert.deepEqual(result.bundle.source, { kind: 'public-pages', manifestHash: HASH, capturedAt: CAPTURED, complete: false })
  assert.equal(result.bundle.version, 1)
  const allowed = new Set(['categories', 'products', 'courses', 'course-sessions', 'pages', 'trips', 'albums', 'events', 'redirects'])
  for (const item of result.bundle.entities) {
    assert.ok(allowed.has(item.collection), item.collection)
    assert.equal(item.data.published, true)
    for (const field of ['id', 'password', 'role', 'accessTokenHash']) assert.equal(field in item.data, false)
  }
  // In the application repository this also checks the real import contract.
  const contract = new URL('../src/lib/import/bundle.ts', import.meta.url)
  if (existsSync(contract)) {
    const { validateBundle } = await import(contract.href)
    assert.doesNotThrow(() => validateBundle(result.bundle))
  }
  const invalid = spawnSync('python3', ['-c', `import importlib.util;spec=importlib.util.spec_from_file_location('p','${PARSER}');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.convert_pages([], 'yesterday', '${HASH}')`], { encoding: 'utf8', env })
  assert.notEqual(invalid.status, 0)
})

// The importer contract the parser mirrors (src/lib/import/bundle.ts). Checked here only when present.
async function contract(result: Result) {
  const file = new URL('../src/lib/import/bundle.ts', import.meta.url)
  if (!existsSync(file)) return
  const { validateBundle } = await import(file.href)
  assert.doesNotThrow(() => validateBundle(result.bundle))
}
const article = (title: string, body = '<p>Treść.</p>') => `<html><head><title>${title}</title></head><body><div class="portal-real-content"><article><h1>${title}</h1>${body}</article></div></body></html>`

test('route keys follow the importer: no leading or trailing slash, no .html in any case, NFC', () => {
  const cases = ['/x.html', '/x', '/x/', '/X.HTML', '/x.html/', '//a/b.Html', '/szczegół.html', '/x.htm']
  assert.deepEqual(python('json.dump([module.route_key(path) for path in request], sys.stdout, ensure_ascii=False)', cases), ['x', 'x', 'x', 'X', 'x', 'a/b', 'szczegół', 'x.htm'])
})

test('one product at /x.html and /x is one address: one record and no self-redirect', async () => {
  const html = fixture('product.html')
  const result = convert([page(PRODUCT, html), page(PRODUCT.replace(/\.html$/, ''), html), page(NESTED, html), page(NESTED.replace(/\.html$/, ''), html)])
  assert.equal(result.bundle.entities.filter(item => item.collection === 'products').length, 1)
  const redirects = result.bundle.entities.filter(item => item.collection === 'redirects')
  assert.deepEqual(redirects.map(item => [item.data.from, item.data.to]), [[decodeURIComponent(NESTED), PRODUCT]], 'one redirect per address, the .html form')
  assert.equal(result.counts.skipped['same-route-alias'], 2)
  await contract(result)
})

test('different records under /x and /x.html are dropped and reported; the rest of the bundle stays', async () => {
  const product = fixture('product.html')
  const result = convert([
    page(PRODUCT, product),
    page('/o-nas.html', article('O nas')),
    page('/o-nas', article('O nas inaczej')),
    // A page at the redirect's address (nested product path without .html) competes with the redirect.
    page(MASK, fixture('product-root-category.html')),
    page(MASK_NESTED, fixture('product-root-category.html')),
    page(MASK_NESTED.replace(/\.html$/, ''), article('Strona pod adresem przekierowania')),
    // A page at the product address without .html competes with the product itself.
    page('/2001-pianka-testowa.html', fixture('product-two-fields.html')),
    page('/2001-pianka-testowa', article('Pianka jako strona')),
  ])
  const keys = result.bundle.entities.map(item => `${item.collection}:${item.key}`)
  for (const gone of ['pages:page:o-nas.html', 'pages:page:o-nas', 'products:vm-product:2002', 'pages:page:2001-pianka-testowa', 'pages:page:' + MASK_NESTED.slice(1, -5)]) assert.ok(!keys.includes(gone), gone)
  assert.equal(result.bundle.entities.some(item => item.collection === 'redirects'), false)
  for (const kept of ['products:vm-product:1482', 'products:vm-product:3625']) assert.ok(keys.includes(kept), `unrelated records still import: ${kept}`)
  assert.ok(keys.some(key => key.startsWith('categories:')))
  const conflicts = result.unresolved.filter(item => item.code === 'conflicting-source-path').map(item => item.detail)
  for (const route of ["'o-nas'", "'2001-pianka-testowa'", "'80-maski-i-fajki/139-maski-nurkowe/3625-maska-soprastek-corona'"]) assert.ok(conflicts.some(detail => detail.startsWith('address ' + route)), route)
  await contract(result)
})

test('slugs follow the importer segment rule; only the affected record is skipped', async () => {
  const valid = ['a', 'maska-1', 'skrzydła_i~uprzęże', 'a.b', 'a/b', 'x'.repeat(200)]
  const invalid = ['', '.a', 'a,b', 'a(b)', 'a+b', 'a!b', 'a&b', 'a=b', 'a;b', 'a:b', 'a@b', 'a$b', 'a*b', "a'b", 'a//b', 'a/', 'a​b', 'x'.repeat(201), 'szczegół']
  assert.deepEqual(python('json.dump([module.valid_slug(slug) for slug in request], sys.stdout)', [...valid, ...invalid]), [...valid.map(() => true), ...invalid.map(() => false)])
  assert.deepEqual(python("json.dump([module.valid_slug('a/b', nested=False), module.valid_slug('a', nested=False)], sys.stdout)", null), [false, true])

  const result = convert([
    page('/1115-maska,testowa(2).html', fixture('product.html')),
    page('/kursy-nurkowania/kurs+testowy.html', fixture('course.html')),
    page('/o-nas,firma(1).html', article('O firmie')),
    page('/2001-pianka-testowa.html', fixture('product-two-fields.html')),
  ])
  const skipped = result.unresolved.filter(item => item.code === 'invalid-slug').map(item => item.url)
  assert.deepEqual(skipped.sort(), [ORIGIN + '/1115-maska,testowa(2).html', ORIGIN + '/kursy-nurkowania/kurs+testowy.html'])
  assert.ok(entity(result, 'products', 'vm-product:2002'), 'other products stay')
  assert.equal(entity(result, 'pages', 'page-sha256:' + createHash('sha256').update('o-nas,firma(1).html').digest('hex').slice(0, 40))?.data.path, '/o-nas,firma(1).html', 'a page has a path, not a slug: legacyPath allows these characters')
  await contract(result)
})

test('paths with invisible, control or encoded separator characters are not source paths', () => {
  const paths = ['/o-nas.html', '/o​nas.html', '/o%E2%80%8Bnas.html', '/o%C2%85nas.html', '/o%C2%9Cnas.html', '/a%2Fb.html', '/a%3Fb.html', '/a/./b.html', '/a//b.html', '/a/b/', '/o%20nas.html']
  assert.deepEqual(python('json.dump([module.safe_page_path(path) for path in request], sys.stdout, ensure_ascii=False)', paths), ['/o-nas.html', null, null, null, null, null, null, null, null, '/a/b/', null])
})

test('text over the importer limits skips the record; optional SEO and captions are left out, never cut', async () => {
  const long = (n: number) => 'x'.repeat(n)
  const product = fixture('product.html')
  const result = convert([
    page('/strona-500.html', article(long(500))),
    page('/strona-501.html', article(long(501))),
    page('/strona-c1.html', article('Tytuł\u009Cz kontrolką')),
    page('/1115-maska-testowa-syntetyczna.html', product.replace('<h1>Maska Testowa Syntetyczna</h1>', `<h1>${long(301)}</h1>`)),
    page('/2001-pianka-testowa.html', fixture('product-two-fields.html').replace(/<title>[^<]*<\/title>/, `<title>${long(301)}</title><meta name="description" content="${long(2001)}">`)),
    page('/strona-html.html', article('Za długa treść', `<p>${long(1_000_001)}</p>`)),
  ])
  assert.equal(entity(result, 'pages', 'page:strona-500.html')?.data.title, long(500))
  for (const path of ['/strona-501.html', '/strona-c1.html', '/1115-maska-testowa-syntetyczna.html', '/strona-html.html']) assert.ok(result.unresolved.some(item => item.code === 'field-invalid' && item.url === ORIGIN + path), path)
  assert.equal(entity(result, 'products', 'vm-product:1482'), undefined)
  assert.equal(result.bundle.entities.some(item => item.collection === 'pages' && item.data.title.length > 500), false)
  const foam = entity(result, 'products', 'vm-product:2002')!
  assert.ok(foam, 'too long SEO metadata does not drop the product')
  assert.equal('seo' in foam.data, false)
  assert.deepEqual(result.unresolved.filter(item => item.code === 'field-omitted' && item.key === 'vm-product:2002').map(item => item.detail.split(':')[0]).sort(), ['seo.description', 'seo.title'])
  assert.equal('title' in (entity(result, 'pages', 'page:strona-500.html')!.data.seo ?? {}), false, 'a 500-character <title> is over the SEO limit of 300')
  await contract(result)
})

test('short text, image counts, photo captions and alt texts are checked against the importer limits', async () => {
  const product = fixture('product.html')
  const shortLong = convert([page(PRODUCT, product.replace('Krótki syntetyczny opis maski.', 'x'.repeat(5001)))])
  assert.equal(entity(shortLong, 'products', 'vm-product:1482'), undefined)
  assert.ok(shortLong.unresolved.some(item => item.code === 'field-invalid' && item.detail.includes('short')))

  const images = Array.from({ length: 501 }, (_, index) => `<img class="product-image" src="/images/stories/virtuemart/product/p${index}.jpg" alt="">`).join('')
  const many = convert([page(PRODUCT, product.replace('<div class="product-price"', `<div class="additional-images">${images}</div><div class="product-price"`))])
  assert.equal(entity(many, 'products', 'vm-product:1482'), undefined)
  assert.ok(many.unresolved.some(item => item.code === 'field-invalid' && item.detail.includes('images: 50')), JSON.stringify(many.unresolved.map(item => item.detail)))

  const gallery = fixture('gallery.html')
  const photos = Array.from({ length: 2001 }, (_, index) => `<img src="/images/phocagallery/album/n${index}.jpg" alt="">`).join('')
  const album = convert([page('/galeria/album-duzy.html', gallery.replace('<div class="phocagallery">', `<div class="phocagallery">${photos}`))])
  assert.equal(album.bundle.entities.length, 0)
  assert.ok(album.unresolved.some(item => item.code === 'field-invalid' && item.detail.includes('photos: 2003')), JSON.stringify(album.unresolved.map(item => item.detail)))

  const captioned = convert([page('/galeria/album-testowy.html', gallery.replace('title="Rafa koralowa"', `title="${'r'.repeat(1001)}"`)), page(PRODUCT, product.replace('alt="Szczegół"', `alt="${'a'.repeat(1001)}"`))])
  const kept = entity(captioned, 'albums', 'album:galeria/album-testowy.html')!
  assert.ok(kept)
  const first = captioned.media_urls.find(item => item.path === 'images/phocagallery/album/zdjecie-1.jpg')!
  assert.equal(first.targets[0].caption, '', 'the over-long caption stays empty')
  assert.equal(first.alt, '')
  assert.equal(captioned.media_urls.find(item => item.path === 'images/opisy/maska-szczegół.jpg')!.alt, '')
  assert.ok(entity(captioned, 'products', 'vm-product:1482')!.data.body.includes('a'.repeat(1001)), 'the body keeps the source alt text')
  const omitted = captioned.unresolved.filter(item => item.code === 'field-omitted').map(item => item.detail.split(' of ')[0]).sort()
  assert.deepEqual(omitted, ['alt text', 'photo caption'])
  for (const item of captioned.media_urls) assert.ok(item.alt.length <= 1000)
  await contract(captioned)
})

test('one image written in NFC and NFD form is one media identity', () => {
  const nfc = '/images/opisy/szczeg%C3%B3%C5%82.jpg'
  const nfd = '/images/opisy/szczego%CC%81%C5%82.jpg'
  const html = article('Zdjęcia', `<p><img src="${nfc}" alt="NFC"> <img src="${nfd}" alt="NFD"></p>`)
  const result = convert([page('/zdjecia.html', html), page('/inne.html', article('Inne', `<p><img src="${nfd}" alt="NFD"></p>`))])
  assert.equal(result.media_urls.length, 1)
  const item = result.media_urls[0]
  assert.equal(item.path, 'images/opisy/szczegół'.normalize('NFC') + '.jpg')
  assert.equal(item.key, 'public-image:' + createHash('sha256').update(item.path, 'utf8').digest('hex').slice(0, 40))
  assert.deepEqual([item.url, ...(item.alternateUrls ?? [])].sort(), [ORIGIN + nfc, ORIGIN + nfd].sort(), 'both referenced forms stay downloadable')
  assert.deepEqual(item.targets.map((target: Record<string, string>) => target.key).sort(), ['page:inne.html', 'page:zdjecia.html'])
  const reasons = python(`json.dump([module.media_ref(src, '${ORIGIN}/')[1] for src in request], sys.stdout)`, ['/images/a%E2%80%8Bb.jpg', '/images/a%C2%9Cb.jpg', '/images/a%3Fb.jpg', '/images/a%2523.jpg'])
  assert.deepEqual(reasons, ['media-unsafe', 'media-unsafe', 'media-encoded-separator', 'media-unsafe'])
})

test('own-site component query links and direct file links keep their text and are reported', async () => {
  const links = [
    '<a href="/index.php?option=com_virtuemart&amp;view=cart&amp;Itemid=5">koszyk</a>',
    '<a href="https://www.underwater.pl/index.php?option=com_content&amp;view=article&amp;id=12&amp;Itemid=3">artykuł 12</a>',
    '<a href="index.php?option=com_mailto&amp;tmpl=component&amp;link=c2VjcmV0">poleć znajomemu</a>',
    '<a href="/sklep-nurkowy.html?task=checkout&amp;token=SECRET-TOKEN">zamów</a>',
    '<a href="/images/stories/cennik.pdf">cennik</a>',
    '<a href="/administrator/index.php">panel</a>',
    '<a href="/images/stories/duze.jpg">zdjęcie w pełnym rozmiarze</a>',
    '<a href="/images/stories/duze.jpg"><img src="/images/stories/male.jpg" alt="miniatura"></a>',
    '<a href="/kontakt.html#mapa">kontakt</a>',
    '<a href="/index.php">start</a>',
    '<a href="/kursy-nurkowania/">kursy</a>',
    '<a href="https://example.org/zrodlo?a=1">źródło</a>',
    '<a href="mailto:biuro@example.org">napisz</a>',
    '<a href="javascript:submitForm()">wyślij</a>',
  ]
  const result = convert([page('/linki.html', article('Linki', `<p>${links.join(' ')}</p>`))])
  const body: string = entity(result, 'pages', 'page:linki.html')!.data.body
  for (const kept of ['<a href="/kontakt.html#mapa">kontakt</a>', '<a href="/">start</a>', '<a href="/kursy-nurkowania/">kursy</a>', '<a href="https://example.org/zrodlo?a=1">źródło</a>', '<a href="mailto:biuro@example.org">napisz</a>']) assert.ok(body.includes(kept), kept)
  for (const text of ['koszyk', 'artykuł 12', 'poleć znajomemu', 'zamów', 'cennik', 'panel', 'zdjęcie w pełnym rozmiarze', 'wyślij']) {
    assert.ok(body.includes(text), text)
    assert.doesNotMatch(body, new RegExp(`<a [^>]*>${text}</a>`), text)
  }
  for (const leaked of ['index.php?', 'option=', 'com_mailto', 'c2VjcmV0', 'SECRET-TOKEN', 'task=', 'cennik.pdf', 'administrator', 'javascript', 'duze.jpg">']) assert.ok(!body.includes(leaked), leaked)
  assert.match(body, /<img src="https:\/\/www.underwater.pl\/images\/stories\/duze.jpg" alt="miniatura">/, 'a lightbox thumbnail is converted, not reported')
  const reported = result.unresolved.filter(item => item.code === 'internal-link-unresolvable')
  assert.deepEqual(reported.map(item => item.detail.split(' text: ')[1]).sort(), ['artykuł 12', 'cennik', 'koszyk', 'panel', 'poleć znajomemu', 'zamów', 'zdjęcie w pełnym rozmiarze'].sort())
  assert.ok(reported.every(item => item.key === 'page:linki.html' && item.url === ORIGIN + '/linki.html'))
  assert.ok(reported.some(item => item.detail.startsWith('https://www.underwater.pl/index.php query: Itemid, option, view (option=com_virtuemart)')), JSON.stringify(reported))
  for (const leaked of ['SECRET-TOKEN', 'c2VjcmV0', 'id=12', 'cart']) assert.ok(!JSON.stringify(result.unresolved).includes(leaked), leaked)
  await contract(result)
})

const MASK_SELF = '/80-maski-i-fajki/139-maski-nurkowe/3625-maska-soprastek-corona.html'

test('a breadcrumb link to the product\'s own short address never becomes a category', async () => {
  const html = fixture('product-breadcrumb-self.html')
  const check = (variant: string, why: string) => {
    const result = convert([page(MASK_SELF, variant)])
    const product = entity(result, 'products', 'vm-product:3625')
    assert.ok(product, `${why}: ${JSON.stringify(result.unresolved)}`)
    assert.equal(product.relations?.category, 'categories:category:80-maski-i-fajki/139-maski-nurkowe', why)
    assert.equal(product.data.legacyPath, MASK_SELF)
    assert.deepEqual(result.bundle.entities.filter(item => item.collection === 'categories').map(item => item.key).sort(), ['category:80-maski-i-fajki', 'category:80-maski-i-fajki/139-maski-nurkowe'], why)
    assert.equal(result.bundle.entities.some(item => item.collection === 'redirects'), false, 'nothing is guessed for the uncaptured short address')
    return result
  }
  await contract(check(html, 'canonical and label'))
  check(html.replace(/<link rel="canonical"[^>]*>/, ''), 'label equal to the product h1')
  check(html.replace('>Maska Soprastek Corona</a>', '>Corona</a>'), 'canonical address')
})

test('the CLI reads and writes local JSON only and keeps the output private', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'underwater-parser-'))
  try {
    const input = path.join(dir, 'pages.json'), output = path.join(dir, 'bundle.json')
    writeFileSync(input, JSON.stringify({ pages: [page(PRODUCT, fixture('product.html'))], capturedAt: CAPTURED, manifestHash: HASH }))
    const first = spawnSync('python3', [PARSER, input, output], { encoding: 'utf8', env })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(statSync(output).mode & 0o777, 0o600)
    const written = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(written.bundle.source.complete, false)
    assert.ok(!first.stdout.includes('Syntetyczny opis'), 'stdout carries counts, not content')
    const again = spawnSync('python3', [PARSER, input, output], { encoding: 'utf8', env })
    assert.notEqual(again.status, 0, 'existing output is not overwritten without --force')
    const envPath = spawnSync('python3', [PARSER, path.join(dir, '.env'), output, '--force'], { encoding: 'utf8', env })
    assert.notEqual(envPath.status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('different legacy form tokens do not discard identical public product content', async () => {
  const html = fixture('product.html')
  const tokenA = html.replace('</body>', '<form><input name="synthetic-token" value="a"></form></body>')
  const tokenB = html.replace('</body>', '<form><input name="synthetic-token" value="b"></form></body>')
  const result = convert([page(PRODUCT, tokenA), page(PRODUCT, tokenB)])
  assert.equal(result.bundle.entities.filter(item => item.collection === 'products').length, 1)
  assert.equal(codes(result).has('conflicting-source-content'), false)
  await contract(result)
})

test('legacy news heading inside the verified main column imports only the single article', async () => {
  const article = '<div class="article-content"><div class="nsp_art"><h2 class="nsp_header">Serwis testowy</h2><p>Właściwa treść artykułu.</p></div></div>'
  const markup = '<html><body><div class="portal-real-content"><div class="left-sitebar"><h2>Nie importować</h2></div><div class="fr right-sitebar">' + article + '<div class="moduletable">Obcy moduł</div></div></div></body></html>'
  const result = convert([page('/aktualnosci/serwis-testowy.html', markup)])
  const item = result.bundle.entities.find(item => item.collection === 'pages')!
  assert.equal(item.data.title, 'Serwis testowy')
  assert.equal(item.data.kind, 'news')
  assert.ok(item.data.body.includes('Właściwa treść'))
  assert.equal(item.data.body.includes('Obcy moduł'), false)
  const blog = markup.replace(article, article + article.replace('Serwis testowy', 'Inny artykuł'))
  const ambiguous = convert([page('/aktualnosci/niejednoznaczny.html', blog)])
  assert.equal(ambiguous.bundle.entities.some(item => item.collection === 'pages'), false)
  assert.ok(codes(ambiguous).has('ambiguous-main-content'))
  await contract(result)
})

test('the observed PADI specialty route uses the course collection and preserves its source address', async () => {
  const result = convert([page('/kursy-specjalizacji-nurkowych-padi/kurs-nurkowania-padi-night-diver.html', fixture('course.html'))])
  const item = result.bundle.entities.find(item => item.collection === 'courses')!
  assert.ok(item)
  assert.equal(item.data.legacyPath, '/kursy-specjalizacji-nurkowych-padi/kurs-nurkowania-padi-night-diver.html')
  await contract(result)
})


test('JEvents calendar cells import literal dates and times without invented quotas or ambiguous DST', async () => {
  const cell = (day: string, name: string) => '<td><a class="cal_daylink" href="/kalendarz/eventsbyday/' + day + '/-.html">dzień</a><a class="cal_titlelink" href="/kalendarz/eventdetail/10/-/kurs-testowy.html">' + name + '</a></td>'
  const markup = '<html><body><div class="jeventpage"><table><tr>' + cell('2026/10/12', '18:30 Kurs testowy') + cell('2026/10/25', '02:30 Niepewna godzina') + '</tr></table></div></body></html>'
  const result = convert([page('/kalendarz.html', markup)])
  const events = result.bundle.entities.filter(item => item.collection === 'events')
  assert.equal(events.length, 1)
  assert.equal(events[0].data.title, 'Kurs testowy')
  assert.equal(events[0].data.startsAt, '2026-10-12T16:30:00.000Z')
  assert.equal(events[0].data.endsAt, undefined)
  assert.equal(events[0].data.capacity, undefined)
  assert.ok(codes(result).has('calendar-event-unresolved'))
  await contract(result)
})


test('the verified JEvents week grid creates one start for a multi-day event', async () => {
  const headers = Array.from({ length: 7 }, (_, index) => '<div class="jev_daynum"><a class="cal_daylink" href="/kalendarz/eventsbyday/2026/10/' + (index + 1) + '/-.html">' + (index + 1) + '</a></div>').join('')
  const event = '<a class="cal_titlelink" href="/kalendarz/eventdetail/10/-/wyjazd.html">16:00 Wyjazd testowy</a>'
  const blocks = '<div class="jev_daynoevents jevblocks1"></div><div class="jev_daynoevents jevblocks3">' + event + '</div><div class="jev_daynoevents jevblocks3"></div><div class="jev_daynoevents jevblocks0"></div>'
  const markup = '<html><body><table><tr><td class="jevdaydata"><div class="jevdaydata">' + headers + '</div><div class="jeveventrow slots2">' + blocks + '</div></td></tr></table></body></html>'
  const result = convert([page('/kalendarz.html', markup)])
  const events = result.bundle.entities.filter(item => item.collection === 'events')
  assert.equal(events.length, 1)
  assert.equal(events[0].data.startsAt, '2026-10-02T14:00:00.000Z')
  assert.equal(events[0].data.endsAt, undefined)
  const invalid = convert([page('/kalendarz.html', markup.replace('jevblocks1', 'jevblocks2'))])
  assert.equal(invalid.bundle.entities.some(item => item.collection === 'events'), false)
  await contract(result)
})

test('changed SEO on the same captured address stays a conflict', () => {
  const html = fixture('product.html')
  const changed = html.replace(/(<meta name="description" content=")[^"]*/, '$1Zmiana metadanych')
  const result = convert([page(PRODUCT, html), page(PRODUCT, changed)])
  assert.equal(result.bundle.entities.some(item => item.collection === 'products'), false)
  assert.ok(codes(result).has('conflicting-page-metadata'))
})


test('literal monthly calendar replaces prose calendar entries while course booking sessions remain', async () => {
  const course = fixture('course-legacy.html')
  const calendar = '<html><body><table><tr><td><a class="cal_daylink" href="/kalendarz/eventsbyday/2026/10/12/-.html">12</a><a class="cal_titlelink" href="/kalendarz/eventdetail/10/-/kurs-testowy.html">18:30 Dosłowna nazwa z kalendarza</a></td></tr></table></body></html>'
  const result = convert([page('/kursy-nurkowania/kurs-syntetyczny-ows.html', course), page('/kalendarz.html', calendar)])
  assert.equal(result.bundle.entities.filter(item => item.collection === 'course-sessions').length, 1)
  const events = result.bundle.entities.filter(item => item.collection === 'events')
  assert.equal(events.length, 1)
  assert.equal(events[0].data.title, 'Dosłowna nazwa z kalendarza')
  await contract(result)
})

test('verified Phoca folders preserve child links and thumbnails instead of becoming empty albums', async () => {
  const folder = '<h1>Folder syntetyczny</h1><div id="phocagallery" class="pg-category-view"><div class="phocagallery-box-file pg-box-subfolder"><a href="/galeria/album-syntetyczny.html"><img src="/images/phocagallery/folder/thumbs/mini.jpg" alt=""><span>Album testowy</span></a></div></div>'
  const result = convert([page('/galeria/folder-syntetyczny.html', folder), page('/galeria.html', folder)])
  const folders = result.bundle.entities.filter(item => item.collection === 'pages')
  assert.equal(folders.length, 2)
  assert.equal(result.bundle.entities.some(item => item.collection === 'albums'), false)
  for (const item of folders) {
    assert.equal(item.data.title, 'Folder syntetyczny')
    assert.match(item.data.body, /href="\/galeria\/album-syntetyczny.html"/)
    assert.match(item.data.body, /Album testowy/)
    assert.match(item.data.body, /mini.jpg/)
  }
  assert.equal(result.media_urls.length, 1)
  await contract(result)
})
