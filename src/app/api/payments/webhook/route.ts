import { db } from '@/lib/data'
import { acceptNotification } from '@/lib/commerce/order'
import { paymentProvider } from '@/lib/commerce/payment-registry'
import { hash, InputError } from '@/lib/commerce/input'
import { errorResponse, json, rateLimit } from '@/lib/http'
export async function POST(request: Request) {
  try {
    rateLimit('payment-webhook:global', 300)
    // Preserve exact raw bytes; verification must precede every business mutation.
    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > 8192) throw new InputError('Zbyt duży komunikat.', 413)
    const reader = request.body?.getReader(); if (!reader) throw new InputError('Brak komunikatu.')
    const chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw new InputError('Zbyt duży komunikat.', 413) }; chunks.push(value) } } finally { reader.releaseLock() }
    const raw = Buffer.concat(chunks).toString('utf8')
    const notification = paymentProvider().verify(raw, request.headers.get('x-underwater-signature') || '')
    return json({ ok: true, ...await acceptNotification(await db(), notification, hash(raw)) })
  } catch (error) { return errorResponse(error) }
}
