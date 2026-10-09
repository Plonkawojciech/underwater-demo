import { test, expect, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const enquiryProduct = '/9999202-test-qa-zapytanie.html'
const legacyMarker = 'QA legacy instructor biography preserved'

async function follows(first: Locator, later: Locator) {
  const next = await later.elementHandle()
  expect(next).not.toBeNull()
  return first.evaluate((element, other) => !!(element.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING), next)
}

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, environment: 'test', payments: 'test', mail: 'captured' })
})

test('UW-04: contact heading, details and form precede a preserved long imported biography', async ({ page }) => {
  await page.goto('/kontakt.html')
  const heading = page.getByRole('heading', { level: 1, name: 'Kontakt', exact: true })
  const form = page.getByRole('form', { name: 'Napisz do nas', exact: true })
  const biography = page.getByText(legacyMarker, { exact: false }).first()
  await expect(heading).toBeVisible()
  await expect(form).toBeVisible()
  await expect(biography).toBeAttached()
  expect(await follows(heading, biography)).toBe(true)
  expect(await follows(page.locator('.contact .dl'), biography)).toBe(true)
  expect(await follows(form, biography)).toBe(true)
  // An empty source body would conceal the original multi-screen regression.
  const sourceBody = page.locator('.longform').filter({ hasText: legacyMarker })
  expect(await sourceBody.locator('p').count()).toBeGreaterThanOrEqual(20)
  expect(await sourceBody.evaluate(element => element.scrollHeight)).toBeGreaterThan(1_000)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations, result.violations.map(v => v.id).join(', ')).toEqual([])
})

for (const chosenConsent of [false, true]) {
  test(`UW-04: product enquiry by keyboard lands on an unobscured form with context (${chosenConsent ? 'consent chosen' : 'cold consent'})`, async ({ page }) => {
    await page.goto(enquiryProduct)
    const necessary = page.getByRole('button', { name: 'Tylko niezbędne', exact: true })
    await expect(necessary).toBeVisible()
    if (chosenConsent) await necessary.click()
    const enquiry = page.getByRole('link', { name: 'Zapytaj o dostępność', exact: true })
    const href = await enquiry.getAttribute('href')
    expect(href).toMatch(/^\/kontakt\.html\?produkt=\d+#formularz-kontaktowy$/)
    const productID = new URL(href!, page.url()).searchParams.get('produkt')!
    await enquiry.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/kontakt\\.html\\?produkt=${productID}#formularz-kontaktowy$`))
    const form = page.getByRole('form', { name: 'Napisz do nas', exact: true })
    const heading = form.getByRole('heading', { name: 'Napisz do nas', exact: true })
    const name = form.getByLabel('Imię i nazwisko', { exact: true })
    await expect(form.locator('input[name="contextKind"]')).toHaveValue('product')
    await expect(form.locator('input[name="contextID"]')).toHaveValue(productID)
    await expect(form.getByRole('link', { name: 'TEST QA produkt bez potwierdzonego stanu', exact: true })).toBeVisible()
    await expect(heading).toBeInViewport({ ratio: 1 })
    await expect(name).toBeInViewport({ ratio: 1 })
    await expect.poll(() => name.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const headerBottom = document.querySelector('.head')!.getBoundingClientRect().bottom
      const centre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return rect.top >= headerBottom && centre === element
    })).toBe(true)
    await name.focus()
    await page.keyboard.type('Test contact QA')
    await expect(name).toHaveValue('Test contact QA')
    // No valid submission or record writes are needed to verify landing and context.
  })
}
