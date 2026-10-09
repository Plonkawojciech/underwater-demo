import type { Payload, PayloadRequest } from 'payload'
import type { Product } from '@/payload-types'
import { cents, InputError, legacyCents, requestedItems, type RequestedItem } from './input'

export type QuoteItem = { product: number; name: string; sku?: string; variantId?: string; variant?: string; qty: number; unitPriceCents: number; lineTotalCents: number; taxRate?: number }
export type DeliveryKind = 'courier' | 'pickup_point' | 'pickup'
export type PaymentMethodID = 'online' | 'bank_transfer' | 'cod'
export type DeliveryMethod = { id: string; label: string; priceCents: number; kind: DeliveryKind; paymentMethods: PaymentMethodID[] }
export type PaymentOption = { id: PaymentMethodID; label: string; offline: boolean; surchargeCents: number }
export type CheckoutConfig = { deliveryMethods: DeliveryMethod[]; payments: PaymentOption[]; freeShippingThresholdCents: number | null; offlineReservationMinutes: number | null }
export type Quote = {
  items: QuoteItem[]; subtotalCents: number; deliveryBaseCents: number; deliveryCents: number; paymentSurchargeCents: number; totalCents: number; currency: 'PLN'
  deliveryMethods: DeliveryMethod[]; deliveryMethod: string; deliveryKind: DeliveryKind
  paymentMethods: PaymentOption[]; paymentMethod: PaymentMethodID
  freeShippingThresholdCents: number | null; freeShippingApplied: boolean; offlineReservationMinutes: number | null
  addressRequired: boolean; pickupPointRequired: boolean
}

export function catalogLine(product: Product, requested: RequestedItem): QuoteItem {
  if (!product.published) throw new InputError('Produkt jest niedostępny.', 409)
  const variants = product.variants || []
  const candidates = requested.variantId
    ? variants.filter(v => v.id === requested.variantId || v.sku === requested.variantId)
    : requested.variant ? variants.filter(v => v.label === requested.variant) : []
  if (variants.length && candidates.length !== 1) throw new InputError(`Wybierz prawidłowy wariant produktu „${product.name}”.`, 409)
  if (!variants.length && (requested.variantId || requested.variant)) throw new InputError('Produkt nie ma wskazanego wariantu.', 409)
  const variant = candidates[0]
  const stock = variant ? variant.stock : product.stock
  if (!Number.isSafeInteger(stock) || Number(stock) < requested.qty) throw new InputError(`Brak wystarczającego stanu: ${product.name}.`, 409)
  const base = product.priceCents != null ? cents(product.priceCents) : legacyCents(product.price)
  const sale = product.salePriceCents != null ? cents(product.salePriceCents) : product.salePrice != null ? legacyCents(product.salePrice) : undefined
  const unitPriceCents = variant?.priceCents != null ? cents(variant.priceCents) : sale != null && sale > 0 && sale < base ? sale : base
  if (unitPriceCents === 0) throw new InputError('Cena produktu wymaga potwierdzenia w katalogu.', 409)
  // Missing variant row IDs make stock reservation ambiguous; never guess.
  if (variant && !variant.id) throw new InputError('Wariant wymaga uzupełnienia identyfikatora w katalogu.', 409)
  return {
    product: product.id, name: product.name, qty: requested.qty, unitPriceCents, lineTotalCents: cents(unitPriceCents * requested.qty, 'wartość pozycji'),
    ...(variant ? { variantId: variant.id!, variant: variant.label } : {}),
    ...(variant?.sku || product.sku ? { sku: variant?.sku || product.sku || undefined } : {}),
    ...(product.taxRate != null ? { taxRate: product.taxRate } : {}),
  }
}
export function mergeQuotedItems(items: QuoteItem[]): QuoteItem[] {
  const merged = new Map<string, QuoteItem>()
  for (const item of items) {
    const key = `${item.product}:${item.variantId || ''}`
    const existing = merged.get(key)
    if (existing) { existing.qty += item.qty; if (existing.qty > 99) throw new InputError('Łączna ilość produktu przekracza 99.'); existing.lineTotalCents = cents(existing.qty * existing.unitPriceCents) }
    else merged.set(key, { ...item })
  }
  return [...merged.values()].sort((a, b) => a.product - b.product || (a.variantId || '').localeCompare(b.variantId || ''))
}

