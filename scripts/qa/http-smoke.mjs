/** Real HTTP checks against explicitly disposable local synthetic fixtures. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { request as rawRequest } from 'node:http'

const origin = process.argv[2] || 'http://localhost:3118'
const url = new URL(origin)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.port || url.pathname !== '/') throw new Error('HTTP fixture checks are local only.')
const checks = []
const request = (pathname, options = {}) => fetch(new URL(pathname, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options })
const post = (pathname, body, extra = {}) => request(pathname, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
const check = async (name, fn) => { await fn(); checks.push(name) }

await check('HTTP 301 and 404 before streaming', async () => {
  for (const method of ['GET', 'HEAD']) {
    const redirect = await request('/test-stary-adres.html', { method })
    assert.equal(redirect.status, 301)
    assert.equal(new URL(redirect.headers.get('location'), origin).pathname, '/test-aktualnosc.html')
    assert.equal((await request('/missing-http-fixture.html', { method })).status, 404)
  }
})
await check('Host isolation and preview indexing headers', async () => {
  const hostStatus = await new Promise((resolve, reject) => {
    const raw = rawRequest(new URL('/', origin), { headers: { host: 'untrusted.example.invalid' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) })
    raw.on('error', reject); raw.end()
  })
  assert.equal(hostStatus, 421)
  const home = await request('/')
  assert.match(home.headers.get('x-robots-tag'), /noindex/)
  assert.match(home.headers.get('cache-control'), /no-store/)
})
await check('Private collections deny anonymous REST reads', async () => {
  for (const collection of ['orders', 'users', 'signups', 'contacts', 'newsletter', 'outbox', 'payment-attempts', 'payment-events', 'audit-events', 'import-runs']) {
    assert.ok([401, 403].includes((await request('/api/' + collection)).status), collection)
  }
  const response = await request('/api/products?depth=0&limit=100')
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.docs.some(doc => doc.slug === '9999104-test-szkic'), false)
})
await check('Origins, content types and financial client fields', async () => {
  assert.equal((await post('/api/store/quote', { items: [] }, { origin: 'https://untrusted.example.invalid' })).status, 403)
  assert.equal((await request('/api/store/quote', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  const products = await (await request('/api/products?depth=0&limit=100')).json()
  const product = products.docs.find(doc => doc.slug === '9999102-test-ostatnia-sztuka')
  assert.ok(product && Number.isSafeInteger(product.stock) && product.stock >= 1, 'The explicitly synthetic stock fixture is required.')
  const initialStock = product.stock
  const items = [{ id: product.id, qty: 1, price: 0.01 }]
  const quoted = await (await post('/api/store/quote', { items, deliveryMethod: 'test-delivery' })).json()
  assert.equal(quoted.quote.totalCents, 3500)
  const input = { idempotencyKey: randomUUID(), customerName: 'TEST HTTP', email: 'http-qa@example.invalid', phone: '000000000', address: 'Disposable synthetic address', privacyAccepted: true, termsAccepted: true, items, deliveryMethod: 'test-delivery', expectedTotalCents: 3500 }
  const response = await post('/api/store/checkout', input)
  assert.equal(response.status, 200)
  const created = await response.json()
  const duplicate = await (await post('/api/store/checkout', input)).json()
  assert.equal(duplicate.number, created.number)
  const token = new URL(created.paymentURL, origin).searchParams.get('token')
  const summary = await (await request('/api/payments/test?token=' + encodeURIComponent(token))).json()
  assert.equal(summary.totalCents, 3500)
  for (let retry = 0; retry < 2; retry++) {
    const cancelled = await post('/api/payments/test', { token, outcome: 'cancelled' })
    assert.equal(cancelled.status, 200)
  }
  const after = await (await request('/api/products/' + product.id + '?depth=0')).json()
  assert.equal(after.stock, initialStock)
})
await check('Bootstrap endpoint and authenticated upload decoding', async () => {
  const bootstrap = await post('/api/users/first-register', { email: 'unauthorized@example.invalid', password: 'synthetic-new-user-password', role: 'admin' })
  assert.ok([400, 401, 403].includes(bootstrap.status))
  const login = await post('/api/users/login', { email: 'qa-admin@example.invalid', password: 'synthetic-qa-admin-password-not-for-deployment-20261008' })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  assert.ok(token)
  const headers = { origin, authorization: 'JWT ' + token }
  const invalid = new FormData()
  invalid.append('file', new Blob(['<html><script>not an image</script></html>'], { type: 'image/jpeg' }), 'test-invalid.jpg')
  invalid.append('_payload', JSON.stringify({ alt: 'Synthetic invalid MIME fixture' }))
  const rejected = await request('/api/media', { method: 'POST', headers, body: invalid })
  assert.ok([400, 413, 415].includes(rejected.status))
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } }).png().toBuffer()
  const valid = new FormData()
  valid.append('file', new Blob([bytes], { type: 'image/png' }), 'synthetic-http-check.png')
  valid.append('_payload', JSON.stringify({ alt: 'Disposable synthetic HTTP upload fixture' }))
  const uploaded = await request('/api/media', { method: 'POST', headers, body: valid })
  assert.equal(uploaded.status, 201)
  const { doc } = await uploaded.json()
  assert.equal((await request(new URL(doc.url, origin).pathname)).status, 200)
  // Only this script's disposable upload; not a catalogue or source file.
  assert.equal((await request('/api/media/' + doc.id, { method: 'DELETE', headers })).status, 200)
})
console.log(JSON.stringify({ passed: checks.length, checks, origin, sourceAccess: false, realPayment: false, realMail: false }))
