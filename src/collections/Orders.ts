import type { CollectionConfig } from 'payload'

export const Orders: CollectionConfig = {
  slug: 'orders',
  labels: { singular: 'Zamówienie', plural: 'Zamówienia' },
  admin: { useAsTitle: 'number', group: 'Sklep', defaultColumns: ['number', 'customerName', 'total', 'status', 'createdAt'] },
  access: { create: () => true },
  fields: [
    { name: 'number', label: 'Numer', type: 'text', required: true, unique: true },
    { name: 'customerName', label: 'Klient', type: 'text', required: true },
    { type: 'row', fields: [
      { name: 'email', label: 'E-mail', type: 'email', required: true },
      { name: 'phone', label: 'Telefon', type: 'text' },
    ] },
    { name: 'address', label: 'Adres dostawy', type: 'textarea' },
    { name: 'items', label: 'Pozycje', type: 'array', fields: [
      { type: 'row', fields: [
        { name: 'product', label: 'Produkt', type: 'relationship', relationTo: 'products', required: true },
        { name: 'variant', label: 'Wariant', type: 'text' },
        { name: 'qty', label: 'Ilość', type: 'number', required: true, defaultValue: 1 },
        { name: 'price', label: 'Cena', type: 'number', required: true },
      ] },
    ] },
    { name: 'total', label: 'Razem (zł)', type: 'number', required: true },
    { name: 'status', label: 'Status', type: 'select', defaultValue: 'new', options: [
      { label: 'Nowe', value: 'new' }, { label: 'Opłacone', value: 'paid' }, { label: 'Wysłane', value: 'shipped' }, { label: 'Anulowane', value: 'cancelled' },
    ], admin: { position: 'sidebar' } },
  ],
}
