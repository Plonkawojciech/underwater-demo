import { randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import type { Order } from '@/payload-types'
import { cents, email, equalDigest, hash, InputError, requestedItems, text, tokenHash } from './input'
import { isOfflinePayment, ONLINE_RESERVATION_MINUTES, PAYMENT_LABELS, quote, type PaymentMethodID, type QuoteItem } from './quote'
import { testProvider, type PaymentNotification } from './provider'
import { paymentProvider, orderAccessToken } from './payment-registry'
import { transaction } from './transaction'
import { runtimeOrigin } from '../origin'

export type CheckoutInput = { idempotencyKey: unknown; customerName: unknown; email: unknown; phone?: unknown; address?: unknown; items: unknown; deliveryMethod?: unknown; paymentMethod?: unknown; pickupPoint?: unknown; privacyAccepted: unknown; termsAccepted: unknown; website?: unknown; expectedTotalCents?: unknown }
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
export async function checkout(payload: Payload, raw: CheckoutInput) {
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
  const provider = paymentProvider()
  const token = orderAccessToken(idempotencyKey, fingerprint)
  const link = paymentLink(token)
  return transaction(payload, 'order-service', async req => {
    await expireReservations(payload, req)
    const previous = await payload.find({ collection: 'orders', where: { idempotencyKey: { equals: idempotencyKey } }, limit: 1, depth: 0, req, overrideAccess: true })
    if (previous.docs[0]) {
      if (!equalDigest(previous.docs[0].fingerprint || '', fingerprint)) throw new InputError('Identyfikator został już użyty dla innego zamówienia.', 409)
      if (['expired', 'cancelled', 'failed'].includes(previous.docs[0].paymentStatus || '')) throw new InputError('Poprzednie zamówienie zostało zamknięte. Koszyk zachowano; potwierdź nowe zamówienie.', 409)
      return { number: previous.docs[0].number, paymentURL: `/platnosc-testowa?token=${encodeURIComponent(token)}` }
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
    const payment = offline ? { reference: `manual-${randomUUID()}`, paymentURL: `/platnosc-testowa?token=${encodeURIComponent(token)}` } : provider.start({ number, amountCents: current.totalCents, currency: current.currency, token })
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
    await payload.create({ collection: 'payment-attempts', req, overrideAccess: true, data: { order: order.id, provider: offline ? MANUAL_TEST_PROVIDER : provider.id, reference: payment.reference, amountCents: current.totalCents, currency: current.currency, status: 'pending', expiresAt } })
    await payload.create({ collection: 'outbox', req, overrideAccess: true, data: { deduplicationKey: `order:${order.id}`, recipient: customerEmail, subject: `Testowe zamówienie ${number}`, body: orderMailBody(order, link) } })
    return { number, paymentURL: payment.paymentURL }
  })
}
export async function paymentSummary(payload: Payload, token: unknown) {
  const accessTokenHash = tokenHash(token)
    const result = await payload.find({ collection: 'orders', where: { accessTokenHash: { equals: accessTokenHash } }, limit: 1, depth: 0, overrideAccess: true })
    const order = result.docs[0]
    if (!order) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
    const status = order.paymentStatus === 'pending' && order.status !== 'shipped' && order.expiresAt && Date.parse(order.expiresAt) <= Date.now() ? 'expired' : order.paymentStatus
    // The token holder sees only what the order page needs; contact data stays in the panel.
    return {
      number: order.number, totalCents: cents(order.totalCents), currency: order.currency, status, expiresAt: order.status === 'shipped' ? null : order.expiresAt,
      orderStatus: order.status, paymentMethod: orderPaymentMethod(order), deliveryLabel: order.deliveryLabel, deliveryKind: order.deliveryKind, pickupPointName: order.pickupPointName,
      paymentSurchargeCents: order.paymentSurchargeCents ?? 0,
    }
}
export async function acceptNotification(payload: Payload, notification: PaymentNotification, rawDigest: string) {
  return transaction(payload, 'payment-service', async req => {
    await expireReservations(payload, req)
    const result = await payload.find({ collection: 'payment-attempts', where: { reference: { equals: notification.reference } }, limit: 1, depth: 0, req, overrideAccess: true })
    const attempt = result.docs[0]
    if (!attempt || attempt.provider !== paymentProvider().id) throw new InputError('Nieznana płatność.', 404)
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
    const accepted = attempt.status === 'pending' && order.paymentStatus === 'pending' && !order.stockReleased
    await payload.create({ collection: 'payment-events', req, overrideAccess: true, data: { eventKey, attempt: attempt.id, digest: rawDigest, outcome: notification.outcome, accepted, reason: accepted ? 'verified' : 'terminal-state' } })
    if (!accepted) {
      if (notification.outcome === 'paid' && order.paymentStatus !== 'paid') {
        await payload.update({ collection: 'orders', id: order.id, data: { paymentReviewRequired: true }, req })
        await payload.create({ collection: 'outbox', data: { deduplicationKey: `attention:${eventKey}`, recipient: process.env.UNDERWATER_ADMIN_EMAIL || 'preview@programo.pl', subject: `Płatność po zamknięciu zamówienia ${order.number}`, body: 'Zdarzenie wymaga sprawdzenia przez obsługę. Stan zamówienia nie został ponownie otwarty. Tryb testowy — brak rzeczywistego pobrania pieniędzy.' }, req })
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
  const provider = testProvider()
  const raw = JSON.stringify({ eventKey: `simulation-${attempt.reference}-${outcome}`, reference: attempt.reference, amountCents: attempt.amountCents, currency: 'PLN', outcome })
  await acceptNotification(payload, provider.verify(raw, provider.sign(raw)), hash(raw))
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
