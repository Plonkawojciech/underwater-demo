import { test, expect } from '@playwright/test'

test('UW-02: featured product column displays Tak, Nie and an unset value', async ({ page, request }, info) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ environment: 'test', payments: 'test', mail: 'captured' })
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 390 : 1280, height: 900 })
  await page.goto('/admin/login')
  await page.getByLabel(/e-?mail/i).fill('qa-editor@example.invalid')
  await page.getByLabel('Hasło', { exact: true }).fill('Synthetic-E2E-only-password-20261009')
  await page.getByRole('button', { name: 'Zaloguj', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/admin')
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('The CMS regression requires the configured isolated loopback harness.')
  const response = await page.request.get('/api/products', {
    headers: { Origin: new URL(baseURL).origin },
    params: { 'where[name][contains]': 'TEST QA wyróżnienie', depth: '0', limit: '10' },
  })
  expect(response.status()).toBe(200)
  const products = await response.json() as { docs: { name: string; featured: boolean | null }[] }
  expect(products.docs).toHaveLength(3)
  for (const [name, value] of [['true', true], ['false', false], ['null', null]] as const) {
    expect(products.docs.find(product => product.name === `TEST QA wyróżnienie ${name}`)?.featured).toBe(value)
  }
  const query = new URLSearchParams({ columns: JSON.stringify(['name', 'featured']), 'where[name][contains]': 'TEST QA wyróżnienie' })
  await page.goto(`/admin/collections/products?${query}`)
  await expect(page.getByRole('columnheader', { name: /Pokaż w promocjach na stronie głównej/ })).toBeVisible()
  for (const [value, label] of [['true', 'Tak'], ['false', 'Nie'], ['null', 'Nie ustawiono']] as const) {
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: `TEST QA wyróżnienie ${value}`, exact: true }) })
    await expect(row).toHaveCount(1)
    await expect(row.locator('td.cell-featured')).toHaveText(label)
  }
  await expect(page.locator('table')).not.toContainText('general:null')
  await expect(page.locator('table')).not.toContainText('fałszywe')
})
