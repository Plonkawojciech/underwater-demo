import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Plik', plural: 'Media' },
  admin: { group: 'System' },
  access: { read: () => true },
  upload: {
    staticDir: process.env.MEDIA_DIR || 'media',
    imageSizes: [
      { name: 'thumb', width: 480, height: 480, fit: 'inside' },
      { name: 'card', width: 960, fit: 'inside' },
    ],
    mimeTypes: ['image/*'],
  },
  fields: [{ name: 'alt', label: 'Opis (alt)', type: 'text' }],
}
