import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Events: CollectionConfig = {
  slug: 'events', labels: { singular: 'Wydarzenie', plural: 'Kalendarz' },
  admin: { useAsTitle: 'title', group: 'Treści' }, access: publicContentAccess,
  fields: [
    { name: 'title', label: 'Nazwa', type: 'text', required: true },
    { name: 'startsAt', label: 'Początek', type: 'date', required: true, index: true },
    { name: 'endsAt', label: 'Koniec', type: 'date' },
    { name: 'location', label: 'Miejsce', type: 'text' },
    { name: 'path', label: 'Adres źródłowy', type: 'text' },
    longContent,
    { name: 'courseSession', label: 'Termin kursu', type: 'relationship', relationTo: 'course-sessions' },
    { name: 'trip', label: 'Wyjazd', type: 'relationship', relationTo: 'trips' },
    ...contentFields,
  ],
}
