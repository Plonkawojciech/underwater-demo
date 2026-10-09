import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { getPayload, type CollectionSlug, type Payload } from 'payload'
import { importBundle, ImportError } from '../src/lib/import/service'
import { transaction } from '../src/lib/commerce/transaction'

// Synthetic data only, in a private temporary database and media directory.
const root = mkdtempSync(path.join(tmpdir(), 'underwater-import-'))
const sourceRoot = path.join(root, 'source')
mkdirSync(path.join(root, 'media'))
mkdirSync(path.join(sourceRoot, 'images'), { recursive: true })
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-import-test-secret-not-used-in-runtime' })
let payload: Payload
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const images: Record<string, Buffer> = {}
const tracked: CollectionSlug[] = ['categories', 'products', 'courses', 'course-sessions', 'pages', 'trips', 'albums', 'events', 'redirects', 'media', 'documents', 'import-runs']
async function snapshot() {
  const counts = await Promise.all(tracked.map(async collection => [collection, (await payload.count({ collection, overrideAccess: true })).totalDocs]))
  const settings = await payload.findGlobal({ slug: 'settings', depth: 0, overrideAccess: true })
  return { counts: Object.fromEntries(counts), settings: settings.updatedAt ?? null }
}
const one = async (collection: CollectionSlug, legacyKey: string) => (await payload.find({ collection, where: { legacyKey: { equals: legacyKey } }, depth: 0, overrideAccess: true })).docs[0] as unknown as Record<string, any> & { id: number }
type Result = Awaited<ReturnType<typeof importBundle>>
type Live = Extract<Result, { dryRun: false }>
type Dry = Extract<Result, { dryRun: true }>
function run(bundle: unknown, options: { verifiedSourceManifestHash?: string; leaseMs?: number } = {}): Promise<Live> { return importBundle(payload, bundle, sourceRoot, { ...options, dryRun: false }) as Promise<Live> }
function dryRun(bundle: unknown): Promise<Dry> { return importBundle(payload, bundle, sourceRoot, { dryRun: true }) as Promise<Dry> }
const clone = <T>(value: T): T => structuredClone(value)

