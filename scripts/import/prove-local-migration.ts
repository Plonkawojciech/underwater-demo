/** Retained synthetic proof: initializes a NEW database using existing migrations. No source/client access. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'
import { importBundle } from '../../src/lib/import/service'
import { currentVersions, localPayloadConfig, parseMigrationArgs, prepareMigration, sha256 } from './local-migration-contract'
import { runPreparedMigration, targetSnapshot } from './local-migration'

async function projectSnapshot(repoRoot: string) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot }).toString('utf8').split('\0').filter(file => file && !file.split('/').some(part => part.startsWith('.env'))).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file + '\0')
    for await (const chunk of createReadStream(path.join(repoRoot, file))) hash.update(chunk)
    hash.update('\0')
  }
  return { files: files.length, sha256: hash.digest('hex') }
}

export async function proveLocalMigration(outputParent: string) {
  if (!path.isAbsolute(outputParent) || await realpath(outputParent) !== outputParent || !outputParent.startsWith('/Volumes/Mad Dog/')) throw new Error('Retained proof parent must be a mounted canonical Mad Dog directory.')
  const workRoot = path.join(outputParent, 'synthetic-migration-' + randomUUID())
  const targetRoot = path.join(workRoot, 'target'), sourceRoot = path.join(workRoot, 'source'), reportsRoot = path.join(workRoot, 'reports')
  for (const directory of [workRoot, targetRoot, sourceRoot, reportsRoot, path.join(targetRoot, 'media')]) await mkdir(directory, { mode: 0o700 })
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const projectBefore = await projectSnapshot(repoRoot)
  const writeJSON = async (file: string, value: unknown) => { const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); return { path: file, sha256: sha256(bytes) } }
  const isolationID = randomUUID()
  await writeJSON(path.join(targetRoot, '.underwater-local-migration.json'), { formatVersion: 1, purpose: 'local-migration-copy', root: targetRoot, isolationID, environment: 'test', clientWrites: false })
  const sourceManifest = await writeJSON(path.join(sourceRoot, 'source-manifest.json'), { formatVersion: 1, kind: 'demo', capturedAt: '2026-10-09T00:00:00Z', complete: false, databaseSnapshot: false,
    sourceVersions: { joomla: 'synthetic-no-client-version', virtuemart: 'synthetic-no-client-version' },
    coverage: { accounts: { knownTotal: null, exported: 0, status: 'not-imported' }, history: { knownTotal: null, exported: 0, status: 'not-imported' } } })
  const sharp = (await import('sharp')).default
  const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#0b3d5c' } }).png().toBuffer()
  await writeFile(path.join(sourceRoot, 'synthetic.png'), image, { flag: 'wx', mode: 0o600 })
  const entities = [
    { collection: 'categories', key: 'synthetic-category', data: { name: 'Synthetic category', slug: 'synthetic-category', published: true } },
    { collection: 'products', key: 'synthetic-product', data: { name: 'Synthetic product', slug: 'synthetic-product', vmId: 1, priceCents: 12300, stock: 4, published: true }, relations: { category: 'categories:synthetic-category', images: ['media:synthetic-image'] } },
    { collection: 'pages', key: 'synthetic-page', data: { title: 'Synthetic page', path: '/synthetic-page.html', kind: 'page', body: '<p>Synthetic content</p>', published: true } },
    { collection: 'redirects', key: 'synthetic-redirect', data: { from: '/synthetic-old.html', to: '/synthetic-page.html', published: true } },
  ]
  const bundle = { version: 1, source: { kind: 'demo', manifestHash: sourceManifest.sha256, capturedAt: '2026-10-09T00:00:00Z', complete: false },
    media: [{ key: 'synthetic-image', path: 'synthetic.png', sha256: sha256(image), alt: 'Synthetic image', url: '/images/synthetic.png' }], entities }
  const bundleFile = await writeJSON(path.join(sourceRoot, 'bundle.json'), bundle)
  const handoff = await writeJSON(path.join(sourceRoot, 'seo.handoff.json'), { formatVersion: 1, targetOrigin: 'https://www.underwater.pl', deployOnClient: false,
    audit: { blockingIssues: [], safe: true }, gates: { ownPreviewRoutesReady: true, clientCutoverReady: false },
    routes: [{ from: '/synthetic-old.html', to: '/synthetic-page.html', status: 301, queryPolicy: 'preserve', source: 'published', recordId: 1 }], decisions: [] })
  const packagePath = path.join(sourceRoot, 'migration-package.json')
  const pkg = { formatVersion: 1, scope: 'synthetic', clientWrites: false, versions: await currentVersions(repoRoot), mediaRoot: sourceRoot, bundle: bundleFile, sourceManifest, handoff }
  await writeJSON(packagePath, pkg)
  Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: targetRoot, DATABASE_URI: `file:${targetRoot}/underwater-test.db`, MEDIA_DIR: `${targetRoot}/media`,
    UNDERWATER_ORIGIN: 'http://localhost:3011', NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', UNDERWATER_PAYMENT_PROVIDER: 'internal-test', PAYLOAD_SECRET: randomUUID() + randomUUID() })
  const { getPayload } = await import('payload')
  const config = (await import('../../src/payload.config')).default
  const payload: Payload = await getPayload({ config: await localPayloadConfig(config), disableOnInit: true })
  try {
    await payload.db.migrate() // Existing reviewed migration files only; never done by the production entrypoint.
    await payload.create({ collection: 'users', overrideAccess: true, context: { systemAction: 'bootstrap-admin' }, data: { email: 'synthetic-preserved@example.invalid', password: randomUUID() + randomUUID(), role: 'admin', name: 'Synthetic preserved account' } })
    await payload.create({ collection: 'contacts', overrideAccess: true, context: { systemAction: 'form-service' }, data: { name: 'Synthetic existing contact', email: 'synthetic-contact@example.invalid', message: 'Synthetic private history kept.', privacyAccepted: true } })
    await payload.create({ collection: 'orders', overrideAccess: true, context: { systemAction: 'order-service' }, data: { number: 'SYNTHETIC-PRESERVED-1', customerName: 'Synthetic existing customer', email: 'synthetic-order@example.invalid', total: 123, items: [], privacyAccepted: true, termsAccepted: true } })
    await payload.create({ collection: 'pages', overrideAccess: true, data: { title: 'Manual content kept', path: '/manual-kept.html', kind: 'page', published: false } })
    await writeFile(path.join(targetRoot, 'media', 'manual-kept.txt'), 'Synthetic manual media stays intact.\n', { flag: 'wx', mode: 0o600 })
    const baseArgs = ['--work-root', workRoot, '--package', packagePath, '--target', targetRoot, '--reports', reportsRoot]
    const args = parseMigrationArgs(baseArgs)
    const prepared = await prepareMigration(args, repoRoot)
    const before = await targetSnapshot(payload, prepared.mediaRoot)
    assert.equal(before.tables.users.count, 1); assert.equal(before.tables.orders.count, 1); assert.equal(before.tables.contacts.count, 1)
    const dry = await runPreparedMigration(payload, prepared, args, repoRoot)
    assert.equal(dry.report.mode, 'dry-run'); assert.equal(dry.report.sourceComplete, false)
    assert.equal(dry.report.accountsMigration, 'unsupported'); assert.equal(dry.report.historyMigration, 'unsupported')
    assert.equal(dry.report.privateCoverage.accounts.knownTotal, null); assert.equal(dry.report.privateCoverage.history.exported, 0)
    assert.deepEqual(await targetSnapshot(payload, prepared.mediaRoot), before)
    assert.equal((dry.report as any).plan.created, 4)
    const first = await runPreparedMigration(payload, prepared, { applyLocal: true }, repoRoot)
    assert.equal((first.report as any).counts.created, 4)
    assert.equal((first.report as any).counts.mediaCreated, 1)
    const resumedArgs = parseMigrationArgs([...baseArgs, '--apply-local', '--resume', first.checkpointPath])
    const resumed = await prepareMigration(resumedArgs, repoRoot)
    const replay = await runPreparedMigration(payload, resumed, resumedArgs, repoRoot)
    assert.equal((replay.report as any).counts.created, 0); assert.equal((replay.report as any).counts.updated, 0); assert.equal((replay.report as any).counts.unchanged, 4)
    const product = (await payload.find({ collection: 'products', where: { legacyKey: { equals: 'synthetic-product' } }, overrideAccess: true, depth: 0 })).docs[0]
    await payload.update({ collection: 'products', id: product.id, overrideAccess: true, data: { name: 'Manual product edit kept' } })
    await payload.update({ collection: 'products', id: product.id, overrideAccess: true, context: { systemAction: 'operations-service' }, data: { stock: 2 } })
    const preserved = await runPreparedMigration(payload, prepared, { applyLocal: true }, repoRoot)
    assert.equal((preserved.report as any).counts.preserved, 1)
    // A new synthetic source revision disagrees with the manual title; it must become a review conflict.
    const revisionManifestValue = { ...JSON.parse(await readFile(sourceManifest.path, 'utf8')), capturedAt: '2026-10-09T00:01:00Z' }
    const revisionManifest = await writeJSON(path.join(sourceRoot, 'source-manifest-revision.json'), revisionManifestValue)
    const revisionBundleValue = { ...bundle, source: { ...bundle.source, manifestHash: revisionManifest.sha256, capturedAt: revisionManifestValue.capturedAt },
      entities: entities.map(entity => entity.key === 'synthetic-product' ? { ...entity, data: { ...entity.data, name: 'Synthetic new source title' } } : entity) }
    const revisionBundle = await writeJSON(path.join(sourceRoot, 'bundle-revision.json'), revisionBundleValue)
    const revisionPackagePath = path.join(sourceRoot, 'migration-package-revision.json')
    await writeJSON(revisionPackagePath, { ...pkg, sourceManifest: revisionManifest, bundle: revisionBundle })
    const revisionBaseArgs = ['--work-root', workRoot, '--package', revisionPackagePath, '--target', targetRoot, '--reports', reportsRoot]
    const revisionArgs = parseMigrationArgs(revisionBaseArgs)
    const revisionPrepared = await prepareMigration(revisionArgs, repoRoot)
    const conflict = await runPreparedMigration(payload, revisionPrepared, { applyLocal: true }, repoRoot)
    assert.equal((conflict.report as any).counts.conflicts, 1)
    const keptProduct = await payload.findByID({ collection: 'products', id: product.id, overrideAccess: true, depth: 0 })
    assert.equal(keptProduct.name, 'Manual product edit kept'); assert.equal(keptProduct.stock, 2)
    // Simulate lost caller acknowledgement after a real committed importer run. Resume reconciles rather than resetting.
    let loseAcknowledgement = true
    const lostAck: typeof importBundle = async (...input) => {
      const result = await importBundle(...input)
      if (!result.dryRun && loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Synthetic lost caller acknowledgement') }
      return result
    }
    await assert.rejects(runPreparedMigration(payload, revisionPrepared, { applyLocal: true }, repoRoot, lostAck))
    const reportFiles = (await import('node:fs/promises')).readdir
    const failures = (await reportFiles(reportsRoot)).filter(file => file.endsWith('-failed.json'))
    assert.equal(failures.length, 1)
    const failurePath = path.join(reportsRoot, failures[0])
    const recoveryArgs = parseMigrationArgs([...revisionBaseArgs, '--apply-local', '--resume', failurePath])
    const recovery = await runPreparedMigration(payload, await prepareMigration(recoveryArgs, repoRoot), recoveryArgs, repoRoot)
    assert.equal((recovery.report as any).counts.created, 0); assert.equal((recovery.report as any).counts.updated, 0); assert.equal((recovery.report as any).counts.conflicts, 1)
    assert.equal(await readFile(path.join(targetRoot, 'media', 'manual-kept.txt'), 'utf8'), 'Synthetic manual media stays intact.\n')
    const manualPages = await payload.find({ collection: 'pages', where: { path: { equals: '/manual-kept.html' } }, overrideAccess: true })
    assert.equal(manualPages.totalDocs, 1); assert.equal(manualPages.docs[0].title, 'Manual content kept'); assert.equal(manualPages.docs[0].published, false)
    const projectAfter = await projectSnapshot(repoRoot)
    assert.deepEqual(projectAfter, projectBefore, 'Payload init/import must not regenerate tracked source files')
    const proof = { formatVersion: 1, scope: 'synthetic-only', clientSourceRead: false, clientWrites: 0, databaseRetained: true, sourceComplete: false, clientCutoverReady: false,
      checks: { defaultDryRun: true, allTableAndMediaHashesUnchangedInDryRun: true, created: 4, replayUnchanged: 4, replayCreated: 0, replayUpdated: 0,
        projectFilesUnchanged: true, sourceImageImported: true, existingPrivateAccountOrderAndContactPreserved: true, manualContentPreserved: true, manualStockPreserved: true, conflictReported: true, callerAckLossRecovery: true, sourceAccountAndHistoryGapsReported: true },
      projectBefore, projectAfter,
      packageSha256: prepared.packageSha256, revisionPackageSha256: revisionPrepared.packageSha256, versions: prepared.versions, reports: [dry, first, replay, preserved, conflict, recovery].map(result => ({ file: result.checkpointPath })),
      failedCheckpoint: failurePath, after: await targetSnapshot(payload, prepared.mediaRoot) }
    await writeJSON(path.join(workRoot, 'proof.json'), proof)
    return { workRoot, checks: proof.checks }
  } finally { await payload.destroy() }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proveLocalMigration(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(() => { console.log(JSON.stringify({ success: false, scope: 'synthetic-only', errorCode: 'synthetic-proof-failed' })); process.exitCode = 1 })
}
