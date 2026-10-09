import { db } from '@/lib/data'
import { expireReservations } from '@/lib/commerce/order'
import { transaction } from '@/lib/commerce/transaction'
import { quote } from '@/lib/commerce/quote'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('quote:global', 600)
    const body = await jsonBody(request) as { items?: unknown; deliveryMethod?: unknown; paymentMethod?: unknown }
    const payload = await db()
    const current = await transaction(payload, 'reservation-service', async req => {
      await expireReservations(payload, req)
      return quote(payload, body?.items, body?.deliveryMethod, req, body?.paymentMethod)
    })
    return json({ ok: true, quote: current })
  } catch (error) { return errorResponse(error) }
}
