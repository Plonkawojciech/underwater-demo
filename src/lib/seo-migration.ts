import type { Where } from 'payload'
import { canonicalPath, contentHref, normalizeSegments } from './presentation'
import { publicSeoPath, sitemapFinder, type SitemapRecords } from './seo'
import { isAppRoute, resolveSourceRoute, type FixedRoute, type Resolved, type RouteFinder } from './source-routes'

export type MigrationRedirect = { id: number; published: boolean; from: string; to: string }
export type MigrationDocument = { id: number; legacyPath: string; url: string }
export type MigrationProjection = {
  records: SitemapRecords & { redirects?: MigrationRedirect[] }
  documents?: MigrationDocument[]
}
export type CrawlAddress = { url: string; final_url?: string; captureState?: 'captured' | 'document' | 'failed' | 'pending' | 'excluded' }
export type MigrationDisposition = 'retained200' | 'redirect301' | 'unresolved404' | 'review'
export type MigrationRow = {
  oldUrl: string; oldPath: string | null; newUrl: string | null; newPath: string | null
  disposition: MigrationDisposition; currentStatus: number | null; canonicalPath: string | null
  resolvedKind: string | null; recordId: number | null; redirectHops: number; capturedFinalUrl: string | null
  captureState: string; reason: string; issues: string[]
}

const SOURCE_HOSTS = new Set(['underwater.pl', 'www.underwater.pl'])
const TARGET_ORIGIN = 'https://www.underwater.pl'

function sourceUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash) return null
    const rawPath = value.match(/^https:\/\/[^/?#]+(\/[^?#]*)?/i)?.[1] || '/'
    if (!decodedPath(rawPath)) return null
    return url
  } catch { return null }
}

