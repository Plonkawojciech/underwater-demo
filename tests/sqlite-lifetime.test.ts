import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const clientModule = createRequire(require.resolve('@payloadcms/db-sqlite')).resolve('@libsql/client')
const variants = [{ name: 'CJS', createClient: (await import(clientModule)).createClient }, { name: 'ESM', createClient: (await import(clientModule.replace('/lib-cjs/', '/lib-esm/'))).createClient }]
for (const { name, createClient } of variants) {

test(`file transactions reuse bounded native handles and terminal objects cannot operate on a later transaction (${name})`, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'underwater-sql-lifetime-'))
  const filename = path.join(root, 'synthetic.db')
  const client = createClient({ url: `file:${filename}` })
  const handles = () => {
    if (process.platform === 'linux') return readdirSync('/proc/self/fd').filter(fd => {
      try { return [filename, filename + '-wal', filename + '-shm'].includes(readlinkSync('/proc/self/fd/' + fd)) } catch { return false }
    }).length
    const result = spawnSync('lsof', ['-a', '-p', String(process.pid), '-Fn', filename, filename + '-wal', filename + '-shm'], { encoding: 'utf8' })
    assert.ok(result.status === 0 || result.status === 1, 'lsof must inspect this test process')
    return result.stdout.split('\n').filter(line => line.startsWith('n')).length
  }
  try {
    await client.execute('PRAGMA journal_mode=WAL')
    await client.execute('CREATE TABLE synthetic(id INTEGER PRIMARY KEY)')
    const first = await client.transaction('write')
    await first.execute('INSERT INTO synthetic VALUES (1)')
    assert.equal((await client.execute('SELECT count(*) AS n FROM synthetic')).rows[0].n, 0, 'ordinary reads cannot see an uncommitted write')
    await first.commit()
    const baseline = handles()
    for (let n = 2; n <= 502; n++) {
      const tx = await client.transaction('write')
      await assert.rejects(first.execute('SELECT 1'), (error: any) => error.code === 'TRANSACTION_CLOSED')
      await tx.execute({ sql: 'INSERT INTO synthetic VALUES (?)', args: [n] })
      if (n % 3 === 0) await tx.commit()
      else if (n % 3 === 1) await tx.rollback()
      else tx.close()
      assert.equal(tx.closed, true)
      await tx.rollback(); tx.close()
    }
    assert.ok(handles() <= baseline + 2, 'native database handles must plateau without relying on GC')
    assert.equal((await client.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
    assert.equal((await client.execute('SELECT count(*) AS n FROM synthetic')).rows[0].n, 168)
  } finally { client.close(); rmSync(root, { recursive: true, force: true }) }
})

test(`a failed deferred-constraint COMMIT stays open for rollback and transaction PRAGMAs persist (${name})`, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'underwater-sql-commit-'))
  const client = createClient({ url: `file:${path.join(root, 'synthetic.db')}` })
  try {
    await client.execute('CREATE TABLE parent(id INTEGER PRIMARY KEY)')
    await client.execute('CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)')
    const tx = await client.transaction('write')
    assert.equal((await tx.execute('PRAGMA foreign_keys')).rows[0].foreign_keys, 1)
    assert.equal((await tx.execute('PRAGMA synchronous')).rows[0].synchronous, 2)
    assert.equal((await tx.execute('PRAGMA busy_timeout')).rows[0].timeout, 5000)
    await tx.execute('INSERT INTO child VALUES (999)')
    await assert.rejects(tx.commit())
    assert.equal(tx.closed, false, 'the original failed COMMIT must remain rollback-capable')
    await tx.rollback()
    await client.execute('DROP TABLE child')
    await client.execute('CREATE TABLE child(parent_id INTEGER)')
    const next = await client.transaction('write')
    assert.equal((await next.execute('SELECT count(*) AS n FROM child')).rows[0].n, 0)
    await next.commit()
    await assert.rejects(tx.execute('SELECT 1'), (error: any) => error.code === 'TRANSACTION_CLOSED')
  } finally { client.close(); rmSync(root, { recursive: true, force: true }) }
})

}
