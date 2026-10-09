import { test, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

type CMSDocument = { id: number } & Record<string, unknown>
const password = 'Synthetic-E2E-only-password-20261009'

function variant(info: TestInfo) {
  const project = info.project.name
  if (project !== 'desktop' && project !== 'mobile') throw new Error('Allocate unique CMS fixture identifiers before adding another E2E project.')
  return { project, vmId: project === 'desktop' ? 9999301 : 9999302 }
}

async function login(page: Page, role: 'editor' | 'admin' = 'editor') {
  await page.goto('/admin/login')
  await page.getByLabel(/e-?mail/i).fill(`qa-${role}@example.invalid`)
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/admin')
}

async function documents(request: APIRequestContext, collection: string, field: string, value: string | number) {
  const baseURL = test.info().project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('CMS API assertions require the configured isolated harness origin.')
  const response = await request.get(`/api/${collection}`, {
    // APIRequestContext shares cookies but does not send browser Fetch Metadata.
    // Payload requires the allowed origin before accepting an auth cookie.
    headers: { Origin: new URL(baseURL).origin },
    params: { [`where[${field}][equals]`]: String(value), depth: '0', limit: '2' },
  })
  expect(response.status()).toBe(200)
  const result = await response.json() as { docs: CMSDocument[]; totalDocs: number }
  expect(Array.isArray(result.docs)).toBe(true)
  return result
}

async function saveShortcut(page: Page) {
  // Payload chooses its modifier from the emulated user agent, while
  // Playwright's ControlOrMeta follows the host operating system.
  const key = await page.evaluate(() => navigator.userAgent.includes('Mac OS X') ? 'Meta+s' : 'Control+s')
  await page.keyboard.press(key)
}

async function save(page: Page, collection: string, mode: 'click' | 'enter' | 'shortcut' = 'click'): Promise<CMSDocument> {
  const responsePromise = page.waitForResponse(response => {
    const pathname = new URL(response.url()).pathname
    return new RegExp(`^/api/${collection}(?:/\\d+)?$`).test(pathname) && ['POST', 'PATCH'].includes(response.request().method())
  })
  if (mode === 'enter') await page.locator('#field-name').press('Enter')
  else if (mode === 'shortcut') {
    await page.locator('#field-name').focus()
    await saveShortcut(page)
  } else await page.locator('#action-save').click()
  const response = await responsePromise
  expect(response.status(), `CMS save ${collection}`).toBeGreaterThanOrEqual(200)
  expect(response.status(), `CMS save ${collection}`).toBeLessThan(300)
  const result = await response.json() as { doc?: CMSDocument }
  expect(result.doc, 'A successful form save must return the persisted document').toBeTruthy()
  expect(Number.isSafeInteger(result.doc!.id)).toBe(true)
  await expect(page).toHaveURL(url => new RegExp(`^/admin/collections/${collection}/\\d+$`).test(url.pathname))
  return result.doc!
}

async function invalidMoneyBlocksEverySave(page: Page, collection: string, priceField: string, key: string, value: string | number) {
  const writes: string[] = []
  const observe = (candidate: import('@playwright/test').Request) => {
    if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === `/api/${collection}`) writes.push(candidate.url())
  }
  page.on('request', observe)
  try {
    for (const mode of ['click', 'enter', 'shortcut']) {
      await page.locator(`#field-${priceField}`).fill('1,234')
      if (mode === 'click') await page.locator('#action-save').click()
      else {
        const title = page.locator(collection === 'course-sessions' ? '#field-title' : '#field-name')
        await title.focus()
        if (mode === 'enter') await title.press('Enter')
        else await saveShortcut(page)
      }
      await expect(page.locator(`#field-${priceField}`)).toHaveAttribute('aria-invalid', 'true')
      await expect(page.locator(`#field-${priceField}`), `The ${mode} save attempt must focus the invalid money input`).toBeFocused()
      await expect(page.getByText('Wpisz kwotę w złotych, np. 129,90, z najwyżej dwoma miejscami po przecinku.', { exact: true }).first()).toBeVisible()
      await expect(page.locator('#action-save')).toBeEnabled()
      expect((await documents(page.request, collection, key, value)).totalDocs, mode).toBe(0)
      expect(writes, `Invalid money must not send a document write via ${mode}`).toEqual([])
    }
  } finally { page.off('request', observe) }
}

