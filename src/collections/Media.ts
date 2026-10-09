import type { CollectionConfig } from 'payload'
import { verifyImageUpload } from '../lib/upload'
import { contentEditor, adminOnly } from '../lib/access'
import { clearOnDuplicate, importerOnly } from './fields'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Plik', plural: 'Media' },
  admin: { group: 'Treści', useAsTitle: 'alt', defaultColumns: ['filename', 'alt', 'updatedAt'], description: 'Zdjęcia do produktów, kursów i wpisów. Dodaj JPEG, PNG, WebP, GIF lub AVIF do 12 MB, a następnie wybierz plik w edytowanej treści.' },
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
    { name: 'alt', label: 'Opis zdjęcia (alt)', type: 'text', admin: { description: 'Opisz, co widać, np. „Maska Sopras Corona, kolor czarny”. Opis pomaga osobom korzystającym z czytnika ekranu; nie wpisuj samej nazwy pliku.' } },
    // Provenance: written only by the importer and seed through the local API (see ./fields).
    { name: 'legacyKey', type: 'text', unique: true, index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'sourceHash', type: 'text', index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
    { name: 'importRun', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true } },
  ],
}
