import { test, expect } from '@playwright/test'

const courseName = 'TEST QA Kurs nurkowania w suchym skafandrze PADI Dry Suit Diver'
const product = '/9999201-test-qa-maska.html'
const routes = [
  '/', '/sklep-nurkowy.html', product,
  '/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html',
  '/kursy-nurkowania/test-qa-kurs.html', '/koszyk', '/kontakt.html', '/kalendarz.html',
]

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({
    ok: true, environment: 'test', payments: 'test', paymentProvider: 'internal-test', mail: 'captured',
  })
})

for (const width of [360, 390]) {
  test(`UW-01: the long next-course title and its date stay inside all eight templates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      const response = await page.goto(route)
      expect(response?.status(), route).toBe(200)
      const link = page.locator('.topline > .wrap > span').first().getByRole('link')
      await expect(link, route).toContainText(courseName)
      await expect(link.locator('time'), `${route}: date must remain readable`).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const bounds = await link.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const lineBoxes = [...range.getClientRects()].map(box => ({ left: box.left, right: box.right }))
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, lineBoxes }
      })
      expect(bounds.documentWidth, `${route}: horizontal document overflow`).toBeLessThanOrEqual(width + 1)
      expect(bounds.lineBoxes.length, `${route}: the full title and date must be present`).toBeGreaterThan(0)
      for (const box of bounds.lineBoxes) {
        expect(box.left, `${route}: text outside the left edge`).toBeGreaterThanOrEqual(-1)
        expect(box.right, `${route}: text outside the right edge`).toBeLessThanOrEqual(bounds.width + 1)
      }
      await page.evaluate(() => scrollTo({ left: 1000, top: 0, behavior: 'instant' }))
      expect(await page.evaluate(() => scrollX), `${route}: horizontal scrolling must be impossible`).toBe(0)
    }
  })
}

type LayoutState = { cls: number; mainTop: number | null; maximumMainMovement: number }

test('UW-03: a cold product already shows privacy choices before hydration and slow JavaScript does not move the content', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  let releaseScripts: () => void = () => {}
  const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve })
  try {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    // Hold the application scripts until the cold HTML has visibly painted. This
    // reproduces the old delayed banner without relying on a machine's speed.
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script') await scriptsReady
      await route.continue()
    })
    await page.addInitScript(() => {
      const state: LayoutState = { cls: 0, mainTop: null, maximumMainMovement: 0 }
      ;(window as unknown as { __uwLayout: LayoutState }).__uwLayout = state
      new PerformanceObserver(list => {
        for (const value of list.getEntries()) {
          const shift = value as PerformanceEntry & { value: number; hadRecentInput: boolean }
          if (!shift.hadRecentInput) state.cls += shift.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
      const sample = () => {
        const main = document.querySelector('main')
        if (main && state.mainTop !== null) {
          state.maximumMainMovement = Math.max(state.maximumMainMovement, Math.abs(main.getBoundingClientRect().top - state.mainTop))
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.goto(new URL(product, baseURL).href, { waitUntil: 'commit' })
    const notice = page.getByRole('region', { name: 'Prywatność i ustawienia pomiaru', exact: true })
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Tylko niezbędne', exact: true })).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Zgoda na pomiar (test)', exact: true })).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Ustawienia', exact: true })).toBeVisible()
    // Visibility alone can pass on unstyled streaming HTML. Measure the cold
    // painted layout only after its stylesheet, still before any application JS.
    await expect.poll(() => notice.evaluate(element => getComputedStyle(element).position)).toBe('fixed')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const before = await page.evaluate(() => {
      const mainTop = document.querySelector('main')!.getBoundingClientRect().top
      ;(window as unknown as { __uwLayout: LayoutState }).__uwLayout.mainTop = mainTop
      return mainTop
    })
    releaseScripts()
    await page.waitForLoadState('networkidle')
    // The measured scroll inset is installed by hydration. Waiting for it also
    // ensures the following dismissal tests a working React handler.
    await expect(page.locator('html')).toHaveAttribute('data-privacy-notice', 'open')
    const after = await page.evaluate(() => ({
      ...((window as unknown as { __uwLayout: LayoutState }).__uwLayout),
      mainTop: document.querySelector('main')!.getBoundingClientRect().top,
    }))
    expect(Math.abs(after.mainTop - before), 'hydration must not push the product below a new banner').toBeLessThanOrEqual(1)
    expect(after.maximumMainMovement, 'the product must stay in place throughout hydration').toBeLessThanOrEqual(1)
    expect(after.cls, 'cold mobile CLS must stay below the good CWV threshold').toBeLessThan(0.1)
    await notice.getByRole('button', { name: 'Tylko niezbędne', exact: true }).click()
    await expect(notice).toHaveCount(0)
    expect(await page.locator('main').evaluate(element => element.getBoundingClientRect().top), 'dismissing privacy choices must not pull the product upward').toBeCloseTo(before, 0)
  } finally {
    releaseScripts()
    await cdp.detach().catch(() => {})
    await context.close()
  }
})