async function select(page: Page, field: string, label: string) {
  const input = page.locator(`#field-${field}`).getByRole('combobox')
  await input.click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function category(page: Page) {
  const input = page.locator('#field-category').getByRole('combobox')
  await input.fill('TEST QA sprzęt')
  await page.getByRole('option', { name: 'TEST QA sprzęt', exact: true }).click()
}

async function publish(page: Page, collection: string) {
  await page.locator('input[name="published"]').check()
  return save(page, collection)
}

async function visibleParagraphs(page: Page, first: string, second: string) {
  const body = page.locator('main .longform').filter({ hasText: first })
  await expect(body.locator('p')).toHaveText([first, second])
}

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, environment: 'test', payments: 'test', paymentProvider: 'internal-test', mail: 'captured' })
})

test('editor creates a draft product, rejects excessive price precision and publishes safe paragraphs', async ({ page, request }, info) => {
  const { project, vmId } = variant(info)
  const name = `TEST CMS maska ${project}`
  const slug = `${vmId}-test-cms-maska-${project}`
  const first = 'Pierwszy akapit testowego opisu produktu.'
  const second = 'Drugi akapit: <script>globalThis.cmsE2EInjected = true</script> & tekst.'
  await login(page)
  expect((await documents(page.request, 'products', 'vmId', vmId)).totalDocs).toBe(0)
  await page.goto('/admin/collections/products/create')
  await expect(page.locator('input[name="published"]')).not.toBeChecked()
  await page.locator('#field-name').fill(name)
  await page.locator('#field-vmId').fill(String(vmId))
  await page.locator('#field-slug').fill(slug)
  await category(page)
  await page.locator('#field-body').fill(`${first}\n\n${second}`)
  await invalidMoneyBlocksEverySave(page, 'products', 'price', 'vmId', vmId)

  await page.locator('#field-price').fill('129,90')
  const created = await save(page, 'products', 'enter')
  const draft = await documents(page.request, 'products', 'vmId', vmId)
  expect(draft.totalDocs).toBe(1)
  expect(draft.docs[0]).toMatchObject({ id: created.id, name, slug, published: false, price: 129.9, priceCents: 12990, stock: 0 })
  expect(draft.docs[0].body).toBe(`<p>${first}</p><p>Drugi akapit: &lt;script&gt;globalThis.cmsE2EInjected = true&lt;/script&gt; &amp; tekst.</p>`)
  expect((await documents(request, 'products', 'vmId', vmId)).totalDocs).toBe(0)

  await publish(page, 'products')
  const published = await documents(request, 'products', 'vmId', vmId)
  expect(published.totalDocs).toBe(1)
  expect(published.docs[0]).toMatchObject({ id: created.id, published: true, price: 129.9, priceCents: 12990 })
  const response = await page.goto(`/${slug}.html`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
  await visibleParagraphs(page, first, second)
  await expect(page.locator('main .longform script')).toHaveCount(0)
  expect(await page.evaluate(() => Boolean((globalThis as { cmsE2EInjected?: boolean }).cmsE2EInjected))).toBe(false)
})

test('editor creates and publishes an article with plain text paragraphs', async ({ page, request }, info) => {
  const { project } = variant(info)
  const title = `TEST CMS aktualność ${project}`
  const address = `/aktualnosci/test-cms-e2e-${project}.html`
  const first = 'Pierwszy akapit aktualności z panelu.'
  const second = 'Drugi akapit zachowuje polskie znaki: Łódź, ćwiczenia i nurkowanie.'
  await login(page)
  expect((await documents(page.request, 'pages', 'path', address)).totalDocs).toBe(0)
  await page.goto('/admin/collections/pages/create')
  await page.locator('#field-title').fill(title)
  await page.locator('#field-path').fill(address)
  await select(page, 'kind', 'Aktualność')
  await page.locator('#field-lead').fill('Wprowadzenie do testowej aktualności.')
  await page.locator('#field-body').fill(`${first}\n\n${second}`)
  await page.getByText('Podgląd akapitów', { exact: true }).click()
  await expect(page.locator('.underwater-body-preview p')).toHaveText([first, second])
  const created = await save(page, 'pages')
  expect((await documents(request, 'pages', 'path', address)).totalDocs).toBe(0)
  await publish(page, 'pages')
  const published = await documents(request, 'pages', 'path', address)
  expect(published.totalDocs).toBe(1)
  expect(published.docs[0]).toMatchObject({ id: created.id, title, path: address, kind: 'news', published: true, body: `<p>${first}</p><p>${second}</p>` })
  const response = await page.goto(address)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
  await visibleParagraphs(page, first, second)
  await page.goto('/aktualnosci.html')
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
})

test('editor creates a course with a comma price and publishes its description', async ({ page, request }, info) => {
  const { project } = variant(info)
  const name = `TEST CMS kurs ${project}`
  const slug = `test-cms-e2e-kurs-${project}`
  const first = 'Kurs testowy nie nadaje uprawnień nurkowych.'
  const second = 'Program służy wyłącznie kontroli opisu i publikacji w panelu.'
  await login(page)
  expect((await documents(page.request, 'courses', 'slug', slug)).totalDocs).toBe(0)
  await page.goto('/admin/collections/courses/create')
  await page.locator('#field-name').fill(name)
  await page.locator('#field-slug').fill(slug)
  await select(page, 'org', 'Inne')
  await page.locator('#field-lead').fill('Testowy opis kursu do kontroli panelu.')
  await page.locator('#field-body').fill(`${first}\n\n${second}`)
  await invalidMoneyBlocksEverySave(page, 'courses', 'price', 'slug', slug)
  await page.locator('#field-price').fill('139,90')
  const created = await save(page, 'courses', 'shortcut')
  expect((await documents(request, 'courses', 'slug', slug)).totalDocs).toBe(0)
  await publish(page, 'courses')
  const published = await documents(request, 'courses', 'slug', slug)
  expect(published.totalDocs).toBe(1)
  expect(published.docs[0]).toMatchObject({ id: created.id, name, slug, org: 'Inne', price: 139.9, published: true, body: `<p>${first}</p><p>${second}</p>` })
  const response = await page.goto(`/kursy-nurkowania/${slug}.html`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
  await visibleParagraphs(page, first, second)
})

test('editor creates a course session using named date inputs, comma money and an explicit seat limit', async ({ page, request }, info) => {
  const { project } = variant(info)
  const title = `TEST CMS termin ${project}`
  const location = `TEST sala ${project}`
  await login(page)
  expect((await documents(page.request, 'course-sessions', 'title', title)).totalDocs).toBe(0)
  const courses = await documents(page.request, 'courses', 'slug', 'test-qa-kurs')
  expect(courses.totalDocs).toBe(1)
  const courseName = courses.docs[0].name
  if (typeof courseName !== 'string') throw new Error('The synthetic course fixture requires a name.')
  await page.goto('/admin/collections/course-sessions/create')
  await page.locator('#field-title').fill(title)
  await page.locator('#field-course').getByRole('combobox').fill(courseName)
  await page.getByRole('option', { name: courseName, exact: true }).click()
  const dates = await page.evaluate(() => {
    const start = new Date(Date.now() + 45 * 86400000)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start.getTime() + 2 * 3600000)
    const text = (date: Date) => `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:00`
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), startText: text(start), endText: text(end) }
  })
  const start = page.getByLabel(/^Początek/), end = page.getByLabel(/^Koniec/)
  await expect(start).toHaveAttribute('id', /^underwater-date-/)
  await expect(end).toHaveAttribute('id', /^underwater-date-/)
  expect(await start.getAttribute('id')).not.toEqual(await end.getAttribute('id'))
  expect(await start.getAttribute('id')).not.toBe('field-startsAt')
  await start.fill(dates.startText)
  await start.press('Tab')
  await end.fill(dates.endText)
  await end.press('Tab')
  await expect(start).toHaveValue(dates.startText)
  await expect(end).toHaveValue(dates.endText)
  await page.locator('#field-location').fill(location)
  await page.locator('#field-capacity').fill('8')
  await invalidMoneyBlocksEverySave(page, 'course-sessions', 'priceCents', 'title', title)
  await page.locator('#field-priceCents').fill('159,90')
  const created = await save(page, 'course-sessions')
  const draft = await documents(page.request, 'course-sessions', 'title', title)
  expect(draft.totalDocs).toBe(1)
  expect(draft.docs[0]).toMatchObject({ id: created.id, course: courses.docs[0].id, title, location, ...{ startsAt: dates.startsAt, endsAt: dates.endsAt }, priceCents: 15990, capacity: 8, reserved: 0, published: false })
  expect((await documents(request, 'course-sessions', 'title', title)).totalDocs).toBe(0)
  await publish(page, 'course-sessions')
  expect((await documents(request, 'course-sessions', 'title', title)).totalDocs).toBe(1)
  await page.reload()
  await expect(page.getByLabel(/^Początek/)).toHaveValue(dates.startText)
  await expect(page.getByLabel(/^Koniec/)).toHaveValue(dates.endText)
  const response = await page.goto('/kursy-nurkowania/test-qa-kurs.html')
  expect(response?.status()).toBe(200)
  const session = page.locator('.sessions li').filter({ hasText: title })
  await expect(session).toBeVisible()
  await expect(session).toContainText(location)
  await expect(session.locator('.session-f')).toContainText(/159,90\s*zł/)
  await expect(session.locator('.session-f')).toContainText('Wolne miejsca: 8')
  const option = page.locator('select[name="session"] option').filter({ hasText: title })
  await expect(option).toHaveAttribute('value', String(created.id))
  const warsawTime = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).format(new Date(dates.startsAt))
  await expect(option).toContainText(warsawTime)
})

