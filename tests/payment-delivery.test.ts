import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPayload, type Payload, type TypedUser } from 'payload'
import { checkout, expireReservations, formatCents, orderMailBody, paymentSummary, simulatePayment, acceptNotification } from '../src/lib/commerce/order'
import { checkoutConfig, checkoutConfigProblems, quote } from '../src/lib/commerce/quote'
import { hash, InputError } from '../src/lib/commerce/input'
import { TestPaymentProvider } from '../src/lib/commerce/provider'
import { transaction } from '../src/lib/commerce/transaction'
import { updateOperationalStatus } from '../src/lib/operations'

// Synthetic, isolated environment only: temporary SQLite file and media folder, no network.
const root = mkdtempSync(path.join(tmpdir(), 'underwater-payment-delivery-'))
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-payment-delivery-test-secret-not-runtime' })
delete process.env.UNDERWATER_ORIGIN
let payload: Payload
let category: number
let operator: TypedUser
let editor: TypedUser
const OFFLINE_MINUTES = 2880
const settings = {
  deliveryMethods: [
    { key: 'test-courier', label: 'TEST kurier — bez nadania', priceCents: 1500, enabled: true, kind: 'courier' as const, codAllowed: true },
    { key: 'test-point', label: 'TEST punkt — wpisany ręcznie', priceCents: 999, enabled: true, kind: 'pickup_point' as const, codAllowed: false },
    { key: 'test-pickup', label: 'TEST odbiór osobisty', priceCents: 0, enabled: true, kind: 'pickup' as const, codAllowed: false },
  ],
  freeShippingThresholdCents: 5000,
  testPayments: { bankTransferEnabled: true, codEnabled: true, offlineReservationMinutes: OFFLINE_MINUTES, codSurchargeCents: 700 },
}
const point = { id: 'TEST-PT-01', name: 'TEST punkt syntetyczny', address: 'ul. Testowa 1, 00-000 Test' }
const tokenFrom = (url: string) => new URL(url, 'http://localhost:3011').searchParams.get('token')!
const input = (id: number, changes: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), customerName: 'TEST płatności', email: 'payment-delivery@example.invalid', phone: '000000000', address: 'Adres syntetyczny 1', items: [{ id, qty: 1, price: 0.01 }], deliveryMethod: 'test-courier', privacyAccepted: true, termsAccepted: true, ...changes })
const status = (error: unknown) => error instanceof InputError ? error.status : 0
const rejectsWith = (promise: Promise<unknown>, code: number, pattern?: RegExp) => assert.rejects(promise, (error: unknown) => status(error) === code && (!pattern || pattern.test((error as Error).message)))
async function product(stock: number) {
  const id = Math.floor(Math.random() * 1e8)
  return payload.create({ collection: 'products', overrideAccess: true, data: { vmId: id, name: `TEST — nie do sprzedaży ${id}`, slug: `test-${id}`, category, price: 10, priceCents: 1000, stock, published: true } })
}
const stock = async (id: number) => (await payload.findByID({ collection: 'products', id, depth: 0 })).stock
const orderOf = async (number: string) => (await payload.find({ collection: 'orders', where: { number: { equals: number } }, depth: 0 })).docs[0]
const expire = (minutesFromNow: number) => transaction(payload, 'reservation-service', req => expireReservations(payload, req, new Date(Date.now() + minutesFromNow * 60_000)))
const operate = (user: TypedUser, id: number, command: string) => updateOperationalStatus(payload, user, { collection: 'orders', id, status: command })

