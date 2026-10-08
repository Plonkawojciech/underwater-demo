import { APIError, type CollectionBeforeValidateHook } from 'payload'
import { cents, legacyCents } from './commerce/input'

export const validateCatalog: CollectionBeforeValidateHook = ({ data, originalDoc, req, operation }) => {
  if (!data) return data
  try {
    const trusted = ['order-service', 'reservation-service', 'payment-service', 'import-service', 'operations-service'].includes(String(req.context.systemAction || ''))
    if (!trusted && operation === 'update') {
      if (data.stock !== undefined && data.stock !== originalDoc?.stock) throw new APIError('Stan magazynu zmienił się. Odśwież produkt; korekty wykonuj w obsłudze magazynu.', 409)
      for (const variant of data.variants || []) {
        const old = originalDoc?.variants?.find((item: { id?: string }) => item.id === variant.id)
        if (old && variant.stock !== old.stock) throw new APIError('Stan wariantu zmienił się. Odśwież produkt.', 409)
        if (!old && variant.stock != null && variant.stock !== 0) throw new APIError('Nowy wariant wymaga osobnego potwierdzenia stanu.', 409)
      }
    }
    if (data.price !== undefined && data.price !== originalDoc?.price) {
      const amount = legacyCents(data.price)
      if (data.priceCents != null && data.priceCents !== originalDoc?.priceCents && data.priceCents !== amount) throw new Error('Cena w złotych i groszach jest niespójna.')
      data.priceCents = amount
    } else if (data.priceCents != null && data.priceCents !== originalDoc?.priceCents) data.price = cents(data.priceCents) / 100
    if (data.salePrice !== undefined && data.salePrice !== originalDoc?.salePrice) data.salePriceCents = data.salePrice == null ? null : legacyCents(data.salePrice)
    else if (data.salePriceCents !== undefined && data.salePriceCents !== originalDoc?.salePriceCents) data.salePrice = data.salePriceCents == null ? null : cents(data.salePriceCents) / 100
    const checkStock = (stock: unknown) => { if (stock != null && (!Number.isSafeInteger(stock) || Number(stock) < 0 || Number(stock) > 1_000_000)) throw new Error('Stan magazynowy musi być nieujemną liczbą całkowitą.') }
    checkStock(data.stock)
    if (Array.isArray(data.variants)) {
      for (const variant of data.variants) { checkStock(variant.stock); if (variant.priceCents != null) cents(variant.priceCents) }
      if (data.variants.length) data.stock = data.variants.some(variant => variant.stock == null) ? null : data.variants.reduce((sum, variant) => sum + Number(variant.stock), 0)
    }
    if (data.taxRate != null && (typeof data.taxRate !== 'number' || !Number.isFinite(data.taxRate) || data.taxRate < 0 || data.taxRate > 100)) throw new Error('Nieprawidłowa stawka VAT.')
  } catch (error) { if (error instanceof APIError) throw error; throw new APIError(error instanceof Error ? error.message : 'Nieprawidłowe dane katalogu.', 400) }
  return data
}
export const validateSession: CollectionBeforeValidateHook = ({ data, originalDoc, req, operation }) => {
  if (!data) return data
  const value = { ...originalDoc, ...data }
  const trusted = ['form-service', 'reservation-service', 'import-service', 'operations-service'].includes(String(req.context.systemAction || ''))
  if (!trusted && operation === 'update' && data.reserved != null && data.reserved !== (originalDoc?.reserved ?? 0)) throw new APIError('Rezerwacje zmienia wyłącznie proces zgłoszeń.', 403)
  if (!trusted && operation === 'create' && Number(data.reserved || 0) !== 0) throw new APIError('Nowy termin nie może mieć ręcznie zarezerwowanych miejsc.', 403)
  if (value.capacity != null && (!Number.isSafeInteger(value.capacity) || value.capacity < 1)) throw new APIError('Limit miejsc musi być dodatnią liczbą całkowitą.', 400)
  if (!Number.isSafeInteger(value.reserved ?? 0) || Number(value.reserved || 0) < 0 || (value.capacity != null && Number(value.reserved || 0) > value.capacity)) throw new APIError('Limit miejsc nie może być niższy niż liczba rezerwacji.', 400)
  if (value.endsAt && value.startsAt && new Date(value.endsAt) < new Date(value.startsAt)) throw new APIError('Koniec terminu nie może poprzedzać początku.', 400)
  return data
}
