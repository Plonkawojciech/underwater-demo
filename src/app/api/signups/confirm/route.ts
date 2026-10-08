import { db } from '@/lib/data'
import { confirmSignup } from '@/lib/forms/reservations'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('signup-confirm:global', 100)
    const body = await jsonBody(request, 2048) as { token?: unknown }
    return json(await confirmSignup(await db(), body?.token))
  } catch (error) { return errorResponse(error) }
}
