/** Offline only: export every retained public crawl address against an own published routing projection. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { capturedMigrationProposals, migrationMap, type CrawlAddress, type MigrationProjection } from '../../src/lib/seo-migration'
import { FIXED_SEO_PATHS, sitemapPaths, sitemapXml, type SitemapRecords } from '../../src/lib/seo'

const PRIVATE = resolve('/Users/wojciechplonka/Programo/underwater-private')
const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--projection', '--crawl', '--out-prefix'].includes(key) || !value || options.has(key)) throw new Error('Use --projection <json> --crawl <json> --out-prefix <private path>.')
  options.set(key, value)
}
if (options.size !== 3) throw new Error('All three offline paths are required.')
function privatePath(value: string) {
  const path = resolve(value)
  if (!path.startsWith(PRIVATE + sep) || path.split(sep).some((part) => part.startsWith('.env'))) throw new Error('Only private own evidence paths are allowed.')
  return path
}
function input(key: string) {
  const path = privatePath(options.get(key)!)
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('A regular retained offline input is required.')
  const body = readFileSync(path)
  if (body.byteLength > 32 * 1024 * 1024) throw new Error('Offline input exceeds the bounded routing projection.')
  return { path, sha256: createHash('sha256').update(body).digest('hex'), value: JSON.parse(body.toString('utf8')) }
}
const projectionInput = input('--projection'), crawlInput = input('--crawl')
const rawProjection = projectionInput.value
if (!rawProjection?.records || typeof rawProjection.records !== 'object') throw new Error('Own routing projection records are required.')
const projection: MigrationProjection = { records: {}, documents: rawProjection.documents || rawProjection.records.documents || [] }
for (const [collection, records] of Object.entries(rawProjection.records)) {
  if (collection === 'documents') continue
  if (!['products', 'categories', 'courses', 'pages', 'trips', 'albums', 'events', 'redirects'].includes(collection) || !Array.isArray(records)) throw new Error('Only public route collections enter this projection.')
  const allowed = collection === 'redirects' ? ['id', 'published', 'from', 'to'] : ['id', 'published', 'legacyPath', 'slug', 'path']
  for (const record of records) {
    if (!record || !Number.isSafeInteger(record.id) || record.id <= 0 || Object.keys(record).some((key) => !allowed.includes(key))) throw new Error('Routing projection must contain only public routing fields and positive IDs.')
  }
  projection.records[collection as keyof typeof projection.records] = records.map((record) => ({ ...record, published: record.published === true || record.published === 1 })) as never
}
for (const document of projection.documents || []) if (!document || !Number.isSafeInteger(document.id) || document.id <= 0 || typeof document.legacyPath !== 'string' || typeof document.url !== 'string' || Object.keys(document).some((key) => !['id', 'legacyPath', 'url'].includes(key))) throw new Error('Only public document routing fields enter this projection.')
const rawCrawl = crawlInput.value
const crawl: CrawlAddress[] = Array.isArray(rawCrawl) ? rawCrawl : [
  ...(rawCrawl.captures || rawCrawl.files || []).map((row: CrawlAddress) => ({ url: row.url, final_url: row.final_url, captureState: 'captured' as const })),
  ...(rawCrawl.failed || []).map((row: CrawlAddress) => ({ url: row.url, captureState: 'failed' as const })),
  ...(rawCrawl.pending || []).map((url: string) => ({ url, captureState: 'pending' as const })),
  ...(rawCrawl.excludedNavigation || []).map((url: string) => ({ url, captureState: 'excluded' as const })),
]
const crawlAddressRows = crawl.length
const supplementalDocumentAddresses = (projection.documents || []).filter((document) => !crawl.some((row) => row.url === new URL(document.legacyPath, 'https://www.underwater.pl').href)).map((document) => ({ url: new URL(document.legacyPath, 'https://www.underwater.pl').href, captureState: 'document' as const }))
crawl.push(...supplementalDocumentAddresses)
const fixed = FIXED_SEO_PATHS
const map = await migrationMap(crawl, projection, fixed)
const publishedRedirects = projection.records.redirects?.filter((row) => row.published === true) || []
const redirectAudit = publishedRedirects.length ? await migrationMap(publishedRedirects.map((row) => ({ url: new URL(row.from, 'https://www.underwater.pl').href })), projection, fixed) : null
const sitemap = await sitemapPaths(projection.records as SitemapRecords, fixed)
const out = privatePath(options.get('--out-prefix')!)
const artifacts: { path: string; bytes: number; sha256: string }[] = []
function write(suffix: string, value: string) {
  const path = out + suffix
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 })
  artifacts.push({ path, bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') })
}
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
write('.json', JSON.stringify(map, null, 2) + '\n')
write('.csv', [
  ['oldUrl', 'oldPath', 'newUrl', 'newPath', 'disposition', 'currentStatus', 'canonicalPath', 'reason', 'issues'].map(csv).join(','),
  ...map.rows.map((row) => [row.oldUrl, row.oldPath, row.newUrl, row.newPath, row.disposition, row.currentStatus, row.canonicalPath, row.reason, row.issues.join(';')].map(csv).join(',')),
].join('\n') + '\n')
write('.rules.json', JSON.stringify({ targetOrigin: map.targetOrigin, deployOnClient: false, previewIsNotRedirectTarget: true, rules: map.redirects }, null, 2) + '\n')
const proposals = capturedMigrationProposals(map.rows, redirectAudit?.rows)
write('.proposals.json', JSON.stringify({ deployOnClient: false, currentRulesUnchanged: true, proposals }, null, 2) + '\n')
write('.redirect-audit.json', JSON.stringify({ publishedRedirectRecords: publishedRedirects.length, audit: redirectAudit }, null, 2) + '\n')
write('.sitemap.xml', sitemapXml(sitemap, map.targetOrigin))
write('.proof.json', JSON.stringify({
  checkedAt: new Date().toISOString(), method: 'offline shared public resolver and exact proxy 301 path matching',
  inputs: [projectionInput, crawlInput].map(({ path, sha256 }) => ({ path, sha256 })),
  sourceInputRows: map.inputRows, uniqueSourceUrls: map.uniqueSourceUrls, dispositions: map.dispositions,
  crawlAddressRows, supplementalDocumentAddresses: supplementalDocumentAddresses.length, verifiedNew301Proposals: proposals.length,
  sitemapCanonicals: sitemap.length, verified301Rules: map.redirects.length,
  publishedRedirectRecords: publishedRedirects.length, redirectAuditDispositions: redirectAudit?.dispositions || {},
  knownExcludedNavigation: Array.isArray(rawCrawl.excludedNavigation) ? rawCrawl.excludedNavigation.length : null,
  sourceDatabaseComplete: false, deployedMigrationRules: false, clientNetworkRequests: 0, databaseWrites: 0,
  artifacts,
}, null, 2) + '\n')
console.log(JSON.stringify({ uniqueSourceUrls: map.uniqueSourceUrls, dispositions: map.dispositions, verified301Rules: map.redirects.length, sitemapCanonicals: sitemap.length, publishedRedirectRecords: publishedRedirects.length, outputPrefix: out }))
