import sharp from 'sharp'
import { APIError, type CollectionBeforeOperationHook } from 'payload'

export const verifyImageUpload: CollectionBeforeOperationHook = async ({ args, operation }) => {
  if (!['create', 'update'].includes(operation) || !args.req?.file) return args
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
