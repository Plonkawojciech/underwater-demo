import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { SanitizedConfig } from 'payload'
import { IMPORTER_VERSION, validateBundle, type ImportBundle } from '../../src/lib/import/bundle'

export class MigrationGateError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'MigrationGateError' }
}
/** Payload's development init otherwise regenerates tracked project files. */
export async function localPayloadConfig(input: SanitizedConfig | Promise<SanitizedConfig>): Promise<SanitizedConfig> {
  const config = await input
  return { ...config, typescript: { ...config.typescript, autoGenerate: false },
    admin: { ...config.admin, importMap: { ...config.admin.importMap, autoGenerate: false } } }
}
const reject = (code: string): never => { throw new MigrationGateError(code) }
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const sourceVersion = (value: unknown) => typeof value === 'string' && (/^\d{1,3}(?:\.\d{1,4}){1,3}(?:[a-z0-9.+-]{0,32})?$/.test(value) || ['unknown-awaiting-current-export', 'synthetic-no-client-version'].includes(value))
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const contains = (root: string, candidate: string) => candidate.startsWith(root + path.sep)

export type MigrationVersions = { bundle: 1; importer: number; schemaSha256: string; dependenciesSha256: string }
export async function currentVersions(repoRoot: string): Promise<MigrationVersions> {
  const directory = path.join(repoRoot, 'src/migrations')
  const files = (await readdir(directory)).filter(name => /\.(ts|json)$/.test(name)).sort()
  const schema = createHash('sha256')
  for (const name of files) { schema.update(name + '\0'); schema.update(await readFile(path.join(directory, name))); schema.update('\0') }
  const dependencies = createHash('sha256')
  for (const name of ['package.json', 'pnpm-lock.yaml']) { dependencies.update(name + '\0'); dependencies.update(await readFile(path.join(repoRoot, name))); dependencies.update('\0') }
  return { bundle: 1, importer: IMPORTER_VERSION, schemaSha256: schema.digest('hex'), dependenciesSha256: dependencies.digest('hex') }
}
export async function containedPath(workRoot: string, value: unknown, kind: 'file' | 'directory') {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.split(path.sep).some(part => part.startsWith('.env'))) reject('unsafe-path')
  const candidate = path.resolve(value)
  if (!contains(workRoot, candidate)) reject('outside-work-root')
  const info = await lstat(candidate).catch(() => reject('missing-input'))
  if (info.isSymbolicLink() || (kind === 'file' ? !info.isFile() : !info.isDirectory()) || await realpath(candidate) !== candidate) reject('symlink-or-wrong-file-type')
  return candidate
}
async function readJSON(file: string, maxBytes = 100 * 1024 * 1024) {
  if ((await lstat(file)).size > maxBytes) reject('input-too-large')
  const bytes = await readFile(file)
  let value: any
  try { value = JSON.parse(bytes.toString('utf8')) } catch { reject('invalid-json') }
  return { bytes, value, sha256: sha256(bytes) }
}
async function hashedJSON(workRoot: string, value: unknown) {
  if (!object(value) || Object.keys(value).some(key => !['path', 'sha256'].includes(key)) || !digest(value.sha256) || typeof value.path !== 'string' || !value.path.endsWith('.json')) reject('invalid-fingerprint')
  const file = await containedPath(workRoot, value.path, 'file')
  const input = await readJSON(file)
  if (input.sha256 !== value.sha256) reject('fingerprint-mismatch')
  return input
}
export function validateHandoff(raw: unknown) {
  if (!object(raw) || raw.formatVersion !== 1 || raw.deployOnClient !== false || raw.targetOrigin !== 'https://www.underwater.pl' ||
    !object(raw.audit) || raw.audit.safe !== true || !Array.isArray(raw.audit.blockingIssues) || raw.audit.blockingIssues.length ||
    !object(raw.gates) || raw.gates.ownPreviewRoutesReady !== true || raw.gates.clientCutoverReady !== false ||
    !Array.isArray(raw.routes) || !Array.isArray(raw.decisions)) reject('unsafe-seo-handoff')
  const from = new Set<string>()
  for (const row of raw.routes) {
    if (!object(row) || row.status !== 301 || row.queryPolicy !== 'preserve' || row.source !== 'published' || !Number.isSafeInteger(row.recordId) || row.recordId <= 0 ||
      typeof row.from !== 'string' || typeof row.to !== 'string' || !row.from.startsWith('/') || row.from.startsWith('//') ||
      !row.to.startsWith('/') || row.to.startsWith('//') || /[?#\s\\\u0000-\u001f]/.test(row.from + row.to) || row.from === row.to || from.has(row.from)) reject('unsafe-seo-route')
    from.add(row.from)
  }
  return { published301: raw.routes.length, unresolvedDecisions: raw.decisions.length }
}
export function parseMigrationArgs(args: string[]) {
  let applyLocal = false
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply-local') { if (applyLocal) reject('invalid-arguments'); applyLocal = true; continue }
    if (!['--work-root', '--package', '--target', '--reports', '--resume'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || values.has(args[i])) reject('invalid-arguments')
    values.set(args[i], args[++i])
  }
  if (!['--work-root', '--package', '--target', '--reports'].every(key => values.has(key))) reject('invalid-arguments')
  return { workRoot: values.get('--work-root')!, packagePath: values.get('--package')!, targetRoot: values.get('--target')!, reportsRoot: values.get('--reports')!, resume: values.get('--resume'), applyLocal }
}
export type MigrationArgs = ReturnType<typeof parseMigrationArgs>
export async function prepareMigration(args: MigrationArgs, repoRoot: string) {
  if (!path.isAbsolute(args.workRoot) || args.workRoot.split(path.sep).some(part => part.startsWith('.env'))) reject('unsafe-work-root')
  const workRoot = path.resolve(args.workRoot)
  if (await realpath(workRoot) !== workRoot || !(await lstat(workRoot)).isDirectory()) reject('unsafe-work-root')
  // A workspace is a separate evidence directory, never a source checkout, home or a live /data volume.
  if (workRoot === path.parse(workRoot).root || workRoot === process.env.HOME || workRoot === path.resolve(repoRoot) || contains(path.resolve(repoRoot), workRoot) || workRoot === '/data' || workRoot.startsWith('/data/')) reject('unsafe-work-root')
  const targetRoot = await containedPath(workRoot, args.targetRoot, 'directory')
  const reportsRoot = await containedPath(workRoot, args.reportsRoot, 'directory')
  if (reportsRoot === targetRoot || contains(targetRoot, reportsRoot) || contains(reportsRoot, targetRoot)) reject('overlapping-target-and-reports')
  const markerFile = await containedPath(workRoot, path.join(targetRoot, '.underwater-local-migration.json'), 'file')
  const marker = (await readJSON(markerFile, 4096)).value
  if (!object(marker) || marker.formatVersion !== 1 || marker.purpose !== 'local-migration-copy' || marker.environment !== 'test' || marker.clientWrites !== false ||
    marker.root !== targetRoot || typeof marker.isolationID !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.isolationID)) reject('invalid-target-marker')
  const databasePath = await containedPath(workRoot, path.join(targetRoot, 'underwater-test.db'), 'file')
  const mediaRoot = await containedPath(workRoot, path.join(targetRoot, 'media'), 'directory')
  const packageFile = await containedPath(workRoot, args.packagePath, 'file')
  if (contains(targetRoot, packageFile) || contains(reportsRoot, packageFile)) reject('input-inside-output')
  const packageInput = await readJSON(packageFile, 32768)
  const pkg = packageInput.value
  const versions = await currentVersions(repoRoot)
  if (!object(pkg) || Object.keys(pkg).some(key => !['formatVersion', 'clientWrites', 'scope', 'versions', 'mediaRoot', 'bundle', 'sourceManifest', 'handoff'].includes(key)) ||
    pkg.formatVersion !== 1 || pkg.clientWrites !== false || !['synthetic', 'public-capture', 'database-export'].includes(pkg.scope) ||
    !object(pkg.versions) || Object.keys(pkg.versions).length !== Object.keys(versions).length || !Object.entries(versions).every(([key, value]) => pkg.versions[key] === value)) reject('version-or-package-mismatch')
  const sourceRoot = await containedPath(workRoot, pkg.mediaRoot, 'directory')
  if (sourceRoot === targetRoot || contains(targetRoot, sourceRoot) || contains(sourceRoot, targetRoot) || sourceRoot === reportsRoot || contains(reportsRoot, sourceRoot) || contains(sourceRoot, reportsRoot)) reject('overlapping-source-and-output')
  for (const descriptor of [pkg.bundle, pkg.sourceManifest, pkg.handoff]) {
    if (object(descriptor) && typeof descriptor.path === 'string' && (contains(targetRoot, descriptor.path) || contains(reportsRoot, descriptor.path))) reject('input-inside-output')
  }
  const source = await hashedJSON(workRoot, pkg.sourceManifest)
  const bundleInput = await hashedJSON(workRoot, pkg.bundle)
  const handoffInput = await hashedJSON(workRoot, pkg.handoff)
  const bundle: ImportBundle = validateBundle(bundleInput.value).bundle
  if (bundle.source.manifestHash !== source.sha256 || !object(source.value) || source.value.formatVersion !== 1 ||
    source.value.kind !== bundle.source.kind || source.value.capturedAt !== bundle.source.capturedAt || source.value.complete !== bundle.source.complete ||
    !object(source.value.sourceVersions) || Object.keys(source.value.sourceVersions).length !== 2 || !['joomla', 'virtuemart'].every(key => sourceVersion(source.value.sourceVersions[key])) ||
    (pkg.scope === 'synthetic' && (bundle.source.kind !== 'demo' || source.value.databaseSnapshot !== false || bundle.source.complete)) ||
    (pkg.scope === 'public-capture' && (bundle.source.kind !== 'public-pages' || source.value.databaseSnapshot !== false || bundle.source.complete)) ||
    (pkg.scope === 'database-export' && (bundle.source.kind !== 'joomla-dump' || source.value.databaseSnapshot !== true || !['joomla', 'virtuemart'].every(key => /^\d/.test(source.value.sourceVersions[key]))))) reject('source-manifest-mismatch')
  if (!object(source.value.coverage) || Object.keys(source.value.coverage).length !== 2 || !['accounts', 'history'].every(key => object(source.value.coverage[key]) &&
    Object.keys(source.value.coverage[key]).length === 3 && ['knownTotal', 'exported', 'status'].every(field => field in source.value.coverage[key]) &&
    source.value.coverage[key].exported === 0 && source.value.coverage[key].status === 'not-imported' &&
    (source.value.coverage[key].knownTotal === null || Number.isSafeInteger(source.value.coverage[key].knownTotal) && source.value.coverage[key].knownTotal >= 0))) reject('private-history-coverage-required')
  const seo = validateHandoff(handoffInput.value)
  const approvedRoutes = new Map<string, string>(handoffInput.value.routes.map((row: any) => [row.from, row.to]))
  for (const entity of bundle.entities) {
    if (entity.collection === 'redirects' && entity.data.published === true && approvedRoutes.get(entity.data.from as string) !== entity.data.to) reject('bundle-redirect-not-in-approved-handoff')
  }
  let resumedFrom: string | null = null
  if (args.resume) {
    const checkpointFile = await containedPath(workRoot, args.resume, 'file')
    if (!contains(reportsRoot, checkpointFile)) reject('resume-outside-reports')
    const checkpoint = (await readJSON(checkpointFile, 1024 * 1024)).value
    if (!object(checkpoint) || checkpoint.formatVersion !== 1 || checkpoint.packageSha256 !== packageInput.sha256 || checkpoint.isolationID !== marker.isolationID ||
      !['preflight', 'applying', 'finished', 'failed'].includes(checkpoint.stage) || !object(checkpoint.versions) || !Object.entries(versions).every(([key, value]) => checkpoint.versions[key] === value)) reject('resume-fingerprint-mismatch')
    resumedFrom = sha256(await readFile(checkpointFile))
  }
  return { workRoot, targetRoot, databasePath, mediaRoot, reportsRoot, sourceRoot, isolationID: marker.isolationID as string,
    packageSha256: packageInput.sha256, versions, scope: pkg.scope as string, bundle, verifiedSourceManifestHash: source.sha256, seo, resumedFrom,
    sourceVersions: source.value.sourceVersions as { joomla: string; virtuemart: string },
    privateCoverage: source.value.coverage as Record<string, { exported: 0; status: 'not-imported'; knownTotal: number | null }> }
}
export type PreparedMigration = Awaited<ReturnType<typeof prepareMigration>>
