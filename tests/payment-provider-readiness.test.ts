import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'
import { getPayload, type Payload, type TypedUser } from 'payload'
import { acceptNotification, checkout, expireReservations, orderMailBody, paymentSummary, resumePayment, simulatePayment, type CheckoutOptions } from '../src/lib/commerce/order'
import { cents, equalDigest, hash, InputError } from '../src/lib/commerce/input'
import { INTERNAL_TEST_PROVIDER, storedPaymentURL, TestPaymentProvider, type PaymentNotification, type PaymentProvider, type PaymentStartInput } from '../src/lib/commerce/provider'
import { registeredPaymentProvider, type PaymentRegistry } from '../src/lib/commerce/payment-registry'
import { transaction } from '../src/lib/commerce/transaction'
import { updateOperationalStatus } from '../src/lib/operations'

// Synthetic, isolated environment only: temporary SQLite file and media folder,
// in-memory fake adapters on a reserved .invalid origin, no network.
const root = mkdtempSync(path.join(tmpdir(), 'underwater-payment-readiness-'))
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-payment-readiness-secret-not-runtime' })
delete process.env.UNDERWATER_ORIGIN
delete process.env.UNDERWATER_PAYMENT_PROVIDER
let payload: Payload
let category: number
let operator: TypedUser
const SANDBOX = 'https://sandbox.example.invalid'
const tokenFrom = (url: string) => new URL(url, 'http://localhost:3011').searchParams.get('token')!
const ownURL = (token: string) => `/platnosc-testowa?token=${token}`
const orderInput = (id: number, changes: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), customerName: 'TEST gotowość operatora', email: 'readiness@example.invalid', phone: '000000000', address: 'Adres syntetyczny 1', items: [{ id, qty: 1, price: 0.01 }], deliveryMethod: 'test-pickup', privacyAccepted: true, termsAccepted: true, ...changes })
const status = (error: unknown) => error instanceof InputError ? error.status : 0
const rejectsWith = (promise: Promise<unknown>, code: number, pattern?: RegExp) => assert.rejects(promise, (error: unknown) => status(error) === code && (!pattern || pattern.test((error as Error).message)))
const openSessions = () => Object.keys(payload.db.sessions || {}).length
async function product(stock: number) {
  const id = Math.floor(Math.random() * 1e8)
  return payload.create({ collection: 'products', overrideAccess: true, data: { vmId: id, name: `TEST — nie do sprzedaży ${id}`, slug: `test-${id}`, category, price: 10, priceCents: 1000, stock, published: true } })
}
const stock = async (id: number) => (await payload.findByID({ collection: 'products', id, depth: 0 })).stock
const orderOf = async (number: string) => (await payload.find({ collection: 'orders', where: { number: { equals: number } }, depth: 0 })).docs[0]
const orderByKey = async (key: string) => (await payload.find({ collection: 'orders', where: { idempotencyKey: { equals: key } }, depth: 0 })).docs[0]
const ordersByKey = async (key: string) => (await payload.count({ collection: 'orders', where: { idempotencyKey: { equals: key } } })).totalDocs
const attemptOf = async (orderID: number) => (await payload.find({ collection: 'payment-attempts', where: { order: { equals: orderID } }, depth: 0 })).docs[0]
const attemptsOf = async (orderID: number) => (await payload.count({ collection: 'payment-attempts', where: { order: { equals: orderID } } })).totalDocs
const eventsOf = async (attemptID: number) => (await payload.count({ collection: 'payment-events', where: { attempt: { equals: attemptID } } })).totalDocs
const outboxCount = async (deduplicationKey: string) => (await payload.count({ collection: 'outbox', where: { deduplicationKey: { equals: deduplicationKey } } })).totalDocs
// Test-only stand-in for a stored row in a given state (crashed holder, row written before the new fields).
const rewriteAttempt = (id: number, data: Record<string, unknown>) => transaction(payload, 'payment-service', async req => { await payload.update({ collection: 'payment-attempts', id, data, req, overrideAccess: true }) })
const expireOrder = async (id: number) => {
  await transaction(payload, 'order-service', async req => { await payload.update({ collection: 'orders', id, data: { expiresAt: '2000-01-01T00:00:00.000Z' }, req }) })
  await transaction(payload, 'reservation-service', req => expireReservations(payload, req))
}
async function waitFor(condition: () => boolean, label: string) {
  for (const started = Date.now(); !condition(); await new Promise(resolve => setTimeout(resolve, 10))) if (Date.now() - started > 5000) throw new Error(`Timed out waiting for ${label}.`)
}

/** In-memory sandbox operator: one remote intent per merchant key, created before any response is lost. */
class FakeSandbox implements PaymentProvider {
  readonly mode = 'test' as const
  readonly redirectOrigins = [SANDBOX]
  readonly signatureHeader = 'x-fake-signature'
  readonly calls: PaymentStartInput[] = []
  readonly intents = new Map<string, string>()
  behaviour: (input: PaymentStartInput, call: number, signal?: AbortSignal) => Promise<void> = async () => undefined
  urlFor = (reference: string) => `${SANDBOX}/pay/${reference}`
  constructor(readonly id = 'fake-sandbox', private readonly referenceFor: (key: string) => string = () => `fake-${randomUUID()}`) {}
  async start(input: PaymentStartInput, options?: { signal?: AbortSignal }) {
    this.calls.push({ ...input })
    let reference = this.intents.get(input.idempotencyKey)
    if (!reference) this.intents.set(input.idempotencyKey, reference = this.referenceFor(input.idempotencyKey))
    await this.behaviour(input, this.calls.length, options?.signal)
    return { reference, paymentURL: this.urlFor(reference) }
  }
  sign(raw: string) { return createHmac('sha256', `synthetic-${this.id}-secret`).update(raw).digest('hex') }
  verify(raw: string, signature: string): PaymentNotification {
    if (!equalDigest(this.sign(raw), signature)) throw new InputError('Nieprawidłowy podpis płatności.', 401)
    const value = JSON.parse(raw)
    return { eventKey: value.eventKey, reference: value.reference, amountCents: value.amountCents, currency: 'PLN', outcome: value.outcome, ...(value.merchantKey != null ? { merchantKey: value.merchantKey } : {}) }
  }
}
const registryOf = (current: PaymentProvider, ...others: PaymentProvider[]): PaymentRegistry => ({ current: () => current, byID: id => [current, ...others].find(adapter => adapter.id === id) ?? registeredPaymentProvider(id) })
/** The internal adapter with an injectable start failure; verification stays the real one. */
class FlakyInternal implements PaymentProvider {
  readonly id = INTERNAL_TEST_PROVIDER
  readonly mode = 'test' as const
  readonly redirectOrigins: readonly string[] = []
  readonly calls: PaymentStartInput[] = []
  failing = false
  readonly inner = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  async start(input: PaymentStartInput) {
    this.calls.push({ ...input })
    if (this.failing) throw new Error('Synthetic operator outage')
    return this.inner.start(input)
  }
  verify(raw: string, signature: string) { return this.inner.verify(raw, signature) }
}
type Signer = { sign(raw: string): string; verify(raw: string, signature: string): PaymentNotification }
const notify = (adapter: Signer, providerID: string, body: Record<string, unknown>) => {
  const raw = JSON.stringify({ eventKey: randomUUID(), currency: 'PLN', outcome: 'paid', ...body })
  return acceptNotification(payload, adapter.verify(raw, adapter.sign(raw)), hash(raw), providerID)
}
const summary = (token: string, options: CheckoutOptions = {}) => paymentSummary(payload, token, options)