/** A small, valid public-capture bundle; `p` namespaces keys, slugs and paths per test. */
function fixture(p: string, kind = 'public-pages', complete = false) {
  return {
    version: 1,
    source: { kind, manifestHash: 'b'.repeat(64), capturedAt: '2026-10-08T00:00:00Z', complete },
    media: [
      { key: `${p}-img-1`, path: 'images/one.png', sha256: sha(images.one), alt: 'Syntetyczny obraz', url: `https://www.underwater.pl/images/${p}/one.png` },
      { key: `${p}-img-2`, path: 'images/two.png', sha256: sha(images.two), url: `/images/${p}/two.png` },
    ],
    mediaUrls: [] as Array<{ key: string; url: string }>,
    entities: [
      { collection: 'categories', key: `${p}-cat-1`, data: { name: 'Kategoria', slug: `${p}-1-kategoria`, vmId: 10, published: true, legacyPath: `/sklep-nurkowy/${p}-1-kategoria.html` } },
      { collection: 'categories', key: `${p}-cat-2`, data: { name: 'Podkategoria', slug: `${p}-2-pod`, published: true }, relations: { parent: `categories:${p}-cat-1`, image: `media:${p}-img-1` } },
      { collection: 'products', key: `${p}-prod`, data: { name: 'Produkt testowy', slug: `${p}-1115-produkt`, vmId: 1482, priceCents: 29900, published: true, body: `<p>Opis <img src="/images/${p}/one.png"></p>`, variants: [{ label: 'M', legacyKey: 'v-m', stock: 3 }, { label: 'L', legacyKey: 'v-l', image: `media:${p}-img-2` }], seo: { title: 'SEO', image: `media:${p}-img-1` } }, relations: { category: `categories:${p}-cat-2`, categories: [`categories:${p}-cat-1`, `categories:${p}-cat-2`], images: [`media:${p}-img-1`, `media:${p}-img-2`] } },
      { collection: 'products', key: `${p}-simple`, data: { name: 'Bez wariantów', slug: `${p}-1116-prosty`, vmId: 1483, price: 10, published: true }, relations: { category: `categories:${p}-cat-1` } },
      { collection: 'courses', key: `${p}-course`, data: { name: 'Kurs', slug: `${p}-kurs`, published: true }, relations: { image: `media:${p}-img-2` } },
      { collection: 'course-sessions', key: `${p}-session`, data: { title: 'Termin', startsAt: '2099-01-01T10:00:00Z', capacity: 4, published: true }, relations: { course: `courses:${p}-course` } },
      { collection: 'albums', key: `${p}-album`, data: { title: 'Galeria', path: `/galerie/${p}.html`, published: true, photos: [{ image: `media:${p}-img-1`, caption: 'Podpis' }] } },
      { collection: 'pages', key: `${p}-page`, data: { title: 'Zażółć', path: `/aktualności/${p}-zażółć.html`.normalize('NFD'), kind: 'news', published: true, body: '<p>Treść</p>' }, relations: { album: `albums:${p}-album` } },
      { collection: 'trips', key: `${p}-trip`, data: { title: 'Wyprawa', path: `/wyprawy-nurkowe/${p}.html`, published: false } },
      { collection: 'events', key: `${p}-event`, data: { title: 'Wydarzenie', startsAt: '2099-01-01T10:00:00Z', published: true }, relations: { courseSession: `course-sessions:${p}-session`, trip: `trips:${p}-trip` } },
      { collection: 'redirects', key: `${p}-redirect`, data: { from: `/${p}-stara.html`, to: `/aktualności/${p}-zażółć.html`, published: true } },
    ] as Array<{ collection: string; key: string; data: Record<string, any>; relations?: Record<string, any> }>,
    settings: undefined as Record<string, unknown> | undefined,
  }
}
const entity = (bundle: ReturnType<typeof fixture>, key: string) => bundle.entities.find(item => item.key === key)!
// Unique vmIds per namespace keep fixtures independent within one database.
let vm = 0
function fresh(p: string, kind?: string, complete?: boolean) {
  const bundle = fixture(p, kind, complete)
  for (const item of bundle.entities) if (item.data.vmId) item.data.vmId = item.data.vmId * 1000 + ++vm
  return bundle
}

