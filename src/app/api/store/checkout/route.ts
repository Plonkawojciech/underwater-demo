import { db } from '@/lib/data'
import { checkout, type CheckoutInput } from '@/lib/commerce/order'
import { email, hash } from '@/lib/commerce/input'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('checkout:global', 100)
    const body = await jsonBody(request) as CheckoutInput
    rateLimit(`checkout:${hash(email(body?.email))}`, 8)
    return json({ ok: true, ...await checkout(await db(), body) })
  } catch (error) { return errorResponse(error) }
}
