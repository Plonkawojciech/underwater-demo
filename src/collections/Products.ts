import type { CollectionConfig } from 'payload'
import { validateCatalog } from '../lib/catalog-validation'
import { updateCatalogSearch } from '../lib/catalog-search'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Produkt', plural: 'Produkty' },
  admin: {
    useAsTitle: 'name',
    group: 'Sklep',
    defaultColumns: ['name', 'published', 'categoryName', 'price', 'salePrice', 'stock'],
    description: 'Ceny wpisuj w złotych. Po zapisaniu produktu potwierdź dostępność w korekcie magazynu.',
    components: { edit: { SaveButton: '@/components/admin/ValidatedSaveButton' } },
  },
  access: publicContentAccess,
  hooks: { beforeValidate: [validateCatalog, updateCatalogSearch] },
  fields: [
    { name: 'name', label: 'Nazwa', type: 'text', required: true },
    { name: 'searchText', type: 'text', admin: { hidden: true } },
    {
      type: 'row',
      fields: [
        { name: 'vmId', label: 'Numer produktu', type: 'number', required: true, unique: true, admin: { width: '25%', description: 'Unikalny numer katalogowy. Zachowaj numer przeniesionego produktu; dla nowego wybierz numer nieużywany w katalogu.' } },
        { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { width: '75%', description: 'Np. 3625-maska-soprastek-corona, bez ukośnika na początku i bez .html. Strona ma adres /3625-maska-soprastek-corona.html. Zachowaj adres przeniesionego produktu.' } },
      ],
    },
    { name: 'category', label: 'Kategoria główna', type: 'relationship', relationTo: 'categories', required: true, admin: { description: 'Wybierz opublikowaną kategorię, w której klient ma znaleźć produkt.' } },
    { name: 'categories', label: 'Dodatkowe kategorie', type: 'relationship', relationTo: 'categories', hasMany: true, admin: { description: 'Opcjonalne. Produkt pojawi się również w tych kategoriach.' } },
    { name: 'categoryName', label: 'Kategoria', type: 'text', virtual: 'category.name', admin: { hidden: true } },
    { name: 'manufacturer', label: 'Producent', type: 'text' },
    { name: 'sku', label: 'Kod produktu (SKU)', type: 'text', index: true },
    { name: 'priceCents', label: 'Cena w groszach', type: 'number', min: 0, admin: { hidden: true, readOnly: true } },
    { name: 'salePriceCents', label: 'Cena promocyjna w groszach', type: 'number', min: 0, admin: { hidden: true, readOnly: true } },
    { name: 'taxRate', label: 'Stawka VAT (%)', type: 'number', min: 0, max: 100 },
    {
      type: 'row',
      fields: [
        { name: 'price', label: 'Cena (zł)', type: 'number', required: true, admin: { width: '33%', description: 'Np. 129,90. Cena 0 kieruje klienta do zapytania o cenę.', components: { Field: '@/components/admin/MoneyField' } } },
        { name: 'salePrice', label: 'Cena promocyjna (zł)', type: 'number', admin: { width: '33%', description: 'Puste = brak promocji. Wpisz cenę niższą od ceny regularnej.', components: { Field: '@/components/admin/MoneyField' } } },
        { name: 'stock', label: 'Stan magazynowy', type: 'number', defaultValue: 0, admin: { width: '33%', readOnly: true, description: 'Podgląd stanu. Zmianę wykonaj w korekcie magazynu po zapisaniu produktu.' } },
      ],
    },
    { name: 'images', label: 'Zdjęcia', type: 'upload', relationTo: 'media', hasMany: true, admin: { description: 'Pierwsze zdjęcie jest główne. Wybierz z Mediów lub dodaj zdjęcie rzeczywistego modelu.' } },
    { name: 'short', label: 'Krótki opis', type: 'textarea', admin: { description: 'Krótki opis obok zdjęcia i ceny. Pełny opis wpisz niżej.' } },
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
      admin: { description: 'Dodaj tylko rzeczywiste opcje produktu. Każdy wariant ma osobny stan potwierdzany w korekcie magazynu.' },
      fields: [
        { type: 'row', fields: [
          { name: 'label', label: 'Nazwa wariantu', type: 'text', required: true },
          { name: 'sku', label: 'SKU wariantu', type: 'text' },
          { name: 'legacyKey', label: 'ID źródłowy', type: 'text', admin: { description: 'Dla nowego wariantu pozostaw puste; zachowaj identyfikator przeniesionego wariantu.' } },
          { name: 'priceCents', label: 'Cena wariantu (zł)', type: 'number', min: 0, admin: { description: 'Np. 129,90. Puste pole używa aktualnej ceny produktu, także promocji. Własna cena wariantu zastępuje tę cenę.', components: { Field: '@/components/admin/MoneyField' } } },
          { name: 'stock', label: 'Stan', type: 'number', defaultValue: 0, admin: { readOnly: true } },
          { name: 'image', label: 'Zdjęcie wariantu', type: 'upload', relationTo: 'media' },
        ] },
      ],
    },
    { name: 'inventoryActions', type: 'ui', admin: { components: { Field: '@/components/admin/InventoryActions' } } },
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
