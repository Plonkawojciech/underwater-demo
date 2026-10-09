import { constants } from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import { sanitizeContent } from '../html'
import { verifyDocumentBytes } from '../document-upload'
import { transaction } from '../commerce/transaction'
import { validateEnvironment } from '../environment'
import {
  IMPORTER_VERSION, ImportError, addedFields, fieldSpecs, importCollections, legacyPath, mediaSourcePath, relationSpecs, routeKey, stableHash, validateBundle,
  type ImportCollection, type ImportMedia, type ImportDocument, type ImportSource, type PreparedEntity, type ValidatedBundle,
} from './bundle'

export { ImportError }
export type ImportOptions = { dryRun?: boolean; verifiedSourceManifestHash?: string; leaseMs?: number }
type Doc = Record<string, any> & { id: number }
type Spec = (typeof fieldSpecs)[ImportCollection][string]

const SYSTEM = 'import-service'
const MAX_MEDIA_BYTES = 12 * 1024 * 1024
const MAX_UNRESOLVED = 10_000
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }
// Payload stores JPEG and PNG originals verbatim; GIF, WebP and AVIF are re-encoded by sharp.
const VERBATIM = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const HASH = /^v2:([a-f0-9]{64}):([a-f0-9]{64})$/
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const idOf = (value: unknown): number | null => value == null ? null : typeof value === 'object' ? ((value as { id?: number }).id ?? null) : value as number
const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Target and source verification

function assertIsolatedTarget(payload: Payload) {
  const runtime = validateEnvironment(process.env)
  if (runtime.environment === 'build') throw new ImportError('Imports are not allowed during a build.')
  const url = (payload.db as unknown as { clientConfig?: { url?: string } }).clientConfig?.url
  if (url !== runtime.databaseURI) throw new ImportError('Payload is not connected to the isolated Underwater database.')
  if (path.resolve(mediaDirectory(payload)) !== runtime.mediaDir) throw new ImportError('Media uploads do not target the isolated Underwater media directory.')
}
function mediaDirectory(payload: Payload): string {
  const dir = (payload.collections.media.config.upload as { staticDir?: string }).staticDir
  if (!dir) throw new ImportError('Media storage directory is not configured.')
  return path.resolve(dir)
}
/**
 * Only a Joomla database dump whose manifest digest was computed by the trusted
 * caller can prove completeness. The bundle's own `complete` flag never suffices.
 */
export function sourceVerification(source: ImportSource, verifiedManifestHash?: string): 'verified' | 'not-a-database-dump' | 'declared-incomplete' | 'manifest-not-verified' | 'manifest-mismatch' {
  if (source.kind !== 'joomla-dump') return 'not-a-database-dump'
  if (!source.complete) return 'declared-incomplete'
  if (verifiedManifestHash === undefined) return 'manifest-not-verified'
  if (!/^[a-f0-9]{64}$/.test(verifiedManifestHash) || !timingSafeEqual(Buffer.from(verifiedManifestHash, 'hex'), Buffer.from(source.manifestHash, 'hex'))) return 'manifest-mismatch'
  return 'verified'
}

// ---------------------------------------------------------------------------
// Media files

type SourceFile = { descriptor: ImportMedia; filePath: string; mime: string; extension: string }
async function locateSource(root: string, descriptor: ImportMedia): Promise<SourceFile> {
  const candidate = path.resolve(root, descriptor.path)
  if (!candidate.startsWith(root + path.sep)) throw new ImportError('Media path escaped the private snapshot root.')
  const info = await lstat(candidate).catch(() => { throw new ImportError('Source media file is missing.') })
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_MEDIA_BYTES) throw new ImportError('Unsupported source media file.')
  const filePath = await realpath(candidate)
  if (!filePath.startsWith(root + path.sep)) throw new ImportError('Media path escaped the private snapshot root.')
  const extension = path.extname(filePath).toLowerCase()
  if (filePath.split(path.sep).some(part => part.startsWith('.env')) || !MIME[extension]) throw new ImportError('Excluded source media file.')
  return { descriptor, filePath, mime: MIME[extension], extension }
}
/** Reads one file (at most 12 MB, never through a symlink) and proves its bytes match the descriptor. */
export async function readVerifiedFile(filePath: string, expectedSha256: string): Promise<Buffer> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new ImportError('Source media file cannot be opened safely.') })
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_MEDIA_BYTES) throw new ImportError('Unsupported source media file.')
    const buffer = Buffer.alloc(info.size)
    let offset = 0
    while (offset < info.size) {
      const { bytesRead } = await handle.read(buffer, offset, info.size - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const tail = await handle.read(Buffer.alloc(1), 0, 1, offset)
    if (offset !== info.size || tail.bytesRead) throw new ImportError('Source media changed while it was read.')
    if (sha256(buffer) !== expectedSha256) throw new ImportError('Source media integrity check failed.')
    return buffer
  } finally { await handle.close() }
}
/** Never replaces a stored file; only reports whether the original is still present and intact. */
async function storedFileProblem(directory: string, doc: Doc): Promise<string | null> {
  const name = doc.filename
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return 'media-file-missing'
  const filePath = path.join(directory, name)
  const info = await lstat(filePath).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isFile()) return 'media-file-missing'
  if (VERBATIM.has(doc.mimeType)) {
    if (info.size > MAX_MEDIA_BYTES) return 'media-file-mismatch'
    try { await readVerifiedFile(filePath, String(doc.sourceHash)) } catch { return 'media-file-mismatch' }
  } else if (typeof doc.filesize === 'number' && info.size !== doc.filesize) return 'media-file-mismatch'
  return null
}

