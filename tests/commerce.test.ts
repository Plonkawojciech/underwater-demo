import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogLine, mergeQuotedItems } from '../src/lib/commerce/quote'
import { requestedItems, cents, email, opaqueToken, tokenHash, equalDigest, InputError } from '../src/lib/commerce/input'
import { TestPaymentProvider } from '../src/lib/commerce/provider'
import { sanitizeContent } from '../src/lib/html'
import type { Product } from '../src/payload-types'

const product = (changes: Partial<Product> = {}): Product => ({ id: 1, name: 'Maska testowa', slug: 'maska-testowa', vmId: 10, category: 1, price: 199, priceCents: 19900, salePriceCents: 18900, stock: 4, published: true, createdAt: '2026-01-01', updatedAt: '2026-01-01', ...changes })
test('catalog is the only source of price, even when client sends one cent', () => {
  const item = requestedItems([{ id: 1, qty: 2, price: 0.01 }])[0]
  const line = catalogLine(product(), item)
  assert.equal(line.unitPriceCents, 18900); assert.equal(line.lineTotalCents, 37800)
})
test('variants resolve by stable ID and use independent prices and stock', () => {
  const p = product({ stock: 0, variants: [{ id: 'a', label: 'Czarny', sku: 'SKU-A', stock: 2, priceCents: 21000 }, { id: 'b', label: 'Czarny', stock: 0 }] })
  assert.equal(catalogLine(p, { id: 1, variantId: 'a', qty: 2 }).unitPriceCents, 21000)
  assert.throws(() => catalogLine(p, { id: 1, variant: 'Czarny', qty: 1 }), InputError)
  assert.throws(() => catalogLine(p, { id: 1, variantId: 'b', qty: 1 }), InputError)
  assert.throws(() => catalogLine(p, { id: 1, qty: 1 }), InputError)
})
test('fractional, zero, negative, excessive quantities and malformed IDs are rejected', () => {
  for (const qty of [0, -1, 1.5, '2', null, 100, NaN, Infinity]) assert.throws(() => requestedItems([{ id: 1, qty }]), InputError)
  for (const id of [0, -1, 1.2, '1', null, NaN, Infinity]) assert.throws(() => requestedItems([{ id, qty: 1 }]), InputError)
  assert.throws(() => requestedItems([]), InputError)
  assert.throws(() => requestedItems(Array.from({ length: 51 }, () => ({ id: 1, qty: 1 }))), InputError)
})
test('duplicate canonical variants merge before final stock validation', () => {
  const lines = mergeQuotedItems([catalogLine(product(), { id: 1, qty: 3 }), catalogLine(product(), { id: 1, qty: 3 })])
  assert.equal(lines[0].qty, 6)
  assert.throws(() => catalogLine(product(), { id: 1, qty: lines[0].qty }), InputError)
  assert.throws(() => mergeQuotedItems([{ ...lines[0], qty: 99 }, { ...lines[0], qty: 1 }]), InputError)
})
test('drafts, ambiguous variants, unavailable stock and invalid catalog prices fail closed', () => {
  assert.throws(() => catalogLine(product({ published: false }), { id: 1, qty: 1 }), InputError)
  assert.throws(() => catalogLine(product({ stock: -1 }), { id: 1, qty: 1 }), InputError)
  assert.throws(() => catalogLine(product({ priceCents: 1.2 }), { id: 1, qty: 1 }), InputError)
  assert.throws(() => catalogLine(product({ variants: [{ label: 'Blue', stock: 2 }] }), { id: 1, qty: 1, variant: 'Blue' }), InputError)
  assert.throws(() => catalogLine(product(), { id: 1, qty: 1, variantId: 'missing' }), InputError)
})
test('zero and higher promotions are ignored, integer amounts are bounded', () => {
  assert.equal(catalogLine(product({ salePriceCents: 0 }), { id: 1, qty: 1 }).unitPriceCents, 19900)
  assert.throws(() => catalogLine(product({ price: 0, priceCents: 0, salePriceCents: null }), { id: 1, qty: 1 }), InputError)
  assert.equal(catalogLine(product({ salePriceCents: 29900 }), { id: 1, qty: 1 }).unitPriceCents, 19900)
  for (const value of [-1, 1.2, '100', Infinity, 100_000_001]) assert.throws(() => cents(value), InputError)
})
test('payment adapter verifies exact signed body, amount, currency and outcome shape', () => {
  const provider = new TestPaymentProvider('synthetic-test-provider-secret-long-enough')
  const raw = JSON.stringify({ eventKey: 'event-1', reference: 'test-1', amountCents: 19900, currency: 'PLN', outcome: 'paid' })
  const signature = provider.sign(raw)
  assert.equal(provider.verify(raw, signature).amountCents, 19900)
  assert.throws(() => provider.verify(raw + ' ', signature), InputError)
  for (const bad of ['', 'a'.repeat(63), 'z'.repeat(64), '0'.repeat(64)]) assert.throws(() => provider.verify(raw, bad), InputError)
  for (const mutation of [{ currency: 'EUR' }, { amountCents: 1.2 }, { outcome: 'shipped' }, { eventKey: '' }]) {
    const changed = JSON.stringify({ ...JSON.parse(raw), ...mutation })
    assert.throws(() => provider.verify(changed, provider.sign(changed)), InputError)
  }
  const changed = raw.replace('19900', '1')
  assert.throws(() => provider.verify(changed, signature), InputError)
})
test('order access tokens are secret-derived, scoped and not guessable from key alone', () => {
  const a = new TestPaymentProvider('synthetic-provider-secret-a-long-enough')
  const b = new TestPaymentProvider('synthetic-provider-secret-b-long-enough')
  assert.equal(a.accessToken('idempotency', 'fingerprint'), a.accessToken('idempotency', 'fingerprint'))
  assert.notEqual(a.accessToken('idempotency', 'fingerprint'), b.accessToken('idempotency', 'fingerprint'))
  assert.notEqual(a.accessToken('idempotency', 'fingerprint'), a.accessToken('idempotency', 'different'))
  assert.equal(tokenHash(opaqueToken()).length, 64)
  assert.throws(() => tokenHash('short'), InputError)
  assert.equal(equalDigest('0'.repeat(64), '0'.repeat(64)), true)
  assert.equal(equalDigest('z'.repeat(64), 'z'.repeat(64)), false)
})
test('HTML sanitizer strips active content and tracking images but preserves editorial markup', () => {
  const cleaned = sanitizeContent('<h2>Tytuł</h2><script>alert(1)</script><svg onload="alert(2)">x</svg><a href="javascript:alert(3)" onclick="evil()">Link</a><img src="https://evil.example/pixel" onerror="evil()"><table><tr><th scope="col">Rozmiar</th><td>XL</td></tr></table>')
  assert.match(cleaned, /<h2>Tytuł<\/h2>/); assert.match(cleaned, /<table>/)
  assert.doesNotMatch(cleaned, /script|svg|javascript:|onclick|onerror|evil|pixel|alert/)
  const media = sanitizeContent('<img src="/api/media/file/maska.webp" alt="Maska"><a href="https://www.underwater.pl/kurs.html">Kurs</a>')
  assert.match(media, /maska\.webp/); assert.match(media, /href="\/kurs\.html"/)
  for (const path of ['/api/media/file/../private', '/api/media/file/%2e%2e/private', '//evil.example', '/api/media/file/%2fprivate']) assert.doesNotMatch(sanitizeContent(`<img src="${path}">`), /<img/)
})
test('email validation does not permit header injection or empty addresses', () => {
  assert.equal(email('  TEST@EXAMPLE.COM '), 'test@example.com')
  for (const value of ['', 'a@b', 'a@b.com\r\nBcc:attacker@evil.example', null]) assert.throws(() => email(value), InputError)
})