test.before(async () => {
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  category = (await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST', slug: 'test', published: true } })).id
  operator = { ...await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, data: { email: 'operations-readiness@example.invalid', password: 'synthetic-password-for-tests-only', role: 'operations' } }), collection: 'users' } as TypedUser
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

test('every checkout reply is the private status page; the adapter starts after COMMIT, outside any transaction, without the token', async () => {
  const p = await product(2), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const seen: { sessions: number; order?: Awaited<ReturnType<typeof orderOf>>; stock?: number | null }[] = []
  fake.behaviour = async start => {
    // Inside a held transaction this independent write would fail at once; here it must commit.
    await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST during start', slug: `test-during-start-${randomUUID()}`, published: false } })
    seen.push({ sessions: openSessions(), order: await orderOf(start.number), stock: await stock(p.id) })
  }
  const created = await checkout(payload, input, { providers })
  const token = tokenFrom(created.paymentURL)
  assert.equal(created.paymentURL, ownURL(token)); assert.equal(created.payment, 'ready')
  assert.equal(seen.length, 1); assert.equal(seen[0].sessions, 0)
  assert.ok(seen[0].order, 'the order was committed before the adapter was called')
  assert.equal(seen[0].stock, 1, 'the reservation was committed before the adapter was called')
  const order = await orderOf(created.number), attempt = await attemptOf(order.id), key = `underwater-${order.number}`
  assert.equal(hash(token), order.accessTokenHash)
  assert.deepEqual(fake.calls, [{ idempotencyKey: key, number: order.number, amountCents: order.totalCents, currency: 'PLN' }], 'the adapter never receives the private token')
  const intent = fake.intents.get(key)!
  assert.deepEqual([attempt.provider, attempt.providerReference, attempt.initializationKey, attempt.paymentUrl, attempt.initialization, attempt.initializationLease], ['fake-sandbox', intent, key, `${SANDBOX}/pay/${intent}`, 'ready', null])
  assert.match(attempt.reference || '', /^fake-sandbox:[a-f0-9]{64}$/)
  const view = await summary(token, { providers })
  assert.deepEqual([view.payment, view.paymentLink, view.simulation, view.status], ['ready', `${SANDBOX}/pay/${intent}`, false, 'pending'])
  assert.doesNotMatch(JSON.stringify(view), /readiness@example|Adres syntetyczny|underwater-UW-|fake-sandbox:/)
  assert.ok(!view.paymentLink!.includes(token))
  await rejectsWith(simulatePayment(payload, token, 'paid'), 403)
})

test('the internal test adapter keeps its own page, familiar simulation and exact amount check', async () => {
  const p = await product(1), created = await checkout(payload, orderInput(p.id))
  const token = tokenFrom(created.paymentURL), order = await orderOf(created.number), attempt = await attemptOf(order.id)
  assert.equal(created.paymentURL, ownURL(token)); assert.equal(created.payment, 'ready')
  assert.deepEqual([attempt.provider, attempt.initialization, attempt.paymentUrl, attempt.initializationKey], [INTERNAL_TEST_PROVIDER, 'ready', '/platnosc-testowa', `underwater-${order.number}`])
  assert.match(attempt.providerReference || '', /^test-[a-f0-9]{32}$/)
  assert.match(attempt.reference || '', /^internal-test:[a-f0-9]{64}$/)
  const view = await summary(token)
  assert.deepEqual([view.payment, view.paymentLink, view.simulation], ['ready', null, true])
  const internal = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  await rejectsWith(notify(internal, INTERNAL_TEST_PROVIDER, { reference: attempt.providerReference, amountCents: 1 }), 409, /Kwota/)
  assert.equal((await summary(token)).status, 'pending')
  assert.equal((await simulatePayment(payload, token, 'paid')).status, 'paid')
  assert.equal(await stock(p.id), 0)
})

test('concurrent checkouts with one key create one order, reservation, attempt and remote intent', async () => {
  const p = await product(5), input = orderInput(p.id), fake = new FakeSandbox()
  fake.behaviour = () => new Promise(resolve => setTimeout(resolve, 150))
  const results = await Promise.all([1, 2, 3].map(() => checkout(payload, input, { providers: registryOf(fake) })))
  assert.equal(new Set(results.map(r => r.number)).size, 1)
  assert.equal(new Set(results.map(r => r.paymentURL)).size, 1)
  assert.ok(results.every(r => r.payment === 'ready'))
  assert.equal(fake.calls.length, 1, 'waiting callers reuse the leased initialization')
  assert.equal(await stock(p.id), 4)
  assert.equal(await ordersByKey(input.idempotencyKey), 1)
  assert.equal(await attemptsOf((await orderByKey(input.idempotencyKey)).id), 1)
  assert.equal(openSessions(), 0)
})

test('a ready attempt is replayed without the adapter and only for the same order fingerprint', async () => {
  const p = await product(3), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const first = await checkout(payload, input, { providers })
  assert.deepEqual(await checkout(payload, input, { providers }), first)
  assert.equal(fake.calls.length, 1, 'a replay does not contact the adapter')
  await rejectsWith(checkout(payload, { ...input, email: 'other-readiness@example.invalid' }, { providers }), 409, /innego zamówienia/)
  const other = await checkout(payload, orderInput(p.id), { providers })
  assert.notEqual(other.number, first.number); assert.notEqual(other.paymentURL, first.paymentURL)
  assert.notEqual((await summary(tokenFrom(other.paymentURL), { providers })).paymentLink, (await summary(tokenFrom(first.paymentURL), { providers })).paymentLink)
  assert.equal(fake.calls.length, 2)
  assert.notEqual(fake.calls[0].idempotencyKey, fake.calls[1].idempotencyKey)
})

test('an adapter URL outside its HTTPS sandbox allowlist is never stored or offered; resume keeps the key', async () => {
  const p = await product(2), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const bad = [
    (reference: string) => `http://sandbox.example.invalid/pay/${reference}`,
    (reference: string) => `https://elsewhere.example.invalid/pay/${reference}`,
    (reference: string) => `https://user:secret@sandbox.example.invalid/pay/${reference}`,
    () => '/platnosc-testowa',
    () => '//sandbox.example.invalid/pay',
  ]
  fake.urlFor = bad[0]
  const created = await checkout(payload, input, { providers })
  const token = tokenFrom(created.paymentURL)
  assert.deepEqual([created.paymentURL, created.payment], [ownURL(token), 'preparing'])
  for (const urlFor of bad) {
    fake.urlFor = urlFor
    const view = await resumePayment(payload, token, { providers })
    assert.deepEqual([view.payment, view.paymentLink], ['preparing', null])
    const attempt = await attemptOf((await orderByKey(input.idempotencyKey)).id)
    assert.deepEqual([attempt.initialization, attempt.initializationLease, attempt.paymentUrl ?? null, attempt.providerReference ?? null], ['initializing', null, null, null])
  }
  // The leaked-token form is refused even though the adapter is never given the token.
  fake.urlFor = reference => `${SANDBOX}/pay/${reference}?return=${token}`
  assert.equal((await resumePayment(payload, token, { providers })).payment, 'preparing')
  assert.equal(await stock(p.id), 1, 'an invalid adapter answer does not release or repeat the reservation')
  fake.urlFor = reference => `${SANDBOX}/pay/${reference}`
  const view = await resumePayment(payload, token, { providers })
  assert.equal(view.payment, 'ready'); assert.equal(new URL(view.paymentLink!).origin, SANDBOX)
  for (const call of fake.calls) assert.deepEqual(call, fake.calls[0])
  assert.equal(await ordersByKey(input.idempotencyKey), 1); assert.equal(await stock(p.id), 1)
  // The internal adapter may return only the shop's own page path.
  const internal = new TestPaymentProvider(process.env.PAYLOAD_SECRET!), sample = 'A'.repeat(43)
  assert.equal(storedPaymentURL(internal, '/platnosc-testowa', sample), '/platnosc-testowa')
  for (const url of [`${SANDBOX}/pay`, '//evil.example.invalid/x', `/platnosc-testowa?token=${sample}`, '/platnosc-testowa/../admin', '/\\evil.example.invalid', '/platnosc-testowa ']) assert.throws(() => storedPaymentURL(internal, url, sample), InputError, url)
})

test('a start timeout still answers with the saved order; resume repeats the same remote key without a new reservation', async () => {
  // The last unit: a cart re-quote would now fail, so the saved order must be resumable on its own.
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  fake.behaviour = (_, call, signal) => call > 1 ? Promise.resolve() : new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 2000)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() })
  })
  const created = await checkout(payload, input, { providers, startTimeoutMs: 100 })
  const token = tokenFrom(created.paymentURL)
  assert.deepEqual([created.paymentURL, created.payment], [ownURL(token), 'preparing'])
  const order = await orderByKey(input.idempotencyKey)
  assert.deepEqual([order.number, order.paymentStatus, order.stockReleased], [created.number, 'pending', false])
  assert.equal(await stock(p.id), 0, 'an ambiguous timeout does not release the reservation')
  const pending = await attemptOf(order.id)
  assert.deepEqual([pending.initialization, pending.initializationLease, pending.initializationKey], ['initializing', null, `underwater-${order.number}`])
  assert.deepEqual([(await summary(token, { providers })).payment, (await summary(token, { providers })).paymentLink], ['preparing', null])
  const view = await resumePayment(payload, token, { providers, startTimeoutMs: 100 })
  assert.deepEqual([view.number, view.payment, view.status], [created.number, 'ready', 'pending'])
  assert.equal(fake.calls.length, 2)
  assert.deepEqual(fake.calls[1], fake.calls[0])
  assert.equal(fake.intents.size, 1, 'the retry reached the same remote intent instead of a second one')
  assert.equal((await attemptOf(order.id)).providerReference, fake.intents.get(fake.calls[0].idempotencyKey))
  assert.equal(await ordersByKey(input.idempotencyKey), 1); assert.equal(await attemptsOf(order.id), 1)
  assert.equal(await stock(p.id), 0)
  // A resume of a ready payment does not contact the adapter again.
  await resumePayment(payload, token, { providers })
  assert.equal(fake.calls.length, 2)
})

