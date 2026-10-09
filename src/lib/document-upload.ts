import path from 'node:path'
import { spawn } from 'node:child_process'
import { APIError, type CollectionBeforeOperationHook, type PayloadRequest } from 'payload'
import { contentEditor } from './access'

let active = false
const waiting: (() => void)[] = []
async function acquire() {
  if (active) {
    if (waiting.length >= 8) throw new APIError('Weryfikacja dokumentów jest zajęta. Spróbuj ponownie.', 429)
    await new Promise<void>(resolve => waiting.push(resolve))
  } else active = true
}
function release() { const next = waiting.shift(); if (next) next(); else active = false }

/** Parse without app secrets in a bounded child process. Keep original bytes. */
export async function verifyDocumentBytes(bytes: Buffer): Promise<number> {
  if (bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-4096).includes(Buffer.from('%%EOF'))) throw new APIError('Plik nie jest prawidłowym PDF (limit 8 MB).', 400)
  await acquire()
  // ulimit limits the entire address space, including decompressed ArrayBuffers.
  // All command arguments are fixed paths, never submitted text or credentials.
  const script = process.platform === 'linux' ? 'ulimit -v 1048576 || exit 1; exec "$1" --max-old-space-size=128 "$2"' : 'exec "$1" --max-old-space-size=128 "$2"'
  let child: ReturnType<typeof spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const processChild = spawn('/bin/sh', ['-c', script, 'underwater-pdf', process.execPath, path.resolve(process.cwd(), 'src/lib/document-worker.mjs')], { env: { NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'] })
    child = processChild
    processChild.stderr.resume()
    return await new Promise<number>((resolve, reject) => {
      const fail = () => reject(new APIError('PDF jest uszkodzony, zaszyfrowany lub zawiera aktywne elementy. Zachowaj oryginał do sprawdzenia.', 400))
      let output = ''
      timer = setTimeout(fail, 15_000)
      processChild.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 1024) fail() })
      processChild.once('close', code => {
        try {
          const report = JSON.parse(output) as { ok?: boolean; pages?: number }
          if (code === 0 && report.ok === true && Number.isSafeInteger(report.pages) && Number(report.pages) >= 1 && Number(report.pages) <= 1000) resolve(Number(report.pages))
          else fail()
        } catch { fail() }
      })
      processChild.once('error', fail)
      processChild.stdin.once('error', fail)
      processChild.stdin.end(bytes)
    })
  } finally {
    if (timer) clearTimeout(timer)
    if (child && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>(resolve => child!.once('close', () => resolve()))
    }
    release()
  }
}

export const verifyDocumentUpload: CollectionBeforeOperationHook = async ({ args, operation }) => {
  const file = args.req?.file
  if (!['create', 'update'].includes(operation)) return args
  const write = args as unknown as { overrideAccess?: boolean; id?: string | number; data?: Record<string, unknown>; req: PayloadRequest }
  // Remote file fetching happens after this hook; require a submitted file so
  // every create and replacement goes through this validator.
  const submitted = write.req?.data
  if (!file && (operation === 'create' || !write.overrideAccess && [write.data, submitted].some(data => typeof data?.url === 'string' || typeof data?.filename === 'string'))) throw new APIError('Prześlij plik PDF bezpośrednio. Import przez zewnętrzny URL jest wyłączony.', 400)
  if (!file) return args
  // Payload calls beforeOperation before collection access checks.
  if (!write.overrideAccess && !await contentEditor({ req: write.req })) throw new APIError('Brak uprawnień do dodawania dokumentów.', 403)
  if (operation === 'update' && !write.id) throw new APIError('Zbiorcza podmiana plików PDF jest wyłączona.', 403)
  if (operation === 'update' && write.id) {
    const existing = await write.req.payload.findByID({ collection: 'documents', id: write.id, depth: 0, overrideAccess: true, req: write.req })
    if (existing.legacyKey) throw new APIError('Oryginał importowanego dokumentu jest chroniony. Dodaj nowy dokument zamiast podmiany pliku.', 403)
  }
  if (file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.name) || /[\\/\u0000-\u001f]/.test(file.name) || file.size !== file.data.length) throw new APIError('Wymagany jest plik PDF o bezpiecznej nazwie.', 400)
  await verifyDocumentBytes(file.data)
  return args
}
