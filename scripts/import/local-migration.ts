/** Local copies only. This entrypoint never initializes/migrates a schema or connects to a client server. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'
import { importBundle } from '../../src/lib/import/service'
import { localPayloadConfig, MigrationGateError, parseMigrationArgs, prepareMigration, sha256, type MigrationArgs, type PreparedMigration } from './local-migration-contract'

type Client = { execute(sql: string): Promise<{ rows: Record<string, any>[] }> }
const privateTables = new Set(['users', 'orders', 'signups', 'contacts', 'newsletter', 'payment_attempts', 'payment_events', 'outbox'])
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)
export async function targetSnapshot(payload: Payload, mediaRoot: string) {
  const client = (payload.db as unknown as { client: Client }).client
  const tables = (await client.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")).rows
  const rows: Record<string, { count: number; sha256: string }> = {}
  for (const table of tables) {
    const name = String(table.name)
    const data = (await client.execute('SELECT * FROM "' + name.replace(/"/g, '""') + '"')).rows.map(row => json(row)).sort()
    rows[name] = { count: data.length, sha256: sha256(json(data)) }
  }
  const media: { bytes: number; sha256: string }[] = []
  async function visit(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith('.env')) throw new MigrationGateError('excluded-target-media')
      const file = path.join(directory, name), info = await lstat(file)
      if (info.isSymbolicLink()) throw new MigrationGateError('target-media-symlink')
      if (info.isDirectory()) await visit(file)
      else if (info.isFile()) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(file)) hash.update(chunk)
        media.push({ bytes: info.size, sha256: sha256(path.relative(mediaRoot, file) + '\0' + hash.digest('hex')) })
      }
      else throw new MigrationGateError('target-media-file-type')
    }
  }
  await visit(mediaRoot)
  return { tables: rows, tablesSha256: sha256(json({ schema: tables, rows })), mediaFiles: media.length, mediaSha256: sha256(json(media)),
    privateSha256: sha256(json(Object.fromEntries(Object.entries(rows).filter(([name]) => [...privateTables].some(table => name === table || name.startsWith(table + '_')))))) }
}
export async function assertSchemaLedger(payload: Payload, repoRoot: string) {
  const expected = (await readdir(path.join(repoRoot, 'src/migrations'))).filter(name => /^\d{8}_\d{6}.*\.ts$/.test(name)).map(name => name.slice(0, -3)).sort()
  const client = (payload.db as unknown as { client: Client }).client
  const applied = (await client.execute('SELECT name FROM payload_migrations ORDER BY name')).rows.map(row => row.name).sort()
  if (json(applied) !== json(expected)) throw new MigrationGateError('target-schema-ledger-mismatch')
  return expected.length
}
function unresolvedSummary(items: string[]) {
  const byKind: Record<string, number> = {}
  const hashedReferences: { kind: string; sha256: string }[] = []
  for (const item of items) {
    const prefix = item.split(':')[0]
    const kind = /^[a-z][a-z0-9-]{0,79}$/.test(prefix) ? prefix : 'review'
    byKind[kind] = (byKind[kind] || 0) + 1
    hashedReferences.push({ kind, sha256: sha256(item) })
  }
  return { total: items.length, byKind, hashedReferences }
}
async function acquireLock(prepared: PreparedMigration): Promise<() => Promise<void>> {
  const file = path.join(prepared.targetRoot, '.underwater-local-migration.lock')
  try {
    const handle = await open(file, 'wx', 0o600)
    await handle.writeFile(json({ pid: process.pid, host: hostname(), isolationID: prepared.isolationID })); await handle.sync(); await handle.close()
  } catch (error: any) {
    if (error.code !== 'EEXIST') throw error
    if ((await lstat(file)).isSymbolicLink()) throw new MigrationGateError('unsafe-lock')
    let previous: any
    try { previous = JSON.parse(await readFile(file, 'utf8')) } catch { throw new MigrationGateError('unsafe-lock') }
    if (previous.host !== hostname() || previous.isolationID !== prepared.isolationID || !Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new MigrationGateError('unsafe-lock')
    try { process.kill(previous.pid, 0); throw new MigrationGateError('target-in-use') }
    catch (error: any) { if (error.code !== 'ESRCH') throw error }
    // Serialize stale-lock recovery, so another recovering process cannot archive a fresh live lock.
    const recoveryFile = file + '.recovery'
    const recovery = await open(recoveryFile, 'wx', 0o600).catch(() => { throw new MigrationGateError('lock-recovery-in-use') })
    try {
      if (await readFile(file, 'utf8') !== json(previous)) throw new MigrationGateError('lock-owner-changed')
      await rename(file, file + '.interrupted-' + randomUUID())
      return await acquireLock(prepared)
    } finally { await recovery.close(); await unlink(recoveryFile) }
  }
  return async () => { await unlink(file) }
}
export async function runPreparedMigration(payload: Payload, prepared: PreparedMigration, args: Pick<MigrationArgs, 'applyLocal'>, repoRoot: string,
  engine: typeof importBundle = importBundle) {
  const connectedURI = (payload.db as unknown as { clientConfig?: { url?: string } }).clientConfig?.url
  const uploads = payload.collections.media.config.upload as { staticDir?: string }
  if (connectedURI !== 'file:' + prepared.databasePath || uploads.staticDir !== prepared.mediaRoot) throw new MigrationGateError('prepared-target-does-not-match-runtime')
  const release = await acquireLock(prepared)
  const attemptID = randomUUID()
  const files: string[] = []
  const context = { formatVersion: 1, attemptID, isolationID: prepared.isolationID, packageSha256: prepared.packageSha256, versions: prepared.versions,
    mode: args.applyLocal ? 'apply-local' : 'dry-run', scope: prepared.scope, sourceVersions: prepared.sourceVersions, resumedFrom: prepared.resumedFrom,
    clientWrites: 0, clientCutoverReady: false, accountsMigration: 'unsupported', historyMigration: 'unsupported', privateCoverage: prepared.privateCoverage, seo: prepared.seo }
  async function checkpoint(stage: string, details: object) {
    const file = path.join(prepared.reportsRoot, `${attemptID}-${files.length}-${stage}.json`)
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(json({ ...context, checkedAt: new Date().toISOString(), stage, ...details }) + '\n'); await handle.sync() } finally { await handle.close() }
    files.push(file)
    return file
  }
  try {
    const appliedSchemaMigrations = await assertSchemaLedger(payload, repoRoot)
    const before = await targetSnapshot(payload, prepared.mediaRoot)
    const planned = await engine(payload, prepared.bundle, prepared.sourceRoot, { dryRun: true, verifiedSourceManifestHash: prepared.verifiedSourceManifestHash })
    if (!planned.dryRun) throw new MigrationGateError('invalid-importer-plan')
    const afterPlan = await targetSnapshot(payload, prepared.mediaRoot)
    if (json(before) !== json(afterPlan)) throw new MigrationGateError('dry-run-mutated-target')
    const preflight = { appliedSchemaMigrations, runKey: planned.runKey, sourceVerification: planned.sourceVerification,
      sourceComplete: false, plan: planned.plan, unresolved: unresolvedSummary(planned.unresolved), before,
      dryRunZeroRowWrites: true, dryRunZeroMediaWrites: true, schemaWrites: 0 }
    await checkpoint('preflight', preflight)
    if (!args.applyLocal) {
      const report = { ...context, ...preflight, stage: 'finished', after: afterPlan }
      const checkpointPath = await checkpoint('finished', report)
      return { report, checkpointPath, checkpoints: files }
    }
    await checkpoint('applying', preflight)
    const applied = await engine(payload, prepared.bundle, prepared.sourceRoot, { dryRun: false, verifiedSourceManifestHash: prepared.verifiedSourceManifestHash })
    if (applied.dryRun) throw new MigrationGateError('invalid-importer-result')
    const after = await targetSnapshot(payload, prepared.mediaRoot)
    if (before.privateSha256 !== after.privateSha256) throw new MigrationGateError('private-history-changed')
    const report = { ...context, stage: 'finished', appliedSchemaMigrations, runKey: applied.runKey, sourceVerification: applied.sourceVerification,
      sourceComplete: false, publicBundleComplete: applied.sourceComplete, status: applied.status, counts: applied.counts, reconciliation: applied.reconciliation,
      unresolved: unresolvedSummary(applied.unresolved), before, after, privateHistoryPreserved: true, schemaWrites: 0 }
    const checkpointPath = await checkpoint('finished', report)
    return { report, checkpointPath, checkpoints: files }
  } catch (error) {
    await checkpoint('failed', { errorCode: error instanceof MigrationGateError ? error.code : 'import-or-storage-failed', sourceComplete: false }).catch(() => undefined)
    throw error
  } finally { await release() }
}
export async function localMigrationMain(argv: string[]) {
  const args = parseMigrationArgs(argv)
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const prepared = await prepareMigration(args, repoRoot)
  // No secrets are accepted in argv/package. Runtime secret comes from the invoking environment.
  if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < 32) throw new MigrationGateError('runtime-secret-required')
  Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: prepared.targetRoot,
    DATABASE_URI: 'file:' + prepared.databasePath, MEDIA_DIR: prepared.mediaRoot, UNDERWATER_ORIGIN: 'http://localhost:3011', NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', UNDERWATER_PAYMENT_PROVIDER: 'internal-test' })
  const { getPayload } = await import('payload')
  const config = (await import('../../src/payload.config')).default
  const payload = await getPayload({ config: await localPayloadConfig(config), disableOnInit: true })
  try {
    const result = await runPreparedMigration(payload, prepared, args, repoRoot)
    console.log(json({ success: true, mode: result.report.mode, scope: result.report.scope, sourceComplete: false, clientWrites: 0,
      unresolved: result.report.unresolved.byKind, checkpointSha256: sha256(await readFile(result.checkpointPath)) }))
  } finally { await payload.destroy() }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  localMigrationMain(process.argv.slice(2)).catch(error => {
    console.log(json({ success: false, errorCode: error instanceof MigrationGateError ? error.code : 'migration-failed', clientWrites: 0 }))
    process.exitCode = 1
  })
}
