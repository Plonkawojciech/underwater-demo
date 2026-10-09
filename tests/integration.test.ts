import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildSync } from 'esbuild'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { sql } from '@payloadcms/db-sqlite'
import { checkout, paymentSummary, simulatePayment, acceptNotification, expireReservations } from '../src/lib/commerce/order'
import { hash, InputError } from '../src/lib/commerce/input'
import { TestPaymentProvider } from '../src/lib/commerce/provider'
import { transaction } from '../src/lib/commerce/transaction'
import { activeWriteTransactionCount, holdingTransaction, writeLease, WriteLeaseTimeout } from '../src/lib/sqlite-adapter'
import { contact, signup, subscribe, newsletterToken } from '../src/lib/forms/service'
import { confirmSignup, expireSignups } from '../src/lib/forms/reservations'
import { adjustInventory, updateOperationalStatus } from '../src/lib/operations'

const root = mkdtempSync(path.join(tmpdir(), 'underwater-integration-'))
const repo = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(path.join(repo, 'tmp'), { recursive: true })
const workerRoot = mkdtempSync(path.join(repo, 'tmp/underwater-native-worker-'))
const workerFile = path.join(workerRoot, 'checkout-worker.mjs')
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-integration-test-secret-not-used-in-runtime' })
let payload: Payload
let category: number
const tokenFrom = (url: string) => new URL(url, 'http://localhost:3011').searchParams.get('token')!
const orderInput = (id: number, changes: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), customerName: 'Test integracyjny', email: 'test@example.invalid', phone: '000000000', address: 'Testowy adres', items: [{ id, qty: 1, price: 0.01 }], deliveryMethod: 'test-pickup', privacyAccepted: true, termsAccepted: true, ...changes })
async function product(stock: number, extra: Record<string, unknown> = {}) {
  const id = Math.floor(Math.random() * 1e8)
  return payload.create({ collection: 'products', overrideAccess: true, data: { vmId: id, name: 'TEST — nie do sprzedaży', slug: `test-${id}`, category, price: 10, priceCents: 1000, stock, published: true, ...extra } })
}

