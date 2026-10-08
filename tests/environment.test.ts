import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEnvironment } from '../src/lib/environment'

const valid: Record<string, string | undefined> = {
  UNDERWATER_ENVIRONMENT: 'test',
  UNDERWATER_DATA_ROOT: '/tmp/underwater-isolated-test',
  DATABASE_URI: 'file:/tmp/underwater-isolated-test/underwater-test.db',
  MEDIA_DIR: '/tmp/underwater-isolated-test/media',
  NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011',
  PAYLOAD_SECRET: 'synthetic-test-secret-not-used-outside-unit-tests',
}

test('the runtime accepts only its dedicated local database and media', () => {
  const config = validateEnvironment(valid)
  assert.equal(config.environment, 'test')
  assert.equal(config.serverURL, 'http://localhost:3011')
  assert.equal(config.databasePath, '/tmp/underwater-isolated-test/underwater-test.db')
})

test('a source host, remote database, shared database and missing secrets fail closed', () => {
  const invalid = [
    { NEXT_PUBLIC_SERVER_URL: 'https://www.underwater.pl' },
    { NEXT_PUBLIC_SERVER_URL: 'https://programo.pl.attacker.example' },
    { NEXT_PUBLIC_SERVER_URL: 'https://user:password@underwater-demo.programo.pl' },
    { DATABASE_URI: 'mysql://source-database/underwater' },
    { DATABASE_URI: 'file:/tmp/crm.db' },
    { DATABASE_URI: 'file:/tmp/underwater-isolated-test/../crm.db' },
    { MEDIA_DIR: '/tmp/shared-media' },
    { PAYLOAD_SECRET: 'dev-secret' },
    { UNDERWATER_ENVIRONMENT: 'production' },
    { UNDERWATER_DATA_ROOT: './data' },
    { NEXT_PUBLIC_SERVER_URL: 'http://underwater-demo.programo.pl' },
  ]
  for (const patch of invalid) assert.throws(() => validateEnvironment({ ...valid, ...patch }))
  for (const key of Object.keys(valid)) {
    const config = { ...valid }
    delete config[key]
    assert.throws(() => validateEnvironment(config), 'Missing ' + key)
  }
})