test.before(async () => {
  images.one = await sharp({ create: { width: 6, height: 4, channels: 3, background: '#0b3d5c' } }).png().toBuffer()
  images.two = await sharp({ create: { width: 4, height: 6, channels: 3, background: '#c9a227' } }).png().toBuffer()
  images.three = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#ffffff' } }).png().toBuffer()
  writeFileSync(path.join(sourceRoot, 'images/one.png'), images.one)
  writeFileSync(path.join(sourceRoot, 'images/two.png'), images.two)
  writeFileSync(path.join(sourceRoot, 'images/three.png'), images.three)
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

test('a verified Joomla dump is the only source that can complete a run', async () => {
  // Runs first, on an empty database, so the full-dump reconciliation sees only its own records.
  const dump = fresh('dump', 'joomla-dump', true)
  const first = await run(dump)
  assert.equal(first.status, 'needs-review'); assert.equal(first.sourceComplete, false); assert.equal(first.sourceVerification, 'manifest-not-verified')
  assert.equal((await run(dump, { verifiedSourceManifestHash: 'c'.repeat(64) })).sourceVerification, 'manifest-mismatch')
  const verified = await run(dump, { verifiedSourceManifestHash: 'b'.repeat(64) })
  assert.deepEqual(verified.unresolved, [])
  assert.equal(verified.status, 'complete'); assert.equal(verified.sourceComplete, true)
  assert.equal((await payload.find({ collection: 'import-runs', where: { runKey: { equals: verified.runKey } }, overrideAccess: true })).docs[0].status, 'complete')
  for (const kind of ['public-pages', 'demo']) {
    const claimed = { ...clone(dump), source: { ...dump.source, kind } }
    const result = await run(claimed, { verifiedSourceManifestHash: 'b'.repeat(64) })
    assert.equal(result.status, 'needs-review'); assert.equal(result.sourceComplete, false); assert.equal(result.sourceVerification, 'not-a-database-dump')
  }
  // A full dump must account for imported records it no longer contains.
  const smaller = clone(dump); smaller.entities = smaller.entities.filter(item => item.collection !== 'redirects')
  const partial = await run(smaller, { verifiedSourceManifestHash: 'b'.repeat(64) })
  assert.equal(partial.status, 'needs-review')
  assert.equal(partial.sourceComplete, false)
  assert.ok(partial.unresolved.includes('not-in-bundle:redirects:dump-redirect'))
})

test('malformed DTOs and foreign collisions are rejected with zero writes, also in dry run', async () => {
  const before = await snapshot()
  const cases: Array<[string, (bundle: ReturnType<typeof fixture>) => void]> = [
    ['category relation to a page', b => { entity(b, 'm-prod').relations!.category = 'pages:m-page' }],
    ['category relation to media', b => { entity(b, 'm-prod').relations!.category = 'media:m-img-1' }],
    ['single relation as list', b => { entity(b, 'm-session').relations!.course = ['courses:m-course'] }],
    ['many relation as string', b => { entity(b, 'm-prod').relations!.images = 'media:m-img-1' }],
    ['numeric nested media id', b => { entity(b, 'm-prod').data.variants[0].image = 5 }],
    ['source variant row id', b => { entity(b, 'm-prod').data.variants[0].id = 'abc' }],
    ['protected field', b => { entity(b, 'm-session').data.reserved = 0 }],
    ['bookkeeping field', b => { entity(b, 'm-page').data.sourceHash = 'x' }],
    ['missing price', b => { delete entity(b, 'm-simple').data.price }],
    ['missing required relation', b => { delete entity(b, 'm-session').relations!.course }],
    ['missing page kind', b => { delete entity(b, 'm-page').data.kind }],
    ['implicit publication', b => { delete entity(b, 'm-trip').data.published }],
    ['capacity zero', b => { entity(b, 'm-session').data.capacity = 0 }],
    ['unparseable date', b => { entity(b, 'm-event').data.startsAt = 'jutro' }],
    ['encoded slash path', b => { entity(b, 'm-trip').data.path = '/a%2Fb.html' }],
    ['duplicate public address', b => { entity(b, 'm-trip').data.path = entity(b, 'm-album').data.path }],
    ['duplicate slug', b => { entity(b, 'm-simple').data.slug = entity(b, 'm-prod').data.slug }],
    ['duplicate variant key', b => { entity(b, 'm-prod').data.variants[1].legacyKey = 'v-m' }],
    ['category cycle', b => { entity(b, 'm-cat-1').relations = { parent: 'categories:m-cat-2' } }],
    ['unknown settings field', b => { b.settings = { deliveryMethods: [] } }],
    ['mistyped setting', b => { b.settings = { phone: 48 } }],
    ['tampered media bytes', b => { b.media[0].sha256 = sha(images.three) }],
    ['media outside snapshot', b => { b.media[0].path = '../underwater-test.db' }],
  ]
  for (const [name, mutate] of cases) {
    const bundle = fresh('m'); mutate(bundle)
    await assert.rejects(run(bundle), ImportError, name)
    await assert.rejects(dryRun(bundle), ImportError, name)
  }
  // A staff-created record without a source key already owns the address.
  const staff = await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'Ręczna', slug: 'm-1-kategoria', published: true } })
  const baseline = await snapshot()
  await assert.rejects(run(fresh('m')), /collide/)
  await assert.rejects(dryRun(fresh('m')), /collide/)
  assert.deepEqual(await snapshot(), baseline)
  await payload.delete({ collection: 'categories', id: staff.id, overrideAccess: true })
  assert.deepEqual(await snapshot(), { ...before, settings: before.settings })
})