test.before(async () => {
  buildSync({ entryPoints: [fileURLToPath(new URL('./transaction-worker.ts', import.meta.url))], outfile: workerFile, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', define: { 'import.meta.url': JSON.stringify(new URL('../src/payload.config.ts', import.meta.url).href) } })
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  category = (await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST', slug: 'test', published: true } })).id
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }); rmSync(workerRoot, { recursive: true, force: true }) })

test('last stock unit is reserved by exactly one concurrent checkout', async () => {
  const p = await product(1)
  const results = await Promise.allSettled([checkout(payload, orderInput(p.id)), checkout(payload, orderInput(p.id))])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 0)
  const orders = await payload.find({ collection: 'orders', where: { 'items.product': { equals: p.id } }, depth: 0 })
  assert.equal(orders.totalDocs, 1); assert.equal(orders.docs[0].totalCents, 1000)
})
test('a missing release row cannot roll back one item and commit the remaining order writes', async () => {
  const first = await product(1), second = await product(1)
  const created = await checkout(payload, orderInput(first.id, { items: [{ id: first.id, qty: 1 }, { id: second.id, qty: 1 }] }))
  await transaction(payload, 'order-service', async req => {
    const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } }, req, depth: 0 })).docs[0]
    await payload.update({ collection: 'orders', id: order.id, data: { expiresAt: '2000-01-01T00:00:00.000Z' }, req })
  })
  const original = payload.findByID.bind(payload)
  // Exercise the actual Payload missing-row path while keeping the source
  // fixture's foreign keys intact. The first item's release must still commit.
  payload.findByID = ((args: any) => original(args.collection === 'products' && args.id === second.id && args.req ? { ...args, id: 2_147_483_646 } : args)) as typeof payload.findByID
  try { await transaction(payload, 'reservation-service', req => expireReservations(payload, req)) }
  finally { payload.findByID = original as typeof payload.findByID }
  assert.equal((await original({ collection: 'products', id: first.id })).stock, 1)
  assert.equal((await original({ collection: 'products', id: second.id })).stock, 0)
  const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } } })).docs[0]
  assert.equal(order.paymentStatus, 'expired')
  assert.equal(order.stockReleased, true)
  assert.equal(order.paymentReviewRequired, true)
})
test('retry of a closed order preserves stock and rejects the obsolete checkout key', async () => {
  const p = await product(1), input = orderInput(p.id)
  const created = await checkout(payload, input)
  await simulatePayment(payload, tokenFrom(created.paymentURL), 'cancelled')
  await assert.rejects(checkout(payload, input), (error: any) => error instanceof InputError && error.status === 409)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id })).stock, 1)
  assert.equal((await payload.count({ collection: 'orders', where: { number: { equals: created.number } } })).totalDocs, 1)
})
test('concurrent idempotency retries create one order and reserve stock once', async () => {
  const p = await product(4), input = orderInput(p.id)
  const [a, b] = await Promise.all([checkout(payload, input), checkout(payload, input)])
  assert.equal(a.number, b.number); assert.equal(a.paymentURL, b.paymentURL)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 3)
  await assert.rejects(checkout(payload, { ...input, email: 'different@example.invalid' }), InputError)
})
test('successful payment and duplicate notifications never decrement stock twice', async () => {
  const p = await product(3), created = await checkout(payload, orderInput(p.id)), token = tokenFrom(created.paymentURL)
  const [a, b] = await Promise.all([simulatePayment(payload, token, 'paid'), simulatePayment(payload, token, 'paid')])
  assert.equal(a.status, 'paid'); assert.equal(b.status, 'paid')
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 2)
  const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } } })).docs[0]
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } } })).docs[0]
  assert.equal((await payload.count({ collection: 'payment-events', where: { attempt: { equals: attempt.id } } })).totalDocs, 1)
})
test('cancelled, failed and expired reservations release exactly once; late paid events do not reopen', async () => {
  for (const outcome of ['cancelled', 'failed', 'expired'] as const) {
    const p = await product(1), created = await checkout(payload, orderInput(p.id)), token = tokenFrom(created.paymentURL)
    if (outcome === 'expired') {
      await transaction(payload, 'order-service', async req => {
        const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } }, req, depth: 0 })).docs[0]
        await payload.update({ collection: 'orders', id: order.id, data: { expiresAt: '2000-01-01T00:00:00.000Z' }, req })
      })
      await transaction(payload, 'reservation-service', req => expireReservations(payload, req))
    } else await simulatePayment(payload, token, outcome)
    await simulatePayment(payload, token, 'paid'); await simulatePayment(payload, token, 'paid')
    const summary = await paymentSummary(payload, token)
    assert.equal(summary.status, outcome)
    assert.equal((await payload.find({ collection: 'orders', where: { number: { equals: created.number } } })).docs[0].paymentReviewRequired, true)
    assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 1)
  }
})
test('duplicate signup reserves one place; confirmation persists and expiry releases once', async () => {
  const course = await payload.create({ collection: 'courses', data: { name: 'TEST opt-in', slug: 'test-opt-in', published: true } })
  const session = await payload.create({ collection: 'course-sessions', data: { title: 'TEST opt-in', course: course.id, startsAt: '2099-01-01T12:00:00.000Z', capacity: 2, published: true } })
  const input = { name: 'Test', email: 'signup-dedup@example.invalid', phone: '000000000', privacyAccepted: true, course: course.id, session: session.id }
  await Promise.all([signup(payload, input), signup(payload, input)])
  assert.equal((await payload.count({ collection: 'signups', where: { email: { equals: input.email } } })).totalDocs, 1)
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 1)
  const captured = (await payload.find({ collection: 'outbox', where: { recipient: { equals: input.email } }, depth: 0 })).docs[0].body
  const token = captured.match(/potwierdz\?token=([A-Za-z0-9_-]+)/)![1]
  await confirmSignup(payload, token); await confirmSignup(payload, token)
  await transaction(payload, 'form-service', req => expireSignups(payload, req, new Date('2100-01-01T00:00:00Z')))
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 1)
  const second = { ...input, email: 'signup-expire@example.invalid' }
  await signup(payload, second)
  const secondCaptured = (await payload.find({ collection: 'outbox', where: { recipient: { equals: second.email } }, depth: 0 })).docs[0].body
  const secondToken = secondCaptured.match(/potwierdz\?token=([A-Za-z0-9_-]+)/)![1]
  for (let i = 0; i < 2; i++) await transaction(payload, 'form-service', req => expireSignups(payload, req, new Date('2100-01-01T00:00:00Z')))
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 1)
  await assert.rejects(confirmSignup(payload, secondToken), InputError)
})
test('operational changes require the right role and preserve stock with an audit trail', async () => {
  const admin = await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, data: { email: 'admin-operations@example.invalid', password: 'synthetic-admin-password-for-tests-only', role: 'admin' } })
  const editor = { ...admin, role: 'editor' as const }
  const p = await product(1), created = await checkout(payload, orderInput(p.id))
  const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } } })).docs[0]
  await assert.rejects(updateOperationalStatus(payload, editor, { collection: 'orders', id: order.id, status: 'cancelled' }), /uprawnień/)
  await assert.rejects(payload.find({ collection: 'orders', user: editor, overrideAccess: false }), /not allowed|Forbidden|permissions|dostęp/i)
  await assert.rejects(updateOperationalStatus(payload, admin, { collection: 'orders', id: order.id, status: 'shipped' }), /opłaconego/)
  await updateOperationalStatus(payload, admin, { collection: 'orders', id: order.id, status: 'cancelled' })
  await updateOperationalStatus(payload, admin, { collection: 'orders', id: order.id, status: 'cancelled' })
  assert.equal((await payload.findByID({ collection: 'products', id: p.id })).stock, 1)
  assert.equal((await payload.count({ collection: 'audit-events', where: { targetId: { equals: order.id } } })).totalDocs, 1, 'a repeated cancellation is a no-op without a second audit mutation')
  await assert.rejects(adjustInventory(payload, editor, { id: p.id, stock: 3, expectedStock: 1 }), /uprawnień/)
  await adjustInventory(payload, admin, { id: p.id, stock: 3, expectedStock: 1 })
  await assert.rejects(adjustInventory(payload, admin, { id: p.id, stock: 4, expectedStock: 1 }), /Stan zmienił/)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id })).stock, 3)
  await contact(payload, { name: 'TEST', email: 'ops-contact@example.invalid', message: 'Wiadomość testowa', privacyAccepted: true })
  const entry = (await payload.find({ collection: 'contacts', where: { email: { equals: 'ops-contact@example.invalid' } } })).docs[0]
  await updateOperationalStatus(payload, admin, { collection: 'contacts', id: entry.id, status: 'closed' })
  assert.equal((await payload.findByID({ collection: 'contacts', id: entry.id })).status, 'closed')
  const course = await payload.create({ collection: 'courses', data: { name: 'TEST lifecycle', slug: 'test-lifecycle', published: true } })
  const session = await payload.create({ collection: 'course-sessions', data: { title: 'TEST lifecycle', course: course.id, startsAt: '2099-01-01T12:00:00Z', capacity: 1, published: true } })
  await signup(payload, { name: 'TEST', email: 'lifecycle@example.invalid', phone: '000000000', privacyAccepted: true, course: course.id, session: session.id })
  const registration = (await payload.find({ collection: 'signups', where: { email: { equals: 'lifecycle@example.invalid' } } })).docs[0]
  await updateOperationalStatus(payload, admin, { collection: 'signups', id: registration.id, status: 'contacted' })
  await transaction(payload, 'form-service', req => expireSignups(payload, req, new Date('2100-01-01T00:00:00Z')))
  assert.equal((await payload.findByID({ collection: 'signups', id: registration.id })).status, 'contacted')
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 0)
  await updateOperationalStatus(payload, admin, { collection: 'signups', id: registration.id, status: 'enrolled' })
  assert.equal((await payload.findByID({ collection: 'signups', id: registration.id })).emailConfirmedAt, null)
  await transaction(payload, 'form-service', req => expireSignups(payload, req, new Date('2100-01-01T00:00:00Z')))
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 1)
  await updateOperationalStatus(payload, admin, { collection: 'signups', id: registration.id, status: 'rejected' })
  await updateOperationalStatus(payload, admin, { collection: 'signups', id: registration.id, status: 'rejected' })
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 0)
})
test('a valid signature with wrong amount does not mutate the order', async () => {
  const p = await product(1), created = await checkout(payload, orderInput(p.id)), token = tokenFrom(created.paymentURL)
  const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } }, depth: 0 })).docs[0]
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, depth: 0 })).docs[0]
  const provider = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  const raw = JSON.stringify({ eventKey: randomUUID(), reference: attempt.providerReference || attempt.reference, amountCents: 1, currency: 'PLN', outcome: 'paid' })
  await assert.rejects(acceptNotification(payload, provider.verify(raw, provider.sign(raw)), hash(raw)), InputError)
  assert.equal((await paymentSummary(payload, token)).status, 'pending')
})
test('a removed reserved variant does not block other checkouts during expiry', async () => {
  const p = await product(1, { variants: [{ label: 'TEST wariant', stock: 1 }] })
  const variantId = p.variants![0].id!
  const created = await checkout(payload, orderInput(p.id, { items: [{ id: p.id, qty: 1, variantId }] }))
  await transaction(payload, 'order-service', async req => {
    await payload.update({ collection: 'products', id: p.id, data: { variants: [], stock: null }, req })
    const order = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } }, req })).docs[0]
    await payload.update({ collection: 'orders', id: order.id, data: { expiresAt: '2000-01-01T00:00:00Z' }, req })
  })
  const other = await product(1)
  assert.ok((await checkout(payload, orderInput(other.id))).number)
  const expired = (await payload.find({ collection: 'orders', where: { number: { equals: created.number } } })).docs[0]
  assert.equal(expired.paymentStatus, 'expired'); assert.equal(expired.stockReleased, true); assert.equal(expired.paymentReviewRequired, true)
})
test('an outdated catalog edit cannot restore stock consumed by checkout', async () => {
  const p = await product(2)
  await checkout(payload, orderInput(p.id))
  await assert.rejects(payload.update({ collection: 'products', id: p.id, data: { short: 'Poprawiony opis', stock: 2 } }), /Stan magazynu zmienił/)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id })).stock, 1)
  await payload.update({ collection: 'products', id: p.id, data: { short: 'Poprawiony opis' } })
  assert.equal((await payload.findByID({ collection: 'products', id: p.id })).stock, 1)
})
test('private records cannot be read or forged through unprivileged local API', async () => {
  for (const collection of ['orders', 'signups', 'contacts', 'newsletter', 'payment-attempts', 'payment-events', 'outbox'] as const) await assert.rejects(payload.find({ collection, overrideAccess: false }), /not allowed|Forbidden|permissions|dostęp/i)
  await assert.rejects(payload.create({ collection: 'orders', overrideAccess: true, data: { number: 'FORGED', customerName: 'X', email: 'test@example.invalid', total: 0, privacyAccepted: true, termsAccepted: true } }), /zweryfikowanego/)
  await assert.rejects(payload.create({ collection: 'users', overrideAccess: true, data: { email: 'attacker@example.invalid', password: 'synthetic-attacker-password', role: 'admin' } }), /bootstrap/)
})
test('one remaining course place cannot be overbooked by concurrent signups', async () => {
  const course = await payload.create({ collection: 'courses', data: { name: 'TEST', slug: 'test-course', published: true } })
  const session = await payload.create({ collection: 'course-sessions', data: { title: 'TEST', course: course.id, startsAt: '2099-01-01T12:00:00.000Z', capacity: 1, published: true } })
  const input = { name: 'Test', email: 'signup@example.invalid', phone: '000000000', privacyAccepted: true, course: course.id, session: session.id }
  const results = await Promise.allSettled([signup(payload, input), signup(payload, { ...input, email: 'second-signup@example.invalid' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await payload.findByID({ collection: 'course-sessions', id: session.id })).reserved, 1)
})
test('newsletter requires explicit opt-in and supports confirmation, replay and unsubscribe', async () => {
  const address = 'newsletter@example.invalid'
  await assert.rejects(subscribe(payload, { email: address }), InputError)
  await subscribe(payload, { email: address, consent: true })
  const captured = (await payload.find({ collection: 'outbox', where: { recipient: { equals: address } }, depth: 0 })).docs[0].body
  const confirm = captured.match(/potwierdz\?token=([A-Za-z0-9_-]+)/)![1], unsubscribe = captured.match(/wypisz\?token=([A-Za-z0-9_-]+)/)![1]
  assert.equal((await payload.find({ collection: 'newsletter', where: { email: { equals: address } } })).docs[0].status, 'pending')
  await newsletterToken(payload, confirm, 'confirm'); await newsletterToken(payload, confirm, 'confirm')
  assert.equal((await payload.find({ collection: 'newsletter', where: { email: { equals: address } } })).docs[0].status, 'active')
  await newsletterToken(payload, unsubscribe, 'unsubscribe'); await newsletterToken(payload, unsubscribe, 'unsubscribe')
  assert.equal((await payload.find({ collection: 'newsletter', where: { email: { equals: address } } })).docs[0].status, 'unsubscribed')
  await assert.rejects(newsletterToken(payload, confirm, 'confirm'), InputError)
})

test('a committed checkout with a lost acknowledgement is reconciled before returning success', async () => {
  const p = await product(2), input = orderInput(p.id)
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = ((...args: Parameters<typeof original>) => original(...args).then(() => { throw new Error('Injected COMMIT acknowledgement failure') })) as typeof drizzle.transaction
  let recovered: Awaited<ReturnType<typeof checkout>>
  try { recovered = await checkout(payload, input) } finally { drizzle.transaction = original }
  assert.ok(recovered.paymentURL.startsWith('/platnosc-testowa?token='))
  const retried = await checkout(payload, input)
  assert.ok(retried.number)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 1)
  assert.equal((await payload.count({ collection: 'orders', where: { idempotencyKey: { equals: input.idempotencyKey } } })).totalDocs, 1)
})

// Make the next COMMIT genuinely fail: a deferred foreign key violation is
// checked by SQLite only at COMMIT, so the whole transaction must roll back.
function failNextCommit(productId: number) {
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = ((callback: any, options: any) => {
    drizzle.transaction = original
    return original(async (tx: any) => {
      await tx.run(sql`PRAGMA defer_foreign_keys = ON`)
      await callback(tx)
      await tx.run(sql`UPDATE products SET category_id = 2147483646 WHERE id = ${productId}`)
    }, options)
  }) as typeof drizzle.transaction
  return () => { drizzle.transaction = original }
}
const openSessions = () => activeWriteTransactionCount(payload.db)
async function quickWrite(label: string) {
  const started = Date.now()
  const doc = await payload.create({ collection: 'categories', overrideAccess: true, data: { name: `TEST ${label}`, slug: `test-${label}-${randomUUID()}`, published: false } })
  assert.ok(Date.now() - started < 1000, `${label} waited for a stale write lease`)
  return doc
}

test('an ordinary CMS write overlapping a held financial transaction neither stalls the event loop nor fails', async () => {
  const p = await product(5)
  let entered!: () => void, resume!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const hold = new Promise<void>(resolve => { resume = resolve })
  const financial = transaction(payload, 'order-service', async req => {
    await payload.update({ collection: 'products', id: p.id, data: { short: 'financial-1' }, req })
    entered(); await hold
    return (await payload.update({ collection: 'products', id: p.id, data: { short: 'financial-2' }, req })).short
  })
  await inside
  let ticks = 0
  const ticker = setInterval(() => { if (++ticks === 5) resume() }, 10)
  const started = Date.now()
  const cms = payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST overlap', slug: `test-overlap-${p.id}`, published: false } })
  const cmsUpdate = payload.update({ collection: 'products', id: p.id, overrideAccess: true, data: { name: 'TEST overlap edit' } })
  const fallback = setTimeout(resume, 2000)
  const results = await Promise.allSettled([financial, cms, cmsUpdate])
  clearInterval(ticker)
  clearTimeout(fallback)
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'fulfilled'], String(results.map(r => r.status === 'rejected' ? r.reason : '')))
  assert.ok(Date.now() - started < 2000, 'writes waited for the SQLite busy timeout')
  assert.ok(ticks >= 5, 'the event loop was blocked while the financial transaction was held')
  const stored = await payload.findByID({ collection: 'products', id: p.id, depth: 0 })
  assert.equal(stored.short, 'financial-2'); assert.equal(stored.name, 'TEST overlap edit')
  assert.equal(openSessions(), 0)
})
test('mixed concurrent CMS edits and checkouts all complete and keep stock exact', async () => {
  const p = await product(6)
  const work: Promise<unknown>[] = []
  for (let i = 0; i < 8; i++) {
    work.push(checkout(payload, orderInput(p.id)))
    work.push(payload.create({ collection: 'categories', overrideAccess: true, data: { name: `TEST mixed ${i}`, slug: `test-mixed-${p.id}-${i}`, published: false } }))
    work.push(payload.update({ collection: 'products', id: p.id, overrideAccess: true, data: { short: `mixed ${i}` } }))
  }
  const results = await Promise.allSettled(work)
  const failures = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason)
  // Six units: six checkouts succeed, two are rejected as out of stock, CMS writes never fail.
  assert.ok(failures.every(error => error instanceof InputError), String(failures.find(error => !(error instanceof InputError))))
  assert.equal(failures.length, 2)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 0)
  assert.equal((await payload.count({ collection: 'orders', where: { 'items.product': { equals: p.id } } })).totalDocs, 6)
  assert.equal((await payload.count({ collection: 'categories', where: { slug: { contains: `test-mixed-${p.id}-` } } })).totalDocs, 8)
  assert.equal(openSessions(), 0)
})
test('a failed COMMIT of an ordinary CMS write is reported and nothing is persisted', async () => {
  const p = await product(1), slug = `test-commit-failure-${p.id}`
  const restore = failNextCommit(p.id)
  try { await assert.rejects(payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST commit failure', slug, published: false } }), /FOREIGN KEY/) }
  finally { restore() }
  assert.equal((await payload.count({ collection: 'categories', where: { slug: { equals: slug } } })).totalDocs, 0)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).category, category)
  assert.equal(openSessions(), 0)
  await quickWrite('after-cms-commit-failure')
})
test('a failed COMMIT of a financial transaction rolls back every write and releases the lease', async () => {
  const p = await product(2), input = orderInput(p.id)
  const restore = failNextCommit(p.id)
  try { await assert.rejects(checkout(payload, input), /FOREIGN KEY/) } finally { restore() }
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 2)
  assert.equal((await payload.count({ collection: 'orders', where: { idempotencyKey: { equals: input.idempotencyKey } } })).totalDocs, 0)
  assert.equal(openSessions(), 0)
  assert.ok((await checkout(payload, input)).number)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 1)
})
test('failed BEGIN and failed ROLLBACK release the write lease without dangling sessions', async () => {
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = (() => Promise.reject(new Error('Injected BEGIN failure'))) as typeof drizzle.transaction
  try { await assert.rejects(payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST begin', slug: 'test-begin-failure', published: false } }), /Injected BEGIN failure/) }
  finally { drizzle.transaction = original }
  assert.equal(openSessions(), 0)
  await quickWrite('after-begin-failure')
  drizzle.transaction = ((...args: Parameters<typeof original>) => original(...args).catch(() => { throw new Error('Injected ROLLBACK failure') })) as typeof drizzle.transaction
  try { await assert.rejects(transaction(payload, 'order-service', async () => { throw new InputError('Rolled back on purpose') }), InputError) }
  finally { drizzle.transaction = original }
  assert.equal(openSessions(), 0)
  await quickWrite('after-rollback-failure')
})
test('an independent write started inside a held transaction fails fast instead of deadlocking', async () => {
  const started = Date.now()
  await assert.rejects(transaction(payload, 'order-service', async () => {
    await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST nested', slug: 'test-nested-without-req', published: false } })
  }), /pass the caller req/)
  assert.ok(Date.now() - started < 1000)
  assert.equal((await payload.count({ collection: 'categories', where: { slug: { equals: 'test-nested-without-req' } } })).totalDocs, 0)
  assert.equal(openSessions(), 0)
  await quickWrite('after-nested')
})
test('a write without req behind a CMS-held transaction fails after the lease wait; the holder still commits', async () => {
  // A CMS hook or email transport writing without the operation req cannot be
  // recognised as nested; it must end in a bounded error, never a hang.
  const id = String(await payload.db.beginTransaction())
  const req = await createLocalReq({}, payload)
  req.transactionID = id
  const held = await payload.create({ collection: 'categories', req, overrideAccess: true, data: { name: 'TEST held', slug: `test-held-${id}`, published: false } })
  const lease = writeLease(payload.db), previous = lease.waitTimeoutMs
  lease.waitTimeoutMs = 300
  try { await assert.rejects(payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST waiter', slug: `test-waiter-${id}`, published: false } }), WriteLeaseTimeout) }
  finally { lease.waitTimeoutMs = previous }
  await payload.db.commitTransaction(id)
  assert.equal((await payload.findByID({ collection: 'categories', id: held.id })).slug, `test-held-${id}`)
  assert.equal((await payload.count({ collection: 'categories', where: { slug: { equals: `test-waiter-${id}` } } })).totalDocs, 0)
  assert.equal(openSessions(), 0)
  await assert.rejects(payload.db.commitTransaction(id), /no longer open/)
  await quickWrite('after-lease-timeout')
})
test('an abandoned transaction is rolled back after the hold limit and cannot be committed later', async () => {
  const lease = writeLease(payload.db), previous = lease.maxHoldMs
  lease.maxHoldMs = 100
  let id: string
  try { id = String(await payload.db.beginTransaction()) } finally { lease.maxHoldMs = previous }
  const req = await createLocalReq({}, payload)
  req.transactionID = id
  await payload.create({ collection: 'categories', req, overrideAccess: true, data: { name: 'TEST abandoned', slug: `test-abandoned-${id}`, published: false } })
  // This writer queues behind the abandoned session and proceeds once the watchdog frees the lease.
  await quickWrite('behind-abandoned')
  // The late owner must not fall back to autocommit writes.
  await assert.rejects(payload.create({ collection: 'categories', req, overrideAccess: true, data: { name: 'TEST late', slug: `test-late-${id}`, published: false } }), /rolled back after being held/)
  await assert.rejects(payload.db.commitTransaction(id), /no longer open|rolled back after being held/)
  assert.equal(openSessions(), 0)
  for (const slug of [`test-abandoned-${id}`, `test-late-${id}`]) assert.equal((await payload.count({ collection: 'categories', where: { slug: { equals: slug } } })).totalDocs, 0)
  await quickWrite('after-abandoned')
})

type WorkerResult = { ok: boolean; error?: string; status?: number; beginWaitMs?: number }
function checkoutWorker() {
  const bootstrap = fileURLToPath(new URL('./transaction-worker-bootstrap.mjs', import.meta.url))
  const child = spawn(process.execPath, [bootstrap, workerFile], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  if (!child.stdout || !child.stderr) { child.kill('SIGKILL'); throw new Error('Synthetic checkout worker requires output pipes.') }
  const stdout = child.stdout, stderr = child.stderr
  let output = '', errors = '', closed = false, terminalError: Error | undefined
  const waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  const observed = new Set<string>()
  child.on('message', (message: any) => { if (typeof message?.kind === 'string') { observed.add(message.kind); waiters.get(message.kind)?.resolve(); waiters.delete(message.kind) } })
  const event = (kind: string) => terminalError || closed ? Promise.reject(terminalError || new Error('Synthetic worker already closed.')) : observed.has(kind) ? Promise.resolve() : new Promise<void>((resolve, reject) => { waiters.set(kind, { resolve, reject }) })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
  const result = new Promise<WorkerResult>((resolve, reject) => {
    stdout.on('data', data => { output += data.toString() })
    stderr.on('data', data => { errors += data.toString() })
    child.on('error', error => { terminalError = error; for (const waiter of waiters.values()) waiter.reject(error); reject(error) })
    child.on('close', code => {
      closed = true; clearTimeout(timeout)
      const failure = new Error('Isolated checkout worker failed or closed before its barrier: ' + errors.slice(-300))
      terminalError ||= failure
      for (const waiter of waiters.values()) waiter.reject(failure)
      waiters.clear()
      if (code !== 0) { reject(failure); return }
      const line = output.split('\n').find(line => line.startsWith('{"ok":'))
      if (!line) { reject(new Error('Worker returned no result.')); return }
      try {
        const value = JSON.parse(line)
        if (typeof value?.ok !== 'boolean') throw new Error('Invalid synthetic worker result.')
        resolve(value)
      } catch { reject(new Error('Invalid synthetic worker result.')) }
    })
  })
  // Attach rejection handling before readiness so failures cannot be unhandled.
  const settled = result.then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }))
  return { event, result: settled, send: (message: unknown) => child.send(message as any), stop: () => { if (!closed) child.kill('SIGKILL') } }
}
test('independent application processes cannot sell the same last stock unit', async () => {
  const p = await product(1)
  const holder = checkoutWorker(), contender = checkoutWorker()
  let settled: Awaited<typeof holder.result>[]
  try {
    await Promise.all([holder.event('ready'), contender.event('ready')])
    holder.send({ kind: 'start', hold: true, input: orderInput(p.id) })
    await holder.event('locked')
    contender.send({ kind: 'start', hold: false, input: orderInput(p.id) })
    await contender.event('contending')
    // Both are initialised; the contender enters BEGIN while the holder owns
    // SQLite's real write lock. Release is an IPC command, not another process.
    await new Promise(resolve => setTimeout(resolve, 100))
    holder.send({ kind: 'release' })
    settled = await Promise.all([holder.result, contender.result])
  } finally {
    holder.stop(); contender.stop()
    await Promise.all([holder.result, contender.result])
  }
  for (const result of settled) if (result.status === 'rejected') throw result.reason
  const results = settled.map(result => { assert.equal(result.status, 'fulfilled'); return result.value })
  assert.equal(results.filter(r => r.ok).length, 1)
  const rejected = results.find(r => !r.ok)!
  assert.deepEqual({ ok: rejected.ok, error: rejected.error, status: rejected.status }, { ok: false, error: 'InputError', status: 409 })
  assert.ok(Number.isFinite(rejected.beginWaitMs) && rejected.beginWaitMs! >= 80, 'The contender must actually wait for the holder write lock.')
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 0)
  assert.equal((await payload.count({ collection: 'orders', where: { 'items.product': { equals: p.id } } })).totalDocs, 1)
})

test('a barrier registered after its worker closes rejects instead of waiting forever', async () => {
  const worker = checkoutWorker()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await worker.event('ready')
    worker.stop()
    await worker.result
    const deadline = new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Late worker event remained unresolved.')), 1000) })
    await assert.rejects(Promise.race([worker.event('locked'), deadline]), /closed/)
  } finally {
    if (timer) clearTimeout(timer)
    worker.stop(); await worker.result
  }
})

