/** Explicit synthetic fixtures for an isolated local test database only. */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getPayload } from 'payload'
import config from '../src/payload.config'

if (process.env.UNDERWATER_ENVIRONMENT !== 'test' || process.env.UNDERWATER_DEMO_SEED !== '1' || process.argv.includes('--force')) throw new Error('Synthetic fixtures require the isolated test environment and UNDERWATER_DEMO_SEED=1. No force/reset is supported.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const payload = await getPayload({ config, disableOnInit: true })
try {
  if ((await payload.count({ collection: 'products' })).totalDocs) throw new Error('Existing catalogue preserved; fixtures require an empty test catalogue.')
  const image = async (file: string, alt: string) => {
    const bytes = await readFile(path.join(root, 'seed-media', file))
    return (await payload.create({ collection: 'media', data: { alt, legacyKey: `synthetic-fixture:${file}`, sourceHash: createHash('sha256').update(bytes).digest('hex') }, filePath: path.join(root, 'seed-media', file) })).id
  }
  const black = await image('SoprasTek_Corona_black.jpg', 'Zdjęcie źródłowe maski — rekord testowy')
  const white = await image('SoprasTek_Corona_white.jpg', 'Zdjęcie źródłowe białej maski — rekord testowy')
  const trainingImage = await image('kurs_owd.jpg', 'Zdjęcie źródłowe zajęć — rekord testowy')
  const hero = await image('hero.jpg', 'Ilustracja nurkowania w środowisku testowym')
  const category = (await payload.create({ collection: 'categories', data: { name: 'TEST — Sprzęt', slug: '9999001-test-sprzet', vmId: 9999001, published: true } })).id
  const child = (await payload.create({ collection: 'categories', data: { name: 'TEST — Maski', slug: '9999001-test-sprzet/9999002-test-maski', vmId: 9999002, parent: category, published: true } })).id
  const products = [
    { vmId: 9999101, name: 'TEST — Maska, dwa warianty', slug: '9999101-test-maska-warianty', category: child, price: 10, stock: 5, images: [black, white], variants: [{ label: 'TEST — czarny', sku: 'TEST-BLACK', stock: 3, image: black }, { label: 'TEST — biały', sku: 'TEST-WHITE', stock: 2, priceCents: 1500, image: white }] },
    { vmId: 9999102, name: 'TEST — Maska, ostatnia sztuka', slug: '9999102-test-ostatnia-sztuka', category: child, price: 20, stock: 1, images: [black] },
    { vmId: 9999103, name: 'TEST — Cena na zapytanie', slug: '9999103-test-cena-na-zapytanie', category: child, price: 0, stock: null, images: [white] },
  ]
  for (const product of products) await payload.create({ collection: 'products', data: { ...product, published: true, featured: true, short: 'Dane syntetyczne do kontroli koszyka. Cena i stan nie stanowią oferty klienta.', body: '<p>Rekord testowy. Nie realizować sprzedaży ani wysyłki.</p>', warranty: null } })
  await payload.create({ collection: 'products', data: { vmId: 9999104, name: 'TEST — Szkic niewidoczny', slug: '9999104-test-szkic', category: child, price: 10, stock: 1, published: false } })
  const course = (await payload.create({ collection: 'courses', data: { name: 'TEST — Zgłoszenie szkoleniowe', slug: 'test-zgloszenie-szkoleniowe', org: 'Inne', level: 'intro', published: true, featured: true, image: trainingImage, lead: 'Syntetyczny kurs do sprawdzenia formularza i rezerwacji miejsc.', body: '<p>Ten rekord nie nadaje uprawnień nurkowych i nie jest ofertą szkolenia.</p>' } })).id
  const start = new Date(Date.now() + 7 * 24 * 60 * 60_000); start.setUTCMinutes(0, 0, 0)
  const startsAt = start.toISOString(), endsAt = new Date(start.getTime() + 2 * 60 * 60_000).toISOString()
  const session = (await payload.create({ collection: 'course-sessions', data: { title: 'TEST — Termin, dwa miejsca', course, startsAt, endsAt, capacity: 2, location: 'Środowisko testowe', published: true } })).id
  const album = (await payload.create({ collection: 'albums', data: { title: 'TEST — Album', path: '/test-album.html', description: 'Zdjęcia do kontroli galerii, bez przypisania do rzeczywistej wyprawy.', published: true, photos: [{ image: trainingImage, caption: 'TEST — pierwsze zdjęcie' }, { image: hero, caption: 'TEST — drugie zdjęcie' }] } })).id
  const trip = (await payload.create({ collection: 'trips', data: { title: 'TEST — Wyprawa', path: '/test-wyprawa.html', startsAt, endsAt, image: hero, album, published: true, lead: 'Syntetyczny termin do testów kalendarza.', body: '<p>Rekord testowy, bez rzeczywistej rezerwacji wyjazdu.</p>' } })).id
  await payload.create({ collection: 'events', data: { title: 'TEST — Wydarzenie', path: '/test-wydarzenie.html', startsAt, endsAt, courseSession: session, trip, published: true } })
  for (const item of [{ title: 'TEST — Aktualność', path: '/test-aktualnosc.html', kind: 'news' as const }, { title: 'TEST — Relacja', path: '/test-relacja.html', kind: 'report' as const }, { title: 'TEST — Polityka prywatności podglądu', path: '/test-prywatnosc.html', kind: 'legal' as const }, { title: 'TEST — Regulamin podglądu', path: '/test-regulamin.html', kind: 'legal' as const }]) await payload.create({ collection: 'pages', data: { ...item, published: true, body: '<p>Wyłącznie dokument testowy. Nie jest obowiązującą polityką ani regulaminem klienta. Formularze wymagają danych syntetycznych; płatności i wiadomości są przechwytywane.</p>' } })
  await payload.create({ collection: 'redirects', data: { from: '/test-stary-adres.html', to: '/test-aktualnosc.html', published: true, reason: 'Syntetyczna kontrola kodu HTTP 301' } })
  await payload.updateGlobal({ slug: 'settings', data: { heroTitle: 'Underwater.pl — podgląd testowy', heroText: 'Katalog, szkolenia, wyprawy i panel zarządzania. Ta lokalna baza zawiera wyłącznie dane do testów.', heroImage: hero, banner: '', priceGuarantee: '', email: 'test@example.invalid', address: 'Adres syntetyczny do testów', deliveryMethods: [{ key: 'test-pickup', label: 'TEST — odbiór bez realizacji', priceCents: 0, enabled: true, kind: 'pickup', codAllowed: false }, { key: 'test-delivery', label: 'TEST — dostawa bez nadania', priceCents: 1500, enabled: true, kind: 'courier', codAllowed: true }, { key: 'test-point', label: 'TEST — punkt wpisany ręcznie', priceCents: 999, enabled: true, kind: 'pickup_point', codAllowed: false }], testPayments: { bankTransferEnabled: true, codEnabled: true, offlineReservationMinutes: 2880, codSurchargeCents: 700 }, freeShippingThresholdCents: 5000 } })
  console.log('Synthetic test fixtures created. No administrator, real mailing, payment or shipment was created.')
} finally { await payload.destroy() }
