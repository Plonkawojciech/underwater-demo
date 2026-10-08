import type { CollectionConfig } from 'payload'
import { operationsOnly } from '../lib/access'
import { internal, serviceWrite } from './commerceFields'
export const PaymentEvents: CollectionConfig = {
  slug: 'payment-events',
  labels: { singular: 'Zdarzenie płatności', plural: 'Zdarzenia płatności' }, admin: { group: 'Sklep', useAsTitle: 'eventKey' },
  access: { read: operationsOnly, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeChange: [serviceWrite] },
  fields: [internal('eventKey', 'text', true), { name: 'attempt', type: 'relationship', relationTo: 'payment-attempts', required: true }, internal('digest'), { name: 'outcome', type: 'select', options: ['paid', 'failed', 'cancelled'], required: true }, { name: 'accepted', type: 'checkbox', defaultValue: false }, { name: 'reason', type: 'text' }],
}
