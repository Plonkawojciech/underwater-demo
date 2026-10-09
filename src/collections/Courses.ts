import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Courses: CollectionConfig = {
  slug: 'courses',
  labels: { singular: 'Kurs', plural: 'Kursy nurkowania' },
  admin: { useAsTitle: 'name', group: 'Szkolenia', defaultColumns: ['name', 'published', 'org', 'maxDepth', 'price'], description: 'Tutaj opisujesz kurs. Konkretne daty i miejsca zapisów dodaj w „Terminach kursów”.', components: { edit: { SaveButton: '@/components/admin/ValidatedSaveButton' } } },
  access: publicContentAccess,
  fields: [
    { name: 'name', label: 'Nazwa kursu', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { description: 'Np. padi-open-water-diver, bez folderu i .html. Adres kursu: /kursy-nurkowania/padi-open-water-diver.html. Zachowaj adres przeniesionego kursu.' } },
    {
      type: 'row',
      fields: [
        { name: 'org', label: 'Federacja', type: 'select', options: ['PADI', 'IANTD', 'TDI/SDI', 'Freediving', 'Inne'], defaultValue: 'PADI', admin: { width: '33%' } },
        { name: 'level', label: 'Poziom', type: 'select', options: [
          { label: 'Wprowadzenie', value: 'intro' }, { label: 'Podstawowy', value: 'basic' }, { label: 'Zaawansowany', value: 'advanced' }, { label: 'Ratownictwo', value: 'rescue' }, { label: 'Profesjonalny', value: 'pro' }, { label: 'Specjalizacja', value: 'specialty' },
        ], admin: { width: '33%' } },
        { name: 'maxDepth', label: 'Uprawnienia do głębokości (m)', type: 'number', admin: { width: '33%' } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'nextDate', label: 'Najbliższy termin ze źródła', type: 'date', admin: { hidden: true, readOnly: true, width: '33%', date: { pickerAppearance: 'dayAndTime', displayFormat: 'd MMM yyyy HH:mm' } } },
        { name: 'price', label: 'Cena (zł)', type: 'number', admin: { width: '50%', description: 'Cena kursu, jeśli konkretny termin nie ma własnej ceny. Puste pole oznacza cenę do ustalenia.', components: { Field: '@/components/admin/MoneyField' } } },
        { name: 'minAge', label: 'Minimalny wiek', type: 'number', admin: { width: '50%' } },
      ],
    },
    { name: 'lead', label: 'Zajawka (1–2 zdania)', type: 'textarea' },
    longContent,
    { name: 'image', label: 'Zdjęcie główne', type: 'upload', relationTo: 'media' },
    { name: 'gallery', label: 'Galeria', type: 'upload', relationTo: 'media', hasMany: true, admin: { description: 'Dodatkowe zdjęcia widoczne pod opisem kursu.' } },
    {
      name: 'sections',
      label: 'Opis w sekcjach',
      type: 'array',
      labels: { singular: 'Sekcja', plural: 'Sekcje' },
      admin: { condition: data => !data?.body?.trim(), description: 'Sekcje pokazują się, gdy „Pełna treść” jest pusta. Wpisuj zwykły tekst; nagłówki i akapity ułoży strona.' },
      fields: [
        { name: 'title', label: 'Nagłówek', type: 'text', required: true },
        { name: 'body', label: 'Treść', type: 'textarea', required: true },
      ],
    },
    { name: 'includes', label: 'Co obejmuje cena', type: 'array', labels: { singular: 'Pozycja', plural: 'Pozycje' }, fields: [{ name: 'text', label: 'Pozycja', type: 'text', required: true }] },
    { name: 'featured', label: 'Wyróżnij na stronie głównej', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'order', label: 'Kolejność', type: 'number', defaultValue: 0, admin: { position: 'sidebar' } },
    ...contentFields,
  ],
}
