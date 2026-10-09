import type { Field, FieldAccess, FieldHook } from 'payload'
import { sanitizeContent } from '../lib/html'

// Import provenance is written only by the importer and seed through the local API
// (overrideAccess: true). REST and admin writes cannot set or change it, and a duplicate
// starts as an unpublished record without provenance or a historical address, so it never
// claims the original's public address or a source key.
export const importerOnly: { create: FieldAccess; update: FieldAccess } = { create: () => false, update: () => false }
export const clearOnDuplicate: FieldHook[] = [() => null]
const draftOnDuplicate: FieldHook[] = [() => false]

export const contentFields: Field[] = [
  { name: 'published', label: 'Opublikowane', type: 'checkbox', defaultValue: false, index: true, admin: { position: 'sidebar' }, hooks: { beforeDuplicate: draftOnDuplicate } },
  { name: 'legacyKey', label: 'Identyfikator źródłowy', type: 'text', unique: true, index: true, access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true, position: 'sidebar' } },
  { name: 'sourceHash', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true, hidden: true } },
  { name: 'importRun', type: 'text', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true, hidden: true } },
  { name: 'importedAt', type: 'date', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true, hidden: true } },
  { name: 'sourceUpdatedAt', type: 'date', access: importerOnly, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { readOnly: true, hidden: true } },
  { name: 'legacyPath', label: 'Historyczny adres', type: 'text', index: true, hooks: { beforeDuplicate: clearOnDuplicate }, admin: { position: 'sidebar' } },
  {
    name: 'seo', label: 'Wyszukiwarki', type: 'group',
    fields: [
      { name: 'title', label: 'Tytuł strony', type: 'text' },
      { name: 'description', label: 'Opis', type: 'textarea' },
      { name: 'image', label: 'Zdjęcie udostępniania', type: 'upload', relationTo: 'media' },
    ],
  },
]

export const longContent: Field = {
  name: 'body', label: 'Pełna treść', type: 'textarea',
  // Source DTOs stay capped at 1 MB. Sanitization adds safe attributes and
  // escapes entities, so normalized HTML needs room beyond that input bound.
  // Other text fields and credentials keep their existing limits.
  maxLength: 8_000_000,
  validate: (value: unknown) => {
    if (value == null) return true
    if (typeof value !== 'string' || value.length > 8_000_000) return 'Treść przekracza dopuszczalny rozmiar.'
    try { sanitizeContent(value) } catch { return 'Treść po oczyszczeniu przekracza dopuszczalny rozmiar.' }
    return true
  },
  admin: { description: 'Treść HTML ze źródła; przed publikacją aplikacja usuwa niebezpieczne elementy.' },
}
