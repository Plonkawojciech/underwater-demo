import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'InputError' }
}
export type RequestedItem = { id: number; qty: number; variantId?: string; variant?: string }
export function text(value: unknown, label: string, max = 200, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new InputError(`Nieprawidłowe pole: ${label}.`)
  const result = value.trim()
  if (required && !result) throw new InputError(`Uzupełnij pole: ${label}.`)
  return result
}
export function email(value: unknown): string {
  const result = text(value, 'e-mail', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new InputError('Podaj prawidłowy e-mail.')
  return result
}
export function positiveID(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new InputError('Nieprawidłowy identyfikator.')
  return value
}
export function requestedItems(value: unknown): RequestedItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new InputError('Koszyk musi zawierać od 1 do 50 pozycji.')
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new InputError('Nieprawidłowa pozycja koszyka.')
    const id = positiveID(item.id)
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) throw new InputError('Ilość musi być liczbą całkowitą od 1 do 99.')
    return { id, qty: item.qty, ...(item.variantId != null ? { variantId: text(item.variantId, 'wariant', 100) } : {}), ...(item.variant != null ? { variant: text(item.variant, 'wariant', 200) } : {}) }
  })
}
export function cents(value: unknown, label = 'cena'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new InputError(`Nieprawidłowa ${label}.`, 409)
  return value
}
export function legacyCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new InputError('Produkt nie ma prawidłowej ceny.', 409)
  return cents(Math.round((value + Number.EPSILON) * 100))
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const opaqueToken = () => randomBytes(32).toString('base64url')
export function tokenHash(token: unknown): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
  return hash(token)
}
export function equalDigest(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