test('a lost first COMMIT acknowledgement returns the saved last-stock order without quoting or reserving twice', async () => {
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const drizzle = payload.db.drizzle, original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = ((...args: Parameters<typeof original>) => {
    drizzle.transaction = original
    return original(...args).then(() => { throw new Error('Injected first COMMIT acknowledgement loss') })
  }) as typeof drizzle.transaction
  let created: Awaited<ReturnType<typeof checkout>>
  try { created = await checkout(payload, input, { providers }) } finally { drizzle.transaction = original }
  assert.equal(created.payment, 'ready')
  assert.equal(created.paymentURL, ownURL(tokenFrom(created.paymentURL)))
  const order = await orderByKey(input.idempotencyKey)
  assert.equal((await summary(tokenFrom(created.paymentURL), { providers })).number, order.number)
  assert.equal(await stock(p.id), 0)
  assert.equal(await ordersByKey(input.idempotencyKey), 1)
  assert.equal(await attemptsOf(order.id), 1)
  assert.equal(fake.calls.length, 1)
  assert.equal((await checkout(payload, input, { providers })).number, created.number)
  assert.equal(await stock(p.id), 0)
  assert.equal(fake.calls.length, 1)
  assert.equal(openSessions(), 0)
})

test('reconciliation refuses a closed order even when no new transaction can begin', async () => {
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const created = await checkout(payload, input, { providers }), order = await orderByKey(input.idempotencyKey)
  await expireOrder(order.id)
  const original = payload.db.beginTransaction
  payload.db.beginTransaction = async () => { throw new Error('Synthetic database connection failure') }
  try { await rejectsWith(checkout(payload, input, { providers }), 409, /zamknięte/) } finally { payload.db.beginTransaction = original }
  assert.equal((await summary(tokenFrom(created.paymentURL), { providers })).status, 'expired')
  assert.equal(await stock(p.id), 1)
  assert.equal(await ordersByKey(input.idempotencyKey), 1)
  assert.equal(fake.calls.length, 1)
})

