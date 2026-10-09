import test from 'node:test'
import assert from 'node:assert/strict'
import { APIError, formatErrors } from 'payload'
import { canRunRecordAction, moneyDisplayValue, moneyInputValue, moneyStorageValue, parseMoneyInput, plainBodyHTML, plainBodyValue } from '../src/components/admin/fieldHelpers'
import { validateCatalog } from '../src/lib/catalog-validation'
import { sanitizeContent } from '../src/lib/html'

type CatalogHookArguments = Parameters<typeof validateCatalog>[0]
const catalogUpdate = (data: Record<string, unknown>, originalDoc: Record<string, unknown>, systemAction = '') => validateCatalog({
  data, originalDoc, operation: 'update', req: { context: { systemAction } },
} as unknown as CatalogHookArguments)

for (const scenario of [
  { name: 'product', data: { stock: 0 }, original: { stock: 3 }, message: 'Stan magazynu zmienił się. Odśwież produkt; korekty wykonuj w obsłudze magazynu.' },
  { name: 'variant', data: { stock: 3, variants: [{ id: 'saved', label: 'Niebieski', stock: 0 }] }, original: { stock: 3, variants: [{ id: 'saved', label: 'Niebieski', stock: 3 }] }, message: 'Stan wariantu zmienił się. Odśwież produkt.' },
  { name: 'new variant', data: { stock: 0, variants: [{ id: 'new', label: 'Niebieski', stock: 3 }] }, original: { stock: 0, variants: [] }, message: 'Nowy wariant wymaga osobnego potwierdzenia stanu.' },
]) {
  test(`CMS stock ${scenario.name} conflict retains its public message after error names are minified`, () => {
    assert.throws(() => catalogUpdate(scenario.data, scenario.original), error => {
      assert.ok(error instanceof APIError)
      assert.equal(error.status, 409)
      assert.equal(error.isPublic, true)
      // Production class names may be removed; use Payload's real formatter.
      error.name = ''
      assert.deepEqual(formatErrors(error), { errors: [{ name: '', data: { code: 'inventory-conflict' }, message: scenario.message }] })
      return true
    })
  })
}

test('CMS stock correction through the operations service still updates the variant and aggregate', async () => {
  const result = await catalogUpdate({ variants: [{ id: 'saved', label: 'Niebieski', stock: 3 }] }, { stock: 0, variants: [{ id: 'saved', label: 'Niebieski', stock: 0 }] }, 'operations-service')
  assert.deepEqual(result, { stock: 3, variants: [{ id: 'saved', label: 'Niebieski', stock: 3 }] })
})

test('CMS money accepts Polish decimals without floating point rounding', () => {
  for (const [input, expected] of [['129,90', 12990], ['129.9', 12990], ['0,29', 29], ['19.99', 1999], ['1500', 150000], ['0001,01', 101], [' 12,05 ', 1205], ['1,', 100]] as const) {
    assert.deepEqual(parseMoneyInput(input), { cents: expected }, input)
    assert.equal(parseMoneyInput(moneyInputValue(expected)).cents, expected)
  }
})

test('CMS money keeps unknown amount distinct from zero and enforces the commerce limit', () => {
  assert.deepEqual(parseMoneyInput(''), { cents: null })
  assert.deepEqual(parseMoneyInput('  '), { cents: null })
  assert.deepEqual(parseMoneyInput('0'), { cents: 0 })
  assert.deepEqual(parseMoneyInput('0,00'), { cents: 0 })
  assert.deepEqual(parseMoneyInput('1000000,00'), { cents: 100_000_000 })
  assert.equal(moneyInputValue(null), '')
  assert.equal(moneyInputValue(0), '0,00')
  assert.ok(parseMoneyInput('1000000,01').error)
})

test('CMS money rejects silently truncated precision, exponent notation and mixed separators', () => {
  for (const input of ['1,234', '1.234', '-1', '+2', '1e3', '1,20.5', '1.2,5', '.', ',', '1 234,50', 'Infinity', 'NaN', '0x10', '9'.repeat(30)]) {
    const result = parseMoneyInput(input)
    assert.equal(result.cents, null, input)
    assert.ok(result.error, input)
  }
})

