import { createHash } from 'node:crypto'
import { fixedRoute, isAppRoute, routeKey } from '../source-routes'

export { routeKey }

// Bump whenever validation, mapping or sanitising changes what a bundle writes.
// The version is part of every run key and every stored entity hash, so a new
// importer re-reconciles all records instead of trusting an older result.
export const IMPORTER_VERSION = 3

export const importCollections = ['categories', 'products', 'courses', 'course-sessions', 'pages', 'trips', 'albums', 'events', 'redirects'] as const
export type ImportCollection = typeof importCollections[number]
export type ImportEntity = { collection: ImportCollection; key: string; data: Record<string, unknown>; relations?: Record<string, string | string[] | null> }
export type ImportMedia = { key: string; path: string; sha256: string; alt?: string; url?: string }
export type ImportMediaURL = { key: string; url: string }
export type ImportSource = { kind: 'joomla-dump' | 'public-pages' | 'demo'; manifestHash: string; capturedAt: string; complete: boolean }
export type ImportBundle = { version: 1; source: ImportSource; media: ImportMedia[]; mediaUrls?: ImportMediaURL[]; entities: ImportEntity[]; settings?: Record<string, unknown> }
export class ImportError extends Error { constructor(message: string) { super(message); this.name = 'ImportError' } }

type Scalar =
  | { kind: 'text'; max: number } | { kind: 'textarea'; max: number } | { kind: 'html' }
  | { kind: 'int'; min: number; max: number } | { kind: 'number'; min: number; max: number }
  | { kind: 'money' } | { kind: 'cents' } | { kind: 'stock' } | { kind: 'date' } | { kind: 'bool' }
  | { kind: 'select'; options: string[] } | { kind: 'path' } | { kind: 'slug'; nested: boolean } | { kind: 'key' } | { kind: 'media' }
type FieldSpec = (Scalar | { kind: 'rows'; max: number; fields: Record<string, FieldSpec> } | { kind: 'group'; fields: Record<string, FieldSpec> }) & { required?: boolean }
type RelationSpec = { target: ImportCollection | 'media'; many: boolean; required?: boolean }

const text = (max = 500, required = false): FieldSpec => ({ kind: 'text', max, required })
const area = (max = 20_000, required = false): FieldSpec => ({ kind: 'textarea', max, required })
const html: FieldSpec = { kind: 'html' }
const int = (min: number, max: number, required = false): FieldSpec => ({ kind: 'int', min, max, required })
const date = (required = false): FieldSpec => ({ kind: 'date', required })
const bool: FieldSpec = { kind: 'bool' }
const cents: FieldSpec = { kind: 'cents' }
const money: FieldSpec = { kind: 'money' }
const media = (required = false): FieldSpec => ({ kind: 'media', required })
const rows = (fields: Record<string, FieldSpec>, max = 500): FieldSpec => ({ kind: 'rows', max, fields })