test('public capture maps typed relations, media and HTML but never claims completeness', async () => {
  const bundle = fresh('a', 'public-pages', true)
  entity(bundle, 'a-prod').data.body += '<img src="https://cdn.example.com/x.jpg"><img src="images/a/missing.jpg"><script>alert(1)</script>'
  bundle.mediaUrls = [{ key: 'a-not-downloaded', url: '/images/a/missing.jpg' }]
  bundle.settings = { phone: '+48 000 000 000' }
  const dry = await dryRun(bundle)
  assert.equal(dry.plan.created, bundle.entities.length); assert.equal(dry.sourceComplete, false)
  assert.ok(dry.unresolved.includes('html-image-external:products:a-prod:cdn.example.com'))
  assert.ok(dry.unresolved.includes('html-image-not-downloaded:products:a-prod:a-not-downloaded'))

  const result = await run(bundle)
  assert.equal(result.status, 'needs-review'); assert.equal(result.sourceComplete, false); assert.equal(result.sourceVerification, 'not-a-database-dump')
  assert.equal(result.counts.created, bundle.entities.length); assert.equal(result.counts.mediaCreated, 2)
  assert.deepEqual(dry.unresolved, result.unresolved)
  const [img1, img2] = [await one('media', 'a-img-1'), await one('media', 'a-img-2')]
  assert.equal(sha(readFileSync(path.join(root, 'media', img1.filename))), sha(images.one))
  const [cat1, cat2] = [await one('categories', 'a-cat-1'), await one('categories', 'a-cat-2')]
  const product = await one('products', 'a-prod')
  assert.equal(cat2.parent, cat1.id); assert.equal(cat2.image, img1.id)
  assert.equal(product.category, cat2.id); assert.deepEqual(product.categories, [cat1.id, cat2.id]); assert.deepEqual(product.images, [img1.id, img2.id])
  assert.equal(product.seo.image, img1.id); assert.equal(product.variants[1].image, img2.id)
  assert.deepEqual(product.variants.map((variant: any) => variant.stock), [3, null])
  assert.equal(product.stock, null, 'an unknown variant stock is not invented as zero')
  assert.equal((await one('products', 'a-simple')).stock, null)
  assert.match(product.body, new RegExp(`<img src="/api/media/file/${img1.filename}"`))
  assert.doesNotMatch(product.body, /script|cdn\.example|missing\.jpg/)
  const page = await one('pages', 'a-page'), album = await one('albums', 'a-album'), session = await one('course-sessions', 'a-session')
  assert.equal(page.path, '/aktualności/a-zażółć.html'); assert.equal(page.album, album.id)
  assert.deepEqual(album.photos.map((row: any) => [row.image, row.caption]), [[img1.id, 'Podpis']])
  assert.equal(session.course, (await one('courses', 'a-course')).id)
  const event = await one('events', 'a-event')
  assert.equal(event.courseSession, session.id); assert.equal(event.trip, (await one('trips', 'a-trip')).id)
  assert.equal((await payload.findGlobal({ slug: 'settings', overrideAccess: true })).phone, '+48 000 000 000')

  const counts = await snapshot()
  const again = await run(bundle)
  assert.equal(again.counts.created, 0); assert.equal(again.counts.updated, 0)
  assert.equal(again.counts.unchanged, bundle.entities.length); assert.equal(again.counts.mediaExisting, 2)
  assert.deepEqual((await snapshot()).counts, counts.counts)
  // Settings have no provenance: a different source value never overwrites the stored one.
  const changed = clone(bundle); changed.settings = { phone: '+48 111 111 111' }
  assert.ok((await run(changed)).unresolved.includes('settings-conflict:phone'))
  assert.equal((await payload.findGlobal({ slug: 'settings', overrideAccess: true })).phone, '+48 000 000 000')
})