test('a crashed holder lease bounds waiting callers and is taken over after it lapses', async () => {
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  fake.behaviour = async (_, call) => { if (call === 1) throw new Error('Synthetic connection reset') }
  const created = await checkout(payload, input, { providers })
  const token = tokenFrom(created.paymentURL)
  assert.equal(created.payment, 'preparing')
  const order = await orderByKey(input.idempotencyKey), attempt = await attemptOf(order.id)
  await rewriteAttempt(attempt.id, { initializationLease: 'crashed-holder', initializationLeaseUntil: new Date(Date.now() + 60_000).toISOString() })
  const started = Date.now()
  assert.equal((await checkout(payload, input, { providers, waitMs: 200 })).payment, 'preparing')
  assert.equal((await resumePayment(payload, token, { providers, waitMs: 200 })).payment, 'preparing')
  assert.ok(Date.now() - started < 3000, 'a live foreign lease is waited for only within the bound')
  assert.equal(fake.calls.length, 1, 'no second start while another holder may still be running')
  await rewriteAttempt(attempt.id, { initializationLeaseUntil: new Date(Date.now() - 1000).toISOString() })
  assert.equal((await resumePayment(payload, token, { providers })).payment, 'ready')
  assert.deepEqual(fake.calls[1], fake.calls[0])
  assert.deepEqual([(await attemptOf(order.id)).initialization, await stock(p.id)], ['ready', 0])
})

test('an uncertain COMMIT of the stored initialization is resolved by replay, not by a second start', async () => {
  const p = await product(2), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  fake.behaviour = async () => {
    // The next transaction is the short store; its COMMIT succeeds but the acknowledgement is lost once.
    drizzle.transaction = ((...args: Parameters<typeof original>) => { drizzle.transaction = original; return original(...args).then(() => { throw new Error('Injected COMMIT acknowledgement failure') }) }) as typeof drizzle.transaction
  }
  let created: Awaited<ReturnType<typeof checkout>>
  try { created = await checkout(payload, input, { providers }) } finally { drizzle.transaction = original }
  assert.equal(created.payment, 'preparing', 'the saved order is answered even when its initialization outcome is unknown')
  const order = await orderByKey(input.idempotencyKey)
  assert.equal((await attemptOf(order.id)).initialization, 'ready')
  assert.equal((await summary(tokenFrom(created.paymentURL), { providers })).payment, 'ready')
  assert.equal((await checkout(payload, input, { providers })).payment, 'ready')
  assert.equal(fake.calls.length, 1)
  assert.equal(await stock(p.id), 1)
  assert.equal(openSessions(), 0)
})

for (const closure of ['expired', 'cancelled'] as const) test(`initialization finishing after the order was ${closure} does not reopen it; a late payment goes to review`, async () => {
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  fake.behaviour = async start => {
    const order = await orderOf(start.number)
    if (closure === 'cancelled') await updateOperationalStatus(payload, operator, { collection: 'orders', id: order.id, status: 'cancelled' })
    else await expireOrder(order.id)
  }
  await rejectsWith(checkout(payload, input, { providers }), 409, /zamknięte/)
  const order = await orderByKey(input.idempotencyKey), attempt = await attemptOf(order.id)
  assert.deepEqual([order.paymentStatus, order.status, order.stockReleased], [closure, closure, true])
  assert.equal(await stock(p.id), 1, 'stock was released exactly once')
  assert.deepEqual([attempt.initialization, attempt.providerReference, attempt.status], ['ready', fake.intents.get(fake.calls[0].idempotencyKey), closure])
  await rejectsWith(checkout(payload, input, { providers }), 409)
  assert.equal(fake.calls.length, 1)
  const eventKey = randomUUID()
  const late = await notify(fake, fake.id, { eventKey, reference: attempt.providerReference, amountCents: order.totalCents })
  assert.deepEqual(late, { accepted: false, duplicate: false })
  const reviewed = await orderByKey(input.idempotencyKey)
  assert.deepEqual([reviewed.paymentStatus, reviewed.status, reviewed.paymentReviewRequired], [closure, closure, true])
  assert.equal(await outboxCount(`attention:fake-sandbox:${eventKey}`), 1)
  assert.equal(await stock(p.id), 1)
})

test('intent created, start timed out, order expired: a signed paid event with the merchant key is reviewed, never reopened', async () => {
  const p = await product(1), input = orderInput(p.id), fake = new FakeSandbox(), providers = registryOf(fake)
  fake.behaviour = (_, __, signal) => new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve()))
  const created = await checkout(payload, input, { providers, startTimeoutMs: 100 })
  assert.equal(created.payment, 'preparing')
  const order = await orderByKey(input.idempotencyKey), key = `underwater-${order.number}`, raw = fake.intents.get(key)!
  assert.match((await attemptOf(order.id)).reference || '', /^pending-/)
  await expireOrder(order.id)
  assert.equal(await stock(p.id), 1)
  // Without the signed key the unknown reference matches nothing.
  await rejectsWith(notify(fake, fake.id, { reference: raw, amountCents: order.totalCents }), 404)
  const eventKey = randomUUID(), body = { eventKey, reference: raw, merchantKey: key, amountCents: order.totalCents }
  assert.deepEqual(await notify(fake, fake.id, body), { accepted: false, duplicate: false })
  const reviewed = await orderByKey(input.idempotencyKey), attempt = await attemptOf(order.id)
  assert.deepEqual([reviewed.paymentStatus, reviewed.status, reviewed.stockReleased, reviewed.paymentReviewRequired], ['expired', 'expired', true, true])
  assert.deepEqual([attempt.initialization, attempt.providerReference, attempt.status, attempt.paymentUrl ?? null], ['ready', raw, 'expired', null])
  assert.match(attempt.reference || '', /^fake-sandbox:[a-f0-9]{64}$/)
  assert.equal(await stock(p.id), 1, 'the released stock stays released')
  assert.equal(await outboxCount(`attention:fake-sandbox:${eventKey}`), 1)
  // The same signed event again is a duplicate with no further effect.
  assert.deepEqual(await notify(fake, fake.id, body), { accepted: false, duplicate: true })
  assert.equal(await eventsOf(attempt.id), 1)
  assert.equal(await outboxCount(`attention:fake-sandbox:${eventKey}`), 1)
  assert.equal(await stock(p.id), 1)
  assert.equal((await resumePayment(payload, tokenFrom(created.paymentURL), { providers })).status, 'expired')
  assert.equal(fake.calls.length, 1)
})

