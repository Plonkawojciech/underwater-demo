import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Użytkownik', plural: 'Użytkownicy' },
  admin: { useAsTitle: 'email', group: 'System' },
  auth: true,
  fields: [{ name: 'name', label: 'Imię i nazwisko', type: 'text' }],
}