// ---------------------------------------------------------------------------
// Data mapping, projection and reconciliation decisions

type Context = { ids: Map<string, number>; mediaURL: Map<string, string>; mediaByPath: Map<string, string>; mediaKeys: Set<string>; documentByPath: Map<string, string>; documentURL: Map<string, string> }
type Prepared = { data: Record<string, unknown>; hash: string; stock: number | null; variantStocks: Array<number | null>; notes: string[] }
type Decision = { action: 'create' } | { action: 'update'; data: Record<string, unknown> } | { action: 'unchanged' | 'preserved' } | { action: 'conflict'; reason: string }

function lookup(ctx: Context, reference: string): number {
  const id = ctx.ids.get(reference)
  if (id === undefined) throw new ImportError('Source dependency has not been imported.')
  return id
}
function mapMedia(spec: Spec, value: unknown, ctx: Context): unknown {
  if (value == null) return value
  if (spec.kind === 'media') return lookup(ctx, value as string)
  if (spec.kind === 'group') return Object.fromEntries(Object.entries(spec.fields).map(([name, sub]) => [name, mapMedia(sub, (value as Record<string, unknown>)[name], ctx)]))
  if (spec.kind === 'rows') return (value as Array<Record<string, unknown>>).map(row => Object.fromEntries(Object.entries(spec.fields).map(([name, sub]) => [name, mapMedia(sub, row[name], ctx)])))
  return value
}
function prepare(entity: PreparedEntity, ctx: Context): Prepared {
  const notes = new Set<string>()
  const resolveImage = (src: string) => {
    const found = mediaSourcePath(src)
    if ('external' in found) { notes.add(`html-image-external:${entity.id}:${found.external}`); return undefined }
    if ('unsafe' in found) { notes.add(`html-image-unsafe:${entity.id}`); return undefined }
    const key = ctx.mediaByPath.get(found.path)
    if (!key) { notes.add(`html-image-unmapped:${entity.id}:${found.path}`); return undefined }
    if (!ctx.mediaKeys.has(key)) { notes.add(`html-image-not-downloaded:${entity.id}:${key}`); return undefined }
    return ctx.mediaURL.get(key)
  }
  const resolveLink = (href: string) => {
    const found = mediaSourcePath(href)
    if (!('path' in found) || !/\.pdf$/i.test(found.path)) return href
    const key = ctx.documentByPath.get(found.path)
    if (!key || !ctx.documentURL.has(key)) { notes.add(`html-document-not-downloaded:${entity.id}:${found.path}`); return href }
    // Keep the source address and source filename; the private proxy serves
    // the immutable own copy behind the same legacy path.
    return href
  }
  const data: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(fieldSpecs[entity.collection])) {
    const value = entity.data[name]
    data[name] = spec.kind === 'html' ? (value == null ? null : sanitizeContent(value as string, resolveImage, resolveLink)) : mapMedia(spec, value, ctx)
  }
  for (const [name, spec] of Object.entries(relationSpecs[entity.collection])) {
    const reference = entity.relations[name]
    data[name] = spec.many ? (reference as string[]).map(item => lookup(ctx, item)) : reference == null ? null : lookup(ctx, reference as string)
  }
  let stock: number | null = null, variantStocks: Array<number | null> = []
  if (entity.collection === 'products') {
    if (data.price == null) data.price = (data.priceCents as number) / 100
    if (data.priceCents == null) data.priceCents = Math.round((data.price as number) * 100)
    if (data.salePrice == null && data.salePriceCents != null) data.salePrice = (data.salePriceCents as number) / 100
    if (data.salePriceCents == null && data.salePrice != null) data.salePriceCents = Math.round((data.salePrice as number) * 100)
    // Source stock is live inventory: written only when a record or variant row is first created.
    stock = (data.stock as number | null) ?? null
    delete data.stock
    const variants = data.variants as Array<Record<string, unknown>>
    variantStocks = variants.map(variant => (variant.stock as number | null) ?? null)
    data.variants = variants.map(({ stock: _stock, ...variant }) => variant)
  }
  return { data, hash: stableHash({ importer: IMPORTER_VERSION, collection: entity.collection, data }), stock, variantStocks, notes: [...notes] }
}
function project(spec: Spec, value: unknown, skip?: string): unknown {
  if (spec.kind === 'group') return Object.fromEntries(Object.entries(spec.fields).map(([name, sub]) => [name, project(sub, (value as Record<string, unknown> | null)?.[name])]))
  if (spec.kind === 'rows') return (Array.isArray(value) ? value : []).map(row => Object.fromEntries(Object.entries(spec.fields).filter(([name]) => name !== skip).map(([name, sub]) => [name, project(sub, row?.[name])])))
  if (spec.kind === 'media') return idOf(value)
  return value ?? null
}
/**
 * The import-managed content of a stored record. Live inventory (product and
 * variant stock), variant row ids, reservations and timestamps are excluded, so
 * checkout and signup activity is never mistaken for a staff edit.
 */