export const PAYMENT_METHODS: readonly PaymentMethodID[] = ['online', 'bank_transfer', 'cod']
export const OFFLINE_PAYMENT_METHODS: readonly PaymentMethodID[] = ['bank_transfer', 'cod']
export const DELIVERY_KINDS: readonly DeliveryKind[] = ['courier', 'pickup_point', 'pickup']
export const PAYMENT_LABELS: Record<PaymentMethodID, string> = {
  online: 'Płatność online (symulacja testowa)',
  bank_transfer: 'Przelew tradycyjny (test, bez numeru rachunku)',
  cod: 'Za pobraniem (test, bez nadania)',
}
export const isOfflinePayment = (method: unknown) => OFFLINE_PAYMENT_METHODS.includes(method as PaymentMethodID)
/** Offline reservations are explicit and bounded: never the 30-minute online default, never indefinite. */
export const OFFLINE_RESERVATION_MINUTES = { min: 60, max: 20_160 } as const
export const ONLINE_RESERVATION_MINUTES = 30

type StoredDelivery = { key?: unknown; label?: unknown; priceCents?: unknown; enabled?: unknown; kind?: unknown; codAllowed?: unknown }
type StoredSettings = { deliveryMethods?: StoredDelivery[] | null; freeShippingThresholdCents?: unknown; testPayments?: { bankTransferEnabled?: unknown; codEnabled?: unknown; offlineReservationMinutes?: unknown; codSurchargeCents?: unknown } | null }
const amount = (value: unknown, min = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= 100_000_000
const blank = (value: unknown) => value === null || value === undefined

/** Editorial validation of stored checkout settings; also used to fail closed at quote time. */
export function checkoutConfigProblems(settings: StoredSettings | null | undefined): string[] {
  const problems: string[] = []
  for (const method of settings?.deliveryMethods || []) {
    if (!blank(method.kind) && !DELIVERY_KINDS.includes(method.kind as DeliveryKind)) problems.push('Nieznany rodzaj dostawy.')
    if (method.codAllowed === true && method.kind === 'pickup') problems.push('Pobranie jest dostępne tylko dla kuriera i punktu odbioru.')
  }
  if (!blank(settings?.freeShippingThresholdCents) && !amount(settings?.freeShippingThresholdCents, 1)) problems.push('Próg darmowej dostawy musi być dodatnią liczbą groszy.')
  const payments = settings?.testPayments || {}
  if (!blank(payments.codSurchargeCents) && !amount(payments.codSurchargeCents)) problems.push('Dopłata za pobranie musi być podana w pełnych groszach.')
  const minutes = payments.offlineReservationMinutes
  if (!blank(minutes) && !(Number.isSafeInteger(minutes) && Number(minutes) >= OFFLINE_RESERVATION_MINUTES.min && Number(minutes) <= OFFLINE_RESERVATION_MINUTES.max)) problems.push(`Rezerwacja offline musi trwać od ${OFFLINE_RESERVATION_MINUTES.min} do ${OFFLINE_RESERVATION_MINUTES.max} minut.`)
  else if ((payments.bankTransferEnabled === true || payments.codEnabled === true) && blank(minutes)) problems.push('Włączenie przelewu lub pobrania wymaga jawnego czasu rezerwacji towaru.')
  return problems
}

/**
 * Resolves the stored settings into the methods a customer may choose. Online
 * is always the signed test adapter. Offline methods exist only when switched on
 * with a valid reservation period; an inconsistent configuration disables them.
 */
export function checkoutConfig(settings: StoredSettings | null | undefined): CheckoutConfig {
  const consistent = checkoutConfigProblems(settings).length === 0
  const stored = settings?.testPayments || {}
  const offlineReservationMinutes = consistent && Number.isSafeInteger(stored.offlineReservationMinutes) ? Number(stored.offlineReservationMinutes) : null
  const bank = offlineReservationMinutes != null && stored.bankTransferEnabled === true
  const cod = offlineReservationMinutes != null && stored.codEnabled === true
  const payments: PaymentOption[] = [{ id: 'online', label: PAYMENT_LABELS.online, offline: false, surchargeCents: 0 }]
  if (bank) payments.push({ id: 'bank_transfer', label: PAYMENT_LABELS.bank_transfer, offline: true, surchargeCents: 0 })
  if (cod) payments.push({ id: 'cod', label: PAYMENT_LABELS.cod, offline: true, surchargeCents: amount(stored.codSurchargeCents) ? Number(stored.codSurchargeCents) : 0 })
  const deliveryMethods: DeliveryMethod[] = (settings?.deliveryMethods || []).filter(m => m.enabled === true).map(m => {
    const kind: DeliveryKind = DELIVERY_KINDS.includes(m.kind as DeliveryKind) ? m.kind as DeliveryKind : 'courier'
    const paymentMethods: PaymentMethodID[] = ['online']
    if (bank) paymentMethods.push('bank_transfer')
    if (cod && m.codAllowed === true && kind !== 'pickup') paymentMethods.push('cod')
    return { id: String(m.key), label: String(m.label), priceCents: cents(m.priceCents, 'cena dostawy'), kind, paymentMethods }
  })
  if (!deliveryMethods.length) deliveryMethods.push({ id: 'test-pickup', label: 'Odbiór testowy — bez realizacji wysyłki', priceCents: 0, kind: 'pickup', paymentMethods: bank ? ['online', 'bank_transfer'] : ['online'] })
  const threshold = consistent && amount(settings?.freeShippingThresholdCents, 1) ? Number(settings!.freeShippingThresholdCents) : null
  return { deliveryMethods, payments, freeShippingThresholdCents: threshold, offlineReservationMinutes }
}

/** Server-side price of a delivery/payment pair; the browser never supplies amounts. */
export function priceSelection(config: CheckoutConfig, subtotalCents: number, deliveryMethod?: unknown, paymentMethod?: unknown) {
  const delivery = deliveryMethod == null || deliveryMethod === '' ? config.deliveryMethods[0] : config.deliveryMethods.find(m => m.id === deliveryMethod)
  if (!delivery) throw new InputError('Wybierz dostępną metodę dostawy.')
  const paymentID = paymentMethod == null || paymentMethod === '' ? 'online' : paymentMethod
  if (!PAYMENT_METHODS.includes(paymentID as PaymentMethodID)) throw new InputError('Nieznana metoda płatności.')
  const payment = config.payments.find(p => p.id === paymentID)
  if (!payment) throw new InputError('Ta metoda płatności jest wyłączona w sklepie testowym.', 409)
  if (!delivery.paymentMethods.includes(payment.id)) throw new InputError('Wybrana płatność nie jest dostępna dla tej metody dostawy.', 409)
  const freeShippingApplied = config.freeShippingThresholdCents != null && subtotalCents >= config.freeShippingThresholdCents
  const deliveryCents = freeShippingApplied ? 0 : delivery.priceCents
  return {
    delivery, payment, deliveryBaseCents: delivery.priceCents, deliveryCents, paymentSurchargeCents: payment.surchargeCents, freeShippingApplied,
    totalCents: cents(subtotalCents + deliveryCents + payment.surchargeCents, 'wartość zamówienia'),
  }
}

export async function quote(payload: Payload, input: unknown, method?: unknown, req?: PayloadRequest, paymentMethod?: unknown): Promise<Quote> {
  const items = requestedItems(input)
  const products = new Map<number, Product>()
  for (const id of new Set(items.map(item => item.id))) {
    const found = await payload.find({ collection: 'products', where: { and: [{ id: { equals: id } }, { published: { equals: true } }] }, limit: 1, depth: 0, overrideAccess: false, req })
    if (!found.docs[0]) throw new InputError('Produkt nie jest dostępny w katalogu.', 409)
    products.set(id, found.docs[0])
  }
  const lines = mergeQuotedItems(items.map(item => catalogLine(products.get(item.id)!, item)))
  // Validate merged quantities, not just each input row (duplicates cannot bypass stock).
  for (const line of lines) catalogLine(products.get(line.product)!, { id: line.product, qty: line.qty, variantId: line.variantId })
  const settings = await payload.findGlobal({ slug: 'settings', depth: 0, overrideAccess: false, req })
  const config = checkoutConfig(settings as unknown as StoredSettings)
  const subtotalCents = cents(lines.reduce((sum, line) => sum + line.lineTotalCents, 0), 'wartość koszyka')
  const selected = priceSelection(config, subtotalCents, method, paymentMethod)
  return {
    items: lines, subtotalCents, deliveryBaseCents: selected.deliveryBaseCents, deliveryCents: selected.deliveryCents, paymentSurchargeCents: selected.paymentSurchargeCents, totalCents: selected.totalCents, currency: 'PLN',
    deliveryMethods: config.deliveryMethods, deliveryMethod: selected.delivery.id, deliveryKind: selected.delivery.kind,
    paymentMethods: config.payments.filter(p => selected.delivery.paymentMethods.includes(p.id)), paymentMethod: selected.payment.id,
    freeShippingThresholdCents: config.freeShippingThresholdCents, freeShippingApplied: selected.freeShippingApplied,
    offlineReservationMinutes: config.offlineReservationMinutes,
    addressRequired: selected.delivery.kind === 'courier', pickupPointRequired: selected.delivery.kind === 'pickup_point',
  }
}
