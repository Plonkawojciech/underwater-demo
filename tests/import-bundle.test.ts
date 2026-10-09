import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ImportError, legacyPath, mediaSourcePath, orderedEntities, validateBundle, type ImportCollection } from '../src/lib/import/bundle'
import { contentProjectionHash, readVerifiedFile, sourceVerification } from '../src/lib/import/service'

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const header = { version: 1, source: { kind: 'public-pages', manifestHash: 'a'.repeat(64), capturedAt: '2026-10-08T00:00:00Z', complete: false }, media: [] as unknown[] }
const bundle = (entities: unknown[], extra: Record<string, unknown> = {}) => ({ ...header, entities, ...extra })
const page = (key: string, data: Record<string, unknown> = {}, relations?: Record<string, unknown>) => ({ collection: 'pages', key, data: { title: 'Strona', path: `/${key}.html`, kind: 'page', published: true, ...data }, ...(relations ? { relations } : {}) })

test('canonical paths are decoded, NFC-normalised and refuse ambiguous encodings', () => {
  assert.equal(legacyPath('/aktualno%C5%9Bci/za%C5%BC%C3%B3%C5%82%C4%87.html'), '/aktualności/zażółć.html')
  assert.equal(legacyPath('/aktualności/zażółć.html'.normalize('NFD')), '/aktualności/zażółć.html')
  for (const unsafe of ['/a%2Fb.html', '/a/%2e%2e/b.html', '/a/../b', '//evil.example/x', '/a b', '/a?x=1', '/a‮b', '/a%E2%80%AEb', '/a%00b', 'relative', '/a//b', '/%ZZ']) assert.throws(() => legacyPath(unsafe), ImportError, unsafe)
})

test('HTML image sources resolve only to own-site paths', () => {
  assert.deepEqual(mediaSourcePath('https://www.underwater.pl/images/a%20b.jpg?v=2'), { path: '/images/a b.jpg' })
  assert.deepEqual(mediaSourcePath('http://underwater.pl/images/x.png'), { path: '/images/x.png' })
  assert.deepEqual(mediaSourcePath('images/żółw.jpg'), { path: '/images/żółw.jpg' })
  assert.deepEqual(mediaSourcePath('//cdn.example.com/x.jpg'), { external: 'cdn.example.com' })
  assert.deepEqual(mediaSourcePath('data:image/png;base64,AAAA'), { external: 'data' })
  assert.deepEqual(mediaSourcePath('../../etc/passwd'), { unsafe: true })
  assert.deepEqual(mediaSourcePath('https://user:pw@underwater.pl/x.jpg'), { unsafe: true })
})

test('dependency order is deterministic, linear and rejects cycles', () => {
  const chain = Array.from({ length: 20_000 }, (_, index) => ({ collection: 'categories' as ImportCollection, key: `c${index}`, relations: (index ? { parent: `categories:c${index - 1}` } : {}) as Record<string, string> }))
  const started = performance.now()
  const ordered = orderedEntities([...chain].reverse())
  assert.ok(performance.now() - started < 2000)
  assert.deepEqual(ordered.map(entity => entity.key), chain.map(entity => entity.key))
  const shuffled = [chain[3], chain[1], chain[0], chain[2]]
  assert.deepEqual(orderedEntities(shuffled.slice(0, 4)).map(entity => entity.key), orderedEntities([chain[2], chain[0], chain[3], chain[1]]).map(entity => entity.key))
  assert.throws(() => orderedEntities([{ collection: 'categories', key: 'a', relations: { parent: 'categories:b' } }, { collection: 'categories', key: 'b', relations: { parent: 'categories:a' } }]), /cycle/)
  assert.throws(() => validateBundle(bundle([{ collection: 'categories', key: 'self', data: { name: 'X', slug: 'self', published: true }, relations: { parent: 'categories:self' } }])), /cycle/)
})

