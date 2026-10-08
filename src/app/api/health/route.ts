import { db } from '@/lib/data'
import { json } from '@/lib/http'
import { maintenanceState } from '@/lib/maintenance'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const payload = await db()
    await payload.count({ collection: 'products', overrideAccess: true })
    const state = maintenanceState()
    const preview = process.env.UNDERWATER_ENVIRONMENT === 'preview'
    const maintenanceOK = !preview || !!state.lastSuccess && Date.now() - state.lastSuccess < 180_000 && state.failures < 3
    return json({ ok: maintenanceOK, environment: process.env.UNDERWATER_ENVIRONMENT, payments: 'test', mail: 'captured', maintenance: preview ? { ok: maintenanceOK, failures: state.failures } : { mode: 'manual-test' } }, maintenanceOK ? 200 : 503)
  } catch { return json({ ok: false }, 503) }
}
