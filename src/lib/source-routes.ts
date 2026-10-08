import type { Where } from 'payload'
import {
  legacyCandidates, normalizeSegments, pathCandidates,
  type AlbumDoc, type CategoryDoc, type CourseDoc, type EventDoc, type PageDoc, type ProductDoc, type TripDoc,
} from './presentation'

// Address rules shared by the public resolver, the redirect proxy, redirect validation and
// the importer, so none of them can disagree about what a visitor sees at an address.
// No framework imports: safe in the proxy, in collection hooks and in plain Node tests.

/** Section routes the application renders itself. The parser mirrors this list (FIXED_ROUTES). */
export const FIXED = {
  'sklep-nurkowy': 'shop',
  'kursy-nurkowania': 'courses',
  'kursy-nurkowania/kursy-nurkowania-padi-warszawa': 'courses',
  kontakt: 'contact',
  wyprawy: 'trips',
  'wyprawy-nurkowe': 'trips',
  kalendarz: 'calendar',
  aktualnosci: 'news',
  relacje: 'reports',
  'relacje-z-wypraw': 'reports',
  galerie: 'albums',
  galeria: 'albums',
} as const
export type FixedRoute = (typeof FIXED)[keyof typeof FIXED]
export const fixedRoute = (route: string): FixedRoute | undefined => Object.hasOwn(FIXED, route) ? FIXED[route as keyof typeof FIXED] : undefined

/** Exact first segments served by the application before the legacy catch-all route. */
export const APP_ROUTES = ['koszyk', 'newsletter', 'zgloszenie', 'platnosc-testowa', 'api', 'admin', 'media', '_next']
/** Home page aliases and application routes: no source record or redirect is ever served there. */
export const isAppRoute = (route: string) => route === '' || route === 'index' || route === 'index.php' || APP_ROUTES.includes(route.split('/')[0])

/** Address key as the public resolver sees it: no leading slash, no trailing slash or `.html`. */
export function routeKey(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.html$/i, '')
}

export type Resolved =
  | { kind: 'fixed'; route: FixedRoute; path: string; source?: PageDoc | null }
  | { kind: 'product'; doc: ProductDoc }
  | { kind: 'category'; doc: CategoryDoc }
  | { kind: 'course'; doc: CourseDoc }
  | { kind: 'page'; doc: PageDoc }
  | { kind: 'trip'; doc: TripDoc }
  | { kind: 'album'; doc: AlbumDoc }
  | { kind: 'event'; doc: EventDoc }
  | { kind: 'redirect'; to: string }

export type RouteCollection = 'products' | 'categories' | 'courses' | 'pages' | 'trips' | 'albums' | 'events' | 'redirects'
/** First published record matching `where`, or null. Callers decide access, depth and transaction. */
export type RouteFinder = <T>(collection: RouteCollection, where: Where, depth: number) => Promise<T | null>

type DocKind = Exclude<Resolved['kind'], 'fixed' | 'redirect'>
const COLLECTION: Record<DocKind, RouteCollection> = {
  product: 'products', category: 'categories', course: 'courses', page: 'pages', trip: 'trips', album: 'albums', event: 'events',
}
// Depth needed by each detail view (relations shown on the page).
const DEPTH: Record<DocKind, number> = { product: 2, category: 1, course: 1, page: 2, trip: 2, album: 1, event: 2 }
// When two records claim the same address, the earlier kind wins.
const ORDER: DocKind[] = ['product', 'category', 'course', 'page', 'trip', 'album', 'event']

const wrap = (kind: DocKind, doc: unknown) => ({ kind, doc }) as Resolved

async function firstOf(lookups: [DocKind, Promise<unknown>][]): Promise<Resolved | null> {
  const found = await Promise.all(lookups.map(async ([k, p]) => [k, await p] as const))
  for (const k of ORDER) {
    const hit = found.find(([kind, doc]) => kind === k && doc)
    if (hit) return wrap(hit[0], hit[1])
  }
  return null
}

/** A stored legacy path may keep the source's trailing slash; Next serves the request without it. */
const withSlash = (candidates: string[]) => [...new Set([...candidates, ...candidates.filter((c) => c.startsWith('/')).map((c) => c + '/')])]

/**
 * Order: fixed sections → published exact legacy path → course slug → product/category
 * slug (any depth, Unicode) → content path → redirect. `key` is the raw (encoded) path
 * without its leading slash. `redirects: false` answers "is there live content here?".
 */
export async function resolveSourceRoute(key: string, find: RouteFinder, options: { redirects?: boolean; depth?: boolean } = {}): Promise<Resolved | null> {
  const raw = key.split('/')
  const n = normalizeSegments(raw)
  if (!n) return null
  const depth = (k: DocKind) => options.depth === false ? 0 : DEPTH[k]
  const legacy = withSlash(legacyCandidates(raw, n))

  const fixed = fixedRoute(n.path)
  if (fixed) {
    // Any spelling of the section address (with or without `.html`) reads the same source page.
    const source = await find<PageDoc>('pages', { legacyPath: { in: withSlash([...legacy, `/${n.path}`, `/${n.path}.html`]) } }, options.depth === false ? 0 : 1)
    return { kind: 'fixed', route: fixed, path: n.path, source }
  }

  const byLegacy = await firstOf(ORDER.map((k) => [k, find(COLLECTION[k], { legacyPath: { in: legacy } }, depth(k))]))
  if (byLegacy) return byLegacy

  if (n.segments[0] === 'kursy-nurkowania' && n.segments.length === 2) {
    const c = await find<CourseDoc>('courses', { slug: { equals: n.segments[1] } }, depth('course'))
    if (c) return { kind: 'course', doc: c }
  }

  const paths = pathCandidates(n.path)
  const found = await firstOf([
    ['product', find('products', { slug: { equals: n.path } }, depth('product'))],
    ['category', find('categories', { slug: { equals: n.path } }, depth('category'))],
    ['page', find('pages', { path: { in: paths } }, depth('page'))],
    ['trip', find('trips', { path: { in: paths } }, depth('trip'))],
    ['album', find('albums', { path: { in: paths } }, depth('album'))],
    ['event', find('events', { path: { in: paths } }, depth('event'))],
  ])
  if (found || options.redirects === false) return found

  // Last resort: a published redirect for an address whose content moved; live content above always wins.
  const r = await find<{ from: string; to: string }>('redirects', { from: { in: legacy.filter((c) => c.startsWith('/')) } }, 0)
  const to = r?.to?.trim()
  if (to && /^\/(?![/\\])/.test(to) && !/[\\\u0000-\u001f]/.test(to) && !legacy.includes(to)) return { kind: 'redirect', to }
  return null
}
