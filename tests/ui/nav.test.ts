import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isNavCurrent, SITE_NAV } from '../../src/components/nav'
import { FIXED } from '../../src/lib/source-routes'
import { ProductCard } from '../../src/components/ProductCard'
import { AddToCart } from '../../src/components/AddToCart'
import { CartProvider } from '../../src/components/cart'
import { PhoneLinks } from '../../src/components/Phone'

const item = (label: string) => SITE_NAV.find((i) => i.label === label)!

test('menu links use canonical section addresses that the router serves', () => {
  assert.equal(item('Wyprawy').href, '/wyprawy-nurkowe.html')
  assert.equal(item('Galerie').href, '/galeria.html')
  for (const i of SITE_NAV) assert.ok(Object.hasOwn(FIXED, i.href.slice(1).replace(/\.html$/, '')), i.href)
})

test('a menu item is current at its canonical address, its aliases and pages below them', () => {
  const cases: [string, string][] = [
    ['/wyprawy-nurkowe.html', 'Wyprawy'], ['/wyprawy.html', 'Wyprawy'], ['/wyprawy/egipt-2026.html', 'Wyprawy'],
    ['/galeria.html', 'Galerie'], ['/galerie.html', 'Galerie'], ['/galeria/rafa.html', 'Galerie'],
    ['/relacje-z-wypraw.html', 'Aktualności'], ['/relacje.html', 'Aktualności'], ['/aktualnosci.html', 'Aktualności'],
    ['/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html', 'Kursy'],
  ]
  for (const [path, label] of cases) {
    assert.deepEqual(SITE_NAV.filter((i) => isNavCurrent(path, i)).map((i) => i.label), [label], path)
  }
  assert.deepEqual(SITE_NAV.filter((i) => isNavCurrent('/3625-maska.html', i)), [])
})

const price = { base: 10000, sale: null, current: 10000 }

test('product card: unknown stock is not shown as sold out; a known zero is', () => {
  const card = (stock: number | null) => renderToStaticMarkup(h(ProductCard, { p: { id: 1, name: 'Maska', slug: 'maska', priceCents: 10000, stock } }))
  const unknown = card(null)
  assert.doesNotMatch(unknown, /prod-out|niedostępny/)
  assert.match(unknown, /Dostępność do potwierdzenia/)
  const zero = card(0)
  assert.match(zero, /class="prod prod-out"/)
  assert.match(zero, /Chwilowo niedostępny/)
  assert.doesNotMatch(card(4), /prod-out|avail/)
})

test('product page: unknown stock blocks purchase with a working enquiry; zero is unavailable', () => {
  const buy = (stock: number | null, variants: { label: string; stock: number | null }[] = []) => renderToStaticMarkup(
    h(CartProvider, null, h(AddToCart, { product: { id: 7, slug: 'maska', name: 'Maska', price, stock }, variants: variants.map((v) => ({ ...v, price })) })),
  )
  const unknown = buy(null)
  assert.match(unknown, /href="\/kontakt\.html\?produkt=7"[^>]*>Zapytaj o dostępność/)
  assert.match(unknown, /Dostępność do potwierdzenia/)
  assert.doesNotMatch(unknown, /Dodaj do koszyka|niedostępny/)
  const zero = buy(0)
  assert.match(zero, /Chwilowo niedostępny/)
  assert.doesNotMatch(zero, /Dodaj do koszyka/)
  assert.match(buy(3), /Dodaj do koszyka/)
  // Variants: only the known zero is crossed out; the unknown one is selected and offers an enquiry.
  const v = buy(null, [{ label: 'S', stock: 0 }, { label: 'L', stock: null }])
  assert.equal(v.match(/chip-off/g)?.length, 1)
  assert.match(v, /chip chip-off"><input[^>]*value="S"/)
  assert.match(v, /chip chip-on"><input[^>]*checked=""[^>]*value="L"/)
})

test('phone links render each number separately as written', () => {
  const html = renderToStaticMarkup(h(PhoneLinks, { value: '22 826 47 73, 604 123 456 wew. 2' }))
  assert.equal(html, '<a href="tel:+48228264773">22 826 47 73</a>, <span>604 123 456 wew. 2</span>')
})
