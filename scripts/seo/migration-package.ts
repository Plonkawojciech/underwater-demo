import { capturedMigrationProposals, migrationMap, type CrawlAddress, type MigrationProjection } from '../../src/lib/seo-migration'
import { FIXED_SEO_PATHS, publicSeoPath, sitemapPaths, type SitemapRecords } from '../../src/lib/seo'

export const TARGET_ORIGIN = 'https://www.underwater.pl'
type SourceIssue = { url: string; code: string }
type BlockingIssue = { code: string; path: string; recordIds?: number[]; detail?: string }

/** Keep the exact captured spelling separately from decoded resolver keys. */
export function requestIdentity(oldUrl: string) {
  const match = oldUrl.match(/^https:\/\/[^/?#]+(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i)
  let wirePath: string | null = null
  try { wirePath = new URL(oldUrl).pathname } catch { /* Reviewed by migrationMap. */ }
  return { originalPath: match ? match[1] || '/' : null, wirePath, query: match?.[2] || null, fragment: match?.[3] || null }
}

function routeKey(path: string): string | null {
  if (path === '/index.php') return path
  return publicSeoPath(path)
}

/** Field-only input validation prevents accidental customer/content exports. */
export function routingProjection(raw: unknown): MigrationProjection {
  if (!raw || typeof raw !== 'object' || !('records' in raw)) throw new Error('Routing records required.')
  const input = raw as { records: Record<string, unknown>; documents?: unknown }
  if (!input.records || typeof input.records !== 'object' || Array.isArray(input.records)) throw new Error('Routing records required.')
  const projection: MigrationProjection = { records: {}, documents: [] }
  for (const [collection, rows] of Object.entries(input.records)) {
    if (collection === 'documents') continue
    if (!['products', 'categories', 'courses', 'pages', 'trips', 'albums', 'events', 'redirects'].includes(collection) || !Array.isArray(rows)) throw new Error('Only public routing collections allowed.')
    const fields = collection === 'redirects' ? ['id', 'published', 'from', 'to'] : ['id', 'published', 'legacyPath', 'slug', 'path']
    const ids = new Set<number>()
    const normalized = rows.map((row) => {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) || Object.keys(row).some((key) => !fields.includes(key))) throw new Error('Unique positive IDs and routing fields required.')
      ids.add(row.id)
      if (![true, false, 1, 0, null, undefined].includes(row.published)) throw new Error('Invalid published value.')
      for (const field of fields.filter((key) => !['id', 'published'].includes(key))) if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') throw new Error('Routing paths must be strings.')
      if (collection === 'redirects' && (typeof row.from !== 'string' || typeof row.to !== 'string')) throw new Error('Redirect paths required.')
      return { ...row, published: row.published === true || row.published === 1 }
    })
    projection.records[collection as keyof typeof projection.records] = normalized as never
  }
  const documents = input.documents || input.records.documents || []
  if (!Array.isArray(documents)) throw new Error('Document routing array required.')
  const ids = new Set<number>()
  for (const document of documents) {
    if (!document || !Number.isSafeInteger(document.id) || document.id <= 0 || ids.has(document.id) || typeof document.legacyPath !== 'string' || typeof document.url !== 'string' || Object.keys(document).some((key) => !['id', 'legacyPath', 'url'].includes(key))) throw new Error('Only public document routing fields and unique IDs allowed.')
    ids.add(document.id)
    projection.documents!.push(document)
  }
  return projection
}

export function capturedAddresses(raw: unknown): CrawlAddress[] {
  if (Array.isArray(raw)) return raw.map((row) => ({ url: row.url, final_url: row.final_url, captureState: row.captureState }))
  if (!raw || typeof raw !== 'object') throw new Error('Captured address manifest required.')
  const input = raw as Record<string, any>
  return [
    ...(input.captures || input.files || []).map((row: any) => ({ url: row.url, final_url: row.final_url, captureState: 'captured' as const })),
    ...(input.failed || []).map((row: any) => ({ url: row.url, captureState: 'failed' as const })),
    ...(input.pending || []).map((url: string) => ({ url, captureState: 'pending' as const })),
    ...(input.excludedNavigation || []).map((url: string) => ({ url, captureState: 'excluded' as const })),
  ]
}

