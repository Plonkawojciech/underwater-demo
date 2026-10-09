import type { Where } from 'payload'
import {
  canonicalPath, categoryHref, contentHref, courseHref, excerpt, mediaUrl, normalizeSegments,
  plainText, productHref, type CourseDoc,
} from './presentation'
import { APP_ROUTES, FIXED, isAppRoute, resolveSourceRoute, type FixedRoute, type RouteCollection, type RouteFinder } from './source-routes'

/** Only routing fields, never customer records or tokens, enter the sitemap. */
export type SitemapDocument = { id: number; published?: boolean | null; legacyPath?: string | null; slug?: string | null; path?: string | null }
export type SitemapRecords = Partial<Record<Exclude<RouteCollection, 'redirects'>, SitemapDocument[]>>
export const SITEMAP_COLLECTIONS = ['products', 'categories', 'courses', 'pages', 'trips', 'albums', 'events'] as const

function originOf(value: string): string | null {
  try {
    const u = new URL(value)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null
    return u.origin
  } catch { return null }
}

/** Reject encoded separators/traversal and application-only addresses before making a URL. */
export function publicSeoPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[?#\\\s\u0000-\u001f\u007f]/.test(value)) return null
  if (value === '/') return '/'
  const pathname = value.replace(/\/+$/, '')
  const n = normalizeSegments(pathname.slice(1).split('/'))
  if (!n || isAppRoute(n.path)) return null
  if (/[?#%\\\s\u0000-\u001f\u007f]/.test(n.requested)) return null
  const first = n.segments[0].toLowerCase().replace(/\.html$/i, '')
  if (APP_ROUTES.includes(first) || ['login', 'logout', 'logowanie', 'rejestracja', 'reset', 'remind', 'token', 'robots', 'sitemap', 'favicon'].includes(first)) return null
  if (n.path.startsWith('component/user') || n.path.startsWith('component/users')) return null
  return n.requested
}

export function seoUrl(path: string | null | undefined, origin: string): string | null {
  const safePath = publicSeoPath(path), safeOrigin = originOf(origin)
  if (!safePath || !safeOrigin) return null
  try { return new URL(safePath, safeOrigin).href } catch { return null }
}

const KIND_COLLECTION = { product: 'products', category: 'categories', course: 'courses', page: 'pages', trip: 'trips', album: 'albums', event: 'events' } as const

function documentPath(collection: (typeof SITEMAP_COLLECTIONS)[number], doc: SitemapDocument): string | null {
  const built = collection === 'products' ? (doc.slug ? productHref(doc.slug) : null)
    : collection === 'categories' ? (doc.slug ? categoryHref(doc.slug) : null)
      : collection === 'courses' ? (doc.slug ? courseHref(doc.slug) : null)
        : contentHref(doc.path)
  return publicSeoPath(canonicalPath(built, doc.legacyPath))
}

/** Indexed lookups implement the resolver's exact equals/in queries; no HTTP probes or N+1 DB reads. */
function sitemapFinder(records: SitemapRecords): RouteFinder {
  const indexes = new Map<string, Map<string, SitemapDocument[]>>()
  for (const collection of SITEMAP_COLLECTIONS) {
    for (const doc of records[collection] || []) {
      if (doc.published !== true) continue
      for (const field of ['legacyPath', 'slug', 'path'] as const) {
        const value = doc[field]
        if (!value) continue
        const key = `${collection}:${field}`
        let values = indexes.get(key)
        if (!values) indexes.set(key, values = new Map())
        const matches = values.get(value) || []
        matches.push(doc)
        values.set(value, matches)
      }
    }
  }
  return async <T>(collection: RouteCollection, where: Where): Promise<T | null> => {
    if (collection === 'redirects') return null
    const entries = Object.entries(where)
    if (entries.length !== 1) throw new Error('Unsupported sitemap routing lookup.')
    const [field, raw] = entries[0]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Unsupported sitemap routing operator.')
    const operation = raw as { equals?: unknown; in?: unknown }
    const candidates = Array.isArray(operation.in) ? operation.in : [operation.equals]
    const values = indexes.get(`${collection}:${field}`)
    const matches = candidates.flatMap((value) => typeof value === 'string' ? values?.get(value) || [] : [])
    // publicFind is ordered by id. The resolver always picks that first published record.
    const doc = matches.sort((a, b) => a.id - b.id)[0]
    return (doc || null) as T | null
  }
}

/** Include one canonical URL per reachable record, following the same collision order as the pages. */
export async function sitemapPaths(records: SitemapRecords, fixedCanonicals: Record<FixedRoute, string>): Promise<string[]> {
  const find = sitemapFinder(records)
  const candidates = new Set<string>(['/', ...Object.values(fixedCanonicals)])
  for (const collection of SITEMAP_COLLECTIONS) for (const doc of records[collection] || []) {
    if (doc.published !== true) continue
    const path = documentPath(collection, doc)
    if (path) candidates.add(path)
  }
  // All fixed section aliases may carry a captured canonical path in the CMS.
  for (const key of Object.keys(FIXED)) candidates.add(`/${key}.html`)
  const result = new Set<string>(['/'])
  for (const candidate of candidates) {
    if (candidate === '/') continue
    const safe = publicSeoPath(candidate)
    if (!safe) continue
    const resolved = await resolveSourceRoute(safe.slice(1), find, { redirects: false, depth: false })
    if (!resolved || resolved.kind === 'redirect') continue
    const canonical = resolved.kind === 'fixed'
      ? publicSeoPath(canonicalPath(fixedCanonicals[resolved.route], resolved.source?.legacyPath))
      : documentPath(KIND_COLLECTION[resolved.kind], resolved.doc)
    if (!canonical) continue
    // A malformed legacy canonical can claim another record's address: do not publish it.
    const destination = await resolveSourceRoute(canonical.slice(1), find, { redirects: false, depth: false })
    const same = destination?.kind === resolved.kind && (destination.kind === 'fixed'
      ? resolved.kind === 'fixed' && destination.route === resolved.route
      : resolved.kind !== 'fixed' && destination.doc.id === resolved.doc.id)
    if (same) result.add(canonical)
  }
  return [...result].sort()
}

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Source dates, priority and update cadence are deliberately omitted when not known. */
export function sitemapXml(paths: string[], origin: string): string {
  if (!originOf(origin)) throw new Error('A valid configured sitemap origin is required.')
  const urls = [...new Set(paths.flatMap((path) => seoUrl(path, origin) || []))].sort()
  if (urls.length > 50_000) throw new Error('Sitemap index required above 50,000 canonical URLs.')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xmlText(url)}</loc></url>`).join('\n')}\n</urlset>\n`
}

/** schema.org Course from visible facts only; no inferred accreditation, price, rating or schedule. */
export function courseSchema(course: CourseDoc, origin: string) {
  const url = seoUrl(canonicalPath(courseHref(course.slug), course.legacyPath), origin)
  const name = course.name?.trim()
  if (!url || !name || course.published === false) return null
  const description = excerpt(plainText(course.lead || course.body || ''), 1000)
  const imagePath = mediaUrl(course.image, 'full')
  let image: string | null = null
  try { if (imagePath && originOf(origin)) image = new URL(imagePath, origin).href } catch { /* malformed media metadata is omitted */ }
  return {
    '@context': 'https://schema.org', '@type': 'Course', name, url,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    provider: { '@type': 'Organization', name: 'Underwater.pl', url: originOf(origin)! },
  }
}
