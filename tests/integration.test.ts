import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { sql } from '@payloadcms/db-sqlite'
import { checkout, paymentSummary, simulatePayment, acceptNotification, expireReservations } from '../src/lib/commerce/order'
import { hash, InputError } from '../src/lib/commerce/input'
import { TestPaymentProvider } from '../src/lib/commerce/provider'
import { transaction } from '../src/lib/commerce/transaction'
import { writeLease, WriteLeaseTimeout } from '../src/lib/sqlite-adapter'
import { contact, signup, subscribe, newsletterToken } from '../src/lib/forms/service'
import { confirmSignup, expireSignups } from '../src/lib/forms/reservations'
import { adjustInventory, updateOperationalStatus } from '../src/lib/operations'

const root = mkdtempSync(path.join(tmpdir(), 'underwater-integration-'))
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
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  category = (await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST', slug: 'test', published: true } })).id
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

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
  assert.equal((await payload.count({ collection: 'audit-events', where: { targetId: { equals: order.id } } })).totalDocs, 2)
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
  const raw = JSON.stringify({ eventKey: randomUUID(), reference: attempt.reference, amountCents: 1, currency: 'PLN', outcome: 'paid' })
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

test('a failed transaction completion cannot return a successful checkout', async () => {
  const p = await product(2), input = orderInput(p.id)
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = ((...args: Parameters<typeof original>) => original(...args).then(() => { throw new Error('Injected COMMIT acknowledgement failure') })) as typeof drizzle.transaction
  try { await assert.rejects(checkout(payload, input), /acknowledgement failure/) } finally { drizzle.transaction = original }
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
const openSessions = () => Object.keys(payload.db.sessions || {}).length
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

// Under heavy machine load the tsx module hooks occasionally let a process exit
// 0 before its module graph settles (seen with the stock adapter too). Such a
// worker printed nothing; rerunning it with the same idempotency key is safe.
async function childCheckout(input: ReturnType<typeof orderInput>): Promise<{ ok: boolean }> {
  for (let attempt = 1; ; attempt++) {
    try { return await childCheckoutOnce(input) }
    catch (error) { if (attempt === 4 || !(error instanceof Error && error.message.startsWith('Worker returned no result'))) throw error }
  }
}
function childCheckoutOnce(input: ReturnType<typeof orderInput>): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    // Load tsx as a hook in the worker itself: the tsx CLI relay process
    // intermittently exited 0 before the worker printed its result.
    const worker = fileURLToPath(new URL('./transaction-worker.ts', import.meta.url))
    const child = spawn(process.execPath, ['--import', 'tsx', worker], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', errors = ''
    child.stdout.on('data', data => { output += data.toString() })
    child.stderr.on('data', data => { errors += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) { reject(new Error('Isolated checkout worker failed: ' + errors.slice(-300))); return }
      const line = output.split('\n').find(line => line.startsWith('{"ok":'))
      if (!line) { reject(new Error('Worker returned no result: ' + (output + errors).slice(-600))); return }
      resolve(JSON.parse(line))
    })
    child.stdin.end(JSON.stringify(input))
  })
}
test('independent application processes cannot sell the same last stock unit', async () => {
  const p = await product(1)
  const results = await Promise.all([childCheckout(orderInput(p.id)), childCheckout(orderInput(p.id))])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal((await payload.findByID({ collection: 'products', id: p.id, depth: 0 })).stock, 0)
  assert.equal((await payload.count({ collection: 'orders', where: { 'items.product': { equals: p.id } } })).totalDocs, 1)
})
