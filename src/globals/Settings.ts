import type { GlobalConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { APIError } from 'payload'

export const Settings: GlobalConfig = {
  slug: 'settings',
  label: 'Ustawienia strony',
  admin: { group: 'Treści' },
  access: { read: () => true, update: adminOnly },
  hooks: { beforeValidate: [({ data }) => {
    const keys = new Set<string>()
    for (const method of data?.deliveryMethods || []) {
      if (!/^[a-z0-9_-]{1,80}$/.test(method.key || '') || keys.has(method.key)) throw new APIError('Metody dostawy wymagają unikalnego identyfikatora.', 400)
      if (!Number.isSafeInteger(method.priceCents) || method.priceCents < 0 || method.priceCents > 100_000_000) throw new APIError('Cena dostawy musi być podana w pełnych groszach.', 400)
      keys.add(method.key)
    }
    return data
  }] },
  fields: [
    { name: 'banner', label: 'Pasek na górze strony', type: 'text', admin: { description: 'Np. „Rozpocznij kurs nurkowania 07.09 lub 14.09 w Warszawie”' } },
    { name: 'heroTitle', label: 'Nagłówek strony głównej', type: 'text' },
    { name: 'heroText', label: 'Tekst pod nagłówkiem', type: 'textarea' },
    { name: 'heroImage', label: 'Zdjęcie w tle', type: 'upload', relationTo: 'media' },
    { name: 'priceGuarantee', label: 'Gwarancja najniższej ceny (treść)', type: 'textarea' },
    { type: 'row', fields: [
      { name: 'phone', label: 'Telefon', type: 'text' },
      { name: 'email', label: 'E-mail', type: 'email' },
    ] },
    { name: 'address', label: 'Adres', type: 'textarea' },
    { name: 'deliveryMethods', type: 'array', label: 'Dostawa testowa', fields: [
      { name: 'key', type: 'text', required: true }, { name: 'label', type: 'text', required: true },
      { name: 'priceCents', type: 'number', required: true, min: 0 }, { name: 'enabled', type: 'checkbox', defaultValue: false },
    ] },
    { name: 'nip', label: 'NIP', type: 'text' },
    { name: 'facebook', label: 'Facebook (URL)', type: 'text' },
    { name: 'youtube', label: 'YouTube (URL)', type: 'text' },
  ],
}
