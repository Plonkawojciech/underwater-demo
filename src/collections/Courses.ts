import type { CollectionConfig } from 'payload'

export const Courses: CollectionConfig = {
  slug: 'courses',
  labels: { singular: 'Kurs', plural: 'Kursy nurkowania' },
  admin: { useAsTitle: 'name', group: 'Szkolenia', defaultColumns: ['name', 'org', 'maxDepth', 'nextDate', 'price'] },
  access: { read: () => true },
  fields: [
    { name: 'name', label: 'Nazwa kursu', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { description: 'Adres: /kursy-nurkowania/{slug}.html — bez zmian względem obecnej strony' } },
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
        { name: 'nextDate', label: 'Najbliższy termin', type: 'date', admin: { width: '33%', date: { pickerAppearance: 'dayAndTime', displayFormat: 'd MMM yyyy HH:mm' } } },
        { name: 'price', label: 'Cena (zł)', type: 'number', admin: { width: '33%' } },
        { name: 'minAge', label: 'Minimalny wiek', type: 'number', admin: { width: '33%' } },
      ],
    },
    { name: 'lead', label: 'Zajawka (1–2 zdania)', type: 'textarea' },
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'gallery', label: 'Galeria', type: 'upload', relationTo: 'media', hasMany: true },
    {
      name: 'sections',
      label: 'Treść kursu',
      type: 'array',
      labels: { singular: 'Sekcja', plural: 'Sekcje' },
      fields: [
        { name: 'title', label: 'Nagłówek', type: 'text', required: true },
        { name: 'body', label: 'Treść', type: 'textarea', required: true },
      ],
    },
    { name: 'includes', label: 'Co obejmuje cena', type: 'array', fields: [{ name: 'text', label: 'Pozycja', type: 'text', required: true }] },
    { name: 'featured', label: 'Wyróżnij na stronie głównej', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'order', label: 'Kolejność', type: 'number', defaultValue: 0, admin: { position: 'sidebar' } },
  ],
}