test.before(async () => {
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  category = (await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST', slug: 'test', published: true } })).id
  const create = (role: 'operations' | 'editor') => payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, data: { email: `${role}-payment@example.invalid`, password: 'synthetic-password-for-tests-only', role } })
  operator = { ...await create('operations'), collection: 'users' } as TypedUser
  editor = { ...await create('editor'), collection: 'users' } as TypedUser
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

test('offline methods stay disabled without explicit settings; online keeps the existing fallback', async () => {
  const p = await product(2)
  const current = await quote(payload, [{ id: p.id, qty: 1 }])
  assert.deepEqual(current.paymentMethods.map(m => m.id), ['online'])
  assert.equal(current.deliveryMethod, 'test-pickup'); assert.equal(current.paymentMethod, 'online'); assert.equal(current.totalCents, 1000)
  await rejectsWith(quote(payload, [{ id: p.id, qty: 1 }], undefined, undefined, 'bank_transfer'), 409, /wyłączona/)
  await rejectsWith(quote(payload, [{ id: p.id, qty: 1 }], undefined, undefined, 'cod'), 409)
  await rejectsWith(quote(payload, [{ id: p.id, qty: 1 }], undefined, undefined, 'paypal'), 400, /Nieznana/)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-pickup', paymentMethod: 'bank_transfer' })), 409)
  assert.equal(await stock(p.id), 2)
  // Inconsistent stored values fail closed instead of inventing a reservation period.
  assert.deepEqual(checkoutConfig({ testPayments: { bankTransferEnabled: true, codEnabled: true } }).payments.map(m => m.id), ['online'])
  assert.deepEqual(checkoutConfig({ testPayments: { bankTransferEnabled: true, offlineReservationMinutes: 30 } }).payments.map(m => m.id), ['online'])
  assert.equal(checkoutConfig({ testPayments: { bankTransferEnabled: true, offlineReservationMinutes: Number.POSITIVE_INFINITY } }).offlineReservationMinutes, null)
})

test('settings reject offline payments without a bounded reservation and invalid amounts', async () => {
  for (const [label, changes] of [
    ['missing minutes', { testPayments: { ...settings.testPayments, offlineReservationMinutes: null } }],
    ['accidental 30 minutes', { testPayments: { ...settings.testPayments, offlineReservationMinutes: 30 } }],
    ['over 14 days', { testPayments: { ...settings.testPayments, offlineReservationMinutes: 20_161 } }],
    ['fractional surcharge', { testPayments: { ...settings.testPayments, codSurchargeCents: 1.5 } }],
    ['zero threshold', { freeShippingThresholdCents: 0 }],
    ['cod for personal pickup', { deliveryMethods: [{ ...settings.deliveryMethods[2], codAllowed: true }] }],
  ] as Array<[string, object]>) await assert.rejects(payload.updateGlobal({ slug: 'settings', data: { ...settings, ...changes } as typeof settings }), /rezerwac|Rezerwac|groszy|pobranie|Pobranie|Próg/, label)
  assert.deepEqual(checkoutConfigProblems(settings), [])
  await payload.updateGlobal({ slug: 'settings', data: settings })
})

test('COD and payment compatibility is enforced on the server for quote and checkout', async () => {
  const p = await product(3)
  const forPoint = await quote(payload, [{ id: p.id, qty: 1 }], 'test-point')
  assert.deepEqual(forPoint.paymentMethods.map(m => m.id), ['online', 'bank_transfer'])
  assert.equal(forPoint.pickupPointRequired, true); assert.equal(forPoint.addressRequired, false)
  await rejectsWith(quote(payload, [{ id: p.id, qty: 1 }], 'test-pickup', undefined, 'cod'), 409, /niedostępna|nie jest dostępna/)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-point', paymentMethod: 'cod', pickupPoint: point })), 409)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-courier', paymentMethod: 'blik' })), 400)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-unknown' })), 400)
  assert.equal(await stock(p.id), 3)
  assert.equal((await payload.count({ collection: 'orders', where: { 'items.product': { equals: p.id } } })).totalDocs, 0)
})

test('pickup point and address requirements follow the delivery kind', async () => {
  const p = await product(5)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-point' })), 400, /punkt odbioru/)
  for (const bad of [{ ...point, id: '' }, { ...point, id: 'PT 01' }, { ...point, id: 'x'.repeat(41) }, { ...point, name: 'n'.repeat(121) }, { ...point, address: '' }, { ...point, address: 'a'.repeat(301) }, { ...point, name: 'A\u0000B' }, [point], 'TEST-PT-01'])
    await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-point', pickupPoint: bad })), 400)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-courier', pickupPoint: point })), 400, /tylko dostawy do punktu/)
  await rejectsWith(checkout(payload, input(p.id, { deliveryMethod: 'test-courier', address: '' })), 400, /adres/)
  assert.equal(await stock(p.id), 5)
  const pickup = await checkout(payload, input(p.id, { deliveryMethod: 'test-pickup', address: '' }))
  assert.equal((await orderOf(pickup.number)).deliveryKind, 'pickup')
  const created = await checkout(payload, input(p.id, { deliveryMethod: 'test-point', address: '', pickupPoint: point }))
  const order = await orderOf(created.number)
  assert.deepEqual([order.deliveryKind, order.pickupPointId, order.pickupPointName, order.pickupPointAddress], ['pickup_point', point.id, point.name, point.address])
})

