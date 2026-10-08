import test from 'node:test'
import assert from 'node:assert/strict'
import { validPreviewAuthorization, healthToken, validHealthToken } from '../src/lib/preview-auth'
import { validateEnvironment } from '../src/lib/environment'

test('preview gate rejects missing, malformed and wrong credentials', () => {
  const user = 'underwater', password = 'synthetic-private-preview-password'
  const valid = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
  assert.equal(validPreviewAuthorization(valid, user, password), true)
  for (const header of [null, '', 'Bearer token', 'Basic !!!', valid + 'bad', 'Basic ' + Buffer.from('underwater:wrong').toString('base64'), 'Basic ' + 'A'.repeat(1025)]) assert.equal(validPreviewAuthorization(header, user, password), false)
})
test('health tokens are purpose-scoped and do not grant preview access', () => {
  const secret = 'synthetic-private-health-secret-long-enough'
  const token = healthToken(secret)
  assert.equal(validHealthToken(token, secret), true)
  assert.equal(validHealthToken(token, secret + 'changed'), false)
  assert.equal(validHealthToken('z'.repeat(64), secret), false)
  assert.equal(validPreviewAuthorization(token, 'underwater', secret), false)
})
test('preview cannot start before access protection is configured', () => {
  assert.throws(() => validateEnvironment({ UNDERWATER_ENVIRONMENT: 'preview', UNDERWATER_DATA_ROOT: '/data/underwater', DATABASE_URI: 'file:/data/underwater/underwater-preview.db', MEDIA_DIR: '/data/underwater/media', NEXT_PUBLIC_SERVER_URL: 'https://underwater-demo.programo.pl', PAYLOAD_SECRET: 'synthetic-long-preview-payload-secret' }), /authentication/)
})