const common: Record<string, FieldSpec> = {
  published: { kind: 'bool', required: true },
  legacyPath: { kind: 'path' },
  sourceUpdatedAt: date(),
  seo: { kind: 'group', fields: { title: text(300), description: area(2000), image: media() } },
}
// Mirrors the Payload collections. Anything not listed (ids, stock reservations,
// import bookkeeping, roles, tokens) is rejected before the database is touched.
export const fieldSpecs: Record<ImportCollection, Record<string, FieldSpec>> = {
  categories: { name: text(300, true), slug: { kind: 'slug', nested: true, required: true }, vmId: int(1, 2_147_483_647), order: int(-1_000_000, 1_000_000) },
  products: {
    name: text(300, true), slug: { kind: 'slug', nested: true, required: true }, vmId: int(1, 2_147_483_647, true),
    manufacturer: text(300), sku: text(200), price: money, priceCents: cents, salePrice: money, salePriceCents: cents,
    taxRate: { kind: 'number', min: 0, max: 100 }, stock: { kind: 'stock' }, short: area(5000), body: html,
    features: rows({ text: text(1000, true) }),
    variants: rows({ label: text(300, true), sku: text(200), legacyKey: { kind: 'key' }, priceCents: cents, stock: { kind: 'stock' }, image: media() }),
    specs: rows({ key: text(300, true), value: text(2000, true) }),
    featured: bool, warranty: text(300),
  },
  courses: {
    name: text(300, true), slug: { kind: 'slug', nested: false, required: true },
    org: { kind: 'select', options: ['PADI', 'IANTD', 'TDI/SDI', 'Freediving', 'Inne'] },
    level: { kind: 'select', options: ['intro', 'basic', 'advanced', 'rescue', 'pro', 'specialty'] },
    maxDepth: { kind: 'number', min: 0, max: 400 }, nextDate: date(), price: money, minAge: int(0, 120),
    lead: area(5000), body: html, sections: rows({ title: text(500, true), body: area(20_000, true) }), includes: rows({ text: text(1000, true) }),
    featured: bool, order: int(-1_000_000, 1_000_000),
  },
  'course-sessions': { title: text(300, true), startsAt: date(true), endsAt: date(), location: text(500), priceCents: cents, capacity: int(1, 100_000) },
  pages: { title: text(500, true), path: { kind: 'path', required: true }, kind: { kind: 'select', options: ['page', 'news', 'report', 'legal'], required: true }, lead: area(5000), body: html, publishedAt: date() },
  trips: { title: text(500, true), path: { kind: 'path', required: true }, location: text(500), startsAt: date(), endsAt: date(), priceCents: cents, lead: area(5000), body: html },
  albums: { title: text(500, true), path: { kind: 'path', required: true }, description: area(5000), date: date(), photos: rows({ image: media(true), caption: text(1000) }, 2000) },
  events: { title: text(500, true), startsAt: date(true), endsAt: date(), location: text(500), path: { kind: 'path' }, body: html },
  redirects: { from: { kind: 'path', required: true }, to: { kind: 'path', required: true }, reason: text(500) },
}
for (const collection of importCollections) Object.assign(fieldSpecs[collection], common)

export const relationSpecs: Record<ImportCollection, Record<string, RelationSpec>> = {
  categories: { parent: { target: 'categories', many: false }, image: { target: 'media', many: false } },
  products: { category: { target: 'categories', many: false, required: true }, categories: { target: 'categories', many: true }, images: { target: 'media', many: true } },
  courses: { image: { target: 'media', many: false }, gallery: { target: 'media', many: true } },
  'course-sessions': { course: { target: 'courses', many: false, required: true } },
  pages: { image: { target: 'media', many: false }, album: { target: 'albums', many: false } },
  trips: { image: { target: 'media', many: false }, album: { target: 'albums', many: false } },
  albums: {},
  events: { courseSession: { target: 'course-sessions', many: false }, trip: { target: 'trips', many: false } },
  redirects: {},
}
const settingsSpecs: Record<string, FieldSpec> = {
  banner: text(500), heroTitle: text(500), heroText: area(5000), heroImage: media(), priceGuarantee: area(5000),
  phone: text(100), email: text(254), address: area(2000), nip: text(32), facebook: text(500), youtube: text(500),
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const INVISIBLE = /\p{Cf}/u
const KEY = /^[\p{L}\p{N}_.:/-]{1,300}$/u
const SEGMENT = /^[\p{L}\p{M}\p{N}_~-][\p{L}\p{M}\p{N}_.~-]*$/u
export const OWN_HOSTS = ['underwater.pl', 'www.underwater.pl']

export const isKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value) && value === value.normalize('NFC') && !value.split('/').some(part => part === '..' || part === '.')

/**
 * Canonical, decoded, NFC-normalised site path without a trailing slash (except `/`): Next
 * answers `/a/` with a redirect to `/a`, so only the slashless form is reachable.
 * Rejects anything that could change meaning after decoding.
 */
