import type { CollectionConfig } from 'payload'

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: { singular: 'Kategoria', plural: 'Kategorie' },
  admin: { useAsTitle: 'name', group: 'Sklep', defaultColumns: ['name', 'vmId', 'parent'] },
  access: { read: () => true },
  fields: [
    { name: 'name', label: 'Nazwa', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { description: 'Np. 80-maski-i-fajki — adres /80-maski-i-fajki.html zostaje taki sam jak dziś' } },
    { name: 'vmId', label: 'ID z VirtueMart', type: 'number', admin: { description: 'Zachowane przy migracji, żeby adresy i pozycje w Google nie zmieniły się' } },
    { name: 'parent', label: 'Kategoria nadrzędna', type: 'relationship', relationTo: 'categories' },
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'order', label: 'Kolejność', type: 'number', defaultValue: 0 },
  ],
}
