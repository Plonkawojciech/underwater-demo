import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

type Document = { id: number } & Record<string, unknown>
type Role = 'editor' | 'operations' | 'admin'
const productPath = '/9999201-test-qa-maska.html'
const enquiryPath = '/9999202-test-qa-zapytanie.html'
const password = 'Synthetic-E2E-only-password-20261009'

function project() {
  const name = test.info().project.name
  if (!['desktop', 'mobile'].includes(name)) throw new Error('Allocate distinct CMS fixture identifiers for this project.')
  return name
}

function headers() {
  const baseURL = test.info().project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('The client workflow requires the configured isolated harness.')
  return { Origin: new URL(baseURL).origin }
}

async function login(page: Page, role: Role) {
  await page.context().clearCookies()
  await page.goto('/admin/login')
  await page.getByLabel(/e-?mail/i).fill(`qa-${role}@example.invalid`)
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/admin')
  const identity = await page.request.get('/api/users/me', { headers: headers() })
  expect(identity.status()).toBe(200)
  const { user } = await identity.json() as { user: Document }
  expect(user).toMatchObject({ role, email: `qa-${role}@example.invalid` })
  return user
}

async function documents(request: APIRequestContext, collection: string, field: string, value: string | number) {
  const response = await request.get(`/api/${collection}`, { headers: headers(),
    params: { [`where[${field}][equals]`]: String(value), depth: '0', limit: '20' } })
  expect(response.status(), collection).toBe(200)
  return await response.json() as { docs: Document[]; totalDocs: number }
}

async function save(page: Page, collection: string) {
  const saving = page.waitForResponse(response => new RegExp(`^/api/${collection}(?:/\\d+)?$`).test(new URL(response.url()).pathname) && ['POST', 'PATCH'].includes(response.request().method()))
  await page.locator('#action-save').click()
  const response = await saving
  expect(response.status(), `CMS save ${collection}`).toBeGreaterThanOrEqual(200)
  expect(response.status(), `CMS save ${collection}`).toBeLessThan(300)
  const { doc } = await response.json() as { doc: Document }
  expect(Number.isSafeInteger(doc.id)).toBe(true)
  await expect(page).toHaveURL(url => url.pathname === `/admin/collections/${collection}/${doc.id}`)
  return doc
}

async function recordAction(page: Page, collection: string, id: number, status: string) {
  await page.goto(`/admin/collections/${collection}/${id}`)
  const actions = page.locator('.underwater-record-actions')
  await actions.getByLabel('Czynność obsługi', { exact: true }).selectOption(status)
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/records' && response.request().method() === 'POST')
  // The CMS reloads only after parsing an { ok: true } response. Arm this before
  // the click; response bodies belong to the old document and may disappear.
  const refreshed = page.waitForEvent('framenavigated', frame => frame === page.mainFrame())
  await actions.getByRole('button', { name: 'Zapisz status', exact: true }).click()
  const response = await saving
  expect(response.status()).toBe(200)
  await refreshed
  await page.waitForLoadState('domcontentloaded')
  await expect(page).toHaveURL(url => url.pathname === `/admin/collections/${collection}/${id}`)
  const persistedStatus = status === 'bank-paid' ? 'paid' : status
  await expect.poll(async () => (await documents(page.request, collection, 'id', id)).docs[0]?.status).toBe(persistedStatus)
  const statusLabels: Record<string, string> = {
    contacted: 'Skontaktowano', rejected: 'Odrzucone', cancelled: 'Anulowane',
    paid: 'Opłacone (test)', shipped: 'Nadane (test)',
  }
  expect(statusLabels[persistedStatus], `Allocate the actual CMS label for ${persistedStatus}`).toBeTruthy()
  await expect(page.locator('#field-status .rs__single-value')).toHaveText(statusLabels[persistedStatus])
}

async function consent(page: Page) {
  const button = page.getByRole('button', { name: 'Tylko niezbędne', exact: true })
  if (await button.count()) await button.click()
}