export function legacyPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\s?#]/.test(value) || CONTROL.test(value)) throw new ImportError('Invalid canonical source path.')
  if (/%(?:2f|5c|00|3f|23)/i.test(value)) throw new ImportError('Encoded separator in source path.')
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { throw new ImportError('Invalid encoded source path.') }
  decoded = decoded.normalize('NFC')
  const segments = decoded.split('/').slice(1)
  if (decoded.startsWith('//') || /\\/.test(decoded) || CONTROL.test(decoded) || INVISIBLE.test(decoded) || segments.some((part, index) => part === '.' || part === '..' || (!part && index < segments.length - 1))) throw new ImportError('Unsafe source path.')
  return decoded.length > 1 ? decoded.replace(/\/$/, '') : decoded
}
/**
 * True when the public site serves something else at `route`, so the record is never shown there.
 * A pages record whose legacy address is a fixed section is that section's title, SEO and introduction.
 */
export function shadowedRoute(route: string, collection?: ImportCollection, legacy?: unknown): boolean {
  if (isAppRoute(route)) return true
  if (!fixedRoute(route)) return false
  return !(collection === 'pages' && typeof legacy === 'string' && routeKey(legacy) === route)
}
/**
 * Maps an image reference from source HTML or media metadata to a canonical own-site
 * path. External hosts, data URIs and unsafe paths never resolve to a media key.
 */
export function mediaSourcePath(src: string): { path: string } | { external: string } | { unsafe: true } {
  const value = src.trim()
  if (!value || value.length > 2048 || CONTROL.test(value)) return { unsafe: true }
  if (/^data:/i.test(value)) return { external: 'data' }
  let raw = value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    let url: URL
    try { url = new URL(value.startsWith('//') ? 'https:' + value : value) } catch { return { unsafe: true } }
    if (!['http:', 'https:'].includes(url.protocol)) return { external: url.protocol.replace(':', '') }
    if (!OWN_HOSTS.includes(url.hostname)) return { external: url.hostname }
    if (url.username || url.password || url.port) return { unsafe: true }
    raw = url.pathname
  } else raw = '/' + value.split(/[?#]/)[0].replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  raw = raw.split(/[?#]/)[0].replace(/ /g, '%20')
  try { return { path: legacyPath(raw) } } catch { return { unsafe: true } }
}
export function stableHash(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : record(item) ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, normalize(item[key])])) : item
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

export type PreparedEntity = {
  collection: ImportCollection; key: string; id: string
  data: Record<string, unknown>
  relations: Record<string, string | string[] | null>
  dependencies: string[]
  routes: string[]
  unique: Array<{ field: string; value: string | number }>
}
export type ValidatedBundle = {
  bundle: ImportBundle
  entities: PreparedEntity[]
  media: ImportMedia[]
  mediaByPath: Map<string, string>
  settings?: Record<string, unknown>
  shadowed: Array<{ id: string; route: string }>
}

