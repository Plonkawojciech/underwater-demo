import { db } from '@/lib/data'
import { InputError } from '@/lib/commerce/input'
import { adjustInventory, updateOperationalStatus } from '@/lib/operations'
import { errorResponse, json, jsonBody, rateLimit, requireOrigin } from '@/lib/http'
export async function POST(request: Request) {
  try {
    requireOrigin(request)
    const payload = await db(), { user } = await payload.auth({ headers: request.headers })
    if (!user) throw new InputError('Zaloguj się do panelu.', 401)
    rateLimit(`operations:${user.id}`, 60)
    const input = await jsonBody(request, 2048) as { command?: unknown; collection?: unknown; id?: unknown; status?: unknown; variantId?: unknown; stock?: unknown; expectedStock?: unknown }
    return json(input.command === 'inventory-adjustment' ? await adjustInventory(payload, user, input) : await updateOperationalStatus(payload, user, input))
  } catch (error) { return errorResponse(error) }
}
