import { db } from '@/lib/data'
import { acceptNotification } from '@/lib/commerce/order'
import { registeredPaymentProvider } from '@/lib/commerce/payment-registry'
import { DEFAULT_SIGNATURE_HEADER, readNotificationBody } from '@/lib/commerce/provider'
import { hash, InputError } from '@/lib/commerce/input'
import { errorResponse, json, rateLimit } from '@/lib/http'
// The adapter comes only from the path and the registry, never from the
// untrusted body. The preview proxy keeps Basic Auth on this endpoint too.
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    rateLimit('payment-webhook:global', 300)
    const provider = registeredPaymentProvider((await params).provider)
    if (!provider) throw new InputError('Nieznany operator płatności.', 404)
    // Preserve exact raw bytes; verification must precede every business mutation.
    const raw = await readNotificationBody(request)
    const notification = provider.verify(raw, request.headers.get(provider.signatureHeader || DEFAULT_SIGNATURE_HEADER) || '')
    return json({ ok: true, ...await acceptNotification(await db(), notification, hash(raw), provider.id) })
  } catch (error) { return errorResponse(error) }
}
