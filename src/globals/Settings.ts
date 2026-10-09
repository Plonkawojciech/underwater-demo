import type { GlobalConfig } from 'payload'
import { adminOnly } from '../lib/access'
import { APIError } from 'payload'
import { checkoutConfigProblems } from '../lib/commerce/quote'

export const Settings: GlobalConfig = {
  slug: 'settings',
  label: 'Ustawienia strony',
  admin: { group: 'Treści' },
  access: { read: () => true, update: adminOnly },
  hooks: { beforeValidate: [({ data, originalDoc }) => {
    const keys = new Set<string>()
    for (const method of data?.deliveryMethods || []) {
      if (!/^[a-z0-9_-]{1,80}$/.test(method.key || '') || keys.has(method.key)) throw new APIError('Metody dostawy wymagają unikalnego identyfikatora.', 400)
      if (!Number.isSafeInteger(method.priceCents) || method.priceCents < 0 || method.priceCents > 100_000_000) throw new APIError('Cena dostawy musi być podana w pełnych groszach.', 400)
      keys.add(method.key)
    }
    // A partial update (for example the importer changing a phone number) is
    // validated together with the stored checkout configuration.
    const merged = { ...originalDoc, ...data, testPayments: { ...originalDoc?.testPayments, ...data?.testPayments } }
    const problems = checkoutConfigProblems(merged)
    if (problems.length) throw new APIError(problems[0], 400)
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
    { name: 'deliveryMethods', type: 'array', label: 'Dostawa testowa', admin: { description: 'Tryb testowy: żadna metoda nie nadaje przesyłki ani nie pobiera stawek przewoźnika. Ceny wpisuje obsługa.' }, fields: [
      { name: 'key', type: 'text', required: true }, { name: 'label', type: 'text', required: true },
      { name: 'priceCents', type: 'number', required: true, min: 0 }, { name: 'enabled', type: 'checkbox', defaultValue: false },
      { name: 'kind', label: 'Rodzaj dostawy', type: 'select', options: [
        { label: 'Kurier — adres wymagany', value: 'courier' },
        { label: 'Punkt odbioru — klient wpisuje punkt ręcznie', value: 'pickup_point' },
        { label: 'Odbiór osobisty', value: 'pickup' },
      ], admin: { description: 'Puste pole w starszych wpisach działa jak kurier (adres wymagany).' } },
      { name: 'codAllowed', label: 'Dopuść płatność za pobraniem', type: 'checkbox', defaultValue: false, admin: { description: 'Tylko kurier i punkt odbioru. Wymaga włączenia pobrania w płatnościach testowych.' } },
    ] },
    { name: 'freeShippingThresholdCents', label: 'Darmowa dostawa od (grosze)', type: 'number', min: 1, admin: { description: 'Puste = brak progu. Próg dotyczy wartości produktów; nie znosi dopłaty za pobranie.' } },
    { name: 'testPayments', label: 'Płatności testowe', type: 'group', admin: { description: 'Płatność online jest zawsze dostępna jako symulacja. Przelew i pobranie są wyłączone, dopóki nie zostaną tu jawnie włączone; status zmienia wyłącznie zalogowana obsługa z wpisem w historii operacji.' }, fields: [
      { name: 'bankTransferEnabled', label: 'Przelew tradycyjny (test, bez numeru rachunku)', type: 'checkbox', defaultValue: false },
      { name: 'codEnabled', label: 'Za pobraniem (test, bez nadania)', type: 'checkbox', defaultValue: false },
      { name: 'offlineReservationMinutes', label: 'Rezerwacja towaru dla płatności offline (minuty)', type: 'number', min: 60, max: 20160, admin: { description: 'Wymagane po włączeniu przelewu lub pobrania: 60–20160 min (do 14 dni). Brak wartości wyłącza obie metody. Testy używają 2880 (48 h).' } },
      { name: 'codSurchargeCents', label: 'Dopłata za pobranie (grosze)', type: 'number', min: 0, admin: { description: 'Puste = bez dopłaty.' } },
    ] },
    { name: 'nip', label: 'NIP', type: 'text' },
    { name: 'facebook', label: 'Facebook (URL)', type: 'text' },
    { name: 'youtube', label: 'YouTube (URL)', type: 'text' },
  ],
}