test('a verified callback before the start result is stored converges with that result, sequentially or concurrently', async () => {
  // Sequential: the callback arrives while the adapter call is still running.
  const p = await product(2), fake = new FakeSandbox(), providers = registryOf(fake)
  const first = orderInput(p.id)
  fake.behaviour = async start => {
    const order = await orderOf(start.number)
    assert.deepEqual(await notify(fake, fake.id, { reference: fake.intents.get(start.idempotencyKey), merchantKey: start.idempotencyKey, amountCents: order.totalCents }), { accepted: true, duplicate: false })
  }
  const created = await checkout(payload, first, { providers })
  assert.equal(created.payment, 'ready')
  const order = await orderByKey(first.idempotencyKey), attempt = await attemptOf(order.id)
  assert.deepEqual([order.paymentStatus, order.status, order.paymentReviewRequired ?? false], ['paid', 'paid', false])
  assert.deepEqual([attempt.initialization, attempt.providerReference, attempt.paymentUrl], ['ready', fake.intents.get(attempt.initializationKey!), `${SANDBOX}/pay/${fake.intents.get(attempt.initializationKey!)}`])
  assert.equal(await eventsOf(attempt.id), 1)
  assert.equal((await summary(tokenFrom(created.paymentURL), { providers })).paymentLink, null, 'a paid order offers no payment page')
  // Concurrent: the stored result and the callback race; either order of commits converges.
  const second = orderInput(p.id)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  fake.behaviour = () => gate
  const pending = checkout(payload, second, { providers })
  await waitFor(() => fake.calls.length === 2, 'the second start')
  const key = fake.calls[1].idempotencyKey, raw = fake.intents.get(key)!
  const racing = await orderByKey(second.idempotencyKey)
  const [callback, result] = await Promise.all([notify(fake, fake.id, { reference: raw, merchantKey: key, amountCents: racing.totalCents }), (release(), pending)])
  assert.deepEqual(callback, { accepted: true, duplicate: false })
  assert.equal(result.number, racing.number)
  const settled = await attemptOf(racing.id)
  assert.deepEqual([settled.initialization, settled.providerReference, (await orderByKey(second.idempotencyKey)).paymentStatus], ['ready', raw, 'paid'])
  assert.equal(await eventsOf(settled.id), 1)
  assert.equal(await outboxCount(`payment-init-conflict:${settled.id}`), 0)
  assert.equal(await stock(p.id), 0)
})

test('an unknown or mismatched merchant key, adapter, reference or amount claims no attempt', async () => {
  const p = await product(3), a = new FakeSandbox('fake-a'), b = new FakeSandbox('fake-b'), providers = registryOf(a, b)
  a.behaviour = async (_, call) => { if (call === 1) throw new Error('Synthetic connection reset') }
  const created = await checkout(payload, orderInput(p.id), { providers })
  const order = await orderOf(created.number), key = `underwater-${order.number}`, raw = a.intents.get(key)!
  await rejectsWith(notify(b, 'fake-b', { reference: raw, merchantKey: key, amountCents: order.totalCents }), 404)
  await rejectsWith(notify(a, 'fake-a', { reference: raw, merchantKey: 'underwater-UW-00000000-0000-0000-0000-000000000000', amountCents: order.totalCents }), 404)
  await rejectsWith(notify(a, 'fake-a', { reference: raw, merchantKey: 'not a key', amountCents: order.totalCents }), 400)
  await rejectsWith(notify(a, 'fake-a', { reference: raw, merchantKey: key, amountCents: cents(order.totalCents) + 1 }), 409, /Kwota/)
  const untouched = await attemptOf(order.id)
  assert.deepEqual([untouched.initialization, untouched.providerReference ?? null, await eventsOf(untouched.id)], ['initializing', null, 0])
  // Once ready, its reference is never rebound by a signed key carrying another reference.
  assert.equal((await resumePayment(payload, tokenFrom(created.paymentURL), { providers })).payment, 'ready')
  const eventKey = randomUUID()
  assert.deepEqual(await notify(a, 'fake-a', { eventKey, reference: 'fake-other-intent', merchantKey: key, amountCents: order.totalCents }), { accepted: false, duplicate: false })
  const ready = await attemptOf(order.id), flagged = await orderOf(created.number)
  assert.deepEqual([ready.providerReference, flagged.paymentStatus, flagged.paymentReviewRequired], [raw, 'pending', true])
  assert.equal(await outboxCount(`reference-mismatch:fake-a:${eventKey}`), 1)
  assert.deepEqual([(await summary(tokenFrom(created.paymentURL), { providers })).payment, (await summary(tokenFrom(created.paymentURL), { providers })).paymentLink], ['review', null])
  // A known reference with another attempt's signed key is refused without any write.
  const other = await checkout(payload, orderInput(p.id), { providers })
  const otherOrder = await orderOf(other.number), otherAttempt = await attemptOf(otherOrder.id)
  await rejectsWith(notify(a, 'fake-a', { reference: otherAttempt.providerReference, merchantKey: key, amountCents: otherOrder.totalCents }), 409)
  assert.equal(await eventsOf(otherAttempt.id), 0)
  assert.equal((await orderOf(other.number)).paymentStatus, 'pending')
})