test('DTO validation: field allowlist, types, relation targets and cardinality', () => {
  const ok = validateBundle(bundle([page('a', {}, { album: 'albums:g' }), { collection: 'albums', key: 'g', data: { title: 'G', path: '/g.html', published: true } }]))
  assert.equal(ok.entities[0].collection, 'albums')
  const reject = (entities: unknown[], pattern: RegExp, extra?: Record<string, unknown>) => assert.throws(() => validateBundle(bundle(entities, extra)), pattern)
  reject([page('a', { published: 'true' })], /published: expected boolean/)
  reject([page('a', { published: undefined })], /published: required/)
  reject([page('a', { kind: undefined })], /kind: required/)
  reject([page('a', { id: 7 })], /id: unsupported field/)
  reject([page('a', { legacyKey: 'x' })], /legacyKey: unsupported field/)
  reject([page('a', { album: 3 })], /album: unsupported field/)
  reject([page('a', {}, { album: 'pages:b' }), page('b')], /must reference albums/)
  reject([page('a', {}, { image: 3 })], /expected a single reference/)
  reject([page('a', {}, { image: 'albums:g' }), { collection: 'albums', key: 'g', data: { title: 'G', path: '/g.html', published: true } }], /must reference media/)
  reject([page('a', {}, { album: ['albums:g'] }), { collection: 'albums', key: 'g', data: { title: 'G', path: '/g.html', published: true } }], /single reference/)
  reject([{ collection: 'users', key: 'u', data: { published: true } }], /unsupported collection/)
  reject([page('a', { seo: { image: 4 } })], /media:<key>/)
  reject([{ collection: 'albums', key: 'g', data: { title: 'G', path: '/g.html', published: true, photos: [{ id: 'row', image: 'media:x' }] } }], /id: unsupported field/)
  reject([page('a'), page('b', { path: '/a.html' })], /two source records claim one public address/)
  reject([page('a', { path: '/A.html', legacyPath: '/b.html' }), page('b')], /two source records claim one public address/)
  reject([page('a')], /settings\.deliveryMethods/, { settings: { deliveryMethods: [] } })
  reject([page('a')], /settings\.phone/, { settings: { phone: 5 } })
  reject([page('a')], /settings\.facebook/, { settings: { facebook: 'javascript:alert(1)' } })
  reject([{ collection: 'redirects', key: 'r1', data: { from: '/x.html', to: '/y.html', published: true } }, { collection: 'redirects', key: 'r2', data: { from: '/y.html', to: '/x', published: true } }], /redirect cycle/)
  const shadowed = validateBundle(bundle([page('kontakt'), page('b', { path: '/koszyk/b.html' })])).shadowed.map(item => item.route)
  assert.deepEqual(shadowed.sort(), ['kontakt', 'koszyk/b'])
})

test('product list pages: ordered product relations, names without a product, complete ranges and own results links', () => {
  const category = { collection: 'categories', key: 'c', data: { name: 'C', slug: '1-c', published: true } }
  const product = (n: number) => ({ collection: 'products', key: `p${n}`, data: { name: `P${n}`, slug: `${n}-p`, vmId: n, priceCents: n * 100, published: true }, relations: { category: 'categories:c' } })
  const list = (data: Record<string, unknown> = {}, relations: Record<string, unknown> = {}) =>
    page('1-c/marka', { listing: true, ...data }, { listingCategory: 'categories:c', listingProducts: ['products:p2', 'products:p1'], ...relations })
  const catalogue = [category, product(1), product(2)]
  const ok = validateBundle(bundle([list({ listingFrom: 1, listingTo: 3, listingTotal: 3, listingMissing: [{ title: 'Nieznany', legacyPath: '/9-nieznany,czarny.html' }], listingLinks: [{ label: 'Wyniki 4–6', path: '/1-c/marka/results,4-6.html' }] }), ...catalogue]))
  const entity = ok.entities.find(item => item.collection === 'pages')!
  assert.deepEqual(entity.relations.listingProducts, ['products:p2', 'products:p1'], 'page order is kept')
  assert.equal(entity.relations.listingCategory, 'categories:c')
  assert.deepEqual(entity.data.listingMissing, [{ title: 'Nieznany', legacyPath: '/9-nieznany,czarny.html' }])
  assert.deepEqual(entity.data.listingLinks, [{ label: 'Wyniki 4–6', path: '/1-c/marka/results,4-6.html' }])
  assert.ok(ok.entities.indexOf(entity) > ok.entities.findIndex(item => item.key === 'p2'), 'members are written before the list')
  const plain = validateBundle(bundle([page('a')])).entities[0]
  assert.deepEqual([plain.data.listing, plain.data.listingFrom, plain.data.listingMissing, plain.data.listingLinks, plain.relations.listingProducts, plain.relations.listingCategory], [null, null, [], [], [], null])

  const reject = (entities: unknown[], pattern: RegExp) => assert.throws(() => validateBundle(bundle(entities)), pattern)
  reject([list({}, { listingProducts: ['categories:c'] }), ...catalogue], /listingProducts: must reference products/)
  reject([list({}, { listingCategory: 'products:p1' }), ...catalogue], /listingCategory: must reference categories/)
  reject([list({}, { listingProducts: ['products:p1', 'products:p1'] }), ...catalogue], /duplicate reference/)
  reject([list({}, { listingProducts: ['products:p9'] }), ...catalogue], /unresolved source relationship/)
  reject([list({}, { listingProducts: 'products:p1' }), ...catalogue], /expected a list of references/)
  reject([page('a', { listingFrom: 1, listingTo: 1, listingTotal: 1 })], /listing fields require listing: true/)
  reject([page('a', {}, { listingProducts: ['products:p1'] }), ...catalogue], /listing fields require listing: true/)
  reject([list({ listingFrom: 1, listingTo: 3 }), ...catalogue], /complete range/)
  reject([list({ listingFrom: 4, listingTo: 3, listingTotal: 9 }), ...catalogue], /complete range/)
  reject([list({ listingFrom: 0, listingTo: 3, listingTotal: 9 }), ...catalogue], /listingFrom: expected integer/)
  reject([list({ listingLinks: [{ label: 'Ta sama', path: '/1-c/marka' }] }), ...catalogue], /points to the page itself/)
  reject([list({ listingMissing: [{ title: 'X', legacyPath: '/a?b=1' }] }), ...catalogue], /canonical source path/)
  reject([list({ kind: 'news' }), ...catalogue], /information page/)
})

