import path from 'node:path'
import type { CollectionConfig } from 'payload'
import { contentEditor, adminOnly } from '../lib/access'
import { verifyDocumentUpload } from '../lib/document-upload'
import { clearOnDuplicate, importerOnly } from './fields'

/** Public source downloads have separate storage/type rules from gallery images. */
export const Documents: CollectionConfig = {
  slug: 'documents',
  disableDuplicate: true,
  disableBulkEdit: true,
  labels: { singular: 'Dokument PDF', plural: 'Dokumenty do pobrania' },
  admin: { group: 'Treści', useAsTitle: 'title', description: 'Wyłącznie publiczne materiały do pobrania. Dokumenty klienta i dane prywatne nie trafiają do tej kolekcji.' },
  access: { read: () => true, create: contentEditor, update: contentEditor, delete: adminOnly },
  hooks: { beforeOperation: [verifyDocumentUpload] },
  upload: { staticDir: path.join(process.env.MEDIA_DIR || '', 'documents'), mimeTypes: ['application/pdf'] },
  fields: [
    { name: 'title', label: 'Nazwa dokumentu', type: 'text', required: true },
    { name: 'legacyKey', type: 'text', unique: true, index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'legacyPath', type: 'text', unique: true, index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'sourceHash', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'importRun', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
  ],
}