export function contentProjectionHash(collection: ImportCollection, doc: Doc): string {
  const result: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(fieldSpecs[collection])) {
    if (collection === 'products' && name === 'stock') continue
    result[name] = project(spec, doc[name], collection === 'products' && name === 'variants' ? 'stock' : undefined)
  }
  for (const [name, spec] of Object.entries(relationSpecs[collection])) result[name] = spec.many ? (Array.isArray(doc[name]) ? doc[name].map(idOf) : []) : idOf(doc[name])
  for (const name of addedFields[collection] ?? []) {
    const value = result[name]
    if (value == null || value === false || (Array.isArray(value) && !value.length)) delete result[name]
  }
  return stableHash(result)
}
const normal = (value: unknown) => value == null ? null : String(value).normalize('NFC').trim().toLowerCase()
function sameVariant(source: Record<string, unknown>, existing: Record<string, unknown>) {
  if (source.legacyKey != null && existing.legacyKey != null) return source.legacyKey === existing.legacyKey
  if (source.sku != null && existing.sku != null) return normal(source.sku) === normal(existing.sku)
  return normal(source.label) === normal(existing.label)
}
/** Keeps live variant rows (id and stock); any row that cannot be matched is a topology change for review. */
function mergeVariants(existing: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>, stocks: Array<number | null>) {
  if (existing.length > 0 !== incoming.length > 0) return null
  const taken = new Set<number>(), merged: Array<Record<string, unknown>> = []
  for (const [index, variant] of incoming.entries()) {
    const candidates = existing.map((_, position) => position).filter(position => !taken.has(position) && sameVariant(variant, existing[position]))
    if (candidates.length > 1) return null
    if (candidates.length === 1) {
      taken.add(candidates[0])
      merged.push({ ...variant, id: existing[candidates[0]].id, stock: existing[candidates[0]].stock ?? null })
    } else merged.push({ ...variant, stock: stocks[index] })
  }
  return taken.size === existing.length ? merged : null
}
function decide(collection: ImportCollection, previous: Doc | undefined, prepared: Prepared): Decision {
  if (!previous) return { action: 'create' }
  const stored = HASH.exec(String(previous.sourceHash || ''))
  // Unknown provenance (older importer, staff-created record with a source key) is never overwritten.
  if (!stored) return { action: 'conflict', reason: 'manual-edit' }
  if (contentProjectionHash(collection, previous) !== stored[2]) return stored[1] === prepared.hash ? { action: 'preserved' } : { action: 'conflict', reason: 'manual-edit' }
  if (stored[1] === prepared.hash) return { action: 'unchanged' }
  const data = { ...prepared.data }
  if (collection === 'products') {
    const variants = mergeVariants(previous.variants || [], prepared.data.variants as Array<Record<string, unknown>>, prepared.variantStocks)
    if (!variants) return { action: 'conflict', reason: 'variant-topology' }
    data.variants = variants
  }
  if (collection === 'course-sessions' && data.capacity != null && Number(previous.reserved || 0) > (data.capacity as number)) return { action: 'conflict', reason: 'capacity-below-reserved' }
  return { action: 'update', data }
}
function createData(collection: ImportCollection, prepared: Prepared): Record<string, unknown> {
  if (collection !== 'products') return { ...prepared.data }
  const variants = (prepared.data.variants as Array<Record<string, unknown>>).map((variant, index) => ({ ...variant, stock: prepared.variantStocks[index] }))
  // With variants the catalog hook derives product stock (null when any variant is unknown).
  return { ...prepared.data, variants, ...(variants.length ? {} : { stock: prepared.stock }) }
}

