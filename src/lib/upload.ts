import sharp from 'sharp'
import { APIError, type CollectionBeforeOperationHook, type PayloadRequest } from 'payload'
import { contentEditor } from './access'

export const verifyImageUpload: CollectionBeforeOperationHook = async ({ args, operation }) => {
  if (!['create', 'update'].includes(operation)) return args
  const write = args as unknown as { overrideAccess?: boolean; duplicateFromID?: number | string; data?: Record<string, unknown>; req: PayloadRequest }
  if (!args.req?.file) {
    if (operation === 'create' && !write.duplicateFromID || !write.overrideAccess && [write.data, write.req?.data].some(data => typeof data?.url === 'string' || typeof data?.filename === 'string')) throw new APIError('Prześlij zdjęcie bezpośrednio. Import przez zewnętrzny URL jest wyłączony.', 400)
    return args
  }
  if (!write.overrideAccess && !await contentEditor({ req: write.req })) throw new APIError('Brak uprawnień do dodawania zdjęć.', 403)
  const file = args.req.file
  if (file.size > 12 * 1024 * 1024 || file.data.length > 12 * 1024 * 1024) throw new APIError('Zdjęcie jest zbyt duże (limit 12 MB).', 413)
  if (!/\.(?:jpe?g|png|webp|gif|avif)$/i.test(file.name) || /[\\/\u0000-\u001F]/.test(file.name)) throw new APIError('Niedozwolona nazwa lub rozszerzenie zdjęcia.', 400)
  try {
    const metadata = await sharp(file.data, { limitInputPixels: 40_000_000 }).metadata()
    const formats: Record<string, string[]> = { jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], gif: ['image/gif'], avif: ['image/avif'], heif: ['image/avif'] }
    if (!formats[metadata.format || '']?.includes(file.mimetype) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000 || (metadata.pages || 1) > 100) throw new Error('Invalid image content.')
  } catch { throw new APIError('Plik nie jest obsługiwanym, prawidłowym zdjęciem.', 400) }
  return args
}
