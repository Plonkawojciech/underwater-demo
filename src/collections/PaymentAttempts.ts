import type { CollectionConfig } from 'payload'
import { operationsOnly } from '../lib/access'
import { internal, serviceWrite } from './commerceFields'
export const PaymentAttempts: CollectionConfig = {
  slug: 'payment-attempts',
  labels: { singular: 'Próba płatności', plural: 'Próby płatności' }, admin: { group: 'Sklep', useAsTitle: 'reference' },
  access: { read: operationsOnly, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeChange: [serviceWrite] },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    { name: 'provider', type: 'text', required: true }, internal('reference', 'text', true),
    internal('amountCents', 'number'), { name: 'currency', type: 'select', options: ['PLN'], defaultValue: 'PLN' },
    { name: 'status', type: 'select', defaultValue: 'pending', options: ['pending', 'paid', 'failed', 'cancelled', 'expired'] },
    internal('expiresAt', 'date'),
    // Online attempts start as a placeholder and are initialized with the adapter
    // after COMMIT. Rows from before these fields stay empty: internal or manual fallback.
    { name: 'initialization', type: 'select', options: ['initializing', 'ready'], admin: { readOnly: true } },
    // Token-free: the shop's own payment page path or the adapter's HTTPS page.
    internal('paymentUrl'), internal('initializationLease'), internal('initializationLeaseUntil', 'date'),
    // Merchant key sent on every start, stored before the first one: a signed event can find
    // the attempt even when the start result was never stored. Older rows stay empty.
    internal('initializationKey', 'text', true),
    // The operator's raw reference, unique only per adapter; `reference` then holds its
    // provider-namespaced form. Older rows keep the raw value in `reference` only.
    { name: 'providerReference', type: 'text', index: true, admin: { readOnly: true } },
  ],
}