test('two adapters with the same raw reference stay isolated', async () => {
  const p = await product(2)
  const a = new FakeSandbox('fake-a', () => 'shared-ref-1'), b = new FakeSandbox('fake-b', () => 'shared-ref-1')
  const viaA = await checkout(payload, orderInput(p.id), { providers: registryOf(a, b) })
  const viaB = await checkout(payload, orderInput(p.id), { providers: registryOf(b, a) })
  const orderA = await orderOf(viaA.number), orderB = await orderOf(viaB.number)
  const attemptA = await attemptOf(orderA.id), attemptB = await attemptOf(orderB.id)
  assert.deepEqual([attemptA.provider, attemptA.providerReference, attemptB.provider, attemptB.providerReference], ['fake-a', 'shared-ref-1', 'fake-b', 'shared-ref-1'])
  assert.notEqual(attemptA.reference, attemptB.reference)
  assert.deepEqual(await notify(a, 'fake-a', { reference: 'shared-ref-1', amountCents: orderA.totalCents }), { accepted: true, duplicate: false })
  assert.deepEqual([(await orderOf(viaA.number)).paymentStatus, (await orderOf(viaB.number)).paymentStatus], ['paid', 'pending'])
  assert.equal(await eventsOf(attemptB.id), 0)
  assert.deepEqual(await notify(b, 'fake-b', { reference: 'shared-ref-1', amountCents: orderB.totalCents }), { accepted: true, duplicate: false })
  assert.equal((await orderOf(viaB.number)).paymentStatus, 'paid')
  assert.deepEqual([await eventsOf(attemptA.id), await eventsOf(attemptB.id)], [1, 1])
})

test('notifications and simulation keep provider identity; placeholders are never payable', async () => {
  const internal = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  const p = await product(4), fake = new FakeSandbox(), providers = registryOf(fake)
  const sandboxOrder = await checkout(payload, orderInput(p.id), { providers })
  const sandbox = await orderOf(sandboxOrder.number), sandboxAttempt = await attemptOf(sandbox.id)
  const ownOrder = await checkout(payload, orderInput(p.id))
  const own = await orderOf(ownOrder.number), ownAttempt = await attemptOf(own.id)
  await rejectsWith(notify(internal, INTERNAL_TEST_PROVIDER, { reference: sandboxAttempt.providerReference, amountCents: sandbox.totalCents }), 404)
  // The backward-compatible default identity is the internal adapter too.
  const forged = JSON.stringify({ eventKey: randomUUID(), reference: sandboxAttempt.providerReference, amountCents: sandbox.totalCents, currency: 'PLN', outcome: 'paid' })
  await rejectsWith(acceptNotification(payload, internal.verify(forged, internal.sign(forged)), hash(forged)), 404)
  await rejectsWith(notify(fake, fake.id, { reference: ownAttempt.providerReference, amountCents: own.totalCents }), 404)
  // The stored namespaced form is not a raw operator reference.
  await rejectsWith(notify(fake, fake.id, { reference: sandboxAttempt.reference, amountCents: sandbox.totalCents }), 404)
  const sandboxToken = tokenFrom(sandboxOrder.paymentURL)
  for (const outcome of ['paid', 'failed', 'cancelled']) await rejectsWith(simulatePayment(payload, sandboxToken, outcome), 403)
  assert.equal(await eventsOf(sandboxAttempt.id), 0)
  assert.equal((await summary(sandboxToken, { providers })).status, 'pending')
  assert.deepEqual(await notify(fake, fake.id, { reference: sandboxAttempt.providerReference, amountCents: sandbox.totalCents }), { accepted: true, duplicate: false })
  assert.equal((await summary(sandboxToken, { providers })).status, 'paid')
  // An internal placeholder is reached by neither a signed event nor the simulation until resumed.
  const flaky = new FlakyInternal(); flaky.failing = true
  const input = orderInput(p.id), waiting = await checkout(payload, input, { providers: registryOf(flaky) })
  const waitingToken = tokenFrom(waiting.paymentURL), waitingOrder = await orderByKey(input.idempotencyKey), placeholder = await attemptOf(waitingOrder.id)
  assert.equal(waiting.payment, 'preparing')
  assert.match(placeholder.reference || '', /^pending-/)
  await rejectsWith(notify(internal, INTERNAL_TEST_PROVIDER, { reference: placeholder.reference, amountCents: waitingOrder.totalCents }), 404)
  await rejectsWith(simulatePayment(payload, waitingToken, 'paid'), 409)
  assert.deepEqual([(await summary(waitingToken)).payment, (await summary(waitingToken)).simulation], ['preparing', false])
  flaky.failing = false
  assert.equal((await resumePayment(payload, waitingToken, { providers: registryOf(flaky) })).payment, 'ready')
  assert.deepEqual(flaky.calls[1], flaky.calls[0])
  assert.equal((await simulatePayment(payload, waitingToken, 'paid')).status, 'paid')
  assert.equal(await eventsOf(placeholder.id), 1)
})

test('the registry resolves only registered adapters; webhook and resume routes refuse before any write', async () => {
  for (const id of ['fake-sandbox', 'manual-test', '__proto__', 'constructor', 'Internal-Test', '', undefined]) assert.equal(registeredPaymentProvider(id), null, String(id))
  assert.equal(registeredPaymentProvider(INTERNAL_TEST_PROVIDER)?.id, INTERNAL_TEST_PROVIDER)
  const { POST: named } = await import('../src/app/api/payments/webhook/[provider]/route')
  const { POST: original } = await import('../src/app/api/payments/webhook/route')
  const { POST: resume } = await import('../src/app/api/payments/resume/route')
  const internal = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  const raw = JSON.stringify({ eventKey: randomUUID(), reference: 'test-unknown', amountCents: 1000, currency: 'PLN', outcome: 'paid' })
  const request = (headers: Record<string, string> = {}, body = raw) => new Request('http://localhost:3011/api/payments/webhook', { method: 'POST', body, headers })
  const before = (await payload.count({ collection: 'payment-events' })).totalDocs
  for (const id of ['fake-sandbox', 'manual-test', '__proto__']) assert.equal((await named(request({ 'x-underwater-signature': internal.sign(raw) }), { params: Promise.resolve({ provider: id }) })).status, 404, id)
  assert.equal((await named(request({ 'x-underwater-signature': 'f'.repeat(64) }), { params: Promise.resolve({ provider: INTERNAL_TEST_PROVIDER }) })).status, 401)
  assert.equal((await original(request({ 'x-underwater-signature': 'f'.repeat(64) }))).status, 401)
  const resumeBody = JSON.stringify({ token: 'A'.repeat(43) })
  assert.equal((await resume(request({ 'content-type': 'application/json' }, resumeBody))).status, 403)
  assert.equal((await resume(request({ 'content-type': 'application/json', origin: 'https://evil.example.invalid' }, resumeBody))).status, 403)
  assert.equal((await payload.count({ collection: 'payment-events' })).totalDocs, before)
})

