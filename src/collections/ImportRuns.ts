import type { CollectionConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { serviceWrite } from './commerceFields'
export const ImportRuns: CollectionConfig = {
  slug: 'import-runs',
  labels: { singular: 'Przebieg importu', plural: 'Przebiegi importu' }, admin: { group: 'Operacje', useAsTitle: 'runKey' },
  access: { read: adminOnly, create: () => false, update: () => false, delete: () => false }, hooks: { beforeChange: [serviceWrite] },
  fields: [ { name: 'runKey', type: 'text', required: true, unique: true }, { name: 'sourceManifestHash', type: 'text', required: true }, { name: 'status', type: 'select', options: ['running', 'complete', 'failed', 'needs-review'], defaultValue: 'running' }, { name: 'sourceType', type: 'text' }, { name: 'counts', type: 'json' }, { name: 'unresolved', type: 'json' }, { name: 'finishedAt', type: 'date' } ],
}
