import type { CollectionConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { serviceWrite } from './commerceFields'
export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  labels: { singular: 'Zdarzenie operacyjne', plural: 'Historia operacji' }, admin: { group: 'Operacje', useAsTitle: 'command' },
  access: { read: adminOnly, create: () => false, update: () => false, delete: () => false }, hooks: { beforeChange: [serviceWrite] },
  fields: [{ name: 'actor', type: 'relationship', relationTo: 'users', required: true }, { name: 'targetCollection', type: 'text', required: true }, { name: 'targetId', type: 'number', required: true }, { name: 'command', type: 'text', required: true }, { name: 'beforeStatus', type: 'text' }, { name: 'afterStatus', type: 'text' }],
}
