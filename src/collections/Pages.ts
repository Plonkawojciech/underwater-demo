import type { CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields, longContent } from './fields'

const isListing = (data: { listing?: unknown } | undefined) => Boolean(data?.listing)

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Strona lub artykuł', plural: 'Strony i aktualności' },
  admin: { useAsTitle: 'title', group: 'Treści', defaultColumns: ['title', 'kind', 'published', 'updatedAt'], description: 'Dodaj aktualność, relację albo stronę informacyjną. „Rodzaj” określa, w którym archiwum pojawi się wpis.' },
  access: publicContentAccess,
  fields: [
    { name: 'title', label: 'Tytuł', type: 'text', required: true },
    { name: 'path', label: 'Adres strony', type: 'text', required: true, unique: true, index: true, admin: { description: 'Np. /aktualnosci/nowy-kurs.html, z ukośnikiem na początku, bez domeny i spacji. Zachowaj adres przeniesionego wpisu; nie używaj adresów sekcji, np. /aktualnosci.html.' } },
    { name: 'kind', label: 'Rodzaj', type: 'select', required: true, options: [
      { label: 'Strona informacyjna', value: 'page' }, { label: 'Aktualność', value: 'news' },
      { label: 'Relacja', value: 'report' }, { label: 'Dokument sklepu', value: 'legal' },
    ] },
    { name: 'lead', label: 'Wprowadzenie', type: 'textarea', admin: { description: 'Krótki tekst nad pełną treścią oraz na liście wpisów.' } },
    longContent,
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'album', label: 'Album', type: 'relationship', relationTo: 'albums' },
    { name: 'publishedAt', label: 'Data publikacji', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime', displayFormat: 'd MMM yyyy HH:mm' }, description: 'Data widoczna przy aktualności lub relacji i używana do sortowania. Nie planuje automatycznej publikacji; widoczność włączasz polem „Opublikowane”.' } },
    // Product list of the old shop (category, producer filter or a further results page). The page shows
    // the linked products from the catalogue, so their prices and visibility stay with the product records.
    { name: 'listing', label: 'Lista produktów', type: 'checkbox', admin: { description: 'Tylko dla stron katalogu: pokazuje produkty wskazane poniżej. Przy zwykłej aktualności lub relacji pozostaw wyłączone.' } },
    // maxDepth 0: the view reads members through the public product query, never from population.
    { name: 'listingCategory', label: 'Kategoria listy', type: 'relationship', relationTo: 'categories', maxDepth: 0, admin: { condition: isListing } },
    { name: 'listingProducts', label: 'Produkty na liście', type: 'relationship', relationTo: 'products', hasMany: true, maxDepth: 0, admin: { condition: isListing } },
    {
      name: 'listingMissing', label: 'Pozycje bez produktu w sklepie', type: 'array', labels: { singular: 'Pozycja listy', plural: 'Pozycje listy' }, admin: { condition: isListing },
      fields: [
        { name: 'title', label: 'Nazwa', type: 'text', required: true },
        { name: 'legacyPath', label: 'Historyczny adres', type: 'text' },
      ],
    },
    {
      type: 'row', admin: { condition: isListing },
      fields: [
        { name: 'listingFrom', label: 'Wyniki od', type: 'number', min: 1, admin: { step: 1 } },
        { name: 'listingTo', label: 'Wyniki do', type: 'number', min: 1, admin: { step: 1 } },
        { name: 'listingTotal', label: 'Wyników łącznie', type: 'number', min: 1, admin: { step: 1 } },
      ],
    },
    {
      name: 'listingLinks', label: 'Inne strony wyników', type: 'array', labels: { singular: 'Link do wyników', plural: 'Linki do wyników' }, maxRows: 50, admin: { condition: isListing },
      fields: [
        { name: 'label', label: 'Etykieta', type: 'text', required: true },
        { name: 'path', label: 'Adres', type: 'text', required: true },
      ],
    },
    ...contentFields,
  ],
}
