import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Aktualność', plural: 'Aktualności' },
  admin: { useAsTitle: 'title', group: 'Treści', defaultColumns: ['title', 'publishedAt'] },
  access: { read: () => true },
  fields: [
    { name: 'title', label: 'Tytuł', type: 'text', required: true },
    { name: 'slug', label: 'Adres (slug)', type: 'text', required: true, unique: true },
    { name: 'publishedAt', label: 'Data publikacji', type: 'date', required: true },
    { name: 'excerpt', label: 'Zajawka', type: 'textarea' },
    { name: 'body', label: 'Treść', type: 'textarea' },
    { name: 'image', label: 'Zdjęcie', type: 'upload', relationTo: 'media' },
  ],
}
