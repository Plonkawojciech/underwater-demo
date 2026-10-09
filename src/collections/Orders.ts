import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'
import { operationsOnly, adminOnly } from '../lib/access'
import { internal, serviceWrite } from './commerceFields'

// What the customer accepted at checkout. Later service writes change status only.
const SNAPSHOT = ['number', 'customerName', 'email', 'phone', 'address', 'total', 'subtotalCents', 'deliveryCents', 'deliveryBaseCents', 'paymentSurchargeCents', 'totalCents', 'freeShippingThresholdCents', 'freeShippingApplied', 'currency', 'deliveryMethod', 'deliveryLabel', 'deliveryKind', 'pickupPointId', 'pickupPointName', 'pickupPointAddress', 'paymentMethod', 'paymentLabel', 'reservationMinutes', 'idempotencyKey', 'fingerprint', 'accessTokenHash', 'privacyAccepted', 'termsAccepted', 'consentVersion', 'mode'] as const
const itemSnapshot = (items: unknown) => JSON.stringify(Array.isArray(items) ? items.map(item => Object.fromEntries(['id', 'product', 'productName', 'sku', 'variantId', 'variant', 'qty', 'price', 'unitPriceCents', 'lineTotalCents', 'taxRate'].map(key => [key, key === 'product' && item[key] && typeof item[key] === 'object' ? item[key].id : item[key] ?? null]))) : items)
const immutableSnapshot: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update' || !originalDoc) return data
  for (const field of SNAPSHOT) if (field in data && (data[field] ?? null) !== (originalDoc[field] ?? null)) throw new APIError('Dane zamówienia z chwili złożenia są niezmienne.', 409)
  if ('items' in data && itemSnapshot(data.items) !== itemSnapshot(originalDoc.items)) throw new APIError('Pozycje zamówienia z chwili złożenia są niezmienne.', 409)
  return data
}

export const Orders: CollectionConfig = {
  slug: 'orders', labels: { singular: 'Zamówienie', plural: 'Zamówienia' },
  admin: { useAsTitle: 'number', group: 'Sklep', defaultColumns: ['number', 'customerName', 'total', 'status', 'paymentStatus', 'createdAt'] },
  access: { read: operationsOnly, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeChange: [serviceWrite, immutableSnapshot] },
  fields: [
    { name: 'operationalActions', type: 'ui', admin: { components: { Field: '@/components/admin/RecordActions' } } },
    { name: 'number', type: 'text', required: true, unique: true },
    { name: 'customerName', type: 'text', required: true },
    { name: 'email', type: 'email', required: true }, { name: 'phone', type: 'text' },
    { name: 'address', type: 'textarea' },
    { name: 'items', type: 'array', fields: [
      { name: 'product', type: 'relationship', relationTo: 'products', required: true },
      { name: 'productName', type: 'text', required: true },
      { name: 'sku', type: 'text' }, { name: 'variantId', type: 'text' }, { name: 'variant', type: 'text' },
      { name: 'qty', type: 'number', required: true, min: 1, max: 99 },
      { name: 'price', type: 'number', required: true },
      { name: 'unitPriceCents', type: 'number', required: true, min: 0 },
      { name: 'lineTotalCents', type: 'number', required: true, min: 0 },
      { name: 'taxRate', type: 'number', min: 0, max: 100 },
    ] },
    { name: 'total', type: 'number', required: true },
    internal('subtotalCents', 'number'), internal('deliveryCents', 'number'), internal('totalCents', 'number'),
    { name: 'currency', type: 'select', defaultValue: 'PLN', options: ['PLN'] },
    { name: 'deliveryMethod', type: 'text' }, { name: 'deliveryLabel', type: 'text' },
    { name: 'deliveryKind', type: 'select', options: ['courier', 'pickup_point', 'pickup'], admin: { readOnly: true } },
    { name: 'pickupPointId', type: 'text', maxLength: 40, admin: { readOnly: true, description: 'Punkt wpisany ręcznie przez klienta; brak integracji i weryfikacji przewoźnika.' } },
    { name: 'pickupPointName', type: 'text', maxLength: 120, admin: { readOnly: true } },
    { name: 'pickupPointAddress', type: 'text', maxLength: 300, admin: { readOnly: true } },
    internal('deliveryBaseCents', 'number'), internal('paymentSurchargeCents', 'number'), internal('freeShippingThresholdCents', 'number'),
    { name: 'freeShippingApplied', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
    { name: 'paymentMethod', type: 'select', options: ['online', 'bank_transfer', 'cod'], admin: { readOnly: true, description: 'Puste w starszych zamówieniach = płatność online.' } },
    { name: 'paymentLabel', type: 'text', admin: { readOnly: true } },
    internal('reservationMinutes', 'number'),
    { name: 'status', type: 'select', defaultValue: 'new', options: ['new', 'paid', 'shipped', 'cancelled', 'expired'] },
    { name: 'paymentStatus', type: 'select', defaultValue: 'pending', options: ['pending', 'paid', 'failed', 'cancelled', 'expired'] },
    { name: 'paymentReviewRequired', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
    { name: 'stockReleased', type: 'checkbox', defaultValue: false },
    internal('idempotencyKey', 'text', true), internal('fingerprint'), internal('accessTokenHash', 'text', true),
    internal('expiresAt', 'date'), internal('paidAt', 'date'), internal('shippedAt', 'date'), internal('codCollectedAt', 'date'),
    { name: 'privacyAccepted', type: 'checkbox', required: true },
    { name: 'termsAccepted', type: 'checkbox', required: true },
    { name: 'consentVersion', type: 'text' },
    { name: 'mode', type: 'select', defaultValue: 'test', options: ['test'] },
  ],
}