function decodedPath(path: string): string | null {
  if (path === '/') return '/'
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 2048 || /[?#\\\u0000-\u001f\u007f]/.test(path)) return null
  const withoutSlash = path.replace(/\/+$/, '')
  const normalized = normalizeSegments(withoutSlash.slice(1).split('/'))
  if (!normalized || /[?#%\\\u0000-\u001f\u007f]/.test(normalized.requested)) return null
  return normalized.requested
}

function canonicalOf(resolved: Exclude<Resolved, { kind: 'redirect' }>, fixed: Record<FixedRoute, string>): string | null {
  if (resolved.kind === 'fixed') return publicSeoPath(canonicalPath(fixed[resolved.route], resolved.source?.legacyPath))
  const built = resolved.kind === 'product' || resolved.kind === 'category' ? `/${resolved.doc.slug}.html`
    : resolved.kind === 'course' ? `/kursy-nurkowania/${resolved.doc.slug}.html`
      : contentHref(resolved.doc.path)
  return publicSeoPath(canonicalPath(built, resolved.doc.legacyPath))
}

function identity(resolved: Exclude<Resolved, { kind: 'redirect' }>): string {
  return resolved.kind === 'fixed' ? `fixed:${resolved.route}` : `${resolved.kind}:${resolved.doc.id}`
}

/** Resolver lookups use the identical public collision order; redirects match the proxy's exact paths. */
export function migrationFinder(projection: MigrationProjection): RouteFinder {
  const live = sitemapFinder(projection.records)
  const byFrom = new Map<string, MigrationRedirect[]>()
  for (const redirect of projection.records.redirects || []) {
    if (redirect.published !== true) continue
    const rows = byFrom.get(redirect.from) || []
    rows.push(redirect)
    byFrom.set(redirect.from, rows)
  }
  return async <T>(collection: Parameters<RouteFinder>[0], where: Where, depth: number): Promise<T | null> => {
    if (collection !== 'redirects') return live<T>(collection, where, depth)
    const operation = where.from as { in?: unknown; equals?: unknown } | undefined
    const keys = Array.isArray(operation?.in) ? operation.in : [operation?.equals]
    const matches = keys.flatMap((key) => typeof key === 'string' ? byFrom.get(key) || [] : [])
    return (matches.sort((a, b) => a.id - b.id)[0] || null) as T | null
  }
}

/** Never requests the client site or writes a DB; the complete list comes from retained crawl metadata. */
export async function migrationMap(crawl: CrawlAddress[], projection: MigrationProjection, fixed: Record<FixedRoute, string>) {
  if (!crawl.length || crawl.length > 25_000) throw new Error('A bounded complete crawl address list is required.')
  const find = migrationFinder(projection)
  const documents = new Map((projection.documents || []).map((doc) => [doc.legacyPath.normalize('NFC'), doc]))
  const unique = new Map<string, CrawlAddress>()
  for (const entry of crawl) {
    if (!entry || typeof entry.url !== 'string') throw new Error('Every crawl address needs its original URL.')
    const previous = unique.get(entry.url)
    if (!previous || previous.captureState !== 'captured') unique.set(entry.url, entry)
  }
  const rows: MigrationRow[] = []
  for (const entry of [...unique.values()].sort((a, b) => a.url.localeCompare(b.url, 'en'))) {
    const parsed = sourceUrl(entry.url)
    const normalized = parsed ? decodedPath(parsed.pathname) : null
    const issues: string[] = []
    const row: MigrationRow = {
      oldUrl: entry.url, oldPath: normalized, newUrl: null, newPath: null, disposition: 'review', currentStatus: null,
      canonicalPath: null, resolvedKind: null, recordId: null, redirectHops: 0,
      capturedFinalUrl: entry.final_url || null, captureState: entry.captureState || 'captured', reason: '', issues,
    }
    rows.push(row)
    if (!parsed || !normalized) { row.reason = 'outside-safe-source-url-scope'; continue }
    if (parsed.search) { row.reason = 'source-query-needs-explicit-route-mapping'; continue }
    if (!['captured', 'document'].includes(row.captureState)) issues.push(`source-capture-${row.captureState}`)
    // Query-style Joomla routes and account forms need the current SQL; do not redirect them to the homepage.
    if (/^\/(?:account(?:\.html)?|logowanie|component\/(?:user|users))(?:\/|$)/i.test(normalized)) {
      row.reason = 'legacy-account-needs-source-database'; row.currentStatus = 404; continue
    }
    if (/^\/(?:api|admin|administrator|koszyk|checkout|cart|newsletter|zgloszenie|platnosc-testowa|_next)(?:\/|\.|$)/i.test(normalized)) {
      row.reason = 'private-or-application-route-needs-review'; continue
    }
    let pathname = parsed.pathname
    const seen = new Set<string>()
    let reached: Exclude<Resolved, { kind: 'redirect' }> | null = null
    let destination: string | null = null
    let special: 'home' | 'document' | null = null
    for (let step = 0; step <= 20; step++) {
      const path = decodedPath(pathname)
      if (!path) { issues.push('unsafe-redirect-target'); break }
      if (seen.has(path)) { issues.push('redirect-loop'); break }
      seen.add(path)
      if (path === '/') { destination = '/'; special = 'home'; break }
      if (path === '/index.php') { pathname = '/'; row.redirectHops++; continue }
      const document = documents.get(path)
      let documentTarget = ''
      try { if (document) documentTarget = new URL(document.url, 'https://underwater-demo.programo.pl').pathname } catch { /* Invalid own upload URL cannot establish a public destination. */ }
      if (document && /^\/api\/documents\/file\/[a-f0-9]{64}(?:-\d+)?\.pdf$/.test(documentTarget)) {
        destination = path; special = 'document'; row.recordId = document.id; break
      }
      // App routes are served before the catch-all; a row in a public collection cannot replace them.
      if (isAppRoute(path.slice(1).replace(/\.html$/i, ''))) { issues.push('application-route-destination'); break }
      const live = await resolveSourceRoute(pathname.replace(/^\/+/, '').replace(/\/+$/, ''), find, { redirects: false, depth: false })
      if (live && live.kind !== 'redirect') { reached = live; destination = path; break }
      // This is exactly the proxy's stored from matching, not the broader catch-all alias matching.
      const redirect = await find<MigrationRedirect>('redirects', { from: { in: [pathname, path, pathname + '/', path + '/'] } }, 0)
      if (!redirect) break
      if (!publicSeoPath(redirect.to)) { issues.push('unsafe-redirect-target'); break }
      pathname = redirect.to
      row.redirectHops++
      if (step === 20) issues.push('redirect-chain-too-long')
    }
    if (!destination) {
      row.disposition = issues.length ? 'review' : 'unresolved404'
      row.currentStatus = issues.some((issue) => !issue.startsWith('source-capture-')) ? null : 404
      row.reason = row.redirectHops ? 'stored-redirect-destination-unresolved' : 'no-published-destination'
      continue
    }
    row.newPath = destination
    row.newUrl = new URL(destination, TARGET_ORIGIN).href
    row.canonicalPath = special ? destination : reached ? canonicalOf(reached, fixed) : null
    row.resolvedKind = special || reached?.kind || null
    if (reached) {
      if (reached.kind !== 'fixed') row.recordId = reached.doc.id
      if (!row.canonicalPath) issues.push('invalid-public-canonical')
      if (row.canonicalPath && row.canonicalPath !== '/') {
        const canonical = await resolveSourceRoute(row.canonicalPath.slice(1), find, { redirects: false, depth: false })
        if (!canonical || canonical.kind === 'redirect' || identity(canonical) !== identity(reached)) issues.push('canonical-does-not-resolve-to-same-record')
      }
    }
    if (row.redirectHops > 1) issues.push('existing-redirect-chain-needs-flattening')
    if (row.redirectHops && row.canonicalPath !== destination) issues.push('redirect-target-canonical-elsewhere')
    if (!row.redirectHops) {
      const stored = await find<MigrationRedirect>('redirects', { from: { in: [parsed.pathname, normalized, parsed.pathname + '/', normalized + '/'] } }, 0)
      if (stored) issues.push('stored-redirect-shadowed-by-published-content')
      if (row.canonicalPath !== destination) issues.push('served-alias-canonical-elsewhere')
    }
    row.disposition = issues.some((issue) => !['served-alias-canonical-elsewhere', 'stored-redirect-shadowed-by-published-content'].includes(issue)) ? 'review' : row.redirectHops ? 'redirect301' : 'retained200'
    row.currentStatus = row.redirectHops ? 301 : 200
    row.reason = row.redirectHops ? 'verified-permanent-route-to-published-destination' : special === 'document' ? 'source-pdf-kept-at-original-path' : 'source-path-served-without-redirect'
  }
  const targetsByFrom = new Map<string, Set<string>>()
  for (const row of rows.filter((row) => row.disposition === 'redirect301')) {
    const targets = targetsByFrom.get(row.oldPath!) || new Set<string>()
    targets.add(row.newPath!)
    targetsByFrom.set(row.oldPath!, targets)
  }
  for (const row of rows) if (row.disposition === 'redirect301' && targetsByFrom.get(row.oldPath!)!.size > 1) {
    row.disposition = 'review'; row.issues.push('conflicting-normalized-redirect-rules')
  }
  const redirects = rows.filter((row) => row.disposition === 'redirect301').map((row) => ({ from: row.oldPath!, to: row.newPath!, status: 301 as const }))
  const uniqueRules = [...new Map(redirects.map((rule) => [rule.from, rule])).values()].sort((a, b) => a.from.localeCompare(b.from, 'en'))
  return {
    targetOrigin: TARGET_ORIGIN, inputRows: crawl.length, uniqueSourceUrls: unique.size, duplicateSourceUrls: crawl.length - unique.size,
    statusBasis: 'offline shared public resolver and proxy rules; not a new live HTTP crawl',
    dispositions: Object.fromEntries(['retained200', 'redirect301', 'unresolved404', 'review'].map((value) => [value, rows.filter((row) => row.disposition === value).length])),
    sourceDatabaseComplete: false, clientNetworkRequests: 0, databaseWrites: 0, deployedMigrationRules: false,
    rows, redirects: uniqueRules,
  }
}

/** A proposal is separate from a current HTTP rule. Only an exact retained source HTTP target can justify it. */
export function capturedMigrationProposals(rows: MigrationRow[], knownDestinations: MigrationRow[] = []) {
  const byPath = new Map([...rows, ...knownDestinations].filter((row) => row.oldPath && ['retained200', 'redirect301'].includes(row.disposition)).map((row) => [row.oldPath!, row]))
  return rows.flatMap((row) => {
    if (row.disposition !== 'unresolved404' || row.captureState !== 'captured' || !row.oldPath || !row.capturedFinalUrl) return []
    const final = sourceUrl(row.capturedFinalUrl)
    const finalPath = final && !final.search ? decodedPath(final.pathname) : null
    const target = finalPath ? byPath.get(finalPath) : null
    if (!target?.newPath || target.newPath === row.oldPath || target.canonicalPath !== target.newPath || !publicSeoPath(target.newPath)) return []
    return [{ from: row.oldPath, to: target.newPath, status: 301 as const, currentStatus: row.currentStatus, deployed: false,
      evidence: { sourceUrl: row.oldUrl, capturedFinalUrl: row.capturedFinalUrl, currentTargetKind: target.resolvedKind, reason: 'exact-captured-source-http-target-and-published-canonical-destination' },
    }]
  })
}