test('legacy internal and manual attempts without the new fields use a read-only fallback', async () => {
  await payload.updateGlobal({ slug: 'settings', data: {
    deliveryMethods: [{ key: 'test-pickup', label: 'TEST odbiór osobisty', priceCents: 0, enabled: true, kind: 'pickup' as const, codAllowed: false }],
    freeShippingThresholdCents: 5000,
    testPayments: { bankTransferEnabled: true, codEnabled: false, offlineReservationMinutes: 2880, codSurchargeCents: 700 },
  } })
  const p = await product(3), flaky = new FlakyInternal(), providers = registryOf(flaky)
  const legacyShape = { initialization: null, paymentUrl: null, initializationKey: null, providerReference: null }
  // Internal: the row as stored before this change, with its raw reference in `reference`.
  const online = orderInput(p.id), created = await checkout(payload, online)
  const onlineOrder = await orderOf(created.number), onlineAttempt = await attemptOf(onlineOrder.id)
  const legacyReference = `test-${randomUUID()}`
  await rewriteAttempt(onlineAttempt.id, { ...legacyShape, reference: legacyReference })
  const legacy = await attemptOf(onlineOrder.id)
  assert.deepEqual(await checkout(payload, online, { providers }), created)
  assert.deepEqual(await resumePayment(payload, tokenFrom(created.paymentURL), { providers }), await summary(tokenFrom(created.paymentURL)))
  assert.equal(flaky.calls.length, 0, 'a legacy attempt is never re-initialized')
  assert.deepEqual(await attemptOf(onlineOrder.id), legacy, 'the private row is not backfilled')
  assert.deepEqual([(await summary(tokenFrom(created.paymentURL))).payment, (await summary(tokenFrom(created.paymentURL))).simulation], ['ready', true])
  assert.equal((await simulatePayment(payload, tokenFrom(created.paymentURL), 'paid')).status, 'paid')
  assert.equal((await attemptOf(onlineOrder.id)).reference, legacyReference)
  // Manual: the link holder may only withdraw.
  const bank = orderInput(p.id, { paymentMethod: 'bank_transfer' }), manual = await checkout(payload, bank)
  const manualOrder = await orderOf(manual.number), manualAttempt = await attemptOf(manualOrder.id)
  assert.deepEqual([manualAttempt.provider, manualAttempt.initialization, manualAttempt.paymentUrl, manualAttempt.initializationKey ?? null], ['manual-test', 'ready', '/platnosc-testowa', null])
  await rewriteAttempt(manualAttempt.id, legacyShape)
  assert.deepEqual(await checkout(payload, bank, { providers }), manual)
  const token = tokenFrom(manual.paymentURL)
  await rejectsWith(simulatePayment(payload, token, 'paid'), 403)
  await rejectsWith(notify(new TestPaymentProvider(process.env.PAYLOAD_SECRET!), INTERNAL_TEST_PROVIDER, { reference: manualAttempt.reference, amountCents: manualOrder.totalCents }), 404)
  assert.equal((await simulatePayment(payload, token, 'cancelled')).status, 'cancelled')
  assert.equal(await stock(p.id), 2)
  // An unknown legacy adapter is never guessed: the saved order points to the shop and the row stays as it was.
  const retired = orderInput(p.id), kept = await checkout(payload, retired)
  const retiredOrder = await orderOf(kept.number), retiredAttempt = await attemptOf(retiredOrder.id)
  await rewriteAttempt(retiredAttempt.id, { ...legacyShape, provider: 'retired-adapter' })
  const before = await attemptOf(retiredOrder.id)
  const replay = await checkout(payload, retired, { providers })
  assert.deepEqual([replay.paymentURL, replay.payment], [kept.paymentURL, 'review'])
  assert.deepEqual(await attemptOf(retiredOrder.id), before)
  assert.deepEqual([(await summary(tokenFrom(kept.paymentURL))).payment, (await summary(tokenFrom(kept.paymentURL))).simulation], ['review', false])
  await rejectsWith(simulatePayment(payload, tokenFrom(kept.paymentURL), 'paid'), 403)
  assert.equal(flaky.calls.length, 0)
})

test('the captured order mail separates its lines with real newlines', async () => {
  const body = orderMailBody({
    number: 'UW-TEST', items: [{ product: 1, productName: 'TEST maska', qty: 2, unitPriceCents: 1000, lineTotalCents: 2000 }, { product: 2, productName: 'TEST płetwy', variant: 'L', qty: 1, unitPriceCents: 500, lineTotalCents: 500 }],
    subtotalCents: 2500, deliveryCents: 0, paymentSurchargeCents: 0, totalCents: 2500, deliveryLabel: 'TEST odbiór', deliveryKind: 'pickup', pickupPointId: null, pickupPointName: null, pickupPointAddress: null,
    address: null, paymentMethod: 'online', freeShippingApplied: false, expiresAt: null,
  } as Parameters<typeof orderMailBody>[0], 'http://localhost:3011/platnosc-testowa?token=x')
  const lines = body.split('\n')
  assert.ok(!body.includes('\\n'), 'no literal backslash-n separator')
  assert.ok(lines.length > 8)
  assert.ok(lines.includes('Zamówienie: UW-TEST'))
  assert.ok(lines.includes('- TEST maska × 2: 20,00 PLN'))
  assert.ok(lines.includes('- TEST płetwy (L) × 1: 5,00 PLN'))
  assert.equal(lines.at(-1), 'Status i płatność: http://localhost:3011/platnosc-testowa?token=x')
  // The mail captured by a real checkout uses the same separator.
  const p = await product(1), created = await checkout(payload, orderInput(p.id))
  const order = await orderOf(created.number)
  const captured = (await payload.find({ collection: 'outbox', where: { deduplicationKey: { equals: `order:${order.id}` } }, depth: 0 })).docs[0].body
  assert.ok(!captured.includes('\\n'))
  assert.ok(captured.split('\n').includes(`Zamówienie: ${order.number}`))
})