// ---------------------------------------------------------------------------
// Database reads

async function findAll(payload: Payload, collection: CollectionSlug, where: Where = {}, req?: PayloadRequest, select?: Record<string, true>): Promise<Doc[]> {
  return (await payload.find({ collection, where, pagination: false, depth: 0, overrideAccess: true, req, ...(select ? { select } : {}) })).docs as unknown as Doc[]
}
async function byLegacyKeys(payload: Payload, collection: CollectionSlug, keys: string[]): Promise<Map<string, Doc>> {
  const result = new Map<string, Doc>()
  for (let index = 0; index < keys.length; index += 500) for (const doc of await findAll(payload, collection, { legacyKey: { in: keys.slice(index, index + 500) } })) result.set(doc.legacyKey, doc)
  return result
}
const uniqueFields: Record<ImportCollection, string[]> = { categories: ['slug', 'vmId'], products: ['slug', 'vmId'], courses: ['slug'], 'course-sessions': [], pages: ['path'], trips: ['path'], albums: ['path'], events: [], redirects: ['from'] }
function storedRoutes(collection: ImportCollection, doc: Doc): string[] {
  const canonical = (value: unknown) => { try { return routeKey(legacyPath(value)) } catch { return typeof value === 'string' ? routeKey(value) : null } }
  const routes = [canonical(doc.legacyPath)]
  if (collection === 'products' || collection === 'categories') routes.push(doc.slug ?? null)
  if (collection === 'courses' && doc.slug) routes.push(`kursy-nurkowania/${doc.slug}`)
  if (['pages', 'trips', 'albums', 'events'].includes(collection)) routes.push(canonical(doc.path))
  if (collection === 'redirects') routes.push(canonical(doc.from))
  return routes.filter((route): route is string => route != null)
}
/**
 * Read-only check that no existing record outside this bundle's ownership holds an
 * address or unique value the bundle needs. Runs before any write, also for dry runs.
 */
async function assertNoForeignCollisions(payload: Payload, validated: ValidatedBundle) {
  const routes = new Map<string, string>(), unique = new Map<string, string>()
  for (const entity of validated.entities) {
    for (const route of entity.routes) routes.set(route, entity.id)
    for (const { field, value } of entity.unique) unique.set(`${entity.collection}.${field}=${value}`, entity.id)
  }
  const collisions: string[] = []
  for (const collection of importCollections) {
    const select: Record<string, true> = { legacyKey: true, legacyPath: true }
    for (const name of [...uniqueFields[collection], ...(['pages', 'trips', 'albums', 'events'].includes(collection) ? ['path'] : [])]) select[name] = true
    for (const doc of await findAll(payload, collection, {}, undefined, select)) {
      const owner = doc.legacyKey ? `${collection}:${doc.legacyKey}` : null
      for (const route of storedRoutes(collection, doc)) { const holder = routes.get(route); if (holder && holder !== owner) collisions.push(`${collection} address`) }
      for (const name of uniqueFields[collection]) { const holder = doc[name] == null ? undefined : unique.get(`${collection}.${name}=${doc[name]}`); if (holder && holder !== owner) collisions.push(`${collection}.${name}`) }
    }
  }
  if (collisions.length) throw new ImportError(`${collisions.length} existing record value(s) collide with this bundle (first: ${collisions[0]}). Nothing was written.`)
}

// ---------------------------------------------------------------------------
// Run claim: one active import per database, owned through a lease on the run row