function fail(where: string, message: string): never { throw new ImportError(`${where}: ${message}`) }
function scalar(spec: Scalar, value: unknown, where: string, mediaKeys: Set<string>): unknown {
  switch (spec.kind) {
    case 'text': if (typeof value !== 'string' || value.length > spec.max || CONTROL.test(value)) fail(where, 'expected single-line text'); return value
    case 'textarea': if (typeof value !== 'string' || value.length > spec.max || CONTROL_EXCEPT_WHITESPACE.test(value)) fail(where, 'expected text'); return value
    case 'html': if (typeof value !== 'string' || value.length > 1_000_000) fail(where, 'expected HTML up to 1 MB'); return value
    case 'int': if (!Number.isSafeInteger(value) || (value as number) < spec.min || (value as number) > spec.max) fail(where, 'expected integer in range'); return value
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) fail(where, 'expected number in range'); return value
    case 'money': if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) fail(where, 'expected non-negative amount with at most two decimals'); return value
    case 'cents': if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000_000) fail(where, 'expected non-negative integer cents'); return value
    case 'stock': if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) fail(where, 'expected non-negative integer stock or null'); return value
    case 'date': { if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) fail(where, 'expected ISO date'); return new Date(value).toISOString() }
    case 'bool': if (typeof value !== 'boolean') fail(where, 'expected boolean'); return value
    case 'select': if (typeof value !== 'string' || !spec.options.includes(value)) fail(where, 'unsupported option'); return value
    case 'path': return legacyPath(value)
    case 'key': if (!isKey(value)) fail(where, 'expected source key'); return value
    case 'slug': {
      if (typeof value !== 'string') fail(where, 'expected slug')
      const slug = value.normalize('NFC')
      const parts = slug.split('/')
      if (slug.length > 200 || INVISIBLE.test(slug) || (!spec.nested && parts.length > 1) || !parts.every(part => SEGMENT.test(part) && !/^\.+$/.test(part))) fail(where, 'unsafe slug')
      return slug
    }
    case 'media': {
      // Nested media is only ever a source reference; numeric database ids are never accepted.
      if (typeof value !== 'string' || !value.startsWith('media:') || !mediaKeys.has(value.slice(6))) fail(where, 'expected a media:<key> reference to a bundled file')
      return value
    }
  }
}
function field(spec: FieldSpec, value: unknown, where: string, mediaKeys: Set<string>): unknown {
  if (value === null || value === undefined) {
    if (spec.required) fail(where, 'required')
    // Absent lists and groups are written as empty so a re-import clears stale source values.
    if (spec.kind === 'rows') return []
    if (spec.kind === 'group') return field(spec, {}, where, mediaKeys)
    return null
  }
  if (spec.kind === 'group') {
    if (!record(value)) fail(where, 'expected object')
    for (const name of Object.keys(value)) if (!(name in spec.fields)) fail(`${where}.${name}`, 'unsupported field')
    return Object.fromEntries(Object.entries(spec.fields).map(([name, sub]) => [name, field(sub, value[name], `${where}.${name}`, mediaKeys)]))
  }
  if (spec.kind === 'rows') {
    if (!Array.isArray(value) || value.length > spec.max) fail(where, 'expected bounded list')
    return value.map((row, index) => {
      // Row `id`s are local to the target database; a source row can never select one.
      if (!record(row)) fail(`${where}[${index}]`, 'expected object')
      for (const name of Object.keys(row)) if (!(name in spec.fields)) fail(`${where}[${index}].${name}`, 'unsupported field')
      return Object.fromEntries(Object.entries(spec.fields).map(([name, sub]) => [name, field(sub, row[name], `${where}[${index}].${name}`, mediaKeys)]))
    })
  }
  return scalar(spec, value, where, mediaKeys)
}

