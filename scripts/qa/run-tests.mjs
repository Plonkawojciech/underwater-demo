/** Compile project TS before Node tests; avoid loader-time async graph hangs.
 * import.meta.url retains each original source module's location. The only
 * temporary files belong to this invocation and are removed after completion.
 */
import { build } from 'esbuild'
import ts from 'typescript'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const root = process.cwd()
await mkdir(path.join(root, 'tmp'), { recursive: true })
const temporary = await mkdtemp(path.join(root, 'tmp/underwater-native-tests-'))
try {
  const files = (await Promise.all(['tests', 'tests/ui'].map(async folder =>
    (await readdir(path.join(root, folder))).filter(name => name.endsWith('.test.ts')).map(name => path.join(folder, name))))).flat().sort()
  if (!files.length) throw new Error('No tests found.')
  const outputs = []
  const sourceURL = {
    name: 'original-module-location',
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async args => {
        const source = await readFile(args.path, 'utf8')
        const ast = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true, args.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        const replacements = []
        function visit(node) {
          if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'url') replacements.push([node.getStart(ast), node.getEnd()])
          ts.forEachChild(node, visit)
        }
        visit(ast)
        let contents = source
        const url = JSON.stringify(pathToFileURL(args.path).href)
        for (const [start, end] of replacements.sort((a, b) => b[0] - a[0])) contents = contents.slice(0, start) + url + contents.slice(end)
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
      })
    },
  }
  for (const file of files) {
    const outfile = path.join(temporary, file.replace(/\.ts$/, '.mjs'))
    await mkdir(path.dirname(outfile), { recursive: true })
    await build({ absWorkingDir: root, entryPoints: [file], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', plugins: [sourceURL], sourcemap: 'inline' })
    outputs.push(outfile)
  }
  // Payload discovers the raw migration modules dynamically. Keep the loader
  // for those simple modules; application/test graphs are already native ESM.
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...outputs], { cwd: root, stdio: 'inherit' })
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)) })
} finally { await rm(temporary, { recursive: true, force: true }) }
