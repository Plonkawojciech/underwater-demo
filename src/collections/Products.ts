import type { CollectionConfig } from 'payload'
import { validateCatalog } from '../lib/catalog-validation'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Produkt', plural: 'Produkty' },
  admin: {
    useAsTitle: 'name',
    group: 'Sklep',
    defaultColumns: ['name', 'categoryName', 'price', 'salePrice', 'stock', 'featured'],
    description: 'Każdy produkt ma ten sam adres co dziś: /{ID}-{nazwa}.html',
  },
  access: publicContentAccess,
  hooks: { beforeValidate: [validateCatalog] },
  fields: [
    { name: 'inventoryActions', type: 'ui', admin: { components: { Field: '@/components/admin/InventoryActions' } } },
    { name: 'name', label: 'Nazwa', type: 'text', required: true },
    {
      type: 'row',
      fields: [
        { name: 'vmId', label: 'ID produktu', type: 'number', required: true, unique: true, admin: { width: '25%' } },
        { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { width: '75%', description: 'Np. 3625-maska-soprastek-corona' } },
      ],
    },
    { name: 'category', label: 'Kategoria', type: 'relationship', relationTo: 'categories', required: true },
    { name: 'categories', label: 'Wszystkie kategorie', type: 'relationship', relationTo: 'categories', hasMany: true },
    { name: 'categoryName', label: 'Kategoria', type: 'text', virtual: 'category.name', admin: { hidden: true } },
    { name: 'manufacturer', label: 'Producent', type: 'text' },
    { name: 'sku', label: 'SKU', type: 'text', index: true },
    { name: 'priceCents', label: 'Cena w groszach', type: 'number', min: 0 },
    { name: 'salePriceCents', label: 'Cena promocyjna w groszach', type: 'number', min: 0 },
    { name: 'taxRate', label: 'Stawka VAT (%)', type: 'number', min: 0, max: 100 },
    {
      type: 'row',
      fields: [
        { name: 'price', label: 'Cena (zł)', type: 'number', required: true, admin: { width: '33%' } },
        { name: 'salePrice', label: 'Cena promocyjna (zł)', type: 'number', admin: { width: '33%', description: 'Puste = brak promocji' } },
        { name: 'stock', label: 'Stan magazynowy', type: 'number', defaultValue: 0, admin: { width: '33%', readOnly: true } },
      ],
    },
    { name: 'images', label: 'Zdjęcia', type: 'upload', relationTo: 'media', hasMany: true },
    { name: 'short', label: 'Krótki opis', type: 'textarea' },
    longContent,
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
          { name: 'sku', label: 'SKU wariantu', type: 'text' },
          { name: 'legacyKey', label: 'ID źródłowy', type: 'text' },
          { name: 'priceCents', label: 'Cena w groszach (puste = cena produktu)', type: 'number', min: 0 },
          { name: 'stock', label: 'Stan', type: 'number', defaultValue: 0, admin: { readOnly: true } },
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
    { name: 'warranty', label: 'Gwarancja', type: 'text', admin: { position: 'sidebar' } },
    ...contentFields,
  ],
}
