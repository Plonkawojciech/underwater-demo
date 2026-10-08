import type { CollectionConfig } from 'payload'
import { privateSubmissionAccess } from '../lib/access'
import { serviceWrite } from './commerceFields'
export const Contacts: CollectionConfig = { slug: 'contacts', labels: { singular: 'Wiadomość', plural: 'Kontakt' }, admin: { group: 'Operacje', useAsTitle: 'name' }, access: { ...privateSubmissionAccess, update: () => false }, hooks: { beforeChange: [serviceWrite] }, fields: [ { name: 'operationalActions', type: 'ui', admin: { components: { Field: '@/components/admin/RecordActions' } } },
  { name: 'name', type: 'text', required: true }, { name: 'email', type: 'email', required: true }, { name: 'phone', type: 'text' }, { name: 'message', type: 'textarea', required: true }, { name: 'privacyAccepted', type: 'checkbox', required: true }, { name: 'consentVersion', type: 'text' }, { name: 'status', type: 'select', options: ['new', 'contacted', 'closed'], defaultValue: 'new' },
] }
