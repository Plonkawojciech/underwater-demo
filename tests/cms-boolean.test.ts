import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckboxFieldClient, DefaultCellComponentProps } from 'payload'
import BooleanCell from '../src/components/admin/BooleanCell'
import { booleanCellLabel } from '../src/components/admin/booleanCellLabel'
import { Products } from '../src/collections/Products'

test('CMS checkbox labels retain three states without translation keys or literal booleans', () => {
  assert.equal(booleanCellLabel(true), 'Tak')
  assert.equal(booleanCellLabel(false), 'Nie')
  assert.equal(booleanCellLabel(null), 'Nie ustawiono')
  assert.equal(booleanCellLabel(undefined), 'Nie ustawiono')
  for (const unexpected of ['false', 'true', 0, 1, {}]) assert.equal(booleanCellLabel(unexpected), 'Nie ustawiono')
})

test('CMS featured column uses the readable checkbox cell without rewriting imported nulls', () => {
  const field = Products.fields.find(field => 'name' in field && field.name === 'featured')
  assert.ok(field && field.type === 'checkbox')
  assert.equal(field.defaultValue, false)
  assert.equal(field.admin?.components?.Cell, '@/components/admin/BooleanCell')
  assert.equal(field.hooks, undefined, 'Display formatting must not write defaults into imported records')
  for (const [value, expected] of [[true, '<span>Tak</span>'], [false, '<span>Nie</span>'], [null, '<span>Nie ustawiono</span>'], [undefined, '<span>Nie ustawiono</span>']] as const) {
    const props: DefaultCellComponentProps<CheckboxFieldClient, unknown> = {
      cellData: value, collectionSlug: 'products', field: { name: 'featured', type: 'checkbox', label: 'Pokaż w promocjach na stronie głównej' }, rowData: { id: 1, featured: value },
    }
    assert.equal(renderToStaticMarkup(createElement(BooleanCell, props)), expected)
    assert.equal(props.rowData.featured, value)
  }
})