/** Conflict details contain exact captured URL pairs; expose codes, never free-form content. */
export function sourceReportIssues(raw: unknown): SourceIssue[] {
  if (!raw || typeof raw !== 'object') throw new Error('Conversion report required.')
  const report = raw as { unresolved?: Record<string, unknown>[]; excludedNavigation?: string[] }
  if (!Array.isArray(report.unresolved) || (report.excludedNavigation !== undefined && !Array.isArray(report.excludedNavigation))) throw new Error('Conversion report issue arrays required.')
  return [
    ...report.unresolved.flatMap((issue) => {
      if (typeof issue.code !== 'string') return []
      const urls = typeof issue.url === 'string' ? [issue.url] : issue.code === 'conflicting-source-content' && typeof issue.detail === 'string' ? issue.detail.split(' | ') : []
      return urls.filter((url) => /^https:\/\/(?:www\.)?underwater\.pl\//.test(url)).map((url) => ({ url, code: issue.code as string }))
    }),
    ...(report.excludedNavigation || []).map((url) => ({ url, code: 'calendar-navigation-excluded' })),
  ]
}

function decisionCause(codes: string[], fallback: string) {
  const order = ['conflicting-source-content', 'calendar-navigation-excluded', 'shop-component-missing', 'product-category-unresolved', 'product-ambiguous-name', 'product-missing-price', 'album-missing-title', 'field-invalid', 'missing-title', 'source-error-response', 'legacy-account-requires-source-database']
  return order.find((code) => codes.includes(code)) || fallback
}

/** Independent deployment gate: published records are audited individually, never hidden by first-id lookup. */
export async function migrationPackage(crawl: CrawlAddress[], projection: MigrationProjection, sourceIssues: SourceIssue[] = []) {
  const addresses = [...crawl]
  for (const document of projection.documents || []) {
    const url = new URL(document.legacyPath, TARGET_ORIGIN).href
    if (!addresses.some((row) => row.url === url)) addresses.push({ url, captureState: 'document' })
  }
  const map = await migrationMap(addresses, projection, FIXED_SEO_PATHS)
  const published = (projection.records.redirects || []).filter((row) => row.published === true)
  const blockingIssues: BlockingIssue[] = []
  const byKey = new Map<string, typeof published>()
  for (const rule of published) {
    const key = routeKey(rule.from)
    if (!key || !publicSeoPath(rule.to)) {
      blockingIssues.push({ code: 'unsafe-published-rule', path: rule.from, recordIds: [rule.id] })
      continue
    }
    const group = byKey.get(key) || []
    group.push(rule); byKey.set(key, group)
  }
  for (const [path, group] of byKey) if (group.length > 1) blockingIssues.push({
    code: new Set(group.map((rule) => publicSeoPath(rule.to))).size > 1 ? 'conflicting-rule-destinations' : 'duplicate-rule-key', path, recordIds: group.map((rule) => rule.id),
  })
  const audit = published.length ? await migrationMap(published.map((rule) => ({ url: new URL(rule.from, TARGET_ORIGIN).href })), projection, FIXED_SEO_PATHS) : null
  const auditByUrl = new Map(audit?.rows.map((row) => [row.oldUrl, row]) || [])
  const routes: { from: string; to: string; status: 301; queryPolicy: 'preserve'; source: 'published'; recordId: number }[] = []
  for (const rule of published) {
    const row = auditByUrl.get(new URL(rule.from, TARGET_ORIGIN).href)
    // Require the stored direct target itself, rather than a flattened/inferred destination.
    if (!row || row.disposition !== 'redirect301' || row.redirectHops !== 1 || row.newPath !== publicSeoPath(rule.to) || row.newPath !== row.canonicalPath || row.issues.length) {
      blockingIssues.push({ code: 'published-rule-not-direct-canonical-301', path: rule.from, recordIds: [rule.id], detail: row?.issues.join(';') || row?.reason || 'missing audit row' })
      continue
    }
    if ((byKey.get(routeKey(rule.from)!)?.length || 0) > 1) continue
    routes.push({ from: rule.from, to: rule.to, status: 301, queryPolicy: 'preserve', source: 'published', recordId: rule.id })
  }
  routes.sort((a, b) => a.from.localeCompare(b.from, 'en'))
  const sitemap = await sitemapPaths(projection.records as SitemapRecords, FIXED_SEO_PATHS)
  const sitemapMap = await migrationMap(sitemap.map((path) => ({ url: new URL(path, TARGET_ORIGIN).href })), projection, FIXED_SEO_PATHS)
  for (const row of sitemapMap.rows) if (row.disposition !== 'retained200' || row.newPath !== row.canonicalPath || row.issues.length) blockingIssues.push({ code: 'sitemap-not-public-canonical-200', path: row.oldPath || row.oldUrl })
  const sourceByUrl = new Map<string, string[]>()
  for (const issue of sourceIssues) {
    if (typeof issue?.url !== 'string' || typeof issue?.code !== 'string' || !/^[a-z0-9-]{1,100}$/.test(issue.code)) continue
    const codes = sourceByUrl.get(issue.url) || []
    if (!codes.includes(issue.code)) codes.push(issue.code)
    sourceByUrl.set(issue.url, codes)
  }
  const rows = map.rows.map((row) => ({ ...row, ...requestIdentity(row.oldUrl) }))
  const proposals = capturedMigrationProposals(map.rows, audit?.rows)
  const decisions = rows.filter((row) => ['unresolved404', 'review'].includes(row.disposition)).map((row) => ({
    oldUrl: row.oldUrl, originalPath: row.originalPath, wirePath: row.wirePath, resolverPath: row.oldPath,
    disposition: row.disposition, currentStatus: row.currentStatus, proposedDestination: null,
    reason: row.reason, primaryCause: decisionCause(sourceByUrl.get(row.oldUrl) || [], row.reason), sourceIssueCodes: sourceByUrl.get(row.oldUrl) || [], issues: row.issues,
    requiredEvidence: row.reason.includes('account') ? 'current-source-database-and-account-continuity-decision' : row.captureState !== 'captured' ? 'retained-source-or-current-source-database' : 'current-source-database-or-exact-retained-source-evidence',
    blocksClientCutover: true,
  }))
  return {
    formatVersion: 1 as const, targetOrigin: TARGET_ORIGIN, deployOnClient: false as const,
    statusBasis: map.statusBasis, sourceDatabaseComplete: false, clientNetworkRequests: 0, databaseWrites: 0,
    sourceCoverage: { inputRows: map.inputRows, uniqueSourceUrls: map.uniqueSourceUrls, duplicateSourceUrls: map.duplicateSourceUrls, dispositions: map.dispositions, supplementalDocumentAddresses: addresses.length - crawl.length },
    audit: { safe: blockingIssues.length === 0, blockingIssues, publishedRedirectRecords: published.length, verifiedPublishedRoutes: routes.length, publishedRulesOutsideCapturedList: routes.filter((rule) => !rows.some((row) => row.oldUrl === new URL(rule.from, TARGET_ORIGIN).href)).length, sitemapCanonicals: sitemap.length },
    gates: { ownPreviewRoutesReady: blockingIssues.length === 0, clientCutoverReady: false },
    queryPolicy: { existingPathRedirects: 'preserve' as const, querySpecificOldUrls: 'explicit-review-required', canonical: 'only-strona-2-through-1000', indexPhpWithoutQuery: 'built-in-301-to-root', indexPhpWithQuery: 'explicit-review-required' },
    previewPolicy: { authenticationRequired: true, robotsDisallow: '/', xRobotsTag: 'noindex, nofollow, noarchive', cacheControl: 'private, no-store', productionIndexingChangeAuthorized: false },
    routes, decisions, proposals,
    // Source-wide implicit behavior is not a fabricated record from the 627 published rules.
    builtInRoutes: [{ from: '/index.php', to: '/', status: 301, queryPolicy: 'empty-only', source: 'runtime-proxy' }],
    rows, sitemap,
  }
}
