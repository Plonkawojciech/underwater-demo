import type { CollectionConfig } from 'payload'
import { operationsOnly, adminOnly } from '../lib/access'
import { internal, serviceWrite } from './commerceFields'

export const Orders: CollectionConfig = {
  slug: 'orders', labels: { singular: 'Zamówienie', plural: 'Zamówienia' },
  admin: { useAsTitle: 'number', group: 'Sklep', defaultColumns: ['number', 'customerName', 'total', 'status', 'paymentStatus', 'createdAt'] },
  access: { read: operationsOnly, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeChange: [serviceWrite] },
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
    { name: 'status', type: 'select', defaultValue: 'new', options: ['new', 'paid', 'shipped', 'cancelled', 'expired'] },
    { name: 'paymentStatus', type: 'select', defaultValue: 'pending', options: ['pending', 'paid', 'failed', 'cancelled', 'expired'] },
    { name: 'paymentReviewRequired', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
    { name: 'stockReleased', type: 'checkbox', defaultValue: false },
    internal('idempotencyKey', 'text', true), internal('fingerprint'), internal('accessTokenHash', 'text', true),
    internal('expiresAt', 'date'), internal('paidAt', 'date'),
    { name: 'privacyAccepted', type: 'checkbox', required: true },
    { name: 'termsAccepted', type: 'checkbox', required: true },
    { name: 'consentVersion', type: 'text' },
    { name: 'mode', type: 'select', defaultValue: 'test', options: ['test'] },
  ],
}