test('changing payment method or pickup point under the same key is a conflict', async () => {
  const p = await product(4)
  const first = input(p.id, { deliveryMethod: 'test-point', paymentMethod: 'bank_transfer', address: '', pickupPoint: point })
  const created = await checkout(payload, first)
  assert.equal((await checkout(payload, first)).number, created.number)
  await rejectsWith(checkout(payload, { ...first, pickupPoint: { ...point, id: 'TEST-PT-02' } }), 409)
  await rejectsWith(checkout(payload, { ...first, paymentMethod: 'online' }), 409)
  await rejectsWith(checkout(payload, { ...first, deliveryMethod: 'test-courier', pickupPoint: undefined, address: 'Adres syntetyczny 1' }), 409)
  assert.equal(await stock(p.id), 3)
})

test('surcharge, free-shipping threshold and expected total are priced and stored by the server', async () => {
  const p = await product(20)
  const below = await quote(payload, [{ id: p.id, qty: 4 }], 'test-courier', undefined, 'cod')
  assert.deepEqual([below.subtotalCents, below.deliveryCents, below.paymentSurchargeCents, below.totalCents, below.freeShippingApplied], [4000, 1500, 700, 6200, false])
  const at = await quote(payload, [{ id: p.id, qty: 5 }], 'test-courier', undefined, 'cod')
  assert.deepEqual([at.deliveryBaseCents, at.deliveryCents, at.paymentSurchargeCents, at.totalCents, at.freeShippingApplied], [1500, 0, 700, 5700, true])
  assert.equal((await quote(payload, [{ id: p.id, qty: 4 }], 'test-courier', undefined, 'bank_transfer')).totalCents, 5500)
  await rejectsWith(checkout(payload, input(p.id, { items: [{ id: p.id, qty: 4 }], paymentMethod: 'cod', expectedTotalCents: 5500 })), 409, /zmieniły/)
  const created = await checkout(payload, input(p.id, { items: [{ id: p.id, qty: 4 }], paymentMethod: 'cod', expectedTotalCents: 6200 }))
  // A later settings change must not reprice an accepted order.
  await payload.updateGlobal({ slug: 'settings', data: { ...settings, testPayments: { ...settings.testPayments, codSurchargeCents: 900 } } })
  const order = await orderOf(created.number)
  await payload.updateGlobal({ slug: 'settings', data: settings })
  assert.deepEqual([order.subtotalCents, order.deliveryBaseCents, order.deliveryCents, order.paymentSurchargeCents, order.totalCents, order.freeShippingThresholdCents, order.paymentMethod, order.reservationMinutes], [4000, 1500, 1500, 700, 6200, 5000, 'cod', OFFLINE_MINUTES])
  await assert.rejects(transaction(payload, 'order-service', req => payload.update({ collection: 'orders', id: order.id, data: { paymentMethod: 'online' }, req })), /niezmienne/)
  await assert.rejects(transaction(payload, 'order-service', req => payload.update({ collection: 'orders', id: order.id, data: { totalCents: 1 }, req })), /niezmienne/)
  await assert.rejects(transaction(payload, 'order-service', req => payload.update({ collection: 'orders', id: order.id, data: { items: order.items!.map(item => ({ ...item, qty: 1 })) }, req })), /niezmienne/)
  await assert.rejects(transaction(payload, 'order-service', req => payload.update({ collection: 'orders', id: order.id, data: { termsAccepted: false }, req })), /niezmienne/)
  assert.equal((await orderOf(created.number)).totalCents, 6200)
})

test('captured order mail has two-decimal amounts, items, snapshot and a server-origin private link', async () => {
  const p = await product(2)
  const created = await checkout(payload, input(p.id, { deliveryMethod: 'test-point', paymentMethod: 'bank_transfer', address: '', pickupPoint: point }))
  const token = tokenFrom(created.paymentURL)
  const order = await orderOf(created.number)
  const mail = (await payload.find({ collection: 'outbox', where: { deduplicationKey: { equals: `order:${order.id}` } }, depth: 0 })).docs[0]
  assert.match(mail.body, /Razem: 19,99 PLN/); assert.match(mail.body, /Dostawa: TEST punkt — wpisany ręcznie: 9,99 PLN/)
  assert.match(mail.body, new RegExp(`- ${order.items![0].productName} × 1: 10,00 PLN`))
  assert.ok(mail.body.includes(`${point.id} — ${point.name}, ${point.address}`))
  assert.ok(mail.body.includes(`http://localhost:3011/platnosc-testowa?token=${token}`))
  assert.match(mail.body, /nie podaje numeru rachunku/)
  assert.doesNotMatch(mail.body, /\d{26}|PL\d{2}\s?\d{4}/)
  assert.equal(mail.status, 'captured')
  assert.equal(formatCents(5), '0,05 PLN'); assert.equal(formatCents(123456), '1234,56 PLN')
  assert.match(orderMailBody({ ...order, paymentMethod: 'cod', paymentSurchargeCents: 700 }, 'http://localhost:3011/x'), /Dopłata za pobranie: 7,00 PLN/)
})

