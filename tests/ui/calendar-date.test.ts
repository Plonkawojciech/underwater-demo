import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DateRange } from '../../src/components/content/DateText'

test('calendar date and time use Warsaw DST and retain the UTC machine-readable instant', () => {
  const html = renderToStaticMarkup(createElement(DateRange, { from: '2026-10-20T08:00:00.000Z', showTime: true }))
  assert.match(html, /10:00/)
  assert.match(html, /dateTime="2026-10-20T08:00:00.000Z"/i)
  const winter = renderToStaticMarkup(createElement(DateRange, { from: '2026-11-20T08:00:00.000Z', showTime: true }))
  assert.match(winter, /09:00/)
})
test('dated trip ranges do not invent times while timed sessions retain both endpoints', () => {
  const timed = renderToStaticMarkup(createElement(DateRange, { from: '2026-10-20T08:00:00.000Z', to: '2026-10-20T09:00:00.000Z', showTime: true }))
  assert.match(timed, /10:00/); assert.match(timed, /11:00/)
  const dated = renderToStaticMarkup(createElement(DateRange, { from: '2026-10-20T08:00:00.000Z', to: '2026-10-21T08:00:00.000Z' }))
  assert.doesNotMatch(dated.replace(/<[^>]+>/g, ''), /\d{2}:\d{2}/)
})
