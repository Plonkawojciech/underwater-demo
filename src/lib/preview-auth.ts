import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function validPreviewAuthorization(header: string | null, username: string, password: string): boolean {
  if (!header || header.length > 1024 || !header.startsWith('Basic ')) return false
  const encoded = header.slice(6)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const actual = createHash('sha256').update(decoded).digest()
  const expected = createHash('sha256').update(`${username}:${password}`).digest()
  return timingSafeEqual(actual, expected)
}
export function healthToken(secret: string) { return createHmac('sha256', secret).update('underwater-health-only').digest('hex') }
export function validHealthToken(actual: string | null, secret: string) {
  if (!actual || !/^[a-f0-9]{64}$/.test(actual) || secret.length < 32) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(healthToken(secret), 'hex'))
}
