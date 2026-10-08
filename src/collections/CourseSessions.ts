import type { CollectionConfig } from 'payload'
import { validateSession } from '../lib/catalog-validation'
import { publicContentAccess } from '../lib/access'
import { contentFields } from './fields'

export const CourseSessions: CollectionConfig = {
  slug: 'course-sessions', labels: { singular: 'Termin kursu', plural: 'Terminy kursów' },
  admin: { useAsTitle: 'title', group: 'Szkolenia' }, access: publicContentAccess,
  hooks: { beforeValidate: [validateSession] },
  fields: [
    { name: 'title', label: 'Termin', type: 'text', required: true },
    { name: 'course', label: 'Kurs', type: 'relationship', relationTo: 'courses', required: true, index: true },
    { name: 'startsAt', label: 'Początek', type: 'date', required: true, index: true },
    { name: 'endsAt', label: 'Koniec', type: 'date' },
    { name: 'location', label: 'Miejsce', type: 'text' },
    { name: 'priceCents', label: 'Cena w groszach', type: 'number', min: 0 },
    { name: 'capacity', label: 'Potwierdzony limit miejsc', type: 'number', min: 1, admin: { description: 'Puste pole oznacza brak potwierdzonego limitu. Formularz zbiera zgłoszenia; nie deklaruje wolnych miejsc.' } },
    { name: 'reserved', label: 'Zarezerwowane miejsca', type: 'number', min: 0, defaultValue: 0, admin: { readOnly: true } },
    ...contentFields,
  ],
}