test('fields added for product lists do not turn page records of an older importer into staff edits', () => {
  const old = { title: 'T', path: '/t.html', kind: 'page', lead: null, body: '<p>x</p>', publishedAt: null, published: true, legacyPath: '/t.html', sourceUpdatedAt: null, seo: { title: null, description: null, image: null }, image: null, album: null }
  const now = { ...old, listing: null, listingFrom: null, listingTo: null, listingTotal: null, listingMissing: [], listingLinks: [], listingCategory: null, listingProducts: [] }
  assert.equal(contentProjectionHash('pages', now as never), contentProjectionHash('pages', old as never))
  assert.equal(contentProjectionHash('pages', { ...now, listing: false } as never), contentProjectionHash('pages', old as never))
  assert.notEqual(contentProjectionHash('pages', { ...now, listing: true, listingProducts: [5] } as never), contentProjectionHash('pages', old as never))
})

test('source completeness requires a database dump with a trusted manifest digest', () => {
  const source = { kind: 'joomla-dump' as const, manifestHash: 'b'.repeat(64), capturedAt: '2026-10-08T00:00:00Z', complete: true }
  assert.equal(sourceVerification(source), 'manifest-not-verified')
  assert.equal(sourceVerification(source, 'c'.repeat(64)), 'manifest-mismatch')
  assert.equal(sourceVerification(source, 'nothex'), 'manifest-mismatch')
  assert.equal(sourceVerification(source, 'b'.repeat(64)), 'verified')
  assert.equal(sourceVerification({ ...source, complete: false }, 'b'.repeat(64)), 'declared-incomplete')
  for (const kind of ['public-pages', 'demo'] as const) assert.equal(sourceVerification({ ...source, kind }, 'b'.repeat(64)), 'not-a-database-dump')
})

test('media bytes are re-verified, bounded and never read through a symlink', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'underwater-import-files-'))
  try {
    const file = path.join(dir, 'a.png'), link = path.join(dir, 'link.png'), large = path.join(dir, 'large.png')
    writeFileSync(file, 'synthetic bytes')
    assert.equal((await readVerifiedFile(file, sha('synthetic bytes'))).toString(), 'synthetic bytes')
    writeFileSync(file, 'swapped after preflight')
    await assert.rejects(readVerifiedFile(file, sha('synthetic bytes')), /integrity/)
    symlinkSync(file, link)
    await assert.rejects(readVerifiedFile(link, sha('swapped after preflight')), ImportError)
    writeFileSync(large, Buffer.alloc(12 * 1024 * 1024 + 1))
    await assert.rejects(readVerifiedFile(large, sha('x')), /Unsupported/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