type Lease = { id: number; version: string; leaseMs: number; beatAt: number; history: Record<string, unknown>[]; startedAt: string }
async function claimRun(payload: Payload, runKey: string, source: ImportSource, leaseMs: number): Promise<Lease> {
  const claimed = await transaction(payload, SYSTEM, async req => {
    for (const run of await findAll(payload, 'import-runs', { status: { equals: 'running' } }, req)) {
      if (Date.now() - Date.parse(run.updatedAt) < leaseMs) throw new ImportError('Another import is already running on this database.')
      if (run.runKey !== runKey) await payload.update({ collection: 'import-runs', id: run.id, req, overrideAccess: true, depth: 0, data: { status: 'failed', finishedAt: now(), unresolved: [...(Array.isArray(run.unresolved) ? run.unresolved : []), 'interrupted:lease-expired'] } })
    }
    const existing = (await findAll(payload, 'import-runs', { runKey: { equals: runKey } }, req))[0]
    const oldCounts = existing?.counts && typeof existing.counts === 'object' ? existing.counts : {}
    const { attemptHistory: oldHistory, attemptStartedAt, ...previousCounts } = oldCounts
    const history: Record<string, unknown>[] = Array.isArray(oldHistory) ? oldHistory : []
    if (existing) history.push({ status: existing.status, startedAt: attemptStartedAt || existing.createdAt, finishedAt: existing.finishedAt || existing.updatedAt, counts: previousCounts, unresolved: existing.unresolved || [] })
    const startedAt = now()
    const data = { status: 'running' as const, sourceManifestHash: source.manifestHash, sourceType: source.kind, counts: { importerVersion: IMPORTER_VERSION, attemptStartedAt: startedAt, attemptHistory: history }, unresolved: [], finishedAt: null }
    const doc = existing
      ? await payload.update({ collection: 'import-runs', id: existing.id, data, req, overrideAccess: true, depth: 0 })
      : await payload.create({ collection: 'import-runs', data: { ...data, runKey }, req, overrideAccess: true, depth: 0 })
    return { id: doc.id, version: doc.updatedAt, history, startedAt }
  })
  return { ...claimed, leaseMs, beatAt: Date.now() }
}
async function touchRun(payload: Payload, lease: Lease, data: Record<string, unknown>) {
  if (data.counts && typeof data.counts === 'object') data = { ...data, counts: { ...data.counts, attemptStartedAt: lease.startedAt, attemptHistory: lease.history } }
  const version = await transaction(payload, SYSTEM, async req => {
    const run = await payload.findByID({ collection: 'import-runs', id: lease.id, depth: 0, req, overrideAccess: true })
    if (run.status !== 'running' || run.updatedAt !== lease.version) throw new ImportError('Import lease was lost to another process.')
    return (await payload.update({ collection: 'import-runs', id: lease.id, data, req, overrideAccess: true, depth: 0 })).updatedAt
  })
  lease.version = version
  lease.beatAt = Date.now()
}

// ---------------------------------------------------------------------------
// Import

const emptyCounts = () => ({ created: 0, updated: 0, unchanged: 0, preserved: 0, conflicts: 0, mediaCreated: 0, mediaExisting: 0, documentsCreated: 0, documentsExisting: 0, settingsUpdated: 0, settingsConflicts: 0 })
const finalList = (items: Set<string>) => {
  const list = [...items].sort()
  return list.length > MAX_UNRESOLVED ? [...list.slice(0, MAX_UNRESOLVED), `truncated:${list.length - MAX_UNRESOLVED}`] : list
}