test('editor uploads an image, saves alt text and can reopen its file in the CMS', async ({ page }, info) => {
  const { project } = variant(info)
  const alt = `TEST CMS ilustracja nurkowania ${project}`
  const filename = `test-cms-e2e-image-${project}.jpg`
  await login(page)
  expect((await documents(page.request, 'media', 'alt', alt)).totalDocs).toBe(0)
  await page.goto('/admin/collections/media/create')
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'image/jpeg', buffer: await readFile(path.resolve('seed-media/hero.jpg')) })
  await page.locator('#field-alt').fill(alt)
  const created = await save(page, 'media')
  const records = await documents(page.request, 'media', 'alt', alt)
  expect(records.totalDocs).toBe(1)
  const media = records.docs[0]
  expect(media).toMatchObject({ id: created.id, alt, filename, mimeType: 'image/jpeg' })
  expect(Number(media.width)).toBeGreaterThan(0)
  expect(Number(media.height)).toBeGreaterThan(0)
  expect(typeof media.url).toBe('string')
  const file = new URL(String(media.url), page.url())
  expect(file.origin).toBe(new URL(page.url()).origin)
  const response = await page.request.get(file.href)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('image/jpeg')
  expect((await response.body()).length).toBeGreaterThan(0)
  await page.reload()
  await expect(page.locator('#field-alt')).toHaveValue(alt)
  await expect(page.getByText(filename, { exact: true }).first()).toBeVisible()
})

