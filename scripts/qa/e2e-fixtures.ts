/** Synthetic records for a disposable, explicitly owned loopback test database. */
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '../../src/payload.config'

const root = path.resolve(process.env.UNDERWATER_DATA_ROOT || '')
const origin = new URL(process.env.UNDERWATER_ORIGIN || process.env.NEXT_PUBLIC_SERVER_URL || '')
if (process.env.UNDERWATER_ENVIRONMENT !== 'test' || process.env.UNDERWATER_E2E_FIXTURES !== '1' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
  process.env.DATABASE_URI !== `file:${root}/underwater-test.db` ||
  !/(?:underwater-e2e-|quality-round)/.test(root)) throw new Error('E2E fixtures require an explicitly isolated, disposable loopback test root.')
const marker = await readFile(path.join(root, 'owner.marker'), 'utf8')
if (marker.trim() !== 'underwater-quality-round-20261009-root-only' && marker.trim() !== 'underwater-e2e-ci') throw new Error('The test root is not owned by this harness.')
const password = 'Synthetic-E2E-only-password-20261009'
const payload = await getPayload({ config, disableOnInit: true })
try {
  if ((await payload.count({ collection: 'products', where: { vmId: { equals: 9999201 } }, overrideAccess: true })).totalDocs) throw new Error('Fixture already exists; existing records are preserved.')
  const admin = await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, overrideAccess: true,
    data: { email: 'qa-admin@example.invalid', password, name: 'TEST QA administrator', role: 'admin' } })
  const editor = await payload.create({ collection: 'users', overrideAccess: true, user: admin,
    data: { email: 'qa-editor@example.invalid', password, name: 'TEST QA redaktor', role: 'editor' } })
  const media = (await payload.find({ collection: 'media', limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (!media) throw new Error('Seed synthetic media before preparing the empty CI catalogue.')
  const category = await payload.create({ collection: 'categories', overrideAccess: true,
    data: { name: 'TEST QA sprzęt', slug: '9999200-test-qa-sprzet', vmId: 9999200, published: true } })
  const product = await payload.create({ collection: 'products', overrideAccess: true,
    data: { name: 'TEST QA maska', vmId: 9999201, slug: '9999201-test-qa-maska', category: category.id, price: 35, stock: 100,
      published: true, featured: false, sku: 'TEST-QA-20261009', images: [media.id], short: 'Dane syntetyczne do regresji. Bez sprzedaży i wysyłki.', body: '<p>Produkt testowy.</p>' } })
  const course = await payload.create({ collection: 'courses', overrideAccess: true,
    data: { name: 'TEST QA Kurs nurkowania w suchym skafandrze PADI Dry Suit Diver', slug: 'test-qa-kurs', org: 'Inne', level: 'intro', published: true, image: media.id, lead: 'Kurs testowy.', body: '<p>Opis testowy.</p>' } })
  const start = new Date(Date.now() + 86400000); start.setUTCMinutes(0, 0, 0)
  const session = await payload.create({ collection: 'course-sessions', overrideAccess: true,
    data: { title: 'TEST QA termin', course: course.id, startsAt: start.toISOString(), capacity: 100, priceCents: 12345, location: 'Test lokalny', published: true } })
  const post = await payload.create({ collection: 'pages', overrideAccess: true,
    data: { title: 'TEST QA aktualność', path: '/test-qa-aktualnosc.html', kind: 'news', published: true, body: '<p>Treść testowa.</p>' } })
  await payload.create({ collection: 'pages', overrideAccess: true,
    data: { title: 'Kontakt', path: '/kontakt.html', legacyPath: '/kontakt.html', kind: 'page', published: true, lead: 'Kontakt — dane ze źródła QA',
      body: '<h2>QA legacy instructor biography preserved</h2>' + Array.from({ length: 20 }, (_, i) => `<p>Instruktor testowy ${i + 1}. ${'Długi opis kwalifikacji instruktora z importowanej strony. '.repeat(8)}</p>`).join('') } })
  const enquiry = await payload.create({ collection: 'products', overrideAccess: true,
    data: { name: 'TEST QA produkt bez potwierdzonego stanu', vmId: 9999202, slug: '9999202-test-qa-zapytanie', category: category.id,
      price: 35, stock: null, published: true, images: [media.id], body: '<p>Produkt do regresji zapytania.</p>' } })
  for (const [index, featured] of [true, false, null].entries()) {
    await payload.create({ collection: 'products', overrideAccess: true,
      data: { name: `TEST QA wyróżnienie ${String(featured)}`, vmId: 9999203 + index, slug: `999920${3 + index}-test-qa-wyroznienie-${String(featured)}`,
        category: category.id, price: 35, stock: null, published: false, featured } })
  }
  await payload.updateGlobal({ slug: 'settings', overrideAccess: true, data: {
    email: 'test@example.invalid', phone: '', address: 'Adres testowy',
    deliveryMethods: [{ key: 'test-pickup', label: 'TEST odbiór bez realizacji', priceCents: 0, enabled: true, kind: 'pickup', codAllowed: false }],
    testPayments: { bankTransferEnabled: true, codEnabled: false, offlineReservationMinutes: 2880, codSurchargeCents: 0 },
  } })
  const manifest = { synthetic: true, origin: origin.origin, adminEmail: admin.email, editorEmail: editor.email,
    categoryID: category.id, productID: product.id, enquiryProductID: enquiry.id, courseID: course.id, sessionID: session.id, postID: post.id,
    routes: { home: '/', category: '/' + category.slug + '.html', product: '/' + product.slug + '.html', course: '/kursy-nurkowania/' + course.slug + '.html', cart: '/koszyk', checkout: '/koszyk' } }
  await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'e2e-fixtures.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(manifest))
} finally { await payload.destroy() }
