import { db } from '@/lib/data'
import { resumePayment } from '@/lib/commerce/order'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
// Repeats only the payment initialization of the order behind the private link:
// the same attempt and merchant key, never a new order, quote or reservation.
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('payment-resume:global', 100)
    const body = await jsonBody(request, 2048) as { token?: unknown }
    return json({ ok: true, ...await resumePayment(await db(), body?.token) })
  } catch (error) { return errorResponse(error) }
}