test('administrator cannot submit a stock correction while the product form is dirty', async ({ page }) => {
  await login(page, 'admin')
  const before = await documents(page.request, 'products', 'vmId', 9999201)
  expect(before.totalDocs).toBe(1)
  const product = before.docs[0]
  expect(typeof product.stock).toBe('number')
  await page.goto(`/admin/collections/products/${product.id}`)
  const correction = page.locator('.underwater-inventory-actions')
  const quantity = correction.getByLabel('Nowy potwierdzony stan', { exact: true })
  await expect(quantity).toBeEnabled()
  await quantity.fill(String(product.stock))
  const submit = correction.getByRole('button', { name: 'Zapisz korektę z audytem', exact: true })
  await expect(submit).toBeEnabled()
  const operations: string[] = []
  const observe = (candidate: import('@playwright/test').Request) => {
    if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/operations/records') operations.push(candidate.url())
  }
  page.on('request', observe)
  await page.locator('#field-name').fill(`${String(product.name)} — niezapisana zmiana testowa`)
  await expect(submit).toBeDisabled()
  await expect(quantity).toBeDisabled()
  await expect(correction.getByText('Najpierw zapisz zmiany produktu. Korekta będzie dostępna po zapisie.', { exact: true })).toBeVisible()
  const after = await documents(page.request, 'products', 'vmId', 9999201)
  expect(after.totalDocs).toBe(1)
  expect(after.docs[0]).toMatchObject({ id: product.id, name: product.name, stock: product.stock, updatedAt: product.updatedAt })
  expect(operations).toEqual([])
  page.off('request', observe)
})

