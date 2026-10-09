import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentVersions, localPayloadConfig, MigrationGateError, parseMigrationArgs, prepareMigration, sha256, validateHandoff } from '../scripts/import/local-migration-contract'
import type { SanitizedConfig } from 'payload'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const handoff = () => ({ formatVersion: 1, deployOnClient: false, targetOrigin: 'https://www.underwater.pl', audit: { safe: true, blockingIssues: [] as string[] },
  gates: { ownPreviewRoutesReady: true, clientCutoverReady: false }, routes: [{ from: '/old.html', to: '/new.html', status: 301, queryPolicy: 'preserve', source: 'published', recordId: 1 }], decisions: [{ disposition: 'unresolved' }] })
async function fixture() {
  const workRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'underwater-migration-gates-')))
  const source = path.join(workRoot, 'source'), target = path.join(workRoot, 'target'), reports = path.join(workRoot, 'reports')
  for (const directory of [source, target, reports, path.join(target, 'media')]) await mkdir(directory)
  const isolationID = randomUUID()
  async function write(file: string, value: unknown) { const bytes = JSON.stringify(value) + '\n'; await writeFile(file, bytes); return { path: file, sha256: sha256(bytes) } }
  const markerFile = path.join(target, '.underwater-local-migration.json')
  const marker = { formatVersion: 1, purpose: 'local-migration-copy', environment: 'test', clientWrites: false, isolationID, root: target }
  await write(markerFile, marker)
  await writeFile(path.join(target, 'underwater-test.db'), 'Synthetic filesystem-only placeholder; no SQL execution in this test.')
  const manifest = { formatVersion: 1, kind: 'demo', capturedAt: '2026-10-09T00:00:00Z', databaseSnapshot: false, complete: false,
    sourceVersions: { joomla: 'synthetic-no-client-version', virtuemart: 'synthetic-no-client-version' },
    coverage: { accounts: { knownTotal: null, exported: 0, status: 'not-imported' }, history: { knownTotal: null, exported: 0, status: 'not-imported' } } }
  const sourceManifest = await write(path.join(source, 'source-manifest.json'), manifest)
  const bundle = await write(path.join(source, 'bundle.json'), { version: 1, source: { kind: 'demo', manifestHash: sourceManifest.sha256, capturedAt: manifest.capturedAt, complete: false }, media: [], entities: [] })
  const seo = await write(path.join(source, 'seo.handoff.json'), handoff())
  const pkg = { formatVersion: 1, clientWrites: false, scope: 'synthetic', versions: await currentVersions(repoRoot), sourceManifest, bundle, handoff: seo, mediaRoot: source }
  const packagePath = path.join(source, 'package.json')
  await write(packagePath, pkg)
  const args = parseMigrationArgs(['--work-root', workRoot, '--package', packagePath, '--target', target, '--reports', reports])
  return { workRoot, source, target, reports, isolationID, markerFile, marker, packagePath, pkg, manifest, args, write,
    cleanup: () => rm(workRoot, { recursive: true, force: true }) }
}
const code = (expected: string) => (error: unknown) => error instanceof MigrationGateError && error.code === expected

test('Payload migration config disables project generation without mutating the shared application config', async () => {
  const original = { typescript: { outputFile: '/owned/types.ts', autoGenerate: true }, admin: { importMap: { baseDir: '/owned/src', autoGenerate: true } } } as SanitizedConfig
  const migrationConfig = await localPayloadConfig(Promise.resolve(original))
  assert.equal(migrationConfig.typescript.autoGenerate, false)
  assert.equal(migrationConfig.admin.importMap.autoGenerate, false)
  assert.equal(original.typescript.autoGenerate, true); assert.equal(original.admin.importMap.autoGenerate, true)
  assert.equal(migrationConfig.typescript.outputFile, original.typescript.outputFile)
})