test('staff edits are preserved; reservations are not edits and keep live stock and row ids', async () => {
  const bundle = fresh('e')
  await run(bundle)
  const product = await one('products', 'e-prod')
  await payload.update({ collection: 'products', id: product.id, overrideAccess: true, data: { name: 'Nazwa poprawiona w panelu' } })
  assert.equal((await run(bundle)).counts.preserved, 1)
  const renamed = clone(bundle); entity(renamed, 'e-prod').data.name = 'Nowa nazwa ze źródła'
  const conflict = await run(renamed)
  assert.ok(conflict.unresolved.includes('manual-edit:products:e-prod'))
  assert.ok((await dryRun(renamed)).unresolved.includes('manual-edit:products:e-prod'))
  assert.equal((await one('products', 'e-prod')).name, 'Nazwa poprawiona w panelu')

  // Simulate checkout and signup activity through the trusted services.
  const simple = await one('products', 'e-simple')
  assert.equal(simple.stock, null)
  const reserved = await one('products', 'e-prod')
  const variants = reserved.variants.map((variant: any) => ({ ...variant, stock: variant.legacyKey === 'v-m' ? 1 : 7 }))
  await transaction(payload, 'reservation-service', req => payload.update({ collection: 'products', id: reserved.id, req, data: { variants } }))
  const session = await one('course-sessions', 'e-session')
  await transaction(payload, 'reservation-service', req => payload.update({ collection: 'course-sessions', id: session.id, req, data: { reserved: 3 } }))
  const updated = clone(bundle)
  entity(updated, 'e-session').data.location = 'Basen testowy'
  const result = await run(updated)
  assert.equal(result.counts.updated, 1); assert.ok(!result.unresolved.some(item => item.includes('e-session')))
  assert.equal((await one('course-sessions', 'e-session')).reserved, 3)

  // Reverting the panel edit to the imported value makes the record match its import again;
  // the reservation-driven stock change in between is not an edit either.
  await payload.update({ collection: 'products', id: reserved.id, overrideAccess: true, data: { name: 'Produkt testowy' } })
  assert.ok(!(await run(updated)).unresolved.some(item => item.includes('e-prod')))
  // A source change to a reserved product (new description, new source stock) keeps rows and live stock.
  const r = fresh('r'); await run(r)
  const live = await one('products', 'r-prod')
  await transaction(payload, 'reservation-service', req => payload.update({ collection: 'products', id: live.id, req, data: { variants: live.variants.map((variant: any) => ({ ...variant, stock: variant.legacyKey === 'v-m' ? 2 : 5 })) } }))
  const resourced = clone(r)
  entity(resourced, 'r-prod').data.body = '<p>Nowy opis</p>'
  entity(resourced, 'r-prod').data.variants[0].stock = 10
  const synced = await run(resourced)
  assert.ok(!synced.unresolved.some(item => item.includes('r-prod')), 'reservation-driven changes are not manual edits')
  const after = await one('products', 'r-prod')
  assert.equal(after.body, '<p>Nowy opis</p>')
  assert.deepEqual(after.variants.map((variant: any) => [variant.id, variant.stock]), live.variants.map((variant: any) => [variant.id, variant.legacyKey === 'v-m' ? 2 : 5]))
  assert.equal(after.stock, 7)

  // Shrinking capacity below live reservations is reported, not forced.
  const shrink = clone(updated); entity(shrink, 'e-session').data.capacity = 2
  assert.ok((await run(shrink)).unresolved.includes('capacity-below-reserved:course-sessions:e-session'))
  assert.equal((await one('course-sessions', 'e-session')).capacity, 4)
})

test('variant topology changes never delete live rows; additions keep existing ids', async () => {
  const bundle = fresh('v'); await run(bundle)
  const original = await one('products', 'v-prod')
  const removed = clone(bundle); entity(removed, 'v-prod').data.variants.pop()
  assert.ok((await run(removed)).unresolved.includes('variant-topology:products:v-prod'))
  assert.deepEqual((await one('products', 'v-prod')).variants.map((variant: any) => variant.id), original.variants.map((variant: any) => variant.id))
  const added = clone(bundle); entity(added, 'v-prod').data.variants.push({ label: 'XL', legacyKey: 'v-xl', stock: 2 })
  const result = await run(added)
  assert.equal(result.counts.updated, 1)
  const after = await one('products', 'v-prod')
  assert.deepEqual(after.variants.slice(0, 2).map((variant: any) => variant.id), original.variants.map((variant: any) => variant.id))
  assert.deepEqual(after.variants.map((variant: any) => variant.stock), [3, null, 2])
})