test('one adapter returning the same raw reference for two orders sends the second to review without retry, link, start or new reservation', async () => {
  const p = await product(3), fake = new FakeSandbox('fake-dup', () => 'dup-ref-1'), providers = registryOf(fake)
  const firstInput = orderInput(p.id), first = await checkout(payload, firstInput, { providers })
  assert.equal(first.payment, 'ready')
  const secondInput = orderInput(p.id), second = await checkout(payload, secondInput, { providers })
  const token = tokenFrom(second.paymentURL)
  assert.deepEqual([second.paymentURL, second.payment], [ownURL(token), 'review'])
  assert.equal(fake.calls.length, 2)
  assert.equal(await stock(p.id), 1)
  const order = await orderByKey(secondInput.idempotencyKey), attempt = await attemptOf(order.id)
  assert.deepEqual([order.paymentStatus, order.status, order.stockReleased, order.paymentReviewRequired], ['pending', 'new', false, true])
  // The other order's reference is never bound to this attempt.
  assert.deepEqual([attempt.initialization, attempt.providerReference ?? null, attempt.paymentUrl ?? null, attempt.initializationLease ?? null], ['initializing', null, null, null])
  assert.match(attempt.reference || '', /^pending-/)
  const view = await summary(token, { providers })
  assert.deepEqual([view.payment, view.paymentLink, view.simulation, view.status], ['review', null, false, 'pending'])
  // Repeated and concurrent checkout/resume stay stable: no start, order, reservation or duplicate notice.
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await checkout(payload, secondInput, { providers }), second)
    const resumed = await resumePayment(payload, token, { providers })
    assert.deepEqual([resumed.payment, resumed.paymentLink, resumed.status], ['review', null, 'pending'])
  }
  const [again, resumed] = await Promise.all([checkout(payload, secondInput, { providers }), resumePayment(payload, token, { providers })])
  assert.deepEqual([again.payment, resumed.payment], ['review', 'review'])
  await rejectsWith(simulatePayment(payload, token, 'paid'), 403)
  assert.equal(fake.calls.length, 2)
  assert.equal(await ordersByKey(secondInput.idempotencyKey), 1); assert.equal(await attemptsOf(order.id), 1)
  assert.equal(await stock(p.id), 1)
  assert.equal(await outboxCount(`payment-init-conflict:${attempt.id}`), 1)
  assert.deepEqual(await attemptOf(order.id), attempt, 'repeats do not touch the attempt')
  // The first order keeps its intent and link.
  const firstOrder = await orderByKey(firstInput.idempotencyKey), firstAttempt = await attemptOf(firstOrder.id)
  assert.deepEqual([firstAttempt.providerReference, firstOrder.paymentReviewRequired ?? false], ['dup-ref-1', false])
  assert.equal((await summary(tokenFrom(first.paymentURL), { providers })).paymentLink, `${SANDBOX}/pay/dup-ref-1`)
  // The second order's signed key with the shared reference claims nothing; with another reference it is not bound while under review.
  await rejectsWith(notify(fake, fake.id, { reference: 'dup-ref-1', merchantKey: attempt.initializationKey, amountCents: order.totalCents }), 409)
  const eventKey = randomUUID(), body = { eventKey, reference: 'dup-ref-2', merchantKey: attempt.initializationKey, amountCents: order.totalCents }
  assert.deepEqual(await notify(fake, fake.id, body), { accepted: false, duplicate: false })
  assert.deepEqual(await notify(fake, fake.id, body), { accepted: false, duplicate: true })
  const unbound = await attemptOf(order.id)
  assert.deepEqual([unbound.initialization, unbound.providerReference ?? null, unbound.status], ['initializing', null, 'pending'])
  assert.equal(await eventsOf(attempt.id), 1)
  assert.equal(await outboxCount(`reference-mismatch:fake-dup:${eventKey}`), 1)
  assert.equal((await orderOf(second.number)).paymentStatus, 'pending')
  // The shared reference pays only the order that owns it.
  assert.deepEqual(await notify(fake, fake.id, { reference: 'dup-ref-1', amountCents: firstOrder.totalCents }), { accepted: true, duplicate: false })
  assert.deepEqual([(await orderOf(first.number)).paymentStatus, (await orderOf(second.number)).paymentStatus], ['paid', 'pending'])
  // The reservation runs to its normal expiry and is released once.
  await expireOrder(order.id)
  assert.equal(await stock(p.id), 2)
  assert.equal((await resumePayment(payload, token, { providers })).status, 'expired')
  await rejectsWith(checkout(payload, secondInput, { providers }), 409, /zamknięte/)
  assert.equal(fake.calls.length, 2)
  assert.equal(await stock(p.id), 2)
  assert.equal(await outboxCount(`payment-init-conflict:${attempt.id}`), 1)
})

test('an open internal order flagged by a reference mismatch offers no simulation, link or new start', async () => {
  const internal = new TestPaymentProvider(process.env.PAYLOAD_SECRET!), flaky = new FlakyInternal(), providers = registryOf(flaky)
  const p = await product(1), input = orderInput(p.id), created = await checkout(payload, input, { providers })
  const token = tokenFrom(created.paymentURL), order = await orderOf(created.number), attempt = await attemptOf(order.id)
  assert.equal((await summary(token)).simulation, true)
  const eventKey = randomUUID()
  assert.deepEqual(await notify(internal, INTERNAL_TEST_PROVIDER, { eventKey, reference: 'test-other-intent', merchantKey: attempt.initializationKey, amountCents: order.totalCents }), { accepted: false, duplicate: false })
  assert.equal(await outboxCount(`reference-mismatch:internal-test:${eventKey}`), 1)
  const view = await summary(token)
  assert.deepEqual([view.status, view.payment, view.paymentLink, view.simulation], ['pending', 'review', null, false])
  for (const outcome of ['paid', 'failed', 'cancelled']) await rejectsWith(simulatePayment(payload, token, outcome), 409)
  assert.equal((await checkout(payload, input, { providers })).payment, 'review')
  assert.equal((await resumePayment(payload, token, { providers })).payment, 'review')
  assert.equal(flaky.calls.length, 1)
  assert.deepEqual([(await orderOf(created.number)).paymentStatus, await stock(p.id), await eventsOf(attempt.id)], ['pending', 0, 1])
  assert.equal((await attemptOf(order.id)).providerReference, attempt.providerReference)
})
