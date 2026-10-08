import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Strona lub artykuł', plural: 'Strony i aktualności' },
  admin: { useAsTitle: 'title', group: 'Treści', defaultColumns: ['title', 'kind', 'published', 'updatedAt'] },
  access: publicContentAccess,
  fields: [
    { name: 'title', label: 'Tytuł', type: 'text', required: true },
    { name: 'path', label: 'Adres strony', type: 'text', required: true, unique: true, index: true },
    { name: 'kind', label: 'Rodzaj', type: 'select', required: true, options: [
      { label: 'Strona informacyjna', value: 'page' }, { label: 'Aktualność', value: 'news' },
      { label: 'Relacja', value: 'report' }, { label: 'Dokument sklepu', value: 'legal' },
    ] },
    { name: 'lead', label: 'Wprowadzenie', type: 'textarea' },
    longContent,
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'album', label: 'Album', type: 'relationship', relationTo: 'albums' },
    { name: 'publishedAt', label: 'Data publikacji', type: 'date' },
    ...contentFields,
  ],
}
