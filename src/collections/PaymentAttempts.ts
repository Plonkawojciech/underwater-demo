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
  ],
}
