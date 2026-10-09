/** Run under the global heavy wrapper. Preserve isolated evidence outside the checkout. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const artifactRoot = process.env.UNDERWATER_E2E_ARTIFACT_ROOT
const port = Number(process.env.UNDERWATER_E2E_PORT || 3062)
if (!artifactRoot || !path.isAbsolute(artifactRoot)) throw new Error('An absolute, dedicated E2E artifact root is required.')
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Allocate a valid dedicated unprivileged port.')
await mkdir(artifactRoot, { recursive: true })
const root = await mkdtemp(path.join(artifactRoot, 'underwater-cms-gate-'))
const buildRoot = path.join(root, 'build')
await mkdir(path.join(buildRoot, 'media'), { recursive: true })
const origin = `http://localhost:${port}`
const env = { ...process.env,
  NEXT_TELEMETRY_DISABLED: '1', UNDERWATER_PAYMENT_PROVIDER: 'internal-test',
  UNDERWATER_ENVIRONMENT: 'build', UNDERWATER_DATA_ROOT: buildRoot,
  DATABASE_URI: `file:${buildRoot}/underwater-build.db`, MEDIA_DIR: path.join(buildRoot, 'media'),
  PAYLOAD_SECRET: 'synthetic-e2e-ci-secret-not-a-runtime-credential-20261009',
  UNDERWATER_ORIGIN: origin, NEXT_PUBLIC_SERVER_URL: origin,
  UNDERWATER_E2E_PORT: String(port), UNDERWATER_E2E_ARTIFACT_ROOT: path.join(root, 'data'),
  UNDERWATER_E2E_REPORT_ROOT: root,
  // This gate always owns its fresh harness; it never targets an existing server.
  UNDERWATER_E2E_BASE_URL: '', UNDERWATER_E2E_ALLOW_OWNED_COPY: '',
}
const summary = { synthetic: true, root, origin, sourceCommit: '', sourceFiles: {}, startedAt: new Date().toISOString(), stages: [], wrapperChildrenExited: false }
const children = new Set()
function signal(child, name) {
  if (!child.pid) return
  try { process.kill(-child.pid, name) } catch (error) { if (error.code !== 'ESRCH') throw error }
}
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => {
  for (const child of children) signal(child, name)
})
async function run(name, bin, args) {
  const started = Date.now()
  const logfile = path.join(root, `${name}.log`)
  const log = createWriteStream(logfile, { flags: 'wx', mode: 0o600 })
  const child = spawn(bin, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, terminatedBy) => resolve(code ?? (terminatedBy ? 128 : 1)))
  })
  children.delete(child)
  await new Promise(resolve => log.end(resolve))
  summary.stages.push({ name, bin, args, code, durationMS: Date.now() - started, logfile, pid: child.pid })
  console.log(`${name}: exit ${code}; ${logfile}`)
  return code
}
try {
  const git = spawn('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'inherit'] })
  let commit = ''
  git.stdout.on('data', chunk => { commit += chunk })
  if (await new Promise(resolve => git.once('close', resolve)) !== 0) throw new Error('Cannot identify the candidate checkout.')
  summary.sourceCommit = commit.trim()
  for (const file of ['package.json', 'pnpm-lock.yaml', 'playwright.config.ts', 'scripts/qa/client-cms-gate.mjs', 'scripts/qa/e2e-server.mjs', 'scripts/qa/e2e-fixtures.ts', 'tests/e2e/client-operations.spec.ts', 'tests/e2e/cms.spec.ts', 'tests/e2e/cms-boolean-qa.spec.ts', 'tests/e2e/contact-qa.spec.ts', 'tests/e2e/layout-qa.spec.ts', 'tests/e2e/store.spec.ts']) {
    summary.sourceFiles[file] = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex')
  }
  console.log(`Synthetic CMS gate: ${root}`)
  process.exitCode = await run('build-webpack', 'pnpm', ['build', '--webpack'])
  if (!process.exitCode) process.exitCode = await run('typecheck', 'pnpm', ['exec', 'tsc', '--noEmit', '--incremental', 'false'])
  if (!process.exitCode) {
    process.exitCode = await run('e2e', 'pnpm', ['exec', 'playwright', 'test'])
    try { summary.playwright = JSON.parse(await readFile(path.join(root, 'test-results/results.json'), 'utf8')).stats }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
} finally {
  for (const child of children) signal(child, 'SIGTERM')
  summary.wrapperChildrenExited = children.size === 0
  summary.completedAt = new Date().toISOString()
  await writeFile(path.join(root, 'gate-summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
}
