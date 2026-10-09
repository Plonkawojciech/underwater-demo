import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { getPayload, ValidationError } from 'payload'
import config from '../../src/payload.config'
import { importBundle } from '../../src/lib/import/service'

// Usage: tsx scripts/import/import-bundle.ts <bundle.json> <media-root> [--dry-run] [--source-manifest=<file>]
// --source-manifest hashes the trusted snapshot manifest locally; only a matching
// joomla-dump bundle can then be reported as complete. Output contains counts only.
const args = process.argv.slice(2)
const positional = args.filter(arg => !arg.startsWith('--'))
const flags = args.filter(arg => arg.startsWith('--'))
const manifest = flags.find(flag => flag.startsWith('--source-manifest='))?.slice('--source-manifest='.length)
const [filename, mediaRoot] = positional
const hidden = (file: string) => file.split('/').some(part => part.startsWith('.env'))
if (positional.length !== 2 || flags.some(flag => flag !== '--dry-run' && !flag.startsWith('--source-manifest=')) || hidden(filename) || hidden(mediaRoot) || (manifest !== undefined && (!manifest || hidden(manifest)))) throw new Error('Usage: import-bundle <bundle.json> <media-root> [--dry-run] [--source-manifest=<file>]')
if ((await stat(filename)).size > 100 * 1024 * 1024) throw new Error('Source bundle exceeds 100 MB.')
let verifiedSourceManifestHash: string | undefined
if (manifest) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(manifest)) digest.update(chunk)
  verifiedSourceManifestHash = digest.digest('hex')
}
const input = JSON.parse(await readFile(filename, 'utf8'))
const payload = await getPayload({ config, disableOnInit: true })
try {
  const result = await importBundle(payload, input, mediaRoot, { dryRun: flags.includes('--dry-run'), verifiedSourceManifestHash })
  // Review items name source records, so the log carries only their kinds and totals.
  const byKind: Record<string, number> = {}
  for (const item of result.unresolved) { const kind = item.split(':')[0]; byKind[kind] = (byKind[kind] || 0) + 1 }
  const { unresolved, ...summary } = result
  console.log(JSON.stringify({ ...summary, unresolved: { total: unresolved.length, byKind } }))
} catch (error) {
  // The deployment wrapper suppresses SDK traces. Its eligible stdout
  // diagnostic includes only bounded schema field paths, never source values.
  if (error instanceof ValidationError) console.log(JSON.stringify({ importValidationFields: error.data.errors.map(item => item.path).filter(value => /^[a-zA-Z][a-zA-Z0-9_.\[\]-]{0,159}$/.test(value)) }))
  throw error
} finally { await payload.destroy() }
