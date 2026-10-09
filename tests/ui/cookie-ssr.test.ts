import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CookieSettings } from '../../src/components/CookieSettings'

test('a cold SSR response already contains the privacy notice and all three choices', () => {
  const html = renderToStaticMarkup(createElement(CookieSettings, { preview: true, privacyHref: '/polityka-prywatnosci.html' }))
  const notice = html.match(/<section[^>]*class="privacy-banner"[^>]*>([\s\S]*?)<\/section>/)?.[1]
  assert.ok(notice, 'notice must exist before any client effect or portal container')
  assert.match(notice, /Tylko niezbędne/)
  assert.match(notice, /Zgoda na pomiar \(test\)/)
  assert.match(notice, />Ustawienia<\/button>/)
  assert.equal((notice.match(/<button /g) || []).length, 3)
  assert.match(notice, /href="\/polityka-prywatnosci.html"/)
  assert.match(notice, /bez wysyłania danych/)
})

test('the existing settings opener and closed native dialog remain available with the server notice', () => {
  const html = renderToStaticMarkup(createElement(CookieSettings, { preview: true }))
  assert.match(html, />Ustawienia prywatności<\/button>/)
  assert.match(html, /<dialog[^>]*aria-labelledby=/)
  assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:=|\s|>)/)
  assert.match(html, /Domyślnie wyłączone|Żaden skrypt analityczny nie jest wczytywany/)
  assert.doesNotMatch(html, /<script|<iframe|onload=/)
})
