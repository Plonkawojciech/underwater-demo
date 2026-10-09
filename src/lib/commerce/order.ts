import { randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest, Where } from 'payload'
import type { Order } from '@/payload-types'
import { cents, email, equalDigest, hash, InputError, requestedItems, text, tokenHash } from './input'
import { isOfflinePayment, ONLINE_RESERVATION_MINUTES, PAYMENT_LABELS, quote, type PaymentMethodID, type QuoteItem } from './quote'
import { INTERNAL_TEST_PROVIDER, merchantKey, namespacedReference, OWN_PAYMENT_PATH, ownPaymentURL, paymentStartKey, sandboxPaymentLink, storedPaymentURL, testProvider, type PaymentNotification, type PaymentProvider, type PaymentStart, type PaymentStartInput } from './provider'
import { paymentRegistry, orderAccessToken, type PaymentRegistry } from './payment-registry'
import { transaction } from './transaction'
import { runtimeOrigin } from '../origin'

export type CheckoutInput = { idempotencyKey: unknown; customerName: unknown; email: unknown; phone?: unknown; address?: unknown; items: unknown; deliveryMethod?: unknown; paymentMethod?: unknown; pickupPoint?: unknown; privacyAccepted: unknown; termsAccepted: unknown; website?: unknown; expectedTotalCents?: unknown }
/** Server-only; public routes never pass these, so they always use the registered adapters and default limits. */
export type CheckoutOptions = { providers?: PaymentRegistry; startTimeoutMs?: number; waitMs?: number }
/** What the private status page offers: the payment, its preparation (with a resume action) or contact with the shop. */
export type PaymentPreparation = 'ready' | 'preparing' | 'review'
const START_TIMEOUT_MS = 15_000
const INITIALIZATION_WAIT_MS = 20_000
// Longer than one bounded start plus its short store: a live holder finishes or gives up before another caller may take over.
const leaseMs = (startTimeoutMs: number) => startTimeoutMs + 15_000
const CLOSED_ORDER = 'Poprzednie zamówienie zostało zamknięte. Koszyk zachowano; potwierdź nowe zamówienie.'
const SHOP_CONTACT = 'Płatność tego zamówienia wymaga kontaktu ze sklepem.'
/** The order was closed; unlike a failed initialization this is final for its checkout key. */
class ClosedOrderError extends InputError { constructor() { super(CLOSED_ORDER, 409) } }
const ADMIN_EMAIL = () => process.env.UNDERWATER_ADMIN_EMAIL || 'preview@programo.pl'
export type PickupPoint = { id: string; name: string; address: string }
/** Offline attempts never reach the signed online adapter; its notifications cannot match them. */
export const MANUAL_TEST_PROVIDER = 'manual-test'
const relationID = (value: number | { id: number }) => typeof value === 'number' ? value : value.id
export const orderPaymentMethod = (order: Pick<Order, 'paymentMethod'>): PaymentMethodID => order.paymentMethod || 'online'
/** Two decimals with a Polish separator; integer arithmetic, no float rounding. */
export function formatCents(value: number): string {
  const sign = value < 0 ? '-' : '', abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} PLN`
}
/** A manually entered test point. No carrier lookup exists, so only shape and length are verified. */
export function pickupPoint(value: unknown): PickupPoint | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new InputError('Nieprawidłowy punkt odbioru.')
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 'kod punktu odbioru', 40)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new InputError('Kod punktu odbioru może zawierać litery, cyfry, „-” i „_”.')
  return { id, name: text(raw.name, 'nazwa punktu odbioru', 120), address: text(raw.address, 'adres punktu odbioru', 300) }
}
export function paymentLink(token: string) { return `${runtimeOrigin()}/platnosc-testowa?token=${encodeURIComponent(token)}` }
type MailOrder = Pick<Order, 'number' | 'items' | 'subtotalCents' | 'deliveryCents' | 'paymentSurchargeCents' | 'totalCents' | 'deliveryLabel' | 'deliveryKind' | 'pickupPointId' | 'pickupPointName' | 'pickupPointAddress' | 'address' | 'paymentMethod' | 'freeShippingApplied' | 'expiresAt'>
/** Captured customer message: amounts, items, the stored delivery/payment snapshot and the private status link. */
export function orderMailBody(order: MailOrder, link: string) {
  const method = orderPaymentMethod(order)
  const lines = [
    'Tryb testowy — zamówienie nie zostanie zrealizowane, pieniądze nie zostaną pobrane, przesyłka nie zostanie nadana.',
    `Zamówienie: ${order.number}`, '', 'Pozycje:',
    ...(order.items || []).map(item => `- ${item.productName}${item.variant ? ` (${item.variant})` : ''} × ${item.qty}: ${formatCents(item.lineTotalCents)}`),
    '', `Produkty: ${formatCents(order.subtotalCents ?? 0)}`,
    `Dostawa: ${order.deliveryLabel || '—'}: ${formatCents(order.deliveryCents ?? 0)}${order.freeShippingApplied ? ' (darmowa dostawa od progu)' : ''}`,
    ...(order.paymentSurchargeCents ? [`Dopłata za pobranie: ${formatCents(order.paymentSurchargeCents)}`] : []),
    `Razem: ${formatCents(order.totalCents ?? 0)}`, '',
    `Płatność: ${PAYMENT_LABELS[method]}`,
    ...(method === 'bank_transfer' ? [`Przelew testowy: sklep nie podaje numeru rachunku w wersji podglądowej. Nie wykonuj przelewu. Tytuł: ${order.number}. Status zmieni zalogowana obsługa po symulowanym potwierdzeniu.`] : []),
    ...(method === 'cod' ? ['Płatność przy odbiorze (test). Obsługa oznaczy testowe nadanie i potwierdzi testowe pobranie; nic nie zostanie wysłane.'] : []),
    ...(order.deliveryKind === 'pickup_point' ? [`Punkt odbioru (wpisany ręcznie, bez weryfikacji przewoźnika): ${order.pickupPointId} — ${order.pickupPointName}, ${order.pickupPointAddress}`] : []),
    ...(order.address ? [`Adres: ${order.address}`] : []),
    ...(order.expiresAt ? [`Rezerwacja ważna do: ${order.expiresAt}`] : []),
    '', `Status i płatność: ${link}`,
  ]
  return lines.join('\n')
}
export async function reserveProduct(payload: Payload, req: PayloadRequest, line: QuoteItem, release = false) {
  // A thrown Payload read error rolls back its passed transaction. An expected
  // absent row must return null, so later releases remain in the same transaction.
  const product = await payload.findByID({ collection: 'products', id: line.product, depth: 0, req, overrideAccess: true, disableErrors: true })
  if (!product) { if (release) return false; throw new InputError('Produkt nie jest już dostępny.', 409) }
  const delta = release ? line.qty : -line.qty
  if (line.variantId) {
    const variants = (product.variants || []).map(v => ({ ...v }))
    const variant = variants.find(v => v.id === line.variantId)
    if (!variant || !Number.isSafeInteger(variant.stock)) { if (release) return false; throw new InputError('Stan wybranego wariantu zmienił się.', 409) }
    if (Number(variant.stock) + delta < 0) throw new InputError('Stan wybranego wariantu zmienił się.', 409)
    variant.stock = Number(variant.stock) + delta
    await payload.update({ collection: 'products', id: product.id, data: { variants, stock: variants.reduce((sum, v) => sum + Number(v.stock || 0), 0) }, req, overrideAccess: true })
  } else {
    if (!Number.isSafeInteger(product.stock)) { if (release) return false; throw new InputError('Stan produktu zmienił się.', 409) }
    if (Number(product.stock) + delta < 0) throw new InputError('Stan produktu zmienił się.', 409)
    await payload.update({ collection: 'products', id: product.id, data: { stock: Number(product.stock) + delta }, req, overrideAccess: true })
  }
  return true
}
export async function releaseOrder(payload: Payload, req: PayloadRequest, order: Order) {
  // Shipped goods have left the stock; nothing returns to the shelf automatically.
  if (order.stockReleased || order.paymentStatus === 'paid' || order.status === 'shipped') return
  let review = false
  for (const item of order.items || []) if (!await reserveProduct(payload, req, { product: relationID(item.product), name: item.productName, qty: item.qty, variantId: item.variantId || undefined, unitPriceCents: item.unitPriceCents, lineTotalCents: item.lineTotalCents }, true)) review = true
  if (review) {
    await payload.update({ collection: 'orders', id: order.id, data: { paymentReviewRequired: true }, req })
    await payload.create({ collection: 'outbox', data: { deduplicationKey: `stock-review:${order.id}`, recipient: process.env.UNDERWATER_ADMIN_EMAIL || 'preview@programo.pl', subject: `Sprawdzenie magazynu: ${order.number}`, body: 'Podczas zwalniania rezerwacji brakowało produktu, wariantu lub potwierdzonego stanu. Nie dopisano sztuk do innego wariantu. Zamówienie zamknięto; obsługa powinna uzgodnić stan magazynu.' }, req })
  }
}
export async function expireReservations(payload: Payload, req: PayloadRequest, now = new Date()) {
  // A test-shipped cash-on-delivery order waits for collection and never expires.
  const result = await payload.find({ collection: 'orders', where: { and: [{ paymentStatus: { equals: 'pending' } }, { status: { not_equals: 'shipped' } }, { expiresAt: { less_than_equal: now.toISOString() } }] }, limit: 200, depth: 0, req, overrideAccess: true })
  for (const order of result.docs) {
    await releaseOrder(payload, req, order)
    await payload.update({ collection: 'orders', id: order.id, data: { status: 'expired', paymentStatus: 'expired', stockReleased: true }, req, overrideAccess: true })
    await payload.update({ collection: 'payment-attempts', where: { order: { equals: order.id } }, data: { status: 'expired' }, req, overrideAccess: true })
  }
  return result.docs.length
}
export async function checkout(payload: Payload, raw: CheckoutInput, options: CheckoutOptions = {}) {
  if (!raw || typeof raw !== 'object') throw new InputError('Nieprawidłowe zamówienie.')
  if (raw.website) throw new InputError('Zgłoszenie odrzucone.')
  if (raw.privacyAccepted !== true || raw.termsAccepted !== true) throw new InputError('Potwierdź wymagane zgody.')
  const customerName = text(raw.customerName, 'imię i nazwisko', 160)
  const customerEmail = email(raw.email)
  const phone = text(raw.phone ?? '', 'telefon', 40, false)
  const address = text(raw.address ?? '', 'adres', 1000, false)
  const idempotencyKey = text(raw.idempotencyKey, 'identyfikator zamówienia', 100)
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw new InputError('Nieprawidłowy identyfikator zamówienia.')
  const input = requestedItems(raw.items).sort((a, b) => a.id - b.id || (a.variantId || a.variant || '').localeCompare(b.variantId || b.variant || ''))
  const deliveryMethod = raw.deliveryMethod == null ? undefined : text(raw.deliveryMethod, 'metoda dostawy', 100)
  const paymentMethod = raw.paymentMethod == null || raw.paymentMethod === '' ? 'online' : text(raw.paymentMethod, 'metoda płatności', 40)
  const point = pickupPoint(raw.pickupPoint)
  // Payment method and pickup point belong to the order identity: reusing a key with another choice is a conflict.
  const fingerprint = hash(JSON.stringify({ customerName, email: customerEmail, phone, address, input, deliveryMethod, paymentMethod, point, consent: 'preview-v1' }))
  const providers = options.providers ?? paymentRegistry
  // The current selection applies only to a new order; an existing attempt keeps its recorded adapter.
  const provider = providers.current()
  const token = orderAccessToken(idempotencyKey, fingerprint)
  const link = paymentLink(token)
  const created = await transaction(payload, 'order-service', async req => {
    await expireReservations(payload, req)
    const previous = await payload.find({ collection: 'orders', where: { idempotencyKey: { equals: idempotencyKey } }, limit: 1, depth: 0, req, overrideAccess: true })
    if (previous.docs[0]) {
      if (!equalDigest(previous.docs[0].fingerprint || '', fingerprint)) throw new InputError('Identyfikator został już użyty dla innego zamówienia.', 409)
      if (['expired', 'cancelled', 'failed'].includes(previous.docs[0].paymentStatus || '')) throw new ClosedOrderError()
      return { id: previous.docs[0].id, number: previous.docs[0].number }
    }
    const current = await quote(payload, input, deliveryMethod, req, paymentMethod)
    if (current.addressRequired && !address) throw new InputError('Uzupełnij pole: adres dostawy.')
    if (current.pickupPointRequired && !point) throw new InputError('Wpisz punkt odbioru: kod, nazwę i adres.')
    if (!current.pickupPointRequired && point) throw new InputError('Punkt odbioru dotyczy tylko dostawy do punktu.')
    if (raw.expectedTotalCents != null && cents(raw.expectedTotalCents) !== current.totalCents) throw new InputError('Cena lub koszt dostawy zmieniły się. Sprawdź aktualną wycenę i potwierdź ponownie.', 409)
    for (const line of current.items) await reserveProduct(payload, req, line)
    const number = `UW-${randomUUID()}`
    const offline = isOfflinePayment(current.paymentMethod)
    // quote() exposes offline methods only with a validated, bounded reservation period.
    const reservationMinutes = offline ? current.offlineReservationMinutes! : ONLINE_RESERVATION_MINUTES
    const expiresAt = new Date(Date.now() + reservationMinutes * 60_000).toISOString()
    const delivery = current.deliveryMethods.find(m => m.id === current.deliveryMethod)!
    const order = await payload.create({ collection: 'orders', req, overrideAccess: true, data: {
      number, customerName, email: customerEmail, phone, address,
      items: current.items.map(line => ({ ...line, productName: line.name, price: line.unitPriceCents / 100 })),
      total: current.totalCents / 100, totalCents: current.totalCents, subtotalCents: current.subtotalCents, deliveryCents: current.deliveryCents,
      deliveryBaseCents: current.deliveryBaseCents, paymentSurchargeCents: current.paymentSurchargeCents,
      freeShippingThresholdCents: current.freeShippingThresholdCents, freeShippingApplied: current.freeShippingApplied,
      deliveryMethod: current.deliveryMethod, deliveryLabel: delivery.label, deliveryKind: current.deliveryKind,
      ...(point ? { pickupPointId: point.id, pickupPointName: point.name, pickupPointAddress: point.address } : {}),
      paymentMethod: current.paymentMethod, paymentLabel: PAYMENT_LABELS[current.paymentMethod], reservationMinutes,
      currency: current.currency, status: 'new', paymentStatus: 'pending', stockReleased: false, idempotencyKey, fingerprint, accessTokenHash: hash(token), expiresAt,
      privacyAccepted: true, termsAccepted: true, consentVersion: 'preview-v1', mode: 'test',
    } })
    // This callback can be retried from BEGIN, so it never calls the adapter: an online
    // attempt is a placeholder until initializePayment() stores the adapter's reference.
    // The merchant key is stored before any start, so a signed event can find this attempt
    // even if no start result is ever stored.
    const initialization = offline
      ? { provider: MANUAL_TEST_PROVIDER, reference: `manual-${randomUUID()}`, initialization: 'ready' as const, paymentUrl: OWN_PAYMENT_PATH }
      : { provider: provider.id, reference: `pending-${randomUUID()}`, initialization: 'initializing' as const, initializationKey: paymentStartKey(number) }
    await payload.create({ collection: 'payment-attempts', req, overrideAccess: true, data: { order: order.id, ...initialization, amountCents: current.totalCents, currency: current.currency, status: 'pending', expiresAt } })
    await payload.create({ collection: 'outbox', req, overrideAccess: true, data: { deduplicationKey: `order:${order.id}`, recipient: customerEmail, subject: `Testowe zamówienie ${number}`, body: orderMailBody(order, link) } })
    return { id: order.id, number }
  }).catch(async error => {
    if (error instanceof InputError) throw error
    // COMMIT may succeed while its acknowledgement is lost. Reconcile the
    // complete committed order, never infer success from the exception itself.
    // A genuine rollback has no matching order+attempt and still rejects.
    let persisted: { id: number; number: string } | undefined
    let closed = false
    try {
      const order = (await payload.find({ collection: 'orders', where: { idempotencyKey: { equals: idempotencyKey } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
      if (order && equalDigest(order.fingerprint || '', fingerprint) && equalDigest(order.accessTokenHash || '', hash(token))) {
        const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
        closed = ['expired', 'cancelled', 'failed'].includes(order.paymentStatus || '')
        if (!closed && attempt && attempt.amountCents === order.totalCents && attempt.currency === order.currency) persisted = { id: order.id, number: order.number }
      }
    } catch { /* A failed reconciliation retains the original failure. */ }
    if (closed) throw new ClosedOrderError()
    if (!persisted) throw error
    return persisted
  })
  // Reached only after COMMIT; a retry with the same key resumes the same order and attempt here.
  let payment: PaymentPreparation = 'ready'
  try { await initializePayment(payload, created.id, token, providers, options) } catch (error) {
    if (error instanceof ClosedOrderError) throw error
    // The order and its reservation are committed, so the reply is still a success: the
    // private status page resumes this attempt and the cart is never quoted or reserved again.
    if (!(error instanceof InputError)) console.error('[underwater] Payment initialization deferred:', error instanceof Error ? error.name : 'UnknownError')
    payment = error instanceof InputError && error.status === 409 ? 'review' : 'preparing'
  }
  // Every reply leads to the shop's own private status page; an adapter page is offered there only.
  return { number: created.number, paymentURL: ownPaymentURL(token), payment }
}

/** Repeats only the initialization of an existing order for the holder of its private link; never creates, quotes or reserves. */
export async function resumePayment(payload: Payload, token: unknown, options: CheckoutOptions = {}) {
  const accessTokenHash = tokenHash(token)
  const order = (await payload.find({ collection: 'orders', where: { accessTokenHash: { equals: accessTokenHash } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (!order) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
  if (!isOfflinePayment(order.paymentMethod) && order.paymentStatus === 'pending') {
    // A failed resume leaves the state shown by the summary: still preparing, review or closed.
    try { await initializePayment(payload, order.id, token as string, options.providers ?? paymentRegistry, options) } catch (error) { if (!(error instanceof InputError)) throw error }
  }
  return paymentSummary(payload, token, options)
}

type Initialization = { done: true } | { wait: true } | { claim: { attempt: number; lease: string; provider: string; input: PaymentStartInput } }
/**
 * Brings a committed order's attempt to `ready`. An initializing attempt is claimed
 * with a bounded lease; the holder calls the adapter outside any transaction with
 * the stored merchant key and stores the result in a short transaction, the others
 * wait for it. Throws ClosedOrderError for a closed order and InputError when the
 * initialization must be resumed later or needs the shop.
 */
async function initializePayment(payload: Payload, orderID: number, token: string, providers: PaymentRegistry, options: CheckoutOptions): Promise<void> {
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
  const deadline = Date.now() + (options.waitMs ?? INITIALIZATION_WAIT_MS)
  for (;;) {
    const step = await transaction<Initialization>(payload, 'payment-service', async req => {
      await expireReservations(payload, req)
      const order = await payload.findByID({ collection: 'orders', id: orderID, depth: 0, req, overrideAccess: true })
      if (['expired', 'cancelled', 'failed'].includes(order.paymentStatus || '')) throw new ClosedOrderError()
      const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0]
      if (!attempt) throw new InputError(SHOP_CONTACT, 409)
      if (order.paymentStatus === 'paid') return { done: true }
      // An open order under review is never claimed or started again; the shop resolves it.
      if (underReview(order)) throw new InputError(SHOP_CONTACT, 409)
      if (attempt.initialization === 'ready') return { done: true }
      if (!attempt.initialization) {
        // Recorded before initialization existed: read-only fallback, the private row is not backfilled.
        if (attempt.provider !== INTERNAL_TEST_PROVIDER && attempt.provider !== MANUAL_TEST_PROVIDER) throw new InputError(SHOP_CONTACT, 409)
        return { done: true }
      }
      if (!attempt.initializationKey || attempt.initializationKey !== paymentStartKey(order.number)) throw new InputError(SHOP_CONTACT, 409)
      const now = Date.now()
      if (attempt.initializationLeaseUntil && Date.parse(attempt.initializationLeaseUntil) > now) return { wait: true }
      const lease = randomUUID()
      await payload.update({ collection: 'payment-attempts', id: attempt.id, req, overrideAccess: true, data: { initializationLease: lease, initializationLeaseUntil: new Date(now + leaseMs(startTimeoutMs)).toISOString() } })
      return { claim: { attempt: attempt.id, lease, provider: attempt.provider, input: Object.freeze({ idempotencyKey: attempt.initializationKey, number: order.number, amountCents: cents(attempt.amountCents), currency: 'PLN' as const }) } }
    })
    if ('done' in step) return
    if ('wait' in step) {
      if (Date.now() >= deadline) throw new InputError('Płatność jest właśnie przygotowywana. Zamówienie zachowano; spróbuj ponownie za chwilę.', 503)
      await new Promise(resolve => setTimeout(resolve, 50))
      continue
    }
    const { claim } = step
    const adapter = providers.byID(claim.provider)
    let started: { reference: string; paymentUrl: string }
    try {
      if (!adapter) throw new InputError(SHOP_CONTACT, 409)
      const result = await startWithin(adapter, claim.input, startTimeoutMs)
      started = { reference: providerReference(result?.reference), paymentUrl: storedPaymentURL(adapter, result?.paymentURL, token) }
    } catch (error) {
      // The remote outcome is unknown: stock stays reserved until the normal expiry
      // and the next caller repeats the same merchant key instead of a second intent.
      await releaseInitialization(payload, claim.attempt, claim.lease).catch(() => undefined)
      if (error instanceof InputError) throw error
      throw new InputError('Operator płatności nie potwierdził rozpoczęcia płatności. Zamówienie i rezerwację zachowano; spróbuj ponownie.', 503)
    }
    const stored = await transaction(payload, 'payment-service', async req => {
      const attempt = await payload.findByID({ collection: 'payment-attempts', id: claim.attempt, depth: 0, req, overrideAccess: true })
      // The attempt keeps its state (an initializing one stays unbound) and the reservation
      // runs to its normal expiry; the order is flagged once and no longer started.
      const conflict = async () => {
        if (attempt.initialization === 'initializing' && attempt.initializationLease === claim.lease) await payload.update({ collection: 'payment-attempts', id: attempt.id, req, overrideAccess: true, data: { initializationLease: null, initializationLeaseUntil: null } })
        await payload.update({ collection: 'orders', id: relationID(attempt.order), data: { paymentReviewRequired: true }, req, overrideAccess: true })
        await captureOnce(payload, req, { deduplicationKey: `payment-init-conflict:${attempt.id}`, recipient: ADMIN_EMAIL(), subject: `Niespójna inicjalizacja płatności ${claim.input.number}`, body: 'Operator zwrócił referencję niezgodną z zapisaną płatnością albo należącą do innej płatności. Płatności nie powiązano; rezerwacja wygaśnie w zwykłym terminie. Zamówienie wymaga sprawdzenia przez obsługę. Tryb testowy — brak rzeczywistego pobrania pieniędzy.' })
        return 'conflict' as const
      }
      if (attempt.initialization === 'ready') {
        if (attempt.providerReference !== started.reference) return conflict()
        // A verified event bound the same intent first; only its page is added.
        if (!attempt.paymentUrl) await payload.update({ collection: 'payment-attempts', id: attempt.id, req, overrideAccess: true, data: { paymentUrl: started.paymentUrl } })
        return 'stored' as const
      }
      if (attempt.initializationLease !== claim.lease) return 'lost' as const
      const taken = await payload.count({ collection: 'payment-attempts', where: { and: [{ provider: { equals: claim.provider } }, rawReferenceWhere(started.reference)] }, req, overrideAccess: true })
      if (taken.totalDocs) return conflict()
      // Stored even when the order closed meanwhile: a late notification then finds the
      // attempt and goes to manual review, while the order itself is never reopened.
      await payload.update({ collection: 'payment-attempts', id: attempt.id, req, overrideAccess: true, data: { reference: namespacedReference(claim.provider, started.reference), providerReference: started.reference, paymentUrl: started.paymentUrl, initialization: 'ready', initializationLease: null, initializationLeaseUntil: null } })
      return 'stored' as const
    })
    if (stored === 'conflict') throw new InputError(SHOP_CONTACT, 409)
    // 'stored' and 'lost' both re-read the committed state, which rechecks closure.
  }
}
/** An open order flagged for the shop: no adapter start, no simulation, no automatic binding. */
const underReview = (order: Pick<Order, 'paymentStatus' | 'paymentReviewRequired'>) => order.paymentStatus === 'pending' && !!order.paymentReviewRequired
/** A raw operator reference of one adapter; older rows hold it in `reference` alone. */
const rawReferenceWhere = (raw: string): Where => ({ or: [{ providerReference: { equals: raw } }, { and: [{ providerReference: { exists: false } }, { reference: { equals: raw } }] }] })
/** Staff notices that can be raised again by a repeated or concurrent path are captured once. */
async function captureOnce(payload: Payload, req: PayloadRequest, data: { deduplicationKey: string; recipient: string; subject: string; body: string }) {
  if ((await payload.count({ collection: 'outbox', where: { deduplicationKey: { equals: data.deduplicationKey } }, req, overrideAccess: true })).totalDocs) return
  await payload.create({ collection: 'outbox', req, overrideAccess: true, data })
}
function providerReference(value: unknown) {
  const reference = typeof value === 'string' ? value : ''
  // Reserved local prefixes mark placeholders and offline attempts; an adapter cannot claim them.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(reference) || /^(?:pending|manual)-/.test(reference)) throw new InputError('Operator płatności zwrócił nieprawidłową referencję.', 502)
  return reference
}
async function startWithin(adapter: PaymentProvider, input: PaymentStartInput, ms: number): Promise<PaymentStart> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Payment start timed out.')) }, ms) })
  try { return await Promise.race([adapter.start(input, { signal: controller.signal }), timeout]) } finally { clearTimeout(timer) }
}
async function releaseInitialization(payload: Payload, attemptID: number, lease: string) {
  await transaction(payload, 'payment-service', async req => {
    const attempt = await payload.findByID({ collection: 'payment-attempts', id: attemptID, depth: 0, req, overrideAccess: true })
    if (attempt.initialization === 'initializing' && attempt.initializationLease === lease) await payload.update({ collection: 'payment-attempts', id: attemptID, req, overrideAccess: true, data: { initializationLease: null, initializationLeaseUntil: null } })
  })
}
export async function paymentSummary(payload: Payload, token: unknown, options: Pick<CheckoutOptions, 'providers'> = {}) {
  const accessTokenHash = tokenHash(token)
    const result = await payload.find({ collection: 'orders', where: { accessTokenHash: { equals: accessTokenHash } }, limit: 1, depth: 0, overrideAccess: true })
    const order = result.docs[0]
    if (!order) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
    const status = order.paymentStatus === 'pending' && order.status !== 'shipped' && order.expiresAt && Date.parse(order.expiresAt) <= Date.now() ? 'expired' : order.paymentStatus
    const attempt = (await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
    // Review comes first: an open order flagged for the shop is never offered a retry, link or simulation.
    let payment: PaymentPreparation = !attempt || underReview(order) ? 'review'
      : !attempt.initialization ? (attempt.provider === INTERNAL_TEST_PROVIDER || attempt.provider === MANUAL_TEST_PROVIDER ? 'ready' : 'review')
      : attempt.initialization === 'initializing' ? 'preparing' : 'ready'
    // An adapter page is offered only as an explicit link for an open, ready payment; it never carries the token.
    let sandboxLink: string | null = null
    if (attempt && payment === 'ready' && status === 'pending' && order.status !== 'shipped' && attempt.provider !== MANUAL_TEST_PROVIDER && attempt.paymentUrl && attempt.paymentUrl !== OWN_PAYMENT_PATH) {
      try { sandboxLink = sandboxPaymentLink((options.providers ?? paymentRegistry).byID(attempt.provider), attempt.paymentUrl, String(token)) } catch { payment = 'review' }
    }
    // The token holder sees only what the order page needs; contact data, references and keys stay in the panel.
    return {
      number: order.number, totalCents: cents(order.totalCents), currency: order.currency, status, expiresAt: order.status === 'shipped' ? null : order.expiresAt,
      orderStatus: order.status, paymentMethod: orderPaymentMethod(order), deliveryLabel: order.deliveryLabel, deliveryKind: order.deliveryKind, pickupPointName: order.pickupPointName,
      paymentSurchargeCents: order.paymentSurchargeCents ?? 0,
      payment, paymentLink: sandboxLink, simulation: payment === 'ready' && attempt?.provider === INTERNAL_TEST_PROVIDER,
    }
}
/** providerID is the adapter that verified the notification; the original endpoint serves the internal test adapter. */
export async function acceptNotification(payload: Payload, notification: PaymentNotification, rawDigest: string, providerID: string = INTERNAL_TEST_PROVIDER) {
  const key = notification.merchantKey == null ? null : merchantKey(notification.merchantKey)
  return transaction(payload, 'payment-service', async req => {
    await expireReservations(payload, req)
    const unknown = () => new InputError('Nieznana płatność.', 404)
    // The raw reference is unique only within its adapter; older rows hold it in `reference` alone.
    const byReference = (await payload.find({ collection: 'payment-attempts', where: { and: [{ provider: { equals: providerID } }, rawReferenceWhere(notification.reference)] }, limit: 2, depth: 0, req, overrideAccess: true })).docs
    if (byReference.length > 1) throw new InputError('Niejednoznaczna płatność.', 409)
    let attempt = byReference[0]
    let bind = false, mismatch = false
    if (attempt) {
      // A placeholder was never issued by an adapter; a signed key of another attempt claims nothing.
      if (attempt.initialization === 'initializing') throw unknown()
      if (key && attempt.initializationKey !== key) throw new InputError('Zdarzenie nie pasuje do płatności.', 409)
    } else if (key) {
      // The start result may never have been stored: the signed merchant key finds the attempt of this adapter.
      attempt = (await payload.find({ collection: 'payment-attempts', where: { and: [{ provider: { equals: providerID } }, { initializationKey: { equals: key } }] }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0]
      if (!attempt) throw unknown()
      // A ready attempt keeps its stored reference; another one is never rebound.
      if (attempt.initialization === 'initializing') bind = true; else mismatch = true
    }
    if (!attempt || attempt.provider !== providerID) throw unknown()
    const eventKey = `${attempt.provider}:${notification.eventKey}`
    const old = await payload.find({ collection: 'payment-events', where: { eventKey: { equals: eventKey } }, limit: 1, depth: 0, req, overrideAccess: true })
    if (old.docs[0]) {
      if (!equalDigest(old.docs[0].digest || '', rawDigest)) throw new InputError('Zdarzenie ma inne dane niż zapisany komunikat.', 409)
      return { accepted: old.docs[0].accepted, duplicate: true }
    }
    const order = await payload.findByID({ collection: 'orders', id: relationID(attempt.order), depth: 0, req, overrideAccess: true })
    // Offline orders change only through an authenticated, audited operator command.
    if (isOfflinePayment(order.paymentMethod)) throw new InputError('Płatność offline potwierdza wyłącznie zalogowana obsługa sklepu.', 403)
    if (attempt.amountCents !== notification.amountCents || order.totalCents !== notification.amountCents || attempt.currency !== notification.currency || order.currency !== notification.currency) throw new InputError('Kwota lub waluta nie zgadza się z zamówieniem.', 409)
    // An unbound attempt of an open order under review (for example an initialization conflict)
    // is not bound automatically either; the event is kept for the shop.
    if (mismatch || (bind && underReview(order))) {
      await payload.create({ collection: 'payment-events', req, overrideAccess: true, data: { eventKey, attempt: attempt.id, digest: rawDigest, outcome: notification.outcome, accepted: false, reason: mismatch ? 'reference-mismatch' : 'review-required' } })
      await payload.update({ collection: 'orders', id: order.id, data: { paymentReviewRequired: true }, req })
      await captureOnce(payload, req, { deduplicationKey: `reference-mismatch:${eventKey}`, recipient: ADMIN_EMAIL(), subject: `Niezgodna referencja płatności ${order.number}`, body: 'Podpisane zdarzenie operatora wskazuje płatność, której nie można automatycznie powiązać z tą referencją. Płatności nie powiązano; stan zamówienia nie zmienił się. Wymaga sprawdzenia przez obsługę. Tryb testowy — brak rzeczywistego pobrania pieniędzy.' })
      return { accepted: false, duplicate: false }
    }
    if (bind) {
      // Exact amount and currency were checked above. The order is not reopened and no stock
      // is reserved here; a closed order sends a paid event to manual review below.
      const raw = providerReference(notification.reference)
      await payload.update({ collection: 'payment-attempts', id: attempt.id, req, overrideAccess: true, data: { reference: namespacedReference(attempt.provider, raw), providerReference: raw, initialization: 'ready', initializationLease: null, initializationLeaseUntil: null } })
    }
    const accepted = attempt.status === 'pending' && order.paymentStatus === 'pending' && !order.stockReleased
    await payload.create({ collection: 'payment-events', req, overrideAccess: true, data: { eventKey, attempt: attempt.id, digest: rawDigest, outcome: notification.outcome, accepted, reason: accepted ? 'verified' : 'terminal-state' } })
    if (!accepted) {
      if (notification.outcome === 'paid' && order.paymentStatus !== 'paid') {
        await payload.update({ collection: 'orders', id: order.id, data: { paymentReviewRequired: true }, req })
        await payload.create({ collection: 'outbox', data: { deduplicationKey: `attention:${eventKey}`, recipient: ADMIN_EMAIL(), subject: `Płatność po zamknięciu zamówienia ${order.number}`, body: 'Zdarzenie wymaga sprawdzenia przez obsługę. Stan zamówienia nie został ponownie otwarty. Tryb testowy — brak rzeczywistego pobrania pieniędzy.' }, req })
      }
      return { accepted: false, duplicate: false }
    }
    if (notification.outcome !== 'paid') await releaseOrder(payload, req, order)
    await payload.update({ collection: 'orders', id: order.id, req, overrideAccess: true, data: { paymentStatus: notification.outcome, status: notification.outcome === 'paid' ? 'paid' : 'cancelled', stockReleased: notification.outcome !== 'paid', ...(notification.outcome === 'paid' ? { paidAt: new Date().toISOString() } : {}) } })
    await payload.update({ collection: 'payment-attempts', id: attempt.id, data: { status: notification.outcome }, req, overrideAccess: true })
    await payload.create({ collection: 'outbox', req, overrideAccess: true, data: { deduplicationKey: `payment:${attempt.id}:${notification.outcome}`, recipient: order.email, subject: `Status płatności testowej ${order.number}`, body: `Tryb testowy. Zamówienie ${order.number}, kwota ${formatCents(order.totalCents ?? 0)}. Status płatności: ${notification.outcome}. Nie realizować rzeczywistej wysyłki.` } })
    return { accepted: true, duplicate: false }
  })
}
export async function simulatePayment(payload: Payload, token: unknown, outcome: unknown) {
  if (!['paid', 'failed', 'cancelled'].includes(String(outcome))) throw new InputError('Nieprawidłowy wynik testu.')
  const accessTokenHash = tokenHash(token)
  const orders = await payload.find({ collection: 'orders', where: { accessTokenHash: { equals: accessTokenHash } }, limit: 1, depth: 0, overrideAccess: true })
  const order = orders.docs[0]
  if (!order) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
  if (isOfflinePayment(order.paymentMethod)) {
    // The link proves possession, not payment: its holder may only withdraw a pending order.
    if (outcome !== 'cancelled') throw new InputError('Płatność offline potwierdza wyłącznie zalogowana obsługa sklepu.', 403)
    await cancelByCustomer(payload, accessTokenHash)
    return paymentSummary(payload, token)
  }
  const attempts = await payload.find({ collection: 'payment-attempts', where: { order: { equals: order.id } }, limit: 1, depth: 0, overrideAccess: true })
  const attempt = attempts.docs[0]
  if (!attempt) throw new InputError('Brak płatności.', 404)
  // Only the internal test adapter is simulated; another adapter's events come solely from its own signed callback.
  if (attempt.provider !== INTERNAL_TEST_PROVIDER) throw new InputError('Symulacja dotyczy wyłącznie wewnętrznej płatności testowej.', 403)
  if (underReview(order)) throw new InputError(SHOP_CONTACT, 409)
  if (attempt.initialization === 'initializing') throw new InputError('Płatność nie została jeszcze przygotowana.', 409)
  const provider = testProvider()
  // The raw reference the adapter issued; older rows hold it in `reference`.
  const reference = attempt.providerReference || attempt.reference
  const raw = JSON.stringify({ eventKey: `simulation-${reference}-${outcome}`, reference, amountCents: attempt.amountCents, currency: 'PLN', outcome })
  await acceptNotification(payload, provider.verify(raw, provider.sign(raw)), hash(raw), provider.id)
  return paymentSummary(payload, token)
}

/** Closes a pending offline order for the holder of its private link; repeated calls change nothing. */
async function cancelByCustomer(payload: Payload, accessTokenHash: string) {
  return transaction(payload, 'order-service', async req => {
    await expireReservations(payload, req)
    const order = (await payload.find({ collection: 'orders', where: { accessTokenHash: { equals: accessTokenHash } }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0]
    if (!order) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
    if (order.status === 'shipped') throw new InputError('Przesyłka testowa została oznaczona jako nadana. Anulowanie wymaga kontaktu ze sklepem.', 409)
    if (order.paymentStatus !== 'pending' || order.stockReleased) return
    await releaseOrder(payload, req, order)
    await payload.update({ collection: 'orders', id: order.id, data: { status: 'cancelled', paymentStatus: 'cancelled', stockReleased: true }, req, overrideAccess: true })
    await payload.update({ collection: 'payment-attempts', where: { order: { equals: order.id } }, data: { status: 'cancelled' }, req, overrideAccess: true })
    await payload.create({ collection: 'outbox', req, overrideAccess: true, data: { deduplicationKey: `customer-cancel:${order.id}`, recipient: order.email, subject: `Anulowane zamówienie testowe ${order.number}`, body: `Tryb testowy. Zamówienie ${order.number} (${formatCents(order.totalCents ?? 0)}) anulowano z prywatnego linku. Rezerwację zwolniono; nic nie pobrano ani nie wysłano.` } })
  })
}
