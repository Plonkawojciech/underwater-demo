import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const product = '/9999201-test-qa-maska.html'
const category = '/9999200-test-qa-sprzet.html'
const course = '/kursy-nurkowania/test-qa-kurs.html'
test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health'); expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, environment: 'test', payments: 'test', paymentProvider: 'internal-test', mail: 'captured' })
})
const consentChosen = new WeakSet<import('@playwright/test').Page>()
async function necessary(page: import('@playwright/test').Page) {
  if (consentChosen.has(page)) return
  const button = page.getByRole('button', { name: 'Tylko niezbędne', exact: true })
  await expect(button).toBeVisible(); await button.click(); consentChosen.add(page)
}
async function add(page: import('@playwright/test').Page) {
  await page.goto(product); await necessary(page)
  await page.getByRole('button', { name: 'Dodaj do koszyka', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Dodano do koszyka' })).toBeVisible()
  await page.goto('/koszyk')
  await expect(page.getByRole('button', { name: 'Złóż zamówienie testowe' })).toBeEnabled()
}

test('public catalogue, canonical, noindex and accessibility', async ({ page }) => {
  for (const route of ['/', category, product, course, '/koszyk']) {
    const response = await page.goto(route)
    expect(response?.status(), route).toBe(200)
    expect(response?.headers()['x-robots-tag']).toContain('noindex')
    await necessary(page)
    await expect(page.locator('main')).toBeVisible()
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(result.violations, `${route}: ${result.violations.map(v => v.id).join(', ')}`).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.goto(product)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new URL(product, page.url()).href)
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents()
  expect(schemas.some(value => JSON.parse(value)['@type'] === 'Product')).toBe(true)
})

test('cart persists; server ignores altered display price; simulated payment succeeds', async ({ page }) => {
  await add(page)
  await page.evaluate(() => {
    const lines = JSON.parse(localStorage.getItem('uw-cart') || '[]'); lines[0].priceCents = 1
    localStorage.setItem('uw-cart', JSON.stringify(lines))
  })
  const quoteResponse = page.waitForResponse(r => r.url().includes('/api/store/quote') && r.status() === 200)
  await page.reload()
  const quote = await (await quoteResponse).json()
  expect(quote).toMatchObject({ ok: true, quote: { totalCents: 3500 } })
  await expect(page.getByRole('link', { name: 'TEST QA maska', exact: true })).toBeVisible()
  await page.locator('input[name="customerName"]').fill('Test E2E')
  await page.locator('input[name="email"]').fill(`checkout-${test.info().project.name}@example.invalid`)
  await page.locator('input[name="phone"]').fill('500000000')
  await page.locator('input[name="termsAccepted"]').check()
  await page.locator('input[name="privacyAccepted"]').check()
  await page.getByRole('button', { name: 'Złóż zamówienie testowe' }).click()
  await expect(page).toHaveURL(/\/platnosc-testowa\?token=/)
  await page.getByRole('button', { name: 'Symuluj udaną płatność' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Opłacone' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Opłacone' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Symuluj udaną płatność' })).toHaveCount(0)
})

test('course application uses a test session and shows the saved-application notice', async ({ page }) => {
  await page.goto(course); await necessary(page)
  await page.locator('input[name="name"]').fill('Test Kurs E2E')
  await page.locator('input[name="email"]').fill(`course-${test.info().project.name}@example.invalid`)
  await page.locator('input[name="phone"]').fill('500000000')
  await page.locator('input[name="privacyAccepted"]').check()
  await page.getByRole('button', { name: 'Wyślij zgłoszenie' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Zgłoszenie zapisane' })).toBeVisible()
})

test('private records remain protected from anonymous and content-editor sessions', async ({ request, page }) => {
  const anonymous = await request.get('/api/orders'); expect(anonymous.status()).toBe(403)
  await page.goto('/admin/login')
  await page.getByLabel('Email', { exact: false }).fill('qa-editor@example.invalid')
  await page.getByLabel('Hasło', { exact: true }).fill('Synthetic-E2E-only-password-20261009')
  await page.getByRole('button', { name: 'Zaloguj', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
  const headers = { Origin: new URL(page.url()).origin }
  const identity = await page.request.get('/api/users/me', { headers })
  expect(identity.status()).toBe(200)
  expect((await identity.json()).user).toMatchObject({ email: 'qa-editor@example.invalid', role: 'editor' })
  const privateResponse = await page.request.get('/api/orders', { headers }); expect(privateResponse.status()).toBe(403)
  const productResponse = await page.request.get('/api/products', { headers, params: { 'where[vmId][equals]': '9999201', depth: '0', limit: '1' } })
  expect(productResponse.status()).toBe(200)
  const products = await productResponse.json()
  expect(products.totalDocs).toBe(1)
  expect(Number.isSafeInteger(products.docs[0].id)).toBe(true)
  await page.goto(`/admin/collections/products/${products.docs[0].id}`)
  await expect(page.locator('#field-name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zapisz korektę z audytem' })).toHaveCount(0)
})