export async function importBundle(payload: Payload, raw: unknown, mediaRoot: string, options: boolean | ImportOptions = {}) {
  const { dryRun = false, verifiedSourceManifestHash, leaseMs = 5 * 60_000 } = typeof options === 'boolean' ? { dryRun: options } : options
  // 1. Pure validation of every DTO, relation, path, slug and setting.
  const validated = validateBundle(raw)
  const { bundle } = validated
  assertIsolatedTarget(payload)
  const verification = sourceVerification(bundle.source, verifiedSourceManifestHash)
  const runKey = `import-v${IMPORTER_VERSION}-${stableHash(bundle)}`
  const unresolved = new Set<string>(validated.shadowed.map(({ id, route }) => `route-shadowed:${id}:${route}`))

  // 2. Source files: containment, size, type and digest, one bounded buffer at a time.
  const root = await realpath(mediaRoot)
  const sources: SourceFile[] = []
  for (const descriptor of validated.media) {
    const source = await locateSource(root, descriptor)
    await readVerifiedFile(source.filePath, descriptor.sha256)
    sources.push(source)
  }

  const documentSources: Array<{ descriptor: ImportDocument; filePath: string; sourcePath: string }> = []
  for (const descriptor of validated.documents) {
    const candidate = path.resolve(root, descriptor.path)
    if (!candidate.startsWith(root + path.sep)) throw new ImportError('Document path escaped the source root.')
    const info = await lstat(candidate)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new ImportError('Unsupported source document file.')
    const filePath = await realpath(candidate)
    if (!filePath.startsWith(root + path.sep)) throw new ImportError('Document path escaped the source root.')
    const bytes = await readVerifiedFile(filePath, descriptor.sha256)
    await verifyDocumentBytes(bytes)
    const source = mediaSourcePath(descriptor.url)
    if (!('path' in source)) throw new ImportError('Invalid document source URL.')
    documentSources.push({ descriptor, filePath, sourcePath: source.path })
  }

  // 3. Read-only database preflight.
  await assertNoForeignCollisions(payload, validated)
  const directory = mediaDirectory(payload)
  const storedMedia = await byLegacyKeys(payload, 'media', validated.media.map(media => media.key))
  const storedIssues = async (doc: Doc, descriptor: ImportMedia) => [doc.sourceHash !== descriptor.sha256 ? 'media-replacement' : null, await storedFileProblem(directory, doc)].filter(issue => issue).map(issue => `${issue}:${descriptor.key}`)
  const mediaIssues = new Map<string, string[]>()
  for (const { descriptor } of sources) {
    const doc = storedMedia.get(descriptor.key)
    if (doc) mediaIssues.set(descriptor.key, await storedIssues(doc, descriptor))
  }
  const ctx: Context = { ids: new Map(), mediaURL: new Map(), mediaByPath: validated.mediaByPath, mediaKeys: new Set(validated.media.map(media => media.key)), documentByPath: validated.documentByPath, documentURL: new Map() }
  const mediaURL = (doc: Doc) => typeof doc.url === 'string' ? new URL(doc.url, 'http://localhost').pathname : undefined
  const documentDirectory = path.resolve((payload.collections.documents.config.upload as { staticDir: string }).staticDir)
  if (documentDirectory !== path.join(directory, 'documents')) throw new ImportError('Document storage does not target the isolated media directory.')
  const storedDocuments = await byLegacyKeys(payload, 'documents', validated.documents.map(doc => doc.key))
  const documentIssues = new Map<string, string[]>()
  for (const source of documentSources) {
    const { descriptor, sourcePath } = source
    const existing = storedDocuments.get(descriptor.key)
    const claimed = (await findAll(payload, 'documents', { legacyPath: { equals: sourcePath } }))[0]
    if (claimed && claimed.legacyKey !== descriptor.key) throw new ImportError('Document URL belongs to a different stored record.')
    if (existing) {
      const problem = await storedFileProblem(documentDirectory, existing)
      const issues = [existing.sourceHash !== descriptor.sha256 ? `document-replacement:${descriptor.key}` : null, existing.legacyPath !== sourcePath ? `document-route-changed:${descriptor.key}` : null, problem ? `${problem.replace(/^media-/, 'document-')}:${descriptor.key}` : null].filter(Boolean) as string[]
      documentIssues.set(descriptor.key, issues)
    }
  }


  // Run the complete mapping/normalization preflight before claiming a run or
  // uploading any files. A small source can expand during HTML sanitization.
  {
    const plan = { ...emptyCounts(), mediaCreated: 0 }
    // Live review must reflect committed IDs, not placeholder projections.
    const planUnresolved = dryRun ? unresolved : new Set(unresolved)
    sources.forEach(({ descriptor }, index) => {
      const doc = storedMedia.get(descriptor.key)
      ctx.ids.set('media:' + descriptor.key, doc?.id ?? -(index + 1))
      // Reserve the full supported filename length for not-yet-stored media,
      // so preflight cannot underestimate normalized image markup.
      const url = doc ? mediaURL(doc) : `/api/media/file/${'x'.repeat(255)}`
      if (url) ctx.mediaURL.set(descriptor.key, url)
      if (doc) plan.mediaExisting++; else plan.mediaCreated++
      for (const issue of mediaIssues.get(descriptor.key) || []) planUnresolved.add(issue)
    })
    documentSources.forEach(({ descriptor }, index) => {
      const doc = storedDocuments.get(descriptor.key)
      ctx.documentURL.set(descriptor.key, doc ? mediaURL(doc)! : `/api/documents/file/dry-run-${index}.pdf`)
      if (doc) plan.documentsExisting++; else plan.documentsCreated++
      for (const issue of documentIssues.get(descriptor.key) || []) planUnresolved.add(issue)
    })
    const ours = new Map<string, Doc>()
    for (const collection of importCollections) for (const [key, doc] of await byLegacyKeys(payload, collection, validated.entities.filter(entity => entity.collection === collection).map(entity => entity.key))) ours.set(`${collection}:${key}`, doc)
    validated.entities.forEach((entity, index) => {
      const prepared = prepare(entity, ctx), previous = ours.get(entity.id), decision = decide(entity.collection, previous, prepared)
      ctx.ids.set(entity.id, previous?.id ?? -(1_000_000 + index))
      const action = decision.action === 'create' ? 'created' : decision.action === 'update' ? 'updated' : decision.action === 'conflict' ? 'conflicts' : decision.action
      plan[action]++
      if (decision.action === 'conflict') planUnresolved.add(`${decision.reason}:${entity.id}`)
      for (const note of prepared.notes) planUnresolved.add(note)
    })
    if (validated.settings) for (const name of await settingsChanges(payload, validated.settings, ctx).then(result => result.conflicts)) planUnresolved.add(`settings-conflict:${name}`)
    if (dryRun) return { dryRun: true as const, runKey, status: 'dry-run' as const, sourceComplete: false, sourceVerification: verification, entities: validated.entities.length, media: sources.length, documents: documentSources.length, plan, unresolved: finalList(unresolved), checked: ['bundle-schema', 'relations', 'paths', 'media-digests', 'database-collisions', 'stored-media-files', 'manual-edits', 'variant-topology', 'session-capacity', 'html-images', 'public-pdf-documents', 'settings'] }
  }
  // Placeholder relation IDs belong only to the read-only plan. Live mapping
  // must resolve committed records and actual stored media URLs.
  ctx.ids.clear(); ctx.mediaURL.clear(); ctx.documentURL.clear()

  // 4. Live import under an exclusive run claim.
  const lease = await claimRun(payload, runKey, bundle.source, leaseMs)
  const counts = emptyCounts()
  const heartbeat = async () => { if (Date.now() - lease.beatAt > lease.leaseMs / 3) await touchRun(payload, lease, { counts: { importerVersion: IMPORTER_VERSION, ...counts } }) }
  try {
    // Uploads are outside SQL transactions because files live on disk; the stable
    // legacy key makes a resumed run reuse whatever an interrupted run stored.
    for (const source of sources) {
      await heartbeat()
      const { descriptor } = source
      let doc = (await findAll(payload, 'media', { legacyKey: { equals: descriptor.key } }))[0]
      // A file stored after preflight (by an interrupted run) is checked here instead.
      const issues = doc ? (mediaIssues.get(descriptor.key) ?? await storedIssues(doc, descriptor)) : []
      if (!doc) {
        // Re-verify immediately before upload so a file swapped after preflight is never stored.
        const bytes = await readVerifiedFile(source.filePath, descriptor.sha256)
        doc = await payload.create({ collection: 'media', context: { systemAction: SYSTEM }, overrideAccess: true, depth: 0, data: { alt: descriptor.alt || '', legacyKey: descriptor.key, sourceHash: descriptor.sha256, importRun: runKey }, file: { data: bytes, mimetype: source.mime, name: descriptor.sha256 + source.extension, size: bytes.length } }) as unknown as Doc
        const problem = await storedFileProblem(directory, doc)
        if (problem) issues.push(`${problem}:${descriptor.key}`)
        counts.mediaCreated++
      } else counts.mediaExisting++
      ctx.ids.set('media:' + descriptor.key, doc.id)
      const url = mediaURL(doc)
      if (url) ctx.mediaURL.set(descriptor.key, url)
      for (const issue of issues) unresolved.add(issue)
    }

    for (const source of documentSources) {
      await heartbeat()
      const { descriptor, filePath, sourcePath } = source
      let doc = (await findAll(payload, 'documents', { legacyKey: { equals: descriptor.key } }))[0]
      if (!doc) {
        const bytes = await readVerifiedFile(filePath, descriptor.sha256)
        doc = await payload.create({ collection: 'documents', context: { systemAction: SYSTEM }, overrideAccess: true, depth: 0, data: { title: descriptor.title, legacyKey: descriptor.key, legacyPath: sourcePath, sourceHash: descriptor.sha256, importRun: runKey }, file: { data: bytes, mimetype: 'application/pdf', name: descriptor.sha256 + '.pdf', size: bytes.length } }) as unknown as Doc
        counts.documentsCreated++
      } else counts.documentsExisting++
      const url = mediaURL(doc)
      if (url) ctx.documentURL.set(descriptor.key, url)
      const issues = documentIssues.get(descriptor.key) || []
      const problem = await storedFileProblem(documentDirectory, doc)
      for (const issue of [...issues, ...(problem ? [`${problem.replace(/^media-/, 'document-')}:${descriptor.key}`] : [])]) unresolved.add(issue)
      // Preserve staff edits and original bytes; source replacement is review-only.
    }

    for (const entity of validated.entities) {
      await heartbeat()
      const prepared = prepare(entity, ctx)
      const outcome = await transaction(payload, SYSTEM, async req => {
        const previous = (await findAll(payload, entity.collection, { legacyKey: { equals: entity.key } }, req))[0]
        const decision = decide(entity.collection, previous, prepared)
        if (decision.action !== 'create' && decision.action !== 'update') return { id: previous!.id, decision }
        const bookkeeping = { legacyKey: entity.key, importRun: runKey, importedAt: now() }
        const written = decision.action === 'create'
          ? await payload.create({ collection: entity.collection, data: { ...createData(entity.collection, prepared), ...bookkeeping, sourceHash: 'pending' } as never, req, overrideAccess: true, depth: 0 })
          : await payload.update({ collection: entity.collection, id: previous!.id, data: { ...decision.data, ...bookkeeping } as never, req, overrideAccess: true, depth: 0 })
        // Record what was actually stored, so any later staff change is detectable.
        const stored = await payload.findByID({ collection: entity.collection, id: written.id, depth: 0, req, overrideAccess: true }) as unknown as Doc
        await payload.update({ collection: entity.collection, id: written.id, data: { sourceHash: `v2:${prepared.hash}:${contentProjectionHash(entity.collection, stored)}` } as never, req, overrideAccess: true, depth: 0 })
        return { id: written.id as number, decision }
      })
      // Counters and review items only after the transaction has committed (retries cannot double count).
      ctx.ids.set(entity.id, outcome.id)
      const { decision } = outcome
      if (decision.action === 'create') counts.created++
      else if (decision.action === 'update') counts.updated++
      else if (decision.action === 'conflict') { counts.conflicts++; unresolved.add(`${decision.reason}:${entity.id}`) }
      else counts[decision.action]++
      for (const note of prepared.notes) unresolved.add(note)
    }

    if (validated.settings) {
      const settings = validated.settings
      const result = await transaction(payload, SYSTEM, async req => {
        const changes = await settingsChanges(payload, settings, ctx, req)
        if (Object.keys(changes.data).length) await payload.updateGlobal({ slug: 'settings', data: changes.data, req, overrideAccess: true, depth: 0 })
        return changes
      })
      counts.settingsUpdated += Object.keys(result.data).length
      counts.settingsConflicts += result.conflicts.length
      for (const name of result.conflicts) unresolved.add(`settings-conflict:${name}`)
    }

    // 5. Reconcile every bundle key against the database on every run.
    const reconciliation = await reconcile(payload, validated, verification === 'verified', unresolved)
    const status = verification === 'verified' && unresolved.size === 0 ? 'complete' as const : 'needs-review' as const
    const list = finalList(unresolved)
    await touchRun(payload, lease, { status, counts: { importerVersion: IMPORTER_VERSION, sourceVerification: verification, ...counts, reconciliation }, unresolved: list, finishedAt: now() })
    return { dryRun: false as const, runKey, status, sourceComplete: status === 'complete', sourceVerification: verification, counts, reconciliation, unresolved: list }
  } catch (error) {
    await touchRun(payload, lease, { status: 'failed', counts: { importerVersion: IMPORTER_VERSION, sourceVerification: verification, ...counts, failureType: error instanceof Error ? error.name : 'UnknownError' }, unresolved: finalList(unresolved), finishedAt: now() }).catch(() => undefined)
    throw error
  }
}

