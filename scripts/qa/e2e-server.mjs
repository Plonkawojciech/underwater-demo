/** Own a temporary database and server for CI; never reuse a running preview. */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'

await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject)
  probe.listen(3013, '127.0.0.1', () => probe.close(resolve))
})
const root = await mkdtemp(path.join(tmpdir(), 'underwater-e2e-'))
let native
const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root,
  DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`,
  PAYLOAD_SECRET: 'synthetic-e2e-ci-secret-not-a-runtime-credential-20261009',
  UNDERWATER_ORIGIN: 'http://localhost:3013', NEXT_PUBLIC_SERVER_URL: 'http://localhost:3013',
  UNDERWATER_DEMO_SEED: '1', UNDERWATER_E2E_FIXTURES: '1', UNDERWATER_PAYMENT_PROVIDER: 'internal-test',
}
let server, cleaning = false, cleanupPromise
const children = new Set()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function groupSignal(child, signal) {
  if (!child.pid) return false
  try { process.kill(-child.pid, signal); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
function start(bin, args, direct = false) {
  if (cleaning) throw new Error('Harness is shutting down.')
  // Keep package shims' NODE_PATH and own the entire POSIX process group.
  const child = spawn(direct ? process.execPath : '/bin/sh', direct ? args : [path.resolve('node_modules/.bin', bin), ...args], { env, stdio: 'inherit', detached: true })
  children.add(child)
  child.done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  return child
}
function cleanup() {
  return cleanupPromise ||= (async () => {
    cleaning = true
    const owned = [...children]
    for (const child of owned) groupSignal(child, 'SIGTERM')
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && owned.some(child => groupSignal(child, 0))) await delay(50)
    for (const child of owned) if (groupSignal(child, 0)) groupSignal(child, 'SIGKILL')
    await Promise.allSettled(owned.map(child => child.done))
    await rm(root, { recursive: true, force: true })
    if (native) await rm(native, { recursive: true, force: true })
  })()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().then(() => process.exit(0)) })
async function run(bin, args) {
  const child = start(bin, args)
  const code = await child.done
  if (code !== 0) throw new Error(`Fixture preparation failed (${bin}), exit ${code}`)
}
async function runFixture(file) {
  const output = path.join(native, path.basename(file, '.ts') + '.mjs')
  // Native ESM avoids tsx's loader-time asynchronous application graph. Keep
  // each source URL: seed assets and Payload migration paths depend on it.
  await build({ entryPoints: [file], outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', plugins: [{
    name: 'original-fixture-module-location',
    setup(builder) {
      builder.onLoad({ filter: /\.tsx?$/ }, async args => {
        const source = await readFile(args.path, 'utf8')
        const ast = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true, args.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        const replacements = []
        function visit(node) {
          if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'url') replacements.push([node.getStart(ast), node.getEnd()])
          ts.forEachChild(node, visit)
        }
        visit(ast)
        let contents = source
        for (const [begin, end] of replacements.sort((a, b) => b[0] - a[0])) contents = contents.slice(0, begin) + JSON.stringify(pathToFileURL(args.path).href) + contents.slice(end)
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
      })
    },
  }] })
  const child = start('node', [output], true)
  if (await child.done !== 0) throw new Error('Native fixture preparation failed.')
}
try {
  await mkdir(path.resolve('tmp'), { recursive: true })
  native = await mkdtemp(path.resolve('tmp/underwater-native-e2e-'))
  await mkdir(env.MEDIA_DIR); await writeFile(path.join(root, 'owner.marker'), 'underwater-e2e-ci', { mode: 0o600 })
  await run('payload', ['migrate'])
  await runFixture('scripts/seed.ts')
  await runFixture('scripts/qa/e2e-fixtures.ts')
  const manifest = JSON.parse(await readFile(path.join(root, 'e2e-fixtures.json'), 'utf8'))
  if (manifest.synthetic !== true || manifest.origin !== env.UNDERWATER_ORIGIN || manifest.adminEmail !== 'qa-admin@example.invalid' || manifest.editorEmail !== 'qa-editor@example.invalid' || ![manifest.productID, manifest.courseID, manifest.sessionID].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('Synthetic fixtures were not prepared; a healthy empty server is not an E2E harness.')
  server = start('next', ['start', '-p', '3013', '--hostname', '127.0.0.1'])
  const code = await server.done
  if (!cleaning) process.exitCode = Number(code) || 1
} finally { await cleanup() }
