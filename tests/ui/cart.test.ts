import test from 'node:test'
import assert from 'node:assert/strict'
import { cartCount, cartTotal, clampQty, lineKey, MAX_LINES, normalizeLine, parseCart, sameLine } from '../../src/components/cart'

const line = { id: 7, slug: '3625-maska', name: 'Maska', priceCents: 12900, qty: 1 }

test('a cart saved with złoty prices is migrated to grosze', () => {
  const [l] = parseCart(JSON.stringify([{ id: 7, slug: '3625-maska', name: 'Maska', price: 129.99, qty: 2 }]))
  assert.equal(l.priceCents, 12999)
  assert.equal(cartTotal([l]), 25998)
})

test('prices in grosze must be whole, non-negative and bounded', () => {
  for (const priceCents of [-1, 1.5, Number.NaN, '100', 1e12]) assert.equal(normalizeLine({ ...line, priceCents }), null, String(priceCents))
  assert.equal(normalizeLine({ ...line, priceCents: 0 })?.priceCents, 0)
  // An explicit but broken priceCents does not fall back to a złoty price.
  assert.equal(normalizeLine({ ...line, priceCents: -1, price: 10 }), null)
})

test('Unicode slugs are accepted; slugs that change the path are not', () => {
  assert.equal(normalizeLine({ ...line, slug: '3625-maska-żółta' })?.slug, '3625-maska-żółta')
  assert.equal(normalizeLine({ ...line, slug: 'kategoria/3625-maska' })?.slug, 'kategoria/3625-maska')
  for (const slug of ['../admin', '//evil.example', 'a//b', 'javascript:alert(1)', 'a b', '/abs', '']) {
    assert.equal(normalizeLine({ ...line, slug }), null, slug)
  }
})

test('variant id and SKU are kept separately from the label', () => {
  const l = normalizeLine({ ...line, variant: 'Czarna', variantId: '65f0c0ffee0123456789abcd', sku: 'CR-M-01' })
  assert.deepEqual([l?.variant, l?.variantId, l?.sku], ['Czarna', '65f0c0ffee0123456789abcd', 'CR-M-01'])
  assert.equal(normalizeLine({ ...line, variantId: 'bad id!' })?.variantId, undefined)
  assert.equal(lineKey({ id: 7, variant: 'Czarna', variantId: 'v1' }), '7::#v1')
  assert.ok(sameLine({ id: 7, variant: 'Czarna' }, { id: 7, variant: 'Czarna', variantId: 'v1' }))
  assert.ok(!sameLine({ id: 7, variantId: 'v1' }, { id: 7, variantId: 'v2' }))
})

test('quantities are whole units within the line cap', () => {
  assert.equal(clampQty('3'), 3)
  assert.equal(clampQty(2.7), 2)
  assert.equal(clampQty(0), null)
  assert.equal(clampQty(-1), null)
  assert.equal(clampQty(1000), 99)
  assert.equal(clampQty(10, 4), 4)
  const merged = parseCart(JSON.stringify([{ ...line, qty: 3, maxQty: 4 }, { ...line, qty: 3, maxQty: 4 }]))
  assert.equal(merged.length, 1)
  assert.equal(merged[0].qty, 4)
  assert.equal(cartCount(merged), 4)
})

test('storage garbage never breaks the cart', () => {
  assert.deepEqual(parseCart('not json'), [])
  assert.deepEqual(parseCart('{"a":1}'), [])
  assert.deepEqual(parseCart(JSON.stringify([null, 1, 'x', { __proto__: { id: 1 } }])), [])
  const many = Array.from({ length: MAX_LINES + 20 }, (_, i) => ({ ...line, id: i + 1 }))
  assert.equal(parseCart(JSON.stringify(many)).length, MAX_LINES)
  assert.equal(normalizeLine({ ...line, image: '//evil.example/x.png' })?.image, undefined)
  assert.equal(normalizeLine({ ...line, image: '/media/x.png' })?.image, '/media/x.png')
})
