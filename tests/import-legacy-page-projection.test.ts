import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'
import { fieldSpecs, stableHash } from '../src/lib/import/bundle'
import { importBundle } from '../src/lib/import/service'

const root = mkdtempSync(path.join(tmpdir(), 'underwater-legacy-page-projection-'))
const source = path.join(root, 'source')
mkdirSync(source)
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, {
  UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root,
  DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`,
  NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011',
  PAYLOAD_SECRET: 'synthetic-legacy-page-projection-secret-not-runtime',
})
let payload: Payload
test.before(async () => {
  payload = await getPayload({ config: (await import('../src/payload.config')).default, disableOnInit: true })
  await payload.db.migrate()
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

const bundle = (key: string, body = '<p>Treść źródłowa</p>') => ({
  version: 1, source: { kind: 'public-pages', manifestHash: 'a'.repeat(64), capturedAt: '2026-10-08T00:00:00Z', complete: false },
  media: [], entities: [{ collection: 'pages', key, data: { title: 'Strona źródłowa', path: `/${key}.html`, kind: 'page', body, published: true } }],
})
const run = (value: ReturnType<typeof bundle>, dryRun = false) => importBundle(payload, value, source, { dryRun })
const page = async (key: string) => (await payload.find({ collection: 'pages', where: { legacyKey: { equals: key } }, depth: 0, overrideAccess: true })).docs[0] as unknown as Record<string, any>

// Exact managed page projection used before the additive listing schema.
// Persist this old digest in the actual SDK record, rather than testing a mock.
function oldProjection(doc: Record<string, any>) {
  const id = (value: any) => value == null ? null : typeof value === 'object' ? value.id ?? null : value
  return stableHash({
    title: doc.title, path: doc.path, kind: doc.kind, lead: doc.lead ?? null, body: doc.body ?? null,
    publishedAt: doc.publishedAt ?? null, published: doc.published ?? null, legacyPath: doc.legacyPath ?? null,
    sourceUpdatedAt: doc.sourceUpdatedAt ?? null,
    seo: { title: doc.seo?.title ?? null, description: doc.seo?.description ?? null, image: id(doc.seo?.image) },
    image: id(doc.image), album: id(doc.album),
  })
}
async function markAsOldImport(key: string) {
  const doc = await page(key)
  await payload.update({ collection: 'pages', id: doc.id, overrideAccess: true, data: { sourceHash: `v2:${'4'.repeat(64)}:${oldProjection(doc)}` } })
  return doc
}

test('untouched v4 pages upgrade after a schema extension and then replay without writes', async () => {
  assert.ok(Object.keys(fieldSpecs.pages).length > 10, 'The test requires the real extended Pages DTO.')
  const input = bundle('legacy-untouched')
  await run(input)
  await markAsOldImport('legacy-untouched')
  input.entities[0].data.body = '<p>Uzupełniona treść źródłowa</p>'
  const before = await page('legacy-untouched')
  const dry = await run(input, true)
  assert.equal(dry.dryRun, true)
  assert.ok(dry.plan)
  assert.equal(dry.plan.updated, 1)
  assert.equal(dry.plan.conflicts, 0)
  assert.equal((await page('legacy-untouched')).sourceHash, before.sourceHash)
  const applied = await run(input)
  assert.ok(applied.counts)
  assert.equal(applied.counts.updated, 1)
  assert.equal(applied.counts.conflicts, 0)
  assert.match((await page('legacy-untouched')).body, /Uzupełniona treść źródłowa/)
  const replay = await run(input)
  assert.ok(replay.counts)
  assert.equal(replay.counts.unchanged, 1)
  assert.equal(replay.counts.updated, 0)
  assert.equal(replay.counts.conflicts, 0)
})

test('a staff change to original v4 content remains protected during an upgrade', async () => {
  const input = bundle('legacy-old-staff-edit')
  await run(input)
  const doc = await markAsOldImport('legacy-old-staff-edit')
  await payload.update({ collection: 'pages', id: doc.id, overrideAccess: true, data: { title: 'Ręczna poprawka redakcji' } })
  input.entities[0].data.body = '<p>Nowszy zapis źródła</p>'
  const result = await run(input)
  assert.ok(result.counts)
  assert.equal(result.counts.conflicts, 1)
  assert.equal(result.counts.updated, 0)
  assert.equal((await page('legacy-old-staff-edit')).title, 'Ręczna poprawka redakcji')
})

test('a staff change to a newly added listing field cannot use the v4 compatibility path', async () => {
  const oldNames = new Set(['title', 'path', 'kind', 'lead', 'body', 'publishedAt', 'published', 'legacyPath', 'sourceUpdatedAt', 'seo'])
  const flag = Object.entries(fieldSpecs.pages).find(([name, spec]) => !oldNames.has(name) && spec.kind === 'bool')?.[0]
  assert.ok(flag, 'An explicit listing checkbox is required by the new source model.')
  const input = bundle('legacy-new-staff-edit')
  await run(input)
  const doc = await markAsOldImport('legacy-new-staff-edit')
  await payload.update({ collection: 'pages', id: doc.id, overrideAccess: true, data: { [flag]: true } as never })
  input.entities[0].data.body = '<p>Nowszy zapis źródła</p>'
  const result = await run(input)
  assert.ok(result.counts)
  assert.equal(result.counts.conflicts, 1)
  assert.equal(result.counts.updated, 0)
  assert.equal((await page('legacy-new-staff-edit'))[flag], true)
})


test('deleting a listing category gives a clear error and preserves the page until it is unlinked', async () => {
  const category = await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST Kategoria listy', slug: 'test-protected-listing-category' } })
  const listing = await payload.create({ collection: 'pages', overrideAccess: true, data: { title: 'TEST Lista', path: '/test-protected-listing.html', kind: 'page', listing: true, listingCategory: category.id } })
  await assert.rejects(payload.delete({ collection: 'categories', id: category.id, overrideAccess: true }), (error: any) => error.status === 400 && error.message.includes('Najpierw zmień kategorię'))
  assert.equal((await payload.findByID({ collection: 'pages', id: listing.id, overrideAccess: true, depth: 0 })).listingCategory, category.id)
  assert.equal((await payload.findByID({ collection: 'categories', id: category.id, overrideAccess: true })).id, category.id)
  await payload.update({ collection: 'pages', id: listing.id, overrideAccess: true, data: { listingCategory: null } })
  await payload.delete({ collection: 'categories', id: category.id, overrideAccess: true })
  assert.equal((await payload.findByID({ collection: 'pages', id: listing.id, overrideAccess: true, depth: 0 })).listingCategory, null)
})
