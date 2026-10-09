import type { CollectionConfig, Field, GlobalConfig } from 'payload'

/** Labels only: stored keys, option values and schema remain unchanged. */
const fields: Record<string, string> = {
  number: 'Numer zamówienia', customerName: 'Zamawiający', email: 'E-mail', phone: 'Telefon', address: 'Adres',
  items: 'Pozycje zamówienia', product: 'Produkt', productName: 'Nazwa produktu', sku: 'Kod SKU', variantId: 'Kod wariantu', variant: 'Wariant', qty: 'Ilość',
  price: 'Cena (zł)', unitPriceCents: 'Cena jednostkowa (grosze)', lineTotalCents: 'Wartość pozycji (grosze)', taxRate: 'Podatek (%)',
  total: 'Razem (zł)', subtotalCents: 'Produkty (grosze)', deliveryCents: 'Dostawa (grosze)', totalCents: 'Razem (grosze)', currency: 'Waluta',
  deliveryMethod: 'Kod dostawy', deliveryLabel: 'Metoda dostawy', deliveryKind: 'Rodzaj dostawy', deliveryBaseCents: 'Podstawowy koszt dostawy (grosze)',
  pickupPointId: 'Kod punktu odbioru', pickupPointName: 'Nazwa punktu odbioru', pickupPointAddress: 'Adres punktu odbioru',
  paymentMethod: 'Metoda płatności', paymentLabel: 'Wybrana płatność', paymentSurchargeCents: 'Dopłata za pobranie (grosze)',
  freeShippingThresholdCents: 'Próg darmowej dostawy (grosze)', freeShippingApplied: 'Zastosowano darmową dostawę', reservationMinutes: 'Czas rezerwacji (minuty)',
  status: 'Status', paymentStatus: 'Płatność', paymentReviewRequired: 'Wymaga sprawdzenia płatności', stockReleased: 'Zwolniono rezerwację towaru',
  idempotencyKey: 'Klucz powtórzenia operacji', fingerprint: 'Odcisk danych zamówienia', accessTokenHash: 'Odcisk tokena dostępu',
  expiresAt: 'Rezerwacja do', paidAt: 'Opłacono', shippedAt: 'Testowo nadano', codCollectedAt: 'Potwierdzono pobranie',
  privacyAccepted: 'Zaakceptowano przetwarzanie danych', termsAccepted: 'Zaakceptowano regulamin', consentVersion: 'Wersja zgód', mode: 'Tryb',
  name: 'Imię i nazwisko', message: 'Wiadomość', consent: 'Zgoda', consentAt: 'Data zgody', confirmedAt: 'Potwierdzono', reservationReleased: 'Zwolniono rezerwację',
  order: 'Zamówienie', provider: 'Operator testowy', reference: 'Identyfikator płatności', amountCents: 'Kwota (grosze)', eventKey: 'Identyfikator zdarzenia',
  attempt: 'Próba płatności', digest: 'Odcisk komunikatu', outcome: 'Wynik', accepted: 'Przyjęto', reason: 'Powód',
  deduplicationKey: 'Klucz pojedynczej wiadomości', recipient: 'Odbiorca', subject: 'Temat', body: 'Treść', capturedAt: 'Przechwycono',
  actor: 'Wykonał', targetCollection: 'Rodzaj rekordu', targetId: 'Identyfikator rekordu', command: 'Czynność', beforeStatus: 'Przed zmianą', afterStatus: 'Po zmianie',
  title: 'Tytuł', from: 'Adres poprzedni', to: 'Adres docelowy', runKey: 'Identyfikator importu', sourceKind: 'Rodzaj źródła', manifestHash: 'Odcisk manifestu',
  sourceComplete: 'Potwierdzona kompletność źródła', sourceVerification: 'Weryfikacja źródła', startedAt: 'Rozpoczęto', completedAt: 'Zakończono',
  counts: 'Liczby rekordów', unresolved: 'Pozycje do sprawdzenia', reconciliation: 'Uzgodnienie rekordów', heartbeatAt: 'Ostatni postęp',
  legacyKey: 'Identyfikator źródła', legacyPath: 'Adres źródłowy', sourceHash: 'Odcisk wersji źródła', importRun: 'Identyfikator importu', importedAt: 'Zaimportowano',
}
const values: Record<string, string> = {
  new: 'Nowe', paid: 'Opłacone (test)', shipped: 'Nadane (test)', cancelled: 'Anulowane', expired: 'Wygasłe', pending: 'Oczekujące',
  failed: 'Nieudane', contacted: 'Skontaktowano', enrolled: 'Przyjęto zgłoszenie', rejected: 'Odrzucone', closed: 'Zamknięte',
  unconfirmed: 'Do potwierdzenia', confirmed: 'Potwierdzone', unsubscribed: 'Wypisane', captured: 'Przechwycone (bez wysyłki)',
  test: 'Testowy', online: 'Online (test)', bank_transfer: 'Przelew (test)', cod: 'Pobranie (test)',
  courier: 'Kurier', pickup_point: 'Punkt odbioru', pickup: 'Odbiór osobisty',
  running: 'W toku', completed: 'Zakończony', 'needs-review': 'Do sprawdzenia', 'dry-run': 'Kontrola bez zapisu',
}
function translate(field: Field): Field {
  const result = { ...field } as Field
  if ('name' in field && (!('label' in field) || field.label === undefined) && fields[field.name]) Object.assign(result, { label: fields[field.name] })
  if ('fields' in field) Object.assign(result, { fields: field.fields.map(translate) })
  if ('tabs' in field) Object.assign(result, { tabs: field.tabs.map(tab => ({ ...tab, fields: tab.fields.map(translate) })) })
  if ('options' in field) Object.assign(result, { options: field.options.map(option => typeof option === 'string' && values[option] ? { value: option, label: values[option] } : option) })
  return result
}
export function withPolishCMSLabels<T extends CollectionConfig | GlobalConfig>(config: T): T {
  const labels = 'slug' in config && config.slug === 'redirects' ? { singular: 'Przekierowanie', plural: 'Przekierowania' } : undefined
  return { ...config, ...(labels ? { labels } : {}), fields: config.fields.map(translate) }
}
