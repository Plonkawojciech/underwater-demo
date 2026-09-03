import type { CollectionConfig } from 'payload'

export const Trips: CollectionConfig = {
  slug: 'trips',
  labels: { singular: 'Wyprawa', plural: 'Wyprawy nurkowe' },
  admin: { useAsTitle: 'name', group: 'Szkolenia', defaultColumns: ['name', 'place', 'dateFrom', 'dateTo', 'price'] },
  access: { read: () => true },
  fields: [
    { name: 'name', label: 'Nazwa wyprawy', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { description: 'Adres: /wyprawy-nurkowe/{slug}.html' } },
    { type: 'row', fields: [
      { name: 'place', label: 'Miejsce', type: 'text', admin: { width: '50%' } },
      { name: 'country', label: 'Kraj', type: 'text', admin: { width: '50%' } },
    ] },
    { type: 'row', fields: [
      { name: 'dateFrom', label: 'Od', type: 'date', admin: { width: '33%' } },
      { name: 'dateTo', label: 'Do', type: 'date', admin: { width: '33%' } },
      { name: 'price', label: 'Cena (zł)', type: 'number', admin: { width: '33%' } },
    ] },
    { name: 'flights', label: 'Przelot', type: 'text' },
    { name: 'lead', label: 'Zajawka', type: 'textarea' },
    { name: 'image', label: 'Zdjęcie główne', type: 'upload', relationTo: 'media' },
    { name: 'gallery', label: 'Galeria', type: 'upload', relationTo: 'media', hasMany: true },
    { name: 'sections', label: 'Opis', type: 'array', fields: [
      { name: 'title', label: 'Nagłówek', type: 'text', required: true },
      { name: 'body', label: 'Treść', type: 'textarea', required: true },
    ] },
    { name: 'spotsLeft', label: 'Wolne miejsca', type: 'number', admin: { position: 'sidebar' } },
    { name: 'featured', label: 'Wyróżnij na stronie głównej', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
  ],
}
