import { db } from '@/lib/data'
import { newsletterToken } from '@/lib/forms/service'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function POST(request: Request) {
  try {
    requireOrigin(request); rateLimit('newsletter-token:global', 100)
    const body = await jsonBody(request, 2048) as { token?: unknown }
    return json(await newsletterToken(await db(), body?.token, 'unsubscribe'))
  } catch (error) { return errorResponse(error) }
}