/** Settings have no provenance field: fill empty values, keep equal ones, report anything else. */
async function settingsChanges(payload: Payload, settings: Record<string, unknown>, ctx: Context, req?: PayloadRequest) {
  const current = await payload.findGlobal({ slug: 'settings', depth: 0, overrideAccess: true, req }) as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}, conflicts: string[] = []
  for (const [name, value] of Object.entries(settings)) {
    const target = name === 'heroImage' ? ctx.ids.get(value as string) ?? null : value
    const existing = name === 'heroImage' ? idOf(current[name]) : current[name]
    if (existing == null || existing === '') data[name] = target
    else if (existing !== target) conflicts.push(name)
  }
  return { data, conflicts }
}

async function reconcile(payload: Payload, validated: ValidatedBundle, fullSource: boolean, unresolved: Set<string>) {
  const result: Record<string, { expected: number; found: number; notInBundle: number }> = {}
  const groups: Array<[CollectionSlug, string[]]> = [['media', validated.media.map(media => media.key)], ['documents', validated.documents.map(doc => doc.key)], ...importCollections.map(collection => [collection, validated.entities.filter(entity => entity.collection === collection).map(entity => entity.key)] as [CollectionSlug, string[]])]
  for (const [collection, keys] of groups) {
    const present = new Set((await findAll(payload, collection, { legacyKey: { exists: true } }, undefined, { legacyKey: true })).map(doc => doc.legacyKey as string))
    const expected = new Set(keys)
    const missing = keys.filter(key => !present.has(key)), extra = [...present].filter(key => !expected.has(key))
    for (const key of missing) unresolved.add(`reconcile-missing:${collection}:${key}`)
    // A partial capture legitimately leaves earlier records untouched; a full dump must account for them.
    if (fullSource) for (const key of extra) unresolved.add(`not-in-bundle:${collection}:${key}`)
    result[collection] = { expected: keys.length, found: keys.length - missing.length, notInBundle: extra.length }
  }
  return result
}