test('one money input preserves the stored units of a product, variant and session', () => {
  const input = parseMoneyInput('10,08')
  assert.equal(moneyStorageValue(input.cents, false), 10.08, 'product/course price stays złoty')
  assert.equal(moneyStorageValue(input.cents, true), 1008, 'variant/session priceCents stays grosze')
  assert.equal(moneyDisplayValue(10.08, false), '10,08')
  assert.equal(moneyDisplayValue(1008, true), '10,08')
  for (const storedInCents of [true, false]) {
    assert.equal(moneyStorageValue(null, storedInCents), null)
    assert.equal(moneyStorageValue(0, storedInCents), 0)
    assert.equal(moneyDisplayValue(null, storedInCents), '')
    assert.equal(moneyDisplayValue(0, storedInCents), '0,00')
  }
})

test('plain CMS descriptions retain paragraph and line boundaries after storage and sanitization', () => {
  const value = 'Pierwszy akapit.\nDrugi wiersz.\n\nNowy akapit z polską nazwą: Łódź.'
  const stored = plainBodyHTML(value)
  assert.equal(stored, '<p>Pierwszy akapit.<br>Drugi wiersz.</p><p>Nowy akapit z polską nazwą: Łódź.</p>')
  assert.equal(plainBodyValue(stored), value)
  assert.equal(sanitizeContent(stored), stored.replace('<br>', '<br />'))
  assert.equal(plainBodyHTML('  \r\n '), '')
  assert.equal(plainBodyValue(null), '')
})

test('plain descriptions show pasted markup literally instead of executing it', () => {
  const value = '<script>alert("test")</script>\n<img src="https://example.invalid/x" onerror="alert(1)">\n\nA & B > C'
  const stored = plainBodyHTML(value)
  assert.equal(plainBodyValue(stored), value)
  const cleaned = sanitizeContent(stored)
  assert.doesNotMatch(cleaned, /<(?:script|img)\b/)
  assert.match(cleaned, /&lt;script&gt;/)
  assert.match(cleaned, /A &amp; B &gt; C/)
})

test('formatted imported HTML remains in HTML mode without being flattened or rewritten', () => {
  for (const html of ['<h2>Program</h2><p>Teoria <strong>i praktyka</strong>.</p>', '<p>Zdjęcie: <img src="/api/media/file/real.jpg" alt="Maska"></p>', '<p><a href="/kurs.html">Kurs</a></p>', '<table><tr><td>Parametr</td></tr></table>']) assert.equal(plainBodyValue(html), null, html)
  assert.equal(plainBodyValue('Zwykły opis'), 'Zwykły opis')
  assert.equal(plainBodyValue('Dopuszczalne ciśnienie < 200 bar; poziom > 1'), 'Dopuszczalne ciśnienie < 200 bar; poziom > 1')
  assert.equal(plainBodyValue('<p>&amp;lt;script&amp;gt;</p>'), '&lt;script&gt;', 'decode once only')
})

test('record actions never run while the client has an unsaved, processing or unavailable form', () => {
  assert.equal(canRunRecordAction({ modified: false, processing: false, pending: false, ready: true }), true)
  for (const change of [{ modified: true }, { processing: true }, { pending: true }, { ready: false }]) {
    assert.equal(canRunRecordAction({ modified: false, processing: false, pending: false, ready: true, ...change }), false)
  }
})

test('imported paragraph entities stay in HTML mode and cannot be double-escaped', () => {
  for (const entity of ['&nbsp;', '&#160;', '&#xA0;', '&oacute;', '&AMP;']) {
    const imported = `<p>A${entity}B</p>`
    assert.equal(plainBodyValue(imported), null, imported)
  }
  assert.equal(plainBodyValue('<p>A &amp; B &#39;C&#39;</p>'), "A & B 'C'")
  assert.equal(plainBodyHTML(plainBodyValue('<p>A &amp;nbsp; B</p>')!), '<p>A &amp;nbsp; B</p>')
})

test('tagless imported HTML entities remain in the preserved HTML editor', () => {
  assert.equal(plainBodyValue('Maska&nbsp;Sopras &amp; fajka'), null)
  assert.equal(plainBodyValue('Załoga &#x0141;ódź'), null)
  assert.equal(plainBodyValue('Maska & fajka'), 'Maska & fajka')
})