// Next compiles configuration, instrumentation, RSC and route handlers into
// separate module instances. Payload still caches one adapter in this process.
const splitAdapter = () => import(new URL('../src/lib/sqlite-adapter.ts?underwater-split-module-regression', import.meta.url).href) as Promise<typeof import('../src/lib/sqlite-adapter')>
test('split module instances recognize the same registered Payload adapter', async () => {
  const split = await splitAdapter()
  assert.notEqual(split.writeLease, writeLease, 'The fixture must evaluate a separate module instance.')
  assert.equal(split.writeLease(payload.db), writeLease(payload.db))
  assert.notEqual(split.activeWriteTransactionCount, activeWriteTransactionCount)
  assert.equal(split.activeWriteTransactionCount(payload.db), 0)
  const id = String(await payload.db.beginTransaction())
  try {
    assert.equal(activeWriteTransactionCount(payload.db), 1)
    assert.equal(split.activeWriteTransactionCount(payload.db), 1)
  } finally { await payload.db.rollbackTransaction(id) }
  assert.equal(activeWriteTransactionCount(payload.db), 0)
  assert.equal(split.activeWriteTransactionCount(payload.db), 0)
})

test('split module instances share the held transaction context and refuse nested BEGIN', async () => {
  const split = await splitAdapter()
  assert.notEqual(split.holdingTransaction, holdingTransaction)
  let unexpectedlyOpened: string | number | undefined
  try {
    await assert.rejects(split.holdingTransaction(async () => {
      const id = await payload.db.beginTransaction()
      if (id != null) unexpectedlyOpened = id
    }), /inside a held transaction/)
  } finally {
    if (unexpectedlyOpened !== undefined) await payload.db.rollbackTransaction(unexpectedlyOpened)
  }
  assert.equal(openSessions(), 0)
  await quickWrite('after-split-context')
})

