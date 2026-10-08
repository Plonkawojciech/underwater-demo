import type { CollectionConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { serviceWrite } from './commerceFields'
export const Outbox: CollectionConfig = {
  slug: 'outbox',
  labels: { singular: 'Wiadomość testowa', plural: 'Skrzynka testowa' }, admin: { group: 'Operacje', useAsTitle: 'subject', description: 'Skrzynka testowa. Wiadomości nie są wysyłane do odbiorców.' },
  access: { read: adminOnly, create: () => false, update: () => false, delete: adminOnly }, hooks: { beforeChange: [serviceWrite] },
  fields: [ { name: 'deduplicationKey', type: 'text', unique: true, required: true }, { name: 'recipient', type: 'email', required: true }, { name: 'subject', type: 'text', required: true }, { name: 'body', type: 'textarea', required: true }, { name: 'status', type: 'select', options: ['captured'], defaultValue: 'captured' } ],
}