test('deleted records are recreated; missing or changed media is reported and never replaced', async () => {
  const bundle = fresh('d'); await run(bundle)
  const page = await one('pages', 'd-page')
  await payload.delete({ collection: 'pages', id: page.id, overrideAccess: true })
  const media = await one('media', 'd-img-1')
  unlinkSync(path.join(root, 'media', media.filename))
  const changed = clone(bundle); changed.media[1] = { ...changed.media[1], path: 'images/three.png', sha256: sha(images.three) }
  const mediaBefore = (await payload.count({ collection: 'media', overrideAccess: true })).totalDocs
  const result = await run(changed)
  assert.equal(result.counts.created, 1); assert.equal(result.counts.mediaCreated, 0)
  assert.ok(result.unresolved.includes('media-file-missing:d-img-1'))
  assert.ok(result.unresolved.includes('media-replacement:d-img-2'))
  assert.equal(result.status, 'needs-review')
  assert.equal((await payload.count({ collection: 'media', overrideAccess: true })).totalDocs, mediaBefore)
  assert.equal((await one('media', 'd-img-2')).sourceHash, sha(images.two))
  assert.equal((await one('pages', 'd-page')).title, 'Zażółć')
  assert.equal(result.reconciliation.pages.expected, 1); assert.equal(result.reconciliation.pages.found, 1)
  assert.equal(result.reconciliation.media.found, 2)
})

test('one import at a time: concurrent runs are refused and stale claims are taken over', async () => {
  const bundle = fresh('c')
  const results = await Promise.allSettled([run(bundle), run(bundle)])
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  assert.match(String((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason), /already running/)
  const stale = await payload.create({ collection: 'import-runs', context: { systemAction: 'import-service' }, overrideAccess: true, data: { runKey: 'synthetic-stale-run', sourceManifestHash: 'b'.repeat(64), status: 'running' } })
  await assert.rejects(run(bundle), /already running/)
  await new Promise(resolve => setTimeout(resolve, 20))
  const taken = await run(bundle, { leaseMs: 10 })
  assert.equal(taken.counts.unchanged, bundle.entities.length)
  assert.equal((await payload.findByID({ collection: 'import-runs', id: stale.id, overrideAccess: true })).status, 'failed')
})

test('retried transactions do not double count and an interrupted run resumes idempotently', async () => {
  const bundle = fresh('i')
  const original = payload.create.bind(payload)
  let busy = true
  payload.create = (async (args: any) => {
    if (args.collection === 'pages' && busy) { busy = false; throw new Error('SQLITE_BUSY: database is locked') }
    return original(args)
  }) as typeof payload.create
  try { assert.equal((await run(bundle)).counts.created, bundle.entities.length) } finally { payload.create = original }
  assert.equal(busy, false)

  const second = fresh('j')
  payload.create = (async (args: any) => {
    if (args.collection === 'events') throw new Error('Synthetic crash')
    return original(args)
  }) as typeof payload.create
  try { await assert.rejects(run(second), /Synthetic crash/) } finally { payload.create = original }
  const failed = await payload.find({ collection: 'import-runs', where: { status: { equals: 'failed' } }, overrideAccess: true })
  assert.ok(failed.docs.length >= 1)
  const resumed = await run(second)
  // Redirects have no dependencies and were stored before the crash; only the event remains.
  assert.equal(resumed.counts.created, 1); assert.equal(resumed.counts.unchanged, second.entities.length - 1)
  const storedRun = (await payload.find({ collection: 'import-runs', where: { runKey: { equals: resumed.runKey } }, overrideAccess: true })).docs[0]
  const history = (storedRun.counts as { attemptHistory: Array<{ status: string; counts: Record<string, unknown>; unresolved: string[] }> }).attemptHistory
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'failed')
  assert.equal(history[0].counts.failureType, 'Error')
  assert.ok(Number.isSafeInteger(history[0].counts.created))
  assert.equal('attemptHistory' in history[0].counts, false)
  for (const item of second.entities) assert.equal((await payload.count({ collection: item.collection as CollectionSlug, where: { legacyKey: { equals: item.key } }, overrideAccess: true })).totalDocs, 1)
})

