import { db } from './data'
import { expireReservations } from './commerce/order'
import { expireSignups } from './forms/reservations'
import { transaction } from './commerce/transaction'

type State = { timer?: ReturnType<typeof setInterval>; running: boolean; lastSuccess?: number; failures: number }
const globalState = globalThis as typeof globalThis & { underwaterMaintenance?: State }
export function maintenanceState() { return globalState.underwaterMaintenance || { running: false, failures: 0 } }
export async function runMaintenance() {
  const payload = await db()
  let total = 0
  for (let batch = 0; batch < 5; batch++) {
    const released = await transaction(payload, 'reservation-service', async req => (await expireReservations(payload, req)) + (await expireSignups(payload, req)))
    total += released
    if (released < 200) break
  }
  return total
}
export async function startMaintenance() {
  if (process.env.UNDERWATER_ENVIRONMENT !== 'preview') return
  const state = globalState.underwaterMaintenance ||= { running: false, failures: 0 }
  if (state.timer) return
  const run = async () => {
    if (state.running) return
    state.running = true
    try { await runMaintenance(); state.lastSuccess = Date.now(); state.failures = 0 }
    catch (error) { state.failures++; console.error('[underwater] Maintenance failed:', error instanceof Error ? error.name : 'UnknownError') }
    finally { state.running = false }
  }
  await run()
  state.timer = setInterval(() => { void run() }, 60_000)
  state.timer.unref()
}
