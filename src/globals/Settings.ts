import type { GlobalConfig } from 'payload'

export const Settings: GlobalConfig = {
  slug: 'settings',
  label: 'Ustawienia strony',
  admin: { group: 'Treści' },
  access: { read: () => true },
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
    { name: 'nip', label: 'NIP', type: 'text' },
    { name: 'facebook', label: 'Facebook (URL)', type: 'text' },
    { name: 'youtube', label: 'YouTube (URL)', type: 'text' },
  ],
}