test('administrator sees saved variant changes and preserves an edit made during a stock response', async ({ page }, info) => {
  const { project } = variant(info)
  const vmId = project === 'desktop' ? 9999311 : 9999312
  const name = `TEST CMS warianty ${project}`
  await login(page, 'admin')
  expect((await documents(page.request, 'products', 'vmId', vmId)).totalDocs).toBe(0)
  await page.goto('/admin/collections/products/create')
  await page.locator('#field-name').fill(name)
  await page.locator('#field-vmId').fill(String(vmId))
  await page.locator('#field-slug').fill(`${vmId}-test-cms-warianty-${project}`)
  await category(page)
  await page.locator('#field-price').fill('49,90')
  const created = await save(page, 'products')
  const correction = page.locator('.underwater-inventory-actions')
  const quantity = correction.getByLabel('Nowy potwierdzony stan', { exact: true })
  const stockSave = correction.getByRole('button', { name: /^(?:Zapisz korektę z audytem|Zapisywanie…)$/ })
  await expect(quantity).toBeEnabled()
  await expect(correction.getByRole('combobox')).toHaveCount(0)

  async function saveAndReloadInventory(expected: string[]) {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const match = (url: URL) => url.pathname === `/api/products/${created.id}` && url.searchParams.get('depth') === '0'
    const handler = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return }
      const response = await route.fetch({ headers: { ...route.request().headers(), Origin: new URL(route.request().url()).origin } })
      await gate
      await route.fulfill({ response })
    }
    await page.route(match, handler)
    try {
      const reload = page.waitForRequest(candidate => candidate.method() === 'GET' && match(new URL(candidate.url())), { timeout: 15_000 })
      await save(page, 'products')
      await reload
      await expect(page.locator('#field-name')).toBeEditable()
      await expect(quantity, 'A saved document must wait for its new inventory snapshot').toBeDisabled()
      release()
      await expect(quantity).toBeEnabled()
      await expect(correction.getByRole('combobox').locator('option')).toHaveText(expected)
    } finally { release(); await page.unroute(match, handler) }
  }

  const variants = page.locator('#field-variants')
  await variants.getByRole('button', { name: 'Dodaj Wariant', exact: true }).click()
  await page.locator('#field-variants__0__label').fill('Czarny')
  await page.locator('#field-variants__0__priceCents').fill('55,90')
  await expect(quantity).toBeDisabled()
  await saveAndReloadInventory(['Czarny'])
  const first = (await documents(page.request, 'products', 'vmId', vmId)).docs[0]
  expect(first.variants).toEqual([expect.objectContaining({ label: 'Czarny', priceCents: 5590, stock: 0 })])

  await variants.getByRole('button', { name: 'Dodaj Wariant', exact: true }).click()
  await page.locator('#field-variants__1__label').fill('Niebieski')
  await saveAndReloadInventory(['Czarny', 'Niebieski'])
  await page.locator('#variants-row-0 .array-actions__button').click()
  await page.getByRole('button', { name: 'Usuń', exact: true }).click()
  await expect(page.locator('#field-variants__0__label')).toHaveValue('Niebieski')
  await saveAndReloadInventory(['Niebieski'])
  const before = (await documents(page.request, 'products', 'vmId', vmId)).docs[0]
  const savedVariants = before.variants as Array<{ id: string; label: string; stock: number }>
  expect(savedVariants).toHaveLength(1)
  expect(savedVariants[0]).toMatchObject({ label: 'Niebieski', stock: 0 })
  await expect(correction.getByRole('combobox')).toHaveValue(savedVariants[0].id)

  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let inventoryResponseReady!: (status: number) => void
  const inventoryResponse = new Promise<number>(resolve => { inventoryResponseReady = resolve })
  const sent: unknown[] = []
  const holdResponse = async (route: import('@playwright/test').Route) => {
    sent.push(route.request().postDataJSON())
    const response = await route.fetch({ headers: { ...route.request().headers(), Origin: new URL(route.request().url()).origin } })
    inventoryResponseReady(response.status())
    await gate
    await route.fulfill({ response })
  }
  await page.route('**/api/operations/records', holdResponse)
  try {
    await quantity.fill('3')
    const requestSent = page.waitForRequest(candidate => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/operations/records')
    const responded = page.waitForResponse(candidate => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/operations/records')
    await expect(stockSave).toHaveAccessibleName('Zapisz korektę z audytem')
    await stockSave.click()
    await requestSent
    await expect(stockSave).toBeDisabled()
    // Edit while the real successful response is held, after its service write
    // has finished; otherwise Payload's first-edit check races the DB commit.
    expect(await inventoryResponse).toBe(200)
    const draftName = `${name} — niezapisana zmiana podczas korekty`
    await page.locator('#field-name').fill(draftName)
    release()
    expect((await responded).status()).toBe(200)
    await expect(correction.getByRole('status')).toHaveText('Korekta została zapisana. Formularz zawiera niezapisane zmiany; zachowaj je przed odświeżeniem produktu.')
    await expect(page.locator('#field-name')).toHaveValue(draftName)
    await expect(stockSave).toBeDisabled()
    expect(sent).toEqual([{ command: 'inventory-adjustment', id: created.id, stock: 3, expectedStock: 0, variantId: savedVariants[0].id }])
    const after = (await documents(page.request, 'products', 'vmId', vmId)).docs[0]
    expect(after).toMatchObject({ id: created.id, name, stock: 3, variants: [expect.objectContaining({ id: savedVariants[0].id, label: 'Niebieski', stock: 3 })] })

    // Editing the old document after the service write activates Payload's
    // native stale-data protection. Keep the draft instead of forcing a click
    // through its modal or reloading away the unsaved name.
    const staleDocument = page.locator('#document-stale-data')
    await expect(staleDocument).toBeVisible()
    await expect(staleDocument.getByRole('heading', { name: 'Dokument zmodyfikowany', exact: true })).toBeVisible()
    await expect(staleDocument).toContainText('Twoja wersja jest nieaktualna.')
    await expect(staleDocument.getByRole('button', { name: 'Przeładuj dokument', exact: true })).toBeVisible()
    await expect(page.locator('#field-name')).toHaveValue(draftName)

    // The server must also reject a real stale write independently of the UI.
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('The stale write requires the configured isolated harness origin.')
    const rejection = await page.request.patch(`/api/products/${created.id}`, {
      headers: { Origin: new URL(baseURL).origin },
      data: { name: draftName, stock: before.stock, variants: before.variants },
    })
    expect(rejection.status(), 'The stale form must not overwrite the inventory correction').toBe(409)
    const problem = await rejection.json() as { errors?: Array<{ message?: string }> }
    expect(problem.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Stan magazynu zmienił') })]))
    await expect(staleDocument).toBeVisible()
    await expect(page.locator('#field-name')).toHaveValue(draftName)
    const preserved = (await documents(page.request, 'products', 'vmId', vmId)).docs[0]
    expect(preserved).toMatchObject({ id: created.id, name, stock: 3, variants: [expect.objectContaining({ id: savedVariants[0].id, label: 'Niebieski', stock: 3 })] })
  } finally { release(); await page.unroute('**/api/operations/records', holdResponse) }
})
