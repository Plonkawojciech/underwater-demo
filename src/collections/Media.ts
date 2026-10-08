import type { CollectionConfig } from 'payload'
import { verifyImageUpload } from '../lib/upload'
import { contentEditor, adminOnly } from '../lib/access'
import { clearOnDuplicate, importerOnly } from './fields'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Plik', plural: 'Media' },
  admin: { group: 'System' },
  access: { read: () => true, create: contentEditor, update: contentEditor, delete: adminOnly },
  hooks: { beforeOperation: [verifyImageUpload] },
  upload: {
    staticDir: process.env.MEDIA_DIR,
    imageSizes: [
      { name: 'thumb', width: 480, height: 480, fit: 'inside' },
      { name: 'card', width: 960, fit: 'inside' },
    ],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  },
  fields: [
    { name: 'alt', label: 'Opis (alt)', type: 'text' },
    // Provenance: written only by the importer and seed through the local API (see ./fields).
    { name: 'legacyKey', type: 'text', unique: true, index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'sourceHash', type: 'text', index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'importRun', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
  ],
}