async function contact(page: Page, email: string) {
  const form = page.getByRole('form', { name: 'Napisz do nas', exact: true })
  await form.getByLabel('Imię i nazwisko', { exact: true }).fill('TEST CMS zapytanie')
  await form.getByLabel('E-mail', { exact: true }).fill(email)
  await form.getByLabel('Wiadomość', { exact: true }).fill('Test lokalny: proszę o potwierdzenie dostępności. Bez rzeczywistego kontaktu.')
  await form.locator('input[name="privacyAccepted"]').check()
  await form.getByRole('button', { name: 'Wyślij wiadomość', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Wiadomość zapisana' })).toContainText('skrzynce testowej')
}

async function checkout(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto(productPath)
  await consent(page)
  await page.evaluate(() => localStorage.removeItem('uw-cart'))
  await page.reload()
  await page.getByRole('button', { name: 'Dodaj do koszyka', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Dodano do koszyka' })).toBeVisible()
  await page.goto('/koszyk')
  await page.locator('input[name="payment"][value="bank_transfer"]').check()
  await expect(page.getByText('Wersja podglądowa nie podaje numeru rachunku', { exact: false })).toBeVisible()
  await page.locator('input[name="customerName"]').fill('TEST CMS zamówienie')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="phone"]').fill('500000000')
  await page.locator('input[name="termsAccepted"]').check()
  await page.locator('input[name="privacyAccepted"]').check()
  await page.getByRole('button', { name: 'Złóż zamówienie testowe', exact: true }).click()
  await expect(page).toHaveURL(/\/platnosc-testowa\?token=/)
  await expect(page.getByText('Nie wykonuj przelewu', { exact: false }).first()).toBeVisible()
  return page.url()
}

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, environment: 'test', payments: 'test', paymentProvider: 'internal-test', mail: 'captured' })
})

test('staff roles enforce editorial, operational and administrator boundaries', async ({ page, request }) => {
  for (const collection of ['orders', 'contacts', 'signups', 'outbox', 'audit-events']) {
    expect((await request.get(`/api/${collection}`, { headers: headers() })).status(), `anonymous: ${collection}`).toBe(403)
  }
  const editor = await login(page, 'editor')
  for (const collection of ['orders', 'contacts', 'signups', 'outbox', 'audit-events']) {
    expect((await page.request.get(`/api/${collection}`, { headers: headers() })).status(), `editor: ${collection}`).toBe(403)
  }
  const product = (await documents(page.request, 'products', 'vmId', 9999201)).docs[0]
  expect((await page.request.post('/api/operations/records', { headers: headers(), data: { command: 'inventory-adjustment', id: product.id, expectedStock: product.stock, stock: product.stock } })).status()).toBe(403)
  const escalation = await page.request.patch(`/api/users/${editor.id}`, { headers: headers(), data: { role: 'admin' } })
  // Payload may strip a protected field instead of rejecting the whole profile save.
  expect([200, 403]).toContain(escalation.status())
  expect((await (await page.request.get('/api/users/me', { headers: headers() })).json()).user.role).toBe('editor')

  const operations = await login(page, 'operations')
  for (const collection of ['orders', 'contacts', 'signups']) expect((await page.request.get(`/api/${collection}`, { headers: headers() })).status()).toBe(200)
  for (const collection of ['products', 'pages']) expect((await page.request.post(`/api/${collection}`, { headers: headers(), data: {} })).status(), `operations create: ${collection}`).toBe(403)
  const deniedFilename = `test-cms-denied-operations-${project()}.jpg`
  const mediaBefore = await documents(page.request, 'media', 'filename', deniedFilename)
  expect(mediaBefore.totalDocs).toBe(0)
  const mediaUpload = await page.request.post('/api/media', { headers: headers(), multipart: {
    file: { name: deniedFilename, mimeType: 'image/jpeg', buffer: await readFile(path.resolve('seed-media/hero.jpg')) },
    _payload: JSON.stringify({ alt: `TEST CMS denied operations upload ${project()}` }),
  } })
  expect(mediaUpload.status(), 'operations create: valid JPEG media upload').toBe(403)
  expect((await documents(page.request, 'media', 'filename', deniedFilename)).totalDocs).toBe(0)
  expect((await page.request.patch(`/api/products/${product.id}`, { headers: headers(), data: { name: 'TEST forbidden editorial edit' } })).status()).toBe(403)
  expect((await page.request.get('/api/audit-events', { headers: headers() })).status()).toBe(403)
  const operationsEscalation = await page.request.patch(`/api/users/${operations.id}`, { headers: headers(), data: { role: 'admin' } })
  expect([200, 403]).toContain(operationsEscalation.status())
  expect((await (await page.request.get('/api/users/me', { headers: headers() })).json()).user.role).toBe('operations')
  await page.goto(`/admin/collections/products/${product.id}`)
  await expect(page.locator('#field-name')).not.toBeEditable()
  const inventory = page.locator('.underwater-inventory-actions')
  await inventory.getByLabel('Nowy potwierdzony stan', { exact: true }).fill(String(product.stock))
  const correcting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/records' && response.request().method() === 'POST')
  const corrected = page.waitForEvent('framenavigated', frame => frame === page.mainFrame())
  await inventory.getByRole('button', { name: 'Zapisz korektę z audytem', exact: true }).click()
  expect((await correcting).status()).toBe(200)
  await corrected
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('#field-name')).toHaveValue(String(product.name))
  expect((await documents(page.request, 'products', 'id', product.id)).docs[0].stock).toBe(product.stock)

  await login(page, 'admin')
  const staff = await documents(page.request, 'users', 'id', operations.id)
  expect(staff.docs[0]).toMatchObject({ id: operations.id, role: 'operations' })
  expect((await documents(page.request, 'users', 'id', editor.id)).docs[0]).toMatchObject({ id: editor.id, role: 'editor' })
  const audit = await documents(page.request, 'audit-events', 'targetId', product.id)
  expect(audit.docs).toEqual(expect.arrayContaining([expect.objectContaining({ actor: operations.id, targetCollection: 'products', command: 'inventory-adjustment' })]))
})

