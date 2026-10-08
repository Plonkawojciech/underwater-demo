import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Trips: CollectionConfig = {
  slug: 'trips', labels: { singular: 'Wyjazd', plural: 'Wyjazdy' },
  admin: { useAsTitle: 'title', group: 'Treści' }, access: publicContentAccess,
  fields: [
    { name: 'title', label: 'Nazwa', type: 'text', required: true },
    { name: 'path', label: 'Adres strony', type: 'text', required: true, unique: true },
    { name: 'location', label: 'Miejsce', type: 'text' },
    { name: 'startsAt', label: 'Początek', type: 'date' },
    { name: 'endsAt', label: 'Koniec', type: 'date' },
    { name: 'priceCents', label: 'Cena w groszach', type: 'number', min: 0 },
    { name: 'lead', label: 'Wprowadzenie', type: 'textarea' },
    longContent,
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'album', label: 'Album', type: 'relationship', relationTo: 'albums' },
    ...contentFields,
  ],
}