test('offline reservation outlives the online 30 minutes and releases exactly once at its own expiry', async () => {
  const p = await product(1)
  const online = await product(1)
  const bank = await checkout(payload, input(p.id, { paymentMethod: 'bank_transfer' }))
  const card = await checkout(payload, input(online.id))
  const bankOrder = await orderOf(bank.number), cardOrder = await orderOf(card.number)
  const minutes = (order: typeof bankOrder) => Math.round((Date.parse(order.expiresAt!) - Date.parse(order.createdAt)) / 60_000)
  assert.equal(minutes(bankOrder), OFFLINE_MINUTES); assert.equal(minutes(cardOrder), 30)
  await expire(31)
  assert.equal((await orderOf(bank.number)).paymentStatus, 'pending'); assert.equal(await stock(p.id), 0)
  assert.equal((await orderOf(card.number)).paymentStatus, 'expired'); assert.equal(await stock(online.id), 1)
  await expire(OFFLINE_MINUTES + 1); await expire(OFFLINE_MINUTES + 2)
  assert.equal((await orderOf(bank.number)).paymentStatus, 'expired'); assert.equal(await stock(p.id), 1)
  await rejectsWith(operate(operator, bankOrder.id, 'bank-paid'), 409)
  assert.equal(await stock(p.id), 1)
})

test('the public link and signed online path cannot mark an offline order paid or failed', async () => {
  const p = await product(1)
  const created = await checkout(payload, input(p.id, { paymentMethod: 'bank_transfer' }))
  const token = tokenFrom(created.paymentURL)
  await rejectsWith(simulatePayment(payload, token, 'paid'), 403)
  await rejectsWith(simulatePayment(payload, token, 'failed'), 403)
  const order = await orderOf(created.number)
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, depth: 0 })).docs[0]
  assert.equal(attempt.provider, 'manual-test')
  const provider = new TestPaymentProvider(process.env.PAYLOAD_SECRET!)
  const raw = JSON.stringify({ eventKey: randomUUID(), reference: attempt.reference, amountCents: order.totalCents, currency: 'PLN', outcome: 'paid' })
  await assert.rejects(acceptNotification(payload, provider.verify(raw, provider.sign(raw)), hash(raw)), InputError)
  assert.equal((await paymentSummary(payload, token)).status, 'pending')
  assert.equal((await payload.count({ collection: 'payment-events', where: { attempt: { equals: attempt.id } } })).totalDocs, 0)
  // The holder may withdraw the order; repeating it releases stock once.
  assert.equal((await simulatePayment(payload, token, 'cancelled')).status, 'cancelled')
  assert.equal((await simulatePayment(payload, token, 'cancelled')).status, 'cancelled')
  assert.equal(await stock(p.id), 1)
  await rejectsWith(operate(operator, order.id, 'bank-paid'), 409)
})

test('authenticated bank confirmation is role-checked, audited, single and precedes test shipment', async () => {
  const p = await product(2)
  const created = await checkout(payload, input(p.id, { paymentMethod: 'bank_transfer' }))
  const order = await orderOf(created.number)
  await assert.rejects(operate(editor, order.id, 'bank-paid'), /uprawnień/)
  await rejectsWith(operate(operator, order.id, 'shipped'), 409, /opłaconego/)
  await rejectsWith(operate(operator, order.id, 'cod-collected'), 409)
  const result = await operate(operator, order.id, 'bank-paid')
  assert.equal(result.ok, true)
  const paid = await orderOf(created.number)
  assert.deepEqual([paid.status, paid.paymentStatus, !!paid.paidAt], ['paid', 'paid', true])
  const audit = (await payload.find({ collection: 'audit-events', where: { and: [{ targetCollection: { equals: 'orders' } }, { targetId: { equals: order.id } }] }, depth: 0 })).docs
  assert.equal(audit.length, 1); assert.equal(audit[0].command, 'confirm-bank-paid'); assert.equal(audit[0].actor, operator.id)
  assert.deepEqual(JSON.parse(audit[0].beforeStatus!), { status: 'new', paymentStatus: 'pending' })
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, depth: 0 })).docs[0]
  assert.equal(attempt.status, 'paid')
  const events = (await payload.find({ collection: 'payment-events', where: { attempt: { equals: attempt.id } }, depth: 0 })).docs
  assert.equal(events.length, 1); assert.equal(events[0].reason, `operator:${operator.id}:bank-paid`)
  await rejectsWith(operate(operator, order.id, 'bank-paid'), 409)
  await rejectsWith(operate(operator, order.id, 'cancelled'), 409, /zwrotu/)
  await operate(operator, order.id, 'shipped')
  assert.equal((await orderOf(created.number)).status, 'shipped')
  assert.equal(await stock(p.id), 1)
})