function prepareEntity(raw: unknown, index: number, mediaKeys: Set<string>): PreparedEntity {
  const at = `entity #${index}`
  if (!record(raw) || Object.keys(raw).some(name => !['collection', 'key', 'data', 'relations'].includes(name))) fail(at, 'invalid entity envelope')
  if (!importCollections.includes(raw.collection as ImportCollection)) fail(at, 'unsupported collection')
  const collection = raw.collection as ImportCollection, where = `${collection} #${index}`
  if (!isKey(raw.key)) fail(where, 'invalid source key')
  if (!record(raw.data)) fail(where, 'missing data object')
  const specs = fieldSpecs[collection], relSpecs = relationSpecs[collection]
  for (const name of Object.keys(raw.data)) if (!(name in specs)) fail(`${where}.${name}`, 'unsupported field')
  const data: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(specs)) data[name] = field(spec, raw.data[name], `${where}.${name}`, mediaKeys)

  if (raw.relations != null && !record(raw.relations)) fail(where, 'relations must be an object')
  const relationsIn = (raw.relations || {}) as Record<string, unknown>
  for (const name of Object.keys(relationsIn)) if (!(name in relSpecs)) fail(`${where}.${name}`, 'unsupported relationship')
  const relations: Record<string, string | string[] | null> = {}, dependencies: string[] = []
  for (const [name, spec] of Object.entries(relSpecs)) {
    const value = relationsIn[name], rel = `${where}.${name}`
    const check = (reference: unknown) => {
      if (typeof reference !== 'string' || !reference.startsWith(spec.target + ':') || !isKey(reference.slice(spec.target.length + 1))) fail(rel, `must reference ${spec.target}:<key>`)
      if (spec.target !== 'media') dependencies.push(reference)
      else if (!mediaKeys.has(reference.slice(6))) fail(rel, 'references media missing from the bundle')
      return reference
    }
    if (value === undefined || value === null || (spec.many && Array.isArray(value) && !value.length)) {
      if (spec.required) fail(rel, 'required relationship')
      relations[name] = spec.many ? [] : null
    } else if (spec.many) {
      if (!Array.isArray(value) || value.length > 500) fail(rel, 'expected a list of references')
      if (new Set(value).size !== value.length) fail(rel, 'duplicate reference')
      relations[name] = value.map(check)
    } else {
      if (typeof value !== 'string') fail(rel, 'expected a single reference')
      relations[name] = check(value)
    }
  }

  if (collection === 'products') {
    if (data.price == null && data.priceCents == null) fail(`${where}.price`, 'required (price or priceCents)')
    if (data.price != null && data.priceCents != null && Math.round((data.price as number) * 100) !== data.priceCents) fail(`${where}.price`, 'price and priceCents disagree')
    if (data.salePrice != null && data.salePriceCents != null && Math.round((data.salePrice as number) * 100) !== data.salePriceCents) fail(`${where}.salePrice`, 'salePrice and salePriceCents disagree')
    const variants = (data.variants || []) as Array<Record<string, unknown>>
    for (const name of ['legacyKey', 'sku', 'label'] as const) {
      const values = variants.map(variant => variant[name]).filter(value => value != null).map(value => String(value).normalize('NFC').trim().toLowerCase())
      if (new Set(values).size !== values.length) fail(`${where}.variants`, `duplicate variant ${name}`)
    }
    if (variants.length && data.stock != null) fail(`${where}.stock`, 'product stock is derived from variants')
  }
  if (collection === 'redirects' && routeKey(data.from as string) === routeKey(data.to as string)) fail(where, 'redirect points to itself')
  // The redirect hook refuses these addresses, so the importer must not start writing them.
  if (collection === 'redirects' && (isAppRoute(routeKey(data.from as string)) || fixedRoute(routeKey(data.from as string)))) fail(where, 'redirect would hide an application route or fixed section')
  for (const [start, end] of [['startsAt', 'endsAt']]) if (data[start] && data[end] && Date.parse(data[end] as string) < Date.parse(data[start] as string)) fail(where, 'end precedes start')

  const routes = new Set<string>()
  if (data.legacyPath) routes.add(routeKey(data.legacyPath as string))
  if (collection === 'products' || collection === 'categories') routes.add(data.slug as string)
  if (collection === 'courses') routes.add(`kursy-nurkowania/${data.slug}`)
  if (['pages', 'trips', 'albums', 'events'].includes(collection) && data.path) routes.add(routeKey(data.path as string))
  if (collection === 'redirects') routes.add(routeKey(data.from as string))
  const unique: PreparedEntity['unique'] = []
  if (['products', 'categories', 'courses'].includes(collection)) unique.push({ field: 'slug', value: data.slug as string })
  if (collection === 'products' || (collection === 'categories' && data.vmId != null)) unique.push({ field: 'vmId', value: data.vmId as number })
  if (['pages', 'trips', 'albums'].includes(collection)) unique.push({ field: 'path', value: data.path as string })
  if (collection === 'redirects') unique.push({ field: 'from', value: data.from as string })
  return { collection, key: raw.key as string, id: `${collection}:${raw.key}`, data, relations, dependencies, routes: [...routes], unique }
}

