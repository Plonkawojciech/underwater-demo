import type { CollectionConfig } from 'payload'
import { privateSubmissionAccess } from '../lib/access'
import { serviceWrite } from './commerceFields'

export const Signups: CollectionConfig = {
  slug: 'signups',
  labels: { singular: 'Zgłoszenie na kurs', plural: 'Zgłoszenia na kursy' },
  admin: { useAsTitle: 'name', group: 'Szkolenia', defaultColumns: ['name', 'courseName', 'phone', 'email', 'status', 'createdAt'] },
  access: { ...privateSubmissionAccess, update: () => false, delete: () => false },
  hooks: { beforeChange: [serviceWrite] },
  fields: [
    { name: 'operationalActions', type: 'ui', admin: { components: { Field: '@/components/admin/RecordActions' } } },
    { name: 'course', label: 'Kurs', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'session', type: 'relationship', relationTo: 'course-sessions', index: true },
    { name: 'privacyAccepted', type: 'checkbox', required: true },
    { name: 'consentVersion', type: 'text' },
    { name: 'reservationExpiresAt', type: 'date', index: true, admin: { readOnly: true } },
    { name: 'confirmationTokenHash', type: 'text', unique: true, admin: { hidden: true } },
    { name: 'deduplicationKey', type: 'text', unique: true, admin: { hidden: true } },
    { name: 'emailConfirmedAt', type: 'date', admin: { readOnly: true } },
    { name: 'reservationReleased', type: 'checkbox', defaultValue: false },
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
