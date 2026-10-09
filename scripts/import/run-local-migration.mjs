/** Compile the application graph before execution, like the repository's native test runner. */
import { build } from 'esbuild'
import ts from 'typescript'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const prove = args[0] === '--prove'
if (prove && args.length !== 2) throw new Error('Use --prove <existing Mad Dog artifact parent>.')
await mkdir(path.join(root, 'tmp'), { recursive: true })
const temporary = await mkdtemp(path.join(root, 'tmp/local-migration-native-'))
try {
  const sourceURL = { name: 'original-module-location', setup(builder) {
    builder.onLoad({ filter: /\.tsx?$/ }, async ({ path: filename }) => {
      const source = await readFile(filename, 'utf8')
      const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const ranges = []
      function visit(node) {
        if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'url') ranges.push([node.getStart(ast), node.getEnd()])
        ts.forEachChild(node, visit)
      }
      visit(ast)
      let contents = source
      for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) contents = contents.slice(0, start) + JSON.stringify(pathToFileURL(filename).href) + contents.slice(end)
      return { contents, loader: filename.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(filename) }
    })
  } }
  const outfile = path.join(temporary, 'main.mjs')
  const imports = prove ? "import { proveLocalMigration } from './scripts/import/prove-local-migration.ts';" : "import { localMigrationMain } from './scripts/import/local-migration.ts';"
  const call = prove ? 'console.log(JSON.stringify(await proveLocalMigration(process.argv[2])));' : 'await localMigrationMain(process.argv.slice(2));'
  const contents = `${imports}\ntry { ${call} } catch(error) { console.log(JSON.stringify({success:false,errorCode:typeof error.code==='string'?error.code:'migration-failed',clientWrites:0})); process.exitCode=1; }`
  await build({ absWorkingDir: root, stdin: { contents, resolveDir: root, sourcefile: 'local-migration-entry.mjs' },
    outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', plugins: [sourceURL] })
  const child = spawn(process.execPath, ['--import', 'tsx', outfile, ...(prove ? args.slice(1) : args)], { cwd: root, env: process.env, stdio: 'inherit' })
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)) })
} finally { await rm(temporary, { recursive: true, force: true }) }
