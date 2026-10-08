import { db } from '@/lib/data'
import { paymentSummary, simulatePayment } from '@/lib/commerce/order'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function GET(request: Request) {
  try { rateLimit('test-payment-read:global', 600); return json({ ok: true, ...await paymentSummary(await db(), new URL(request.url).searchParams.get('token')) }) } catch (error) { return errorResponse(error) }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('test-payment-write:global', 100)
    const body = await jsonBody(request, 2048) as { token?: unknown; outcome?: unknown }
    return json({ ok: true, ...await simulatePayment(await db(), body?.token, body?.outcome) })
  } catch (error) { return errorResponse(error) }
}
