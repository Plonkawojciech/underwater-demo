import type { CollectionConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { internal, serviceWrite } from './commerceFields'
export const Newsletter: CollectionConfig = { slug: 'newsletter',
  labels: { singular: 'Zapis na newsletter', plural: 'Zapisy na newsletter' }, admin: { group: 'Operacje', useAsTitle: 'email' }, access: { read: adminOnly, create: () => false, update: () => false, delete: adminOnly }, hooks: { beforeChange: [serviceWrite] }, fields: [
  { name: 'email', type: 'email', required: true, unique: true }, { name: 'status', type: 'select', options: ['pending', 'active', 'unsubscribed'], defaultValue: 'pending' }, internal('confirmationTokenHash', 'text', true), internal('unsubscribeTokenHash', 'text', true), internal('confirmationExpiresAt', 'date'), internal('confirmedAt', 'date'), internal('unsubscribedAt', 'date'), { name: 'consentVersion', type: 'text' },
] }