test('cash on delivery: authorized test shipment, then collection; shipped orders cannot be cancelled or expire', async () => {
  const p = await product(2)
  const created = await checkout(payload, input(p.id, { paymentMethod: 'cod' }))
  const token = tokenFrom(created.paymentURL)
  const order = await orderOf(created.number)
  assert.equal(order.totalCents, 1000 + 1500 + 700)
  await rejectsWith(operate(operator, order.id, 'cod-collected'), 409, /po testowym nadaniu/)
  await rejectsWith(operate(operator, order.id, 'bank-paid'), 409)
  await assert.rejects(operate(editor, order.id, 'shipped'), /uprawnień/)
  await operate(operator, order.id, 'shipped')
  const shipped = await orderOf(created.number)
  assert.deepEqual([shipped.status, shipped.paymentStatus, shipped.expiresAt, !!shipped.shippedAt], ['shipped', 'pending', null, true])
  await rejectsWith(operate(operator, order.id, 'shipped'), 409)
  await expire(OFFLINE_MINUTES * 10)
  assert.equal((await orderOf(created.number)).paymentStatus, 'pending'); assert.equal((await orderOf(created.number)).stockReleased, false)
  await rejectsWith(simulatePayment(payload, token, 'cancelled'), 409, /nadana/)
  await rejectsWith(simulatePayment(payload, token, 'paid'), 403)
  await rejectsWith(operate(operator, order.id, 'cancelled'), 409, /Wysłanego/)
  assert.equal(await stock(p.id), 1)
  const summary = await paymentSummary(payload, token)
  assert.deepEqual([summary.status, summary.orderStatus, summary.paymentMethod, summary.expiresAt], ['pending', 'shipped', 'cod', null])
  await operate(operator, order.id, 'cod-collected')
  const collected = await orderOf(created.number)
  assert.deepEqual([collected.status, collected.paymentStatus, !!collected.codCollectedAt], ['shipped', 'paid', true])
  await rejectsWith(operate(operator, order.id, 'cod-collected'), 409)
  const audit = (await payload.find({ collection: 'audit-events', where: { targetId: { equals: order.id } }, sort: 'createdAt', depth: 0 })).docs.map(e => e.command)
  assert.deepEqual(audit, ['update-status', 'confirm-cod-collected'])
  assert.equal(await stock(p.id), 1)
})

test('terminal offline cancellation by the operator releases stock exactly once', async () => {
  const p = await product(1)
  const created = await checkout(payload, input(p.id, { paymentMethod: 'cod' }))
  const order = await orderOf(created.number)
  await operate(operator, order.id, 'cancelled'); await operate(operator, order.id, 'cancelled')
  assert.equal(await stock(p.id), 1)
  await rejectsWith(operate(operator, order.id, 'shipped'), 409)
  await rejectsWith(operate(operator, order.id, 'cod-collected'), 409)
  assert.equal((await orderOf(created.number)).paymentStatus, 'cancelled')
})

test('online payment keeps its signed simulation path alongside offline methods', async () => {
  const p = await product(2)
  const created = await checkout(payload, input(p.id, { paymentMethod: 'online' }))
  const token = tokenFrom(created.paymentURL)
  const order = await orderOf(created.number)
  assert.equal(order.paymentMethod, 'online'); assert.equal(order.totalCents, 2500)
  await rejectsWith(operate(operator, order.id, 'bank-paid'), 409)
  const [a, b] = await Promise.all([simulatePayment(payload, token, 'paid'), simulatePayment(payload, token, 'paid')])
  assert.equal(a.status, 'paid'); assert.equal(b.status, 'paid')
  assert.equal(await stock(p.id), 1)
  await operate(operator, order.id, 'shipped')
  assert.equal((await orderOf(created.number)).status, 'shipped')
})