test('editor creates and publishes a category, then hides it without deletion', async ({ page, request }) => {
  const name = `TEST CMS kategoria ${project()}`
  const slug = `99994${project() === 'desktop' ? '01' : '02'}-test-cms-kategoria`
  await login(page, 'editor')
  await page.goto('/admin/collections/categories/create')
  await page.locator('#field-name').fill(name)
  await page.locator('#field-slug').fill(slug)
  const created = await save(page, 'categories')
  expect((await documents(request, 'categories', 'slug', slug)).totalDocs).toBe(0)
  await page.locator('input[name="published"]').check()
  await save(page, 'categories')
  expect((await page.goto(`/${slug}.html`))?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
  await page.goto(`/admin/collections/categories/${created.id}`)
  await page.locator('input[name="published"]').uncheck()
  await save(page, 'categories')
  expect((await documents(page.request, 'categories', 'slug', slug)).docs[0]).toMatchObject({ id: created.id, published: false })
  expect((await page.goto(`/${slug}.html`))?.status()).toBe(404)
})

test('editor attaches uploaded media to a trip and publishes its inquiry page', async ({ page, request }) => {
  const name = `TEST CMS wyjazd ${project()}`
  const address = `/wyprawy/test-cms-wyjazd-${project()}.html`
  const alt = `TEST CMS zdjęcie wyjazdu ${project()}`
  await login(page, 'editor')
  await page.goto('/admin/collections/media/create')
  await page.locator('input[type="file"]').setInputFiles({ name: `test-cms-trip-${project()}.jpg`, mimeType: 'image/jpeg', buffer: await readFile(path.resolve('seed-media/hero.jpg')) })
  await page.locator('#field-alt').fill(alt)
  const media = await save(page, 'media')
  await page.goto('/admin/collections/trips/create')
  await page.locator('#field-title').fill(name)
  await page.locator('#field-path').fill(address)
  await page.locator('#field-location').fill('TEST miejsce')
  await page.locator('#field-priceCents').fill('12990')
  await page.locator('#field-lead').fill('Wyjazd testowy bez podanej daty.')
  await page.locator('#field-body').fill('Program testowy wyjazdu.\n\nWarunki i miejsca wymagają indywidualnego potwierdzenia.')
  await page.locator('#field-image').getByRole('button', { name: 'Wybierz z istniejących', exact: true }).click()
  await page.getByRole('row').filter({ hasText: alt }).locator('td.cell-filename button').click()
  const created = await save(page, 'trips')
  expect((await documents(page.request, 'trips', 'path', address)).docs[0]).toMatchObject({ id: created.id, image: media.id, priceCents: 12990, published: false })
  expect((await documents(request, 'trips', 'path', address)).totalDocs).toBe(0)
  await page.locator('input[name="published"]').check()
  await save(page, 'trips')
  expect((await page.goto(address))?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
  await expect(page.locator('.chero > img')).toHaveAttribute('src', /test-cms-trip-/)
  await expect(page.locator('.stats')).toContainText(/129,90\s*zł/)
  await expect(page.locator('.longform p')).toHaveText(['Program testowy wyjazdu.', 'Warunki i miejsca wymagają indywidualnego potwierdzenia.'])
  await page.goto('/wyprawy-nurkowe.html?widok=bez-daty')
  await expect(page.locator('.trips').getByRole('link').filter({ hasText: name })).toContainText('Bez podanej daty')
  await page.goto(address)
  await consent(page)
  await page.locator('.aside').getByRole('link', { name: 'Napisz do nas', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Napisz do nas' }).locator('input[name="contextKind"]')).toHaveValue('trip')
  await contact(page, `trip-cms-${project()}@example.invalid`)
  await login(page, 'operations')
  const inquiry = await documents(page.request, 'contacts', 'email', `trip-cms-${project()}@example.invalid`)
  expect(inquiry.totalDocs).toBe(1)
  expect(inquiry.docs[0]).toMatchObject({ contextKind: 'trip', contextID: created.id, contextTitle: name, contextPath: address, status: 'new' })
})

test('unknown stock creates an inquiry for operations without an order or stock promise', async ({ page }) => {
  const email = `stock-inquiry-${project()}@example.invalid`
  await page.goto(enquiryPath)
  await consent(page)
  await expect(page.getByRole('button', { name: 'Dodaj do koszyka', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Zapytaj o dostępność', exact: true }).click()
  await contact(page, email)
  await login(page, 'operations')
  const messages = await documents(page.request, 'contacts', 'email', email)
  expect(messages.totalDocs).toBe(1)
  const message = messages.docs[0]
  const product = (await documents(page.request, 'products', 'vmId', 9999202)).docs[0]
  expect(message).toMatchObject({ contextKind: 'product', contextID: product.id, contextTitle: product.name, contextPath: enquiryPath, status: 'new' })
  expect(product.stock).toBeNull()
  expect((await documents(page.request, 'orders', 'email', email)).totalDocs).toBe(0)
  await recordAction(page, 'contacts', message.id, 'contacted')
  await login(page, 'admin')
  const outbox = await documents(page.request, 'outbox', 'recipient', email)
  expect(outbox.totalDocs).toBe(1)
  expect(outbox.docs[0]).toMatchObject({ status: 'captured', subject: 'Testowe zgłoszenie kontaktowe' })
  const audit = await documents(page.request, 'audit-events', 'targetId', message.id)
  expect(audit.docs).toEqual(expect.arrayContaining([expect.objectContaining({ targetCollection: 'contacts', command: 'update-status', beforeStatus: 'new', afterStatus: 'contacted' })]))
})

test('operations rejects a course application and releases its reserved place once', async ({ page }) => {
  const email = `course-operations-${project()}@example.invalid`
  await login(page, 'operations')
  const session = (await documents(page.request, 'course-sessions', 'title', 'TEST QA termin')).docs[0]
  const reserved = Number(session.reserved)
  await page.context().clearCookies()
  await page.goto('/kursy-nurkowania/test-qa-kurs.html')
  await consent(page)
  await page.locator('select[name="session"]').selectOption(String(session.id))
  await page.locator('input[name="name"]').fill('TEST CMS zgłoszenie operacyjne')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="phone"]').fill('500000000')
  await page.locator('input[name="privacyAccepted"]').check()
  await page.getByRole('button', { name: 'Wyślij zgłoszenie', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Zgłoszenie zapisane' })).toContainText('skrzynce testowej administratora')
  await login(page, 'operations')
  const application = (await documents(page.request, 'signups', 'email', email)).docs[0]
  expect(application).toMatchObject({ session: session.id, status: 'new', reservationReleased: false })
  expect((await documents(page.request, 'course-sessions', 'id', session.id)).docs[0].reserved).toBe(reserved + 1)
  await recordAction(page, 'signups', application.id, 'rejected')
  expect((await documents(page.request, 'signups', 'email', email)).docs[0]).toMatchObject({ status: 'rejected', reservationReleased: true })
  expect((await documents(page.request, 'course-sessions', 'id', session.id)).docs[0].reserved).toBe(reserved)
  await recordAction(page, 'signups', application.id, 'rejected')
  expect((await documents(page.request, 'course-sessions', 'id', session.id)).docs[0].reserved).toBe(reserved)
})

test('operations cancels a pending test order once and preserves the checkout snapshot', async ({ page }) => {
  const email = `order-cancel-cms-${project()}@example.invalid`
  await login(page, 'operations')
  const before = (await documents(page.request, 'products', 'vmId', 9999201)).docs[0]
  const customerURL = await checkout(page, email)
  await login(page, 'operations')
  const order = (await documents(page.request, 'orders', 'email', email)).docs[0]
  expect(order).toMatchObject({ status: 'new', paymentStatus: 'pending', paymentMethod: 'bank_transfer', mode: 'test', stockReleased: false })
  const snapshot = Object.fromEntries(['items', 'customerName', 'email', 'deliveryMethod', 'paymentMethod', 'totalCents'].map(field => [field, order[field]]))
  expect((await documents(page.request, 'products', 'vmId', 9999201)).docs[0].stock).toBe(Number(before.stock) - 1)
  await recordAction(page, 'orders', order.id, 'cancelled')
  const cancelled = (await documents(page.request, 'orders', 'email', email)).docs[0]
  expect(cancelled).toMatchObject({ ...snapshot, status: 'cancelled', paymentStatus: 'cancelled', stockReleased: true })
  expect((await documents(page.request, 'products', 'vmId', 9999201)).docs[0].stock).toBe(before.stock)
  expect((await page.request.patch(`/api/orders/${order.id}`, { headers: headers(), data: { totalCents: 1 } })).status()).toBe(403)
  const repeated = await page.request.post('/api/operations/records', { headers: headers(), data: { collection: 'orders', id: order.id, status: 'cancelled' } })
  expect(repeated.status()).toBe(200)
  expect(await repeated.json()).toMatchObject({ duplicate: true })
  expect((await documents(page.request, 'products', 'vmId', 9999201)).docs[0].stock).toBe(before.stock)
  await expect(page.locator('.underwater-record-actions')).toHaveCount(0)
  await page.goto(customerURL)
  await expect(page.getByRole('status').filter({ hasText: 'Płatność anulowana (test)' })).toBeVisible()
  await login(page, 'admin')
  const audit = await documents(page.request, 'audit-events', 'targetId', order.id)
  expect(audit.docs.filter(record => record.targetCollection === 'orders' && record.afterStatus === 'cancelled')).toHaveLength(1)
})

test('operations simulates a bank payment and shipping while paid-order cancellation is denied', async ({ page }) => {
  const email = `order-paid-cms-${project()}@example.invalid`
  await checkout(page, email)
  const operator = await login(page, 'operations')
  const order = (await documents(page.request, 'orders', 'email', email)).docs[0]
  await page.goto(`/admin/collections/orders/${order.id}`)
  const actions = page.locator('.underwater-record-actions')
  await expect(actions.getByRole('combobox').locator('option[value="shipped"]')).toHaveCount(0)
  const premature = await page.request.post('/api/operations/records', { headers: headers(), data: { collection: 'orders', id: order.id, status: 'shipped' } })
  expect(premature.status()).toBe(409)
  await recordAction(page, 'orders', order.id, 'bank-paid')
  const paid = (await documents(page.request, 'orders', 'email', email)).docs[0]
  expect(paid).toMatchObject({ status: 'paid', paymentStatus: 'paid', totalCents: order.totalCents, stockReleased: false })
  await expect(page.locator('.underwater-record-actions option[value="cancelled"]')).toHaveCount(0)
  const refund = await page.request.post('/api/operations/records', { headers: headers(), data: { collection: 'orders', id: order.id, status: 'cancelled' } })
  expect(refund.status()).toBe(409)
  await recordAction(page, 'orders', order.id, 'shipped')
  expect((await documents(page.request, 'orders', 'email', email)).docs[0]).toMatchObject({ status: 'shipped', paymentStatus: 'paid', stockReleased: false })
  await login(page, 'admin')
  const audit = await documents(page.request, 'audit-events', 'targetId', order.id)
  expect(audit.docs).toEqual(expect.arrayContaining([
    expect.objectContaining({ actor: operator.id, targetCollection: 'orders', command: 'confirm-bank-paid' }),
    expect.objectContaining({ actor: operator.id, targetCollection: 'orders', command: 'update-status', afterStatus: 'shipped' }),
  ]))
  const outbox = await documents(page.request, 'outbox', 'recipient', email)
  expect(outbox.totalDocs).toBeGreaterThan(0)
  expect(outbox.docs.every(record => record.status === 'captured')).toBe(true)
})
