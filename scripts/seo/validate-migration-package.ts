/** Offline-only, read-only inputs. Never starts Payload, requests a site or changes a DB. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { capturedAddresses, migrationPackage, routingProjection, sourceReportIssues } from './migration-package'
import { sitemapXml } from '../../src/lib/seo'

const roots = ['/Users/wojciechplonka/Programo/underwater-private', '/Volumes/Mad Dog/Archive/codex-work'].map((path) => realpathSync(path))
const outputRoot = realpathSync('/Volumes/Mad Dog/Archive/codex-work')
const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--projection', '--crawl', '--baseline-proof', '--source-report', '--out-prefix'].includes(key) || !value || options.has(key)) throw new Error('Use --projection <json> --crawl <json> --baseline-proof <json> [--source-report <json>] --out-prefix <Mad Dog path>.')
  options.set(key, value)
}
for (const key of ['--projection', '--crawl', '--baseline-proof', '--out-prefix']) if (!options.has(key)) throw new Error(`Required: ${key}`)
const inside = (path: string, root: string) => path.startsWith(root + sep)
function safeInput(path: string) {
  const logical = resolve(path)
  if (logical.split(sep).some((part) => part.startsWith('.env'))) throw new Error('Environment files are forbidden.')
  const stat = lstatSync(logical)
  const actual = realpathSync(logical)
  if (stat.isSymbolicLink() || !stat.isFile() || !roots.some((root) => inside(actual, root)) || stat.size > 32 * 1024 * 1024) throw new Error('Bounded regular offline evidence required.')
  return actual
}
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex')
function jsonInput(path: string) {
  const actual = safeInput(path), body = readFileSync(actual)
  return { path: actual, sha256: sha256(body), value: JSON.parse(body.toString('utf8')) }
}
const projectionInput = jsonInput(options.get('--projection')!), crawlInput = jsonInput(options.get('--crawl')!), baselineInput = jsonInput(options.get('--baseline-proof')!)
const baseline = baselineInput.value
if (!Array.isArray(baseline.inputs) || baseline.inputs.length !== 2 || !Array.isArray(baseline.artifacts) || baseline.artifacts.length !== 6) throw new Error('Original migration proof must contain two inputs and six artifacts.')
for (const entry of [...baseline.inputs, ...baseline.artifacts]) {
  if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || sha256(readFileSync(safeInput(entry.path))) !== entry.sha256) throw new Error('Baseline proof hash mismatch.')
}
for (const entry of [projectionInput, crawlInput]) if (!baseline.inputs.some((input: any) => realpathSync(input.path) === entry.path && input.sha256 === entry.sha256)) throw new Error('Baseline proof does not describe these exact routing/crawl inputs.')
const sourceReport = options.has('--source-report') ? jsonInput(options.get('--source-report')!) : null
const result = await migrationPackage(capturedAddresses(crawlInput.value), routingProjection(projectionInput.value), sourceReport ? sourceReportIssues(sourceReport.value) : [])
if (result.sourceCoverage.uniqueSourceUrls !== baseline.uniqueSourceUrls || Object.keys(result.sourceCoverage.dispositions).some((key) => result.sourceCoverage.dispositions[key] !== baseline.dispositions?.[key]) || result.audit.sitemapCanonicals !== baseline.sitemapCanonicals) throw new Error('Recomputed coverage/sitemap differs from frozen baseline; reconcile before exporting.')
const out = resolve(options.get('--out-prefix')!)
const parent = dirname(out)
if (!inside(out, outputRoot) || out.split(sep).some((part) => part.startsWith('.env'))) throw new Error('Outputs belong on Mad Dog.')
let ancestor = parent
while (!existsSync(ancestor)) ancestor = dirname(ancestor)
if (realpathSync(ancestor) !== outputRoot && !inside(realpathSync(ancestor), outputRoot)) throw new Error('Output ancestor escapes through a symlink.')
mkdirSync(parent, { recursive: true, mode: 0o700 })
if (!inside(realpathSync(parent), outputRoot)) throw new Error('Output parent escapes through a symlink.')
const artifacts: { role: string; path: string; sha256: string; bytes: number }[] = []
const inputs = [projectionInput, crawlInput, baselineInput, ...(sourceReport ? [sourceReport] : [])].map(({ path, sha256 }) => ({ path, sha256 }))
const { rows, sitemap, ...handoff } = result
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
const outputs = [
  { role: 'handoff', suffix: '.handoff.json', body: json({ ...handoff, inputs, baseline: { verifiedHashes: 8, proofSha256: baselineInput.sha256 } }) },
  { role: 'sourceRows', suffix: '.rows.json', body: json({ sourceCoverage: result.sourceCoverage, rows }) },
  { role: 'decisions', suffix: '.decisions.csv', body: [
    ['oldUrl', 'originalPath', 'wirePath', 'disposition', 'currentStatus', 'reason', 'primaryCause', 'sourceIssueCodes', 'issues', 'proposedDestination', 'requiredEvidence'].map(csv).join(','),
    ...result.decisions.map((row) => [row.oldUrl, row.originalPath, row.wirePath, row.disposition, row.currentStatus, row.reason, row.primaryCause, row.sourceIssueCodes.join(';'), row.issues.join(';'), row.proposedDestination, row.requiredEvidence].map(csv).join(',')),
  ].join('\n') + '\n' },
  { role: 'sitemap', suffix: '.sitemap.xml', body: sitemapXml(sitemap, result.targetOrigin) },
]
for (const output of outputs) {
  try { lstatSync(out + output.suffix); throw new Error('Output prefix already exists.') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
try { lstatSync(out + '.proof.json'); throw new Error('Proof prefix already exists.') }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
for (const output of outputs) {
  const path = out + output.suffix
  writeFileSync(path, output.body, { flag: 'wx', mode: 0o600 })
  artifacts.push({ role: output.role, path, sha256: sha256(output.body), bytes: Buffer.byteLength(output.body) })
}
writeFileSync(out + '.proof.json', json({ checkedAt: new Date().toISOString(), method: 'offline recomputation plus independent published-rule/canonical gate', inputs, verifiedBaselineHashes: 8, audit: result.audit, gates: result.gates, sourceCoverage: result.sourceCoverage, artifacts, clientNetworkRequests: 0, databaseWrites: 0 }), { flag: 'wx', mode: 0o600 })
console.log(json({ outputPrefix: out, sourceCoverage: result.sourceCoverage, audit: result.audit, gates: result.gates, decisionCount: result.decisions.length, proposalCount: result.proposals.length, handoffSha256: artifacts.find((artifact) => artifact.role === 'handoff')!.sha256 }))
if (!result.audit.safe) process.exitCode = 2
