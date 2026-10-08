import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields } from './fields'

export const Albums: CollectionConfig = {
  slug: 'albums', labels: { singular: 'Album', plural: 'Galerie' },
  admin: { useAsTitle: 'title', group: 'Treści' }, access: publicContentAccess,
  fields: [
    { name: 'title', label: 'Tytuł', type: 'text', required: true },
    { name: 'path', label: 'Adres', type: 'text', required: true, unique: true },
    { name: 'description', label: 'Opis', type: 'textarea' },
    { name: 'date', label: 'Data', type: 'date' },
    { name: 'photos', label: 'Zdjęcia', type: 'array', fields: [
      { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media', required: true },
      { name: 'caption', label: 'Podpis', type: 'text' },
    ] },
    ...contentFields,
  ],
}