test('enquiries store trusted published product context and reject draft or malformed references', async () => {
  const p = await product(0, { name: 'TEST pytanie o produkt' })
  const input = { name: 'TEST pytający', email: 'context@example.invalid', message: 'Pytanie o dostępność', privacyAccepted: true, contextKind: 'product', contextID: String(p.id), contextTitle: 'Nieufny tytuł klienta', contextPath: 'https://example.invalid' }
  await contact(payload, input)
  const record = (await payload.find({ collection: 'contacts', where: { email: { equals: input.email } }, depth: 0 })).docs[0]
  assert.equal(record.contextKind, 'product'); assert.equal(record.contextID, p.id)
  assert.equal(record.contextTitle, p.name); assert.equal(record.contextPath, `/${p.slug}.html`)
  const draft = await product(0, { published: false })
  const before = (await payload.count({ collection: 'contacts' })).totalDocs
  for (const changes of [{ contextID: draft.id }, { contextID: '../1' }, { contextID: 1.5 }, { contextKind: 'users' }, { contextKind: '', contextID: '1' }]) await assert.rejects(contact(payload, { ...input, ...changes }), InputError)
  assert.equal((await payload.count({ collection: 'contacts' })).totalDocs, before)
})

test('catalog search matches Polish Unicode casing, normalized text and SKU without trusting a supplied index', async () => {
  const p = await product(1, { name: 'ŁĄCZNIK ŻÓŁTY', manufacturer: 'ŹRÓDŁO', sku: 'SKU-TEST-Ł', searchText: 'untrusted supplied index' })
  const { catalogSearchText } = await import('../src/lib/catalog-search')
  for (const query of ['łącznik', 'ŻÓŁTY'.normalize('NFD'), 'źródło', 'sku-test-ł']) {
    const result = await payload.find({ collection: 'products', where: { and: [{ id: { equals: p.id } }, { searchText: { like: catalogSearchText(query) } }] }, depth: 0, overrideAccess: false })
    assert.equal(result.totalDocs, 1, query)
  }
  assert.equal(p.searchText, 'łącznik żółty źródło sku-test-ł')
  await payload.update({ collection: 'products', id: p.id, data: { name: 'ĄŻUR', searchText: 'forged index' } })
  const changed = await payload.findByID({ collection: 'products', id: p.id })
  assert.match(changed.searchText || '', /^ążur /)
  assert.doesNotMatch(changed.searchText || '', /forged|łącznik/)
})


test('the additive search migration backfills existing Polish catalog facts unchanged', async () => {
  const p = await product(2, { name: 'ŁĄCZNIK ĄŻUR', manufacturer: 'ŹRÓDŁO', sku: 'TEST-Ł', price: 12.34, priceCents: 1234 })
  const original = await payload.findByID({ collection: 'products', id: p.id, depth: 0 })
  const drizzle = payload.db.drizzle
  await drizzle.run(sql`ALTER TABLE products DROP COLUMN search_text`)
  const { up, down } = await import('../src/migrations/20261009_005425_underwater_unicode_catalog_search')
  await up({ db: drizzle } as never)
  const changed = await payload.findByID({ collection: 'products', id: p.id, depth: 0 })
  assert.equal(changed.searchText, 'łącznik ążur źródło test-ł')
  const { searchText: _before, ...before } = original
  const { searchText: _after, ...after } = changed
  assert.deepEqual(after, before)
  await assert.rejects(down(), /Destructive rollback is disabled/)
})
