import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Produkt', plural: 'Produkty' },
  admin: {
    useAsTitle: 'name',
    group: 'Sklep',
    defaultColumns: ['name', 'categoryName', 'price', 'salePrice', 'stock', 'featured'],
    description: 'Każdy produkt ma ten sam adres co dziś: /{ID}-{nazwa}.html',
  },
  access: { read: () => true },
  fields: [
    { name: 'name', label: 'Nazwa', type: 'text', required: true },
    {
      type: 'row',
      fields: [
        { name: 'vmId', label: 'ID produktu', type: 'number', required: true, unique: true, admin: { width: '25%' } },
        { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { width: '75%', description: 'Np. 3625-maska-soprastek-corona' } },
      ],
    },
    { name: 'category', label: 'Kategoria', type: 'relationship', relationTo: 'categories', required: true },
    { name: 'categoryName', label: 'Kategoria', type: 'text', virtual: 'category.name', admin: { hidden: true } },
    { name: 'manufacturer', label: 'Producent', type: 'text' },
    {
      type: 'row',
      fields: [
        { name: 'price', label: 'Cena (zł)', type: 'number', required: true, admin: { width: '33%' } },
        { name: 'salePrice', label: 'Cena promocyjna (zł)', type: 'number', admin: { width: '33%', description: 'Puste = brak promocji' } },
        { name: 'stock', label: 'Stan magazynowy', type: 'number', defaultValue: 0, admin: { width: '33%' } },
      ],
    },
    { name: 'images', label: 'Zdjęcia', type: 'upload', relationTo: 'media', hasMany: true },
    { name: 'short', label: 'Krótki opis', type: 'textarea' },
    {
      name: 'features',
      label: 'Cechy produktu',
      type: 'array',
      labels: { singular: 'Cecha', plural: 'Cechy' },
      fields: [{ name: 'text', label: 'Treść', type: 'text', required: true }],
    },
    {
      name: 'variants',
      label: 'Warianty (np. kolor, rozmiar)',
      type: 'array',
      labels: { singular: 'Wariant', plural: 'Warianty' },
      fields: [
        { type: 'row', fields: [
          { name: 'label', label: 'Nazwa wariantu', type: 'text', required: true },
          { name: 'stock', label: 'Stan', type: 'number', defaultValue: 0 },
          { name: 'image', label: 'Zdjęcie wariantu', type: 'upload', relationTo: 'media' },
        ] },
      ],
    },
    {
      name: 'specs',
      label: 'Dane techniczne',
      type: 'array',
      labels: { singular: 'Parametr', plural: 'Parametry' },
      fields: [{ type: 'row', fields: [
        { name: 'key', label: 'Parametr', type: 'text', required: true },
        { name: 'value', label: 'Wartość', type: 'text', required: true },
      ] }],
    },
    { name: 'featured', label: 'Pokaż w promocjach na stronie głównej', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'warranty', label: 'Gwarancja', type: 'text', defaultValue: '24 miesiące', admin: { position: 'sidebar' } },
  ],
}