test('public PDF imports preserve bytes, replace body links, resume idempotently and keep staff titles', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create(); pdf.addPage([120, 180])
  const bytes = Buffer.from(await pdf.save())
  mkdirSync(path.join(sourceRoot, 'documents'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'documents/static.pdf'), bytes)
  const bundle = {
    version: 1, source: { kind: 'public-pages', manifestHash: 'd'.repeat(64), capturedAt: '2026-10-09T00:00:00Z', complete: false }, media: [],
    documents: [{ key: 'synthetic-public-pdf', path: 'documents/static.pdf', sha256: sha(bytes), title: 'Tabela syntetyczna', url: 'https://www.underwater.pl/images/Tabela%20syntetyczna.pdf' }],
    entities: [{ collection: 'pages', key: 'synthetic-pdf-page', data: { title: 'Materiały', path: '/synthetic-pdf.html', kind: 'page', published: true, body: '<p><a href="/images/Tabela%20syntetyczna.pdf">Pobierz tabelę</a></p>' } }],
  }
  const before = await snapshot()
  const planned = await dryRun(bundle)
  assert.equal(planned.plan.documentsCreated, 1)
  assert.deepEqual(await snapshot(), before, 'preflight cannot upload or write source records')
  const first = await run(bundle)
  assert.equal(first.counts.documentsCreated, 1)
  assert.equal(first.counts.created, 1)
  assert.deepEqual(first.unresolved, [])
  const doc = await one('documents', 'synthetic-public-pdf')
  assert.equal(doc.legacyPath, '/images/Tabela syntetyczna.pdf')
  assert.equal(sha(readFileSync(path.join(root, 'media/documents', doc.filename))), sha(bytes))
  assert.match((await one('pages', 'synthetic-pdf-page')).body, /href="\/images\/Tabela%20syntetyczna\.pdf"/)
  await payload.update({ collection: 'documents', id: doc.id, data: { title: 'Opis poprawiony przez redakcję' }, overrideAccess: true })
  const resumed = await run(bundle)
  assert.equal(resumed.counts.documentsCreated, 0)
  assert.equal(resumed.counts.documentsExisting, 1)
  assert.equal(resumed.counts.unchanged, 1)
  assert.equal((await one('documents', 'synthetic-public-pdf')).title, 'Opis poprawiony przez redakcję')
  assert.equal((await payload.count({ collection: 'documents', where: { legacyKey: { equals: 'synthetic-public-pdf' } } })).totalDocs, 1)
  assert.equal(resumed.reconciliation.documents.found, 1)
})

test('a corrupt document fails preflight before any entity, run or upload is written', async () => {
  mkdirSync(path.join(sourceRoot, 'documents'), { recursive: true })
  const body = Buffer.from('%PDF-1.7\nsynthetic malformed\n%%EOF')
  writeFileSync(path.join(sourceRoot, 'documents/bad.pdf'), body)
  const before = await snapshot()
  await assert.rejects(run({ version: 1, source: { kind: 'demo', manifestHash: 'e'.repeat(64), capturedAt: '2026-10-09T00:00:00Z', complete: false }, media: [], entities: [], documents: [{ key: 'synthetic-bad-pdf', path: 'documents/bad.pdf', sha256: sha(body), title: 'Nieprawidłowy', url: '/images/bad.pdf' }] }))
  assert.deepEqual(await snapshot(), before)
})
