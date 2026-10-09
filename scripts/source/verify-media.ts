/** Offline preflight of every image; no database or network calls. */
import { readFile, realpath, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { validateBundle } from '../../src/lib/import/bundle'
import { readVerifiedFile } from '../../src/lib/import/service'
import { verifyImageUpload } from '../../src/lib/upload'

const [bundlePath, mediaPath, reportPath] = process.argv.slice(2)
if (!bundlePath || !mediaPath || !reportPath || process.argv.length !== 5 || [bundlePath, mediaPath, reportPath].some(value => value.split('/').some(part => part.startsWith('.env')))) throw new Error('Usage: verify-media <bundle.json> <media-root> <private-report.json>')
const validated = validateBundle(JSON.parse(await readFile(bundlePath, 'utf8')))
const root = await realpath(mediaPath)
const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }
const failed: Array<{ key: string; errorType: string }> = []
let index = 0, checked = 0
// Two bounded buffers/decoders. No full-catalogue image arrays in memory.
await Promise.all(Array.from({ length: 2 }, async () => {
  while (index < validated.media.length) {
    const descriptor = validated.media[index++]
    try {
      const target = path.resolve(root, descriptor.path)
      if (!target.startsWith(root + path.sep) || (await lstat(target)).isSymbolicLink() || !(await realpath(target)).startsWith(root + path.sep)) throw new Error('Unsafe source image path.')
      const bytes = await readVerifiedFile(target, descriptor.sha256)
      const file = { data: bytes, size: bytes.length, name: path.basename(target), mimetype: mime[path.extname(target).toLowerCase()] }
      await verifyImageUpload({ args: { overrideAccess: true, req: { file } }, operation: 'create' } as Parameters<typeof verifyImageUpload>[0])
      await sharp(bytes, { limitInputPixels: 40_000_000 }).resize({ width: 1, height: 1, fit: 'inside' }).toBuffer()
      checked++
    } catch (error) {
      failed.push({ key: descriptor.key, errorType: error instanceof Error ? error.name : 'UnknownError' })
    }
  }
}))
const report = { expected: validated.media.length, verified: checked, failed: failed.sort((a, b) => a.key.localeCompare(b.key)), databaseAccess: false, networkAccess: false }
await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ ...report, failed: failed.length }))
if (failed.length) process.exitCode = 1
