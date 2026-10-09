// Compiled to native ESM before spawning. Every payment response comes from the
// parent over IPC; no operator, HTTP server or network client is involved.
import type { PaymentAttempt } from '../../src/payload-types'
import type { CheckoutInput, checkout as Checkout, paymentSummary as Summary } from '../../src/lib/commerce/order'
import type { PaymentProvider, PaymentStart, PaymentStartInput } from '../../src/lib/commerce/provider'

type AttemptSnapshot = {
  id: number; order: number; provider: string; reference: string;
  initialization: PaymentAttempt['initialization']; initializationKey: string | null;
  lease: string | null; leaseUntil: string | null; providerReference: string | null;
}
export type PaymentWorkerMessage =
  | { kind: 'ready'; pid: number }
  | { kind: 'adapter-started'; pid: number; input: PaymentStartInput; attempt: AttemptSnapshot; openSessions: number }
  | { kind: 'foreign-lease'; pid: number; attempt: AttemptSnapshot; transactionalRead: boolean }
  | { kind: 'result'; pid: number; result: Awaited<ReturnType<typeof Checkout>>; summary: Awaited<ReturnType<typeof Summary>>; attempt: AttemptSnapshot }
  | { kind: 'failure'; pid: number; message: string }
type ParentMessage = { kind: 'start'; role: 'holder' | 'contender'; input: CheckoutInput } | ({ kind: 'intent-response' } & PaymentStart)

const messages: ParentMessage[] = []
let receive: ((message: ParentMessage) => void) | undefined
process.on('message', message => {
  if (receive) { const resolve = receive; receive = undefined; resolve(message as ParentMessage) }
  else messages.push(message as ParentMessage)
})
const nextMessage = () => messages.length ? Promise.resolve(messages.shift()!) : new Promise<ParentMessage>(resolve => { receive = resolve })
async function emit(message: PaymentWorkerMessage) {
  if (!process.send) throw new Error('The synthetic payment worker requires IPC.')
  await new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()))
}
const snapshot = (attempt: PaymentAttempt): AttemptSnapshot => ({
  id: attempt.id, order: typeof attempt.order === 'number' ? attempt.order : attempt.order.id,
  provider: attempt.provider, reference: attempt.reference || '', initialization: attempt.initialization,
  initializationKey: attempt.initializationKey || null, lease: attempt.initializationLease || null,
  leaseUntil: attempt.initializationLeaseUntil || null, providerReference: attempt.providerReference || null,
})

console.error('[synthetic-payment-worker] loading Payload')
const { getPayload } = await import('payload')
console.error('[synthetic-payment-worker] resolving configuration')
const storedConfig = await (await import('../../src/payload.config')).default
const config = {
  ...storedConfig,
  typescript: { ...storedConfig.typescript, autoGenerate: false },
  admin: { ...storedConfig.admin, importMap: { ...storedConfig.admin.importMap, autoGenerate: false } },
}
const { checkout, paymentSummary } = await import('../../src/lib/commerce/order')
console.error('[synthetic-payment-worker] connecting isolated SQLite')
const payload = await getPayload({ config, disableOnInit: true })
console.error('[synthetic-payment-worker] ready')
try {
  await emit({ kind: 'ready', pid: process.pid })
  const start = await nextMessage()
  if (start.kind !== 'start') throw new Error('Invalid synthetic payment start command.')
  let observedLease = false
  if (start.role === 'contender') {
    // Observe the real find() result inside the initialization transaction.
    // Nothing is substituted: the parent must see the foreign persisted lease.
    const find = payload.find.bind(payload)
    payload.find = (async (...args: Parameters<typeof payload.find>) => {
      const result = await find(...args)
      if (!observedLease && args[0].collection === 'payment-attempts' && args[0].req?.transactionID) {
        const attempt = (result.docs as PaymentAttempt[])[0]
        if (attempt?.initialization === 'initializing' && attempt.initializationLease && attempt.initializationLeaseUntil && Date.parse(attempt.initializationLeaseUntil) > Date.now()) {
          observedLease = true
          await emit({ kind: 'foreign-lease', pid: process.pid, attempt: snapshot(attempt), transactionalRead: true })
        }
      }
      return result
    }) as typeof payload.find
  }
  const provider: PaymentProvider = {
    id: 'process-sandbox', mode: 'test', redirectOrigins: ['https://process-sandbox.example.invalid'],
    async start(input) {
      const attempt = (await payload.find({ collection: 'payment-attempts', where: { initializationKey: { equals: input.idempotencyKey } }, depth: 0, overrideAccess: true })).docs[0]
      if (!attempt) throw new Error('The adapter cannot see its committed attempt.')
      await emit({ kind: 'adapter-started', pid: process.pid, input, attempt: snapshot(attempt), openSessions: Object.keys(payload.db.sessions || {}).length })
      const response = await nextMessage()
      if (response.kind !== 'intent-response') throw new Error('Invalid synthetic operator response.')
      return { reference: response.reference, paymentURL: response.paymentURL }
    },
    verify() { throw new Error('This process test never accepts operator notifications.') },
  }
  const providers = { current: () => provider, byID: (id: string) => id === provider.id ? provider : null }
  const result = await checkout(payload, start.input, { providers, startTimeoutMs: 30_000, waitMs: 35_000 })
  const token = new URL(result.paymentURL, 'http://localhost:3011').searchParams.get('token')
  const summary = await paymentSummary(payload, token, { providers })
  const order = (await payload.find({ collection: 'orders', where: { idempotencyKey: { equals: start.input.idempotencyKey } }, depth: 0, overrideAccess: true })).docs[0]
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, depth: 0, overrideAccess: true })).docs[0]
  await emit({ kind: 'result', pid: process.pid, result, summary, attempt: snapshot(attempt) })
} catch (error) {
  await emit({ kind: 'failure', pid: process.pid, message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown synthetic worker failure.' }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await payload.destroy()
  if (process.connected) process.disconnect()
}
