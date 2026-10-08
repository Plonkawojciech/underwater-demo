import { runtimeOrigin } from './origin'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { InputError } from './commerce/input'

export async function jsonBody(request: Request, maxBytes = 32_768): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Wymagany jest format JSON.', 415)
  const declared = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) throw new InputError('Zbyt duże zgłoszenie.', 413)
  if (!request.body) throw new InputError('Brak danych.')
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new InputError('Zbyt duże zgłoszenie.', 413) }; chunks.push(value) }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InputError('Nieprawidłowy format zgłoszenia.') }
}
export function requireOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin || origin !== runtimeOrigin()) throw new InputError('Niedozwolone źródło zgłoszenia.', 403)
}
export const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } })
export function errorResponse(error: unknown) {
  if (error instanceof InputError) return json({ ok: false, message: error.message }, error.status)
  // Do not expose SQL, customer data or provider payloads in API errors/logs.
  console.error('[underwater] Request failed:', error instanceof Error ? error.name : 'UnknownError')
  return json({ ok: false, message: 'Nie udało się zapisać zgłoszenia. Spróbuj ponownie.' }, 500)
}

const buckets = new Map<string, { count: number; until: number }>()
export function rateLimit(key: string, limit = 10, interval = 60_000, now = Date.now()) {
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key)
  if (buckets.size >= 10_000 && !buckets.has(key)) throw new InputError('Spróbuj ponownie później.', 429)
  const value = buckets.get(key)
  if (!value || value.until <= now) { buckets.set(key, { count: 1, until: now + interval }); return }
  if (value.count >= limit) throw new InputError('Zbyt wiele prób. Spróbuj ponownie później.', 429)
  value.count++
}
export async function actionOrigin() {
  const h = await headers()
  if (h.get('origin') !== runtimeOrigin()) throw new InputError('Niedozwolone źródło zgłoszenia.', 403)
}