function prepareSettings(raw: unknown, mediaKeys: Set<string>): Record<string, unknown> {
  if (!record(raw)) throw new ImportError('settings: expected object')
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw)) {
    const spec = settingsSpecs[name]
    if (!spec) throw new ImportError(`settings.${name}: protected or unsupported field`)
    if (value == null) continue
    const normalized = field(spec, value, `settings.${name}`, mediaKeys)
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized as string)) throw new ImportError('settings.email: invalid address')
    if (name === 'facebook' || name === 'youtube') {
      let url: URL | undefined
      try { url = new URL(normalized as string) } catch { /* rejected below */ }
      const hosts = name === 'facebook' ? ['facebook.com'] : ['youtube.com', 'youtu.be']
      if (!url || url.protocol !== 'https:' || url.username || url.password || !hosts.some(host => url!.hostname === host || url!.hostname.endsWith('.' + host))) throw new ImportError(`settings.${name}: expected an HTTPS ${hosts[0]} address`)
    }
    result[name] = normalized
  }
  return result
}

/** Pure validation of the whole bundle. Throws before the caller performs any database read or write. */
export function validateBundle(value: unknown): ValidatedBundle {
  if (!record(value) || value.version !== 1 || !record(value.source) || !['joomla-dump', 'public-pages', 'demo'].includes(String(value.source.kind)) || typeof value.source.complete !== 'boolean' || !/^[a-f0-9]{64}$/.test(String(value.source.manifestHash)) || !Number.isFinite(Date.parse(String(value.source.capturedAt))) || !Array.isArray(value.entities) || !Array.isArray(value.media)) throw new ImportError('Invalid source bundle header.')
  if (Object.keys(value).some(name => !['version', 'source', 'media', 'mediaUrls', 'entities', 'settings'].includes(name))) throw new ImportError('Unsupported bundle section.')
  if (value.entities.length > 100_000 || value.media.length > 100_000) throw new ImportError('Bundle exceeds supported entity limit.')

  const mediaKeys = new Set<string>(), mediaByPath = new Map<string, string>()
  const mapURL = (url: unknown, key: string, label: string) => {
    if (typeof url !== 'string') throw new ImportError(`${label}: expected URL`)
    const resolved = mediaSourcePath(url)
    if (!('path' in resolved)) throw new ImportError(`${label}: media URL must be a safe own-site path`)
    const holder = mediaByPath.get(resolved.path)
    if (holder && holder !== key) throw new ImportError(`${label}: two media keys claim one source URL`)
    mediaByPath.set(resolved.path, key)
  }
  value.media.forEach((media, index) => {
    const label = `media #${index}`
    if (!record(media) || Object.keys(media).some(name => !['key', 'path', 'sha256', 'alt', 'url'].includes(name)) || !isKey(media.key) || typeof media.path !== 'string' || media.path.length > 1024 || media.path.startsWith('/') || media.path.split('/').some(part => ['..', '.', ''].includes(part) || part.startsWith('.env')) || /[\\]/.test(media.path) || CONTROL.test(media.path) || !/^[a-f0-9]{64}$/.test(String(media.sha256)) || (media.alt != null && (typeof media.alt !== 'string' || media.alt.length > 1000 || CONTROL.test(media.alt)))) throw new ImportError(`${label}: invalid source media descriptor`)
    if (mediaKeys.has(media.key)) throw new ImportError(`${label}: duplicate source media identifier`)
    mediaKeys.add(media.key)
    if (media.url != null) mapURL(media.url, media.key, label)
  })
  if (value.mediaUrls != null) {
    if (!Array.isArray(value.mediaUrls) || value.mediaUrls.length > 200_000) throw new ImportError('mediaUrls: expected list')
    value.mediaUrls.forEach((entry, index) => {
      // Converter metadata may name images that were not downloaded; those stay unresolved.
      if (!record(entry) || !isKey(entry.key)) throw new ImportError(`mediaUrls #${index}: invalid entry`)
      mapURL(entry.url, entry.key, `mediaUrls #${index}`)
    })
  }
  // The snapshot-relative path is the weakest mapping and never overrides an explicit URL.
  for (const media of value.media as ImportMedia[]) {
    const resolved = mediaSourcePath('/' + media.path)
    if ('path' in resolved && !mediaByPath.has(resolved.path)) mediaByPath.set(resolved.path, media.key)
  }

  const entities = value.entities.map((entity, index) => prepareEntity(entity, index, mediaKeys))
  const ids = new Set<string>(), routes = new Map<string, string>(), unique = new Map<string, string>()
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new ImportError(`${entity.collection}: duplicate source entity identifier`)
    ids.add(entity.id)
    for (const route of entity.routes) {
      const holder = routes.get(route)
      if (holder && holder !== entity.id) throw new ImportError(`${entity.collection}: two source records claim one public address`)
      routes.set(route, entity.id)
    }
    for (const { field, value: item } of entity.unique) {
      const id = `${entity.collection}.${field}=${item}`
      if (unique.has(id)) throw new ImportError(`${entity.collection}.${field}: duplicate value`)
      unique.set(id, entity.id)
    }
  }
  for (const entity of entities) for (const dependency of entity.dependencies) if (!ids.has(dependency)) throw new ImportError(`${entity.collection}: unresolved source relationship`)

  // Redirect chains must terminate; a loop would bounce visitors forever.
  const redirectTo = new Map(entities.filter(entity => entity.collection === 'redirects').map(entity => [routeKey(entity.data.from as string), routeKey(entity.data.to as string)]))
  for (const start of redirectTo.keys()) {
    const seen = new Set<string>([start])
    for (let next = redirectTo.get(start); next !== undefined; next = redirectTo.get(next)) {
      if (seen.has(next)) throw new ImportError('redirects: redirect cycle')
      seen.add(next)
    }
  }
  const shadowed = entities.flatMap(entity => entity.routes.filter(route => shadowedRoute(route, entity.collection, entity.data.legacyPath)).map(route => ({ id: entity.id, route })))
  const settings = value.settings == null ? undefined : prepareSettings(value.settings, mediaKeys)
  return { bundle: value as unknown as ImportBundle, entities: orderedEntities(entities), media: [...value.media as ImportMedia[]].sort((a, b) => compare(a.key, b.key)), mediaByPath, settings, shadowed }
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
/**
 * Deterministic dependency order (Kahn, O(V + E)): independent of input order,
 * parents before children. Any remaining node means a relationship cycle.
 */
