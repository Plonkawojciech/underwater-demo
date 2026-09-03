import type { CollectionConfig } from 'payload'

export const Signups: CollectionConfig = {
  slug: 'signups',
  labels: { singular: 'Zgłoszenie na kurs', plural: 'Zgłoszenia na kursy' },
  admin: { useAsTitle: 'name', group: 'Szkolenia', defaultColumns: ['name', 'courseName', 'phone', 'email', 'status', 'createdAt'] },
  access: { create: () => true },
  fields: [
    { name: 'course', label: 'Kurs', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'courseName', label: 'Kurs', type: 'text', virtual: 'course.name', admin: { hidden: true } },
    { name: 'name', label: 'Imię i nazwisko', type: 'text', required: true },
    { type: 'row', fields: [
      { name: 'email', label: 'E-mail', type: 'email', required: true },
      { name: 'phone', label: 'Telefon', type: 'text', required: true },
    ] },
    { name: 'message', label: 'Wiadomość', type: 'textarea' },
    { name: 'status', label: 'Status', type: 'select', defaultValue: 'new', options: [
      { label: 'Nowe', value: 'new' }, { label: 'Skontaktowano', value: 'contacted' }, { label: 'Zapisany', value: 'enrolled' }, { label: 'Odrzucone', value: 'rejected' },
    ], admin: { position: 'sidebar' } },
  ],
}