test('local migration defaults to read-only planning; only an explicit local flag allows writes', () => {
  const required = ['--work-root', '/evidence', '--package', '/evidence/source/pkg.json', '--target', '/evidence/target', '--reports', '/evidence/reports']
  assert.equal(parseMigrationArgs(required).applyLocal, false)
  assert.equal(parseMigrationArgs([...required, '--apply-local']).applyLocal, true)
  for (const flags of [['--apply'], ['--deploy-client'], ['--reset'], ['--work-root', '/other'], ['--apply-local', '--apply-local']]) assert.throws(() => parseMigrationArgs([...required, ...flags]), code('invalid-arguments'))
})
test('SEO input refuses client deployment, blockers, foreign origins and unsafe routes; content decisions stay visible', () => {
  assert.deepEqual(validateHandoff(handoff()), { published301: 1, unresolvedDecisions: 1 })
  for (const change of [
    (v: any) => { v.deployOnClient = true }, (v: any) => { v.audit.blockingIssues.push('loop') }, (v: any) => { v.audit.safe = false },
    (v: any) => { v.gates.ownPreviewRoutesReady = false }, (v: any) => { v.gates.clientCutoverReady = true }, (v: any) => { v.targetOrigin = 'https://underwater-demo.programo.pl' },
    (v: any) => { v.routes[0].to = '//foreign.invalid' }, (v: any) => { v.routes[0].from = '/old?secret=1' }, (v: any) => { v.routes[0].queryPolicy = 'drop' },
  ]) { const value = handoff(); change(value); assert.throws(() => validateHandoff(value), MigrationGateError) }
})
test('source fingerprints, versions and private history coverage are mandatory before opening Payload', async () => {
  const f = await fixture()
  try {
    const valid = await prepareMigration(f.args, repoRoot)
    assert.equal(valid.scope, 'synthetic'); assert.equal(valid.privateCoverage.accounts.knownTotal, null)
    assert.equal(valid.bundle.source.complete, false)
    await writeFile(f.pkg.bundle.path, '{"tampered":true}')
    await assert.rejects(prepareMigration(f.args, repoRoot), code('fingerprint-mismatch'))
    await f.write(f.packagePath, { ...f.pkg, versions: { ...f.pkg.versions, importer: f.pkg.versions.importer - 1 } })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('version-or-package-mismatch'))
    await f.write(f.packagePath, { ...f.pkg, ftpPassword: 'synthetic-forbidden-config-field' })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('version-or-package-mismatch'))
  } finally { await f.cleanup() }
})
test('source manifest cannot claim a synthetic snapshot is a complete client database or imported history', async () => {
  const f = await fixture()
  try {
    const manifest = { ...f.manifest, coverage: { ...f.manifest.coverage, accounts: { knownTotal: 10, exported: 10, status: 'imported' } } }
    const sourceManifest = await f.write(f.pkg.sourceManifest.path, manifest)
    const bundle = await f.write(f.pkg.bundle.path, { version: 1, source: { kind: 'demo', manifestHash: sourceManifest.sha256, capturedAt: manifest.capturedAt, complete: false }, media: [], entities: [] })
    await f.write(f.packagePath, { ...f.pkg, sourceManifest, bundle })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('private-history-coverage-required'))
    await f.write(f.packagePath, { ...f.pkg, sourceManifest, bundle, scope: 'database-export' })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('source-manifest-mismatch'))
  } finally { await f.cleanup() }
})
test('target marker, source/output separation and symlink containment block accidental writes to another copy', async () => {
  const f = await fixture()
  try {
    await f.write(f.markerFile, { ...f.marker, root: f.source })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('invalid-target-marker'))
    await f.write(f.markerFile, f.marker)
    await f.write(f.packagePath, { ...f.pkg, mediaRoot: path.join(f.target, 'media') })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('overlapping-source-and-output'))
    await f.write(f.packagePath, f.pkg)
    const alias = path.join(f.workRoot, 'target-alias')
    await symlink(f.target, alias)
    await assert.rejects(prepareMigration({ ...f.args, targetRoot: alias }, repoRoot), code('symlink-or-wrong-file-type'))
    await assert.rejects(prepareMigration({ ...f.args, reportsRoot: path.join(f.target, 'media') }, repoRoot), code('overlapping-target-and-reports'))
    await assert.rejects(prepareMigration({ ...f.args, targetRoot: path.dirname(f.workRoot) }, repoRoot), code('outside-work-root'))
    await assert.rejects(prepareMigration({ ...f.args, workRoot: repoRoot }, repoRoot), code('unsafe-work-root'))
  } finally { await f.cleanup() }
})
test('unreviewed redirect proposals cannot enter a migration bundle through the handoff attachment', async () => {
  const f = await fixture()
  try {
    const bundle = await f.write(f.pkg.bundle.path, { version: 1, source: { kind: 'demo', manifestHash: f.pkg.sourceManifest.sha256, capturedAt: f.manifest.capturedAt, complete: false },
      media: [], entities: [{ collection: 'redirects', key: 'synthetic-proposal', data: { from: '/unreviewed-old.html', to: '/new.html', published: true } }] })
    await f.write(f.packagePath, { ...f.pkg, bundle })
    await assert.rejects(prepareMigration(f.args, repoRoot), code('bundle-redirect-not-in-approved-handoff'))
  } finally { await f.cleanup() }
})
test('environment files referenced as source media are rejected without opening them', async () => {
  const f = await fixture()
  try {
    const bundle = await f.write(f.pkg.bundle.path, { version: 1, source: { kind: 'demo', manifestHash: f.pkg.sourceManifest.sha256, capturedAt: f.manifest.capturedAt, complete: false },
      media: [{ key: 'synthetic-excluded', path: '.env.synthetic.png', sha256: '0'.repeat(64) }], entities: [] })
    await f.write(f.packagePath, { ...f.pkg, bundle })
    await assert.rejects(prepareMigration(f.args, repoRoot), (error: unknown) => error instanceof Error && error.name === 'ImportError')
  } finally { await f.cleanup() }
})
test('resume binds the exact source package and isolated database, and preserves the checkpoint', async () => {
  const f = await fixture()
  try {
    const checkpoint = path.join(f.reports, 'interrupted.json')
    const value = { formatVersion: 1, stage: 'applying', packageSha256: sha256(await readFile(f.packagePath)), isolationID: f.isolationID, versions: f.pkg.versions }
    await f.write(checkpoint, value)
    assert.match((await prepareMigration({ ...f.args, resume: checkpoint }, repoRoot)).resumedFrom!, /^[a-f0-9]{64}$/)
    await f.write(checkpoint, { ...value, isolationID: randomUUID() })
    await assert.rejects(prepareMigration({ ...f.args, resume: checkpoint }, repoRoot), code('resume-fingerprint-mismatch'))
    await f.write(checkpoint, { ...value, packageSha256: '0'.repeat(64) })
    await assert.rejects(prepareMigration({ ...f.args, resume: checkpoint }, repoRoot), code('resume-fingerprint-mismatch'))
    assert.equal(JSON.parse(await readFile(checkpoint, 'utf8')).stage, 'applying')
  } finally { await f.cleanup() }
})