export function orderedEntities<T extends { collection: ImportCollection; key: string; dependencies?: string[]; relations?: Record<string, string | string[] | null> }>(entities: T[]): T[] {
  const rank = (entity: T) => importCollections.indexOf(entity.collection)
  const sorted = [...entities].sort((a, b) => rank(a) - rank(b) || compare(a.key, b.key))
  const index = new Map(sorted.map((entity, position) => [`${entity.collection}:${entity.key}`, position]))
  const indegree = new Array<number>(sorted.length).fill(0), dependents: number[][] = sorted.map(() => [])
  sorted.forEach((entity, position) => {
    const dependencies = entity.dependencies ?? Object.values(entity.relations || {}).flat().filter((reference): reference is string => typeof reference === 'string' && !reference.startsWith('media:'))
    for (const dependency of new Set(dependencies)) {
      const source = index.get(dependency)
      if (source === undefined) throw new ImportError('Unresolved source relationship.')
      indegree[position]++
      dependents[source].push(position)
    }
  })
  const queue = sorted.map((_, position) => position).filter(position => indegree[position] === 0), result: T[] = []
  for (let head = 0; head < queue.length; head++) {
    result.push(sorted[queue[head]])
    for (const next of dependents[queue[head]]) if (--indegree[next] === 0) queue.push(next)
  }
  if (result.length !== sorted.length) throw new ImportError('Source relationships contain a cycle.')
  return result
}
