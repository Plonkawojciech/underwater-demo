import type { Payload, PayloadRequest } from 'payload'
import type { Product } from '@/payload-types'
import { cents, InputError, legacyCents, requestedItems, type RequestedItem } from './input'

export type QuoteItem = { product: number; name: string; sku?: string; variantId?: string; variant?: string; qty: number; unitPriceCents: number; lineTotalCents: number; taxRate?: number }
export type DeliveryMethod = { id: string; label: string; priceCents: number }
export type Quote = { items: QuoteItem[]; subtotalCents: number; deliveryCents: number; totalCents: number; currency: 'PLN'; deliveryMethods: DeliveryMethod[]; deliveryMethod: string }

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
export async function quote(payload: Payload, input: unknown, method?: unknown, req?: PayloadRequest): Promise<Quote> {
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
  const configured = (settings as unknown as { deliveryMethods?: Array<{ key: string; label: string; priceCents: number; enabled?: boolean }> }).deliveryMethods || []
  const deliveryMethods: DeliveryMethod[] = configured.filter(m => m.enabled).map(m => ({ id: m.key, label: m.label, priceCents: cents(m.priceCents, 'cena dostawy') }))
  if (!deliveryMethods.length) deliveryMethods.push({ id: 'test-pickup', label: 'Odbiór testowy — bez realizacji wysyłki', priceCents: 0 })
  const selected = method == null || method === '' ? deliveryMethods[0] : deliveryMethods.find(m => m.id === method)
  if (!selected) throw new InputError('Wybierz dostępną metodę dostawy.')
  const subtotalCents = cents(lines.reduce((sum, line) => sum + line.lineTotalCents, 0), 'wartość koszyka')
  return { items: lines, subtotalCents, deliveryCents: selected.priceCents, totalCents: cents(subtotalCents + selected.priceCents), currency: 'PLN', deliveryMethods, deliveryMethod: selected.id }
}
