import { APIError, type CollectionConfig } from 'payload'
import { publicContentAccess } from '../lib/access'
import { contentFields } from './fields'

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: { singular: 'Kategoria', plural: 'Kategorie' },
  admin: { useAsTitle: 'name', group: 'Sklep', defaultColumns: ['name', 'vmId', 'parent'] },
  access: publicContentAccess,
  hooks: { beforeDelete: [async ({ id, req }) => {
    const references = await req.payload.count({ collection: 'pages', where: { listingCategory: { equals: id } }, overrideAccess: true, req })
    if (references.totalDocs) throw new APIError('Ta kategoria jest używana przez listę produktów. Najpierw zmień kategorię tej listy.', 400)
  }] },
  fields: [
    { name: 'name', label: 'Nazwa', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true, admin: { description: 'Np. 80-maski-i-fajki — adres /80-maski-i-fajki.html zostaje taki sam jak dziś' } },
    { name: 'vmId', label: 'ID z VirtueMart', type: 'number', hooks: { beforeDuplicate: [() => null] }, admin: { description: 'Zachowane przy migracji, żeby adresy i pozycje w Google nie zmieniły się' } },
    { name: 'parent', label: 'Kategoria nadrzędna', type: 'relationship', relationTo: 'categories' },
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
    { name: 'order', label: 'Kolejność', type: 'number', defaultValue: 0 },
    ...contentFields,
  ],
}
