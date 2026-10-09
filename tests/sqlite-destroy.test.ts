import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { setImmediate } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { buildConfig, createLocalReq, getPayload } from 'payload'
import { sql, type SQLiteAdapter } from '@payloadcms/db-sqlite'
import { activeWriteTransactionCount, leasedSqliteAdapter, writeLease } from '../src/lib/sqlite-adapter'

// Native prepared statements retain their connection until finalization,
// even after close(). Keep the old client reachable while collecting only
// abandoned statements; an unclosed client therefore cannot pass the FD check.
setFlagsFromString('--expose-gc')
const collectStatements = runInNewContext('gc') as () => void
async function finalizeStatements() {
  await setImmediate()
  collectStatements()
  await setImmediate()
}

function handles(filename: string) {
  const files = [filename, filename + '-wal', filename + '-shm']
  if (process.platform === 'linux') return readdirSync('/proc/self/fd').filter(fd => {
    try { return files.includes(readlinkSync('/proc/self/fd/' + fd)) } catch { return false }
  }).length
  const result = spawnSync('lsof', ['-a', '-p', String(process.pid), '-Ffn', ...files], { encoding: 'utf8' })
  assert.ok(result.status === 0 || result.status === 1, 'lsof must inspect this test process')
  let fd = '', count = 0
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('f')) fd = line.slice(1)
    else if (line.startsWith('n') && /^\d/.test(fd)) count++
  }
  return count
}

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'underwater-sql-destroy-'))
  const filename = path.join(root, 'synthetic.db')
  const config = buildConfig({
    secret: 'synthetic-sqlite-destroy-test-secret-not-runtime',
    collections: [{ slug: 'synthetic-records', timestamps: false, defaultSort: 'id', fields: [{ name: 'value', type: 'text' }] }],
    typescript: { autoGenerate: false }, admin: { importMap: { autoGenerate: false } },
    db: leasedSqliteAdapter({ client: { url: `file:${filename}` }, push: false, transactionOptions: { behavior: 'immediate' }, busyTimeout: 5000, wal: { synchronous: 'FULL' } }),
  })
  try {
    const payload = await getPayload({ config, disableOnInit: true, key: root })
    const db = payload.db as unknown as SQLiteAdapter
    await db.client.execute('CREATE TABLE synthetic(id INTEGER PRIMARY KEY)')
    await db.client.execute('CREATE TABLE synthetic_records(id INTEGER PRIMARY KEY, value TEXT)')
    return { root, filename, payload, db }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error }
}
const transactionDB = (db: SQLiteAdapter, id: string) => db.sessions![id].db as unknown as SQLiteAdapter['drizzle']
// The application's generated collection union excludes this isolated SDK
// fixture; its sanitized config above defines the runtime collection.
const records = 'synthetic-records' as Parameters<SQLiteAdapter['create']>[0]['collection']

test('SDK destruction rolls back abandoned writes, releases handles and reconnects through the HMR sequence', async () => {
  const { root, filename, payload, db } = await fixture()
  const clients: SQLiteAdapter['client'][] = []
  const closedIDs: string[] = []
  try {
    await db.client.execute('INSERT INTO synthetic VALUES (1)')
    for (let n = 2; n <= 4; n++) {
      const original = db.client
      clients.push(original)
      const id = String(await db.beginTransaction())
      assert.equal(activeWriteTransactionCount(db), 1)
      closedIDs.push(id)
      const orphanDB = transactionDB(db, id)
      await orphanDB.run(sql`INSERT INTO synthetic VALUES (${100 + n})`)
      assert.ok(handles(filename) > 0)
      await payload.destroy()
      assert.equal(activeWriteTransactionCount(db), 0, 'closed markers retain request protection but no unfinished native transaction')
      assert.equal(original.closed, true)
      assert.equal(Reflect.get(db, 'client'), undefined, 'connect creates a new client only when the old property is absent')
      assert.deepEqual(Object.keys(db.sessions!), closedIDs)
      await assert.rejects(original.execute('SELECT 1'), (error: any) => error.code === 'CLIENT_CLOSED')
      await assert.rejects(db.commitTransaction(id), /adapter was destroyed/)
      await assert.rejects(orphanDB.run(sql`SELECT 1`), (error: any) => error.cause?.code === 'TRANSACTION_CLOSED')
      await finalizeStatements()
      assert.equal(handles(filename), 0, 'no native file handle remains after statements finalize, while the old client is retained')
      await payload.destroy() // Already destroyed is a safe no-op.

      // Exact database sequence used by Payload.reload on the same adapter.
      await db.init!()
      await db.connect!({ hotReload: true })
      assert.notEqual(db.client, original)
      assert.equal(db.client.closed, false)
      assert.equal((await db.client.execute('PRAGMA journal_mode')).rows[0].journal_mode, 'wal')
      assert.equal((await db.client.execute('PRAGMA foreign_keys')).rows[0].foreign_keys, 1)
      assert.equal((await db.client.execute('PRAGMA synchronous')).rows[0].synchronous, 2)
      assert.equal((await db.client.execute('PRAGMA busy_timeout')).rows[0].timeout, 5000)
      assert.deepEqual((await db.client.execute('SELECT id FROM synthetic ORDER BY id')).rows.map(row => row.id), Array.from({ length: n - 1 }, (_, i) => i + 1), 'abandoned writes roll back and committed data survives reconnect')
      const next = String(await db.beginTransaction())
      assert.equal((await transactionDB(db, next).run(sql`PRAGMA foreign_keys`)).rows[0].foreign_keys, 1)
      assert.equal((await transactionDB(db, next).run(sql`PRAGMA synchronous`)).rows[0].synchronous, 2)
      assert.equal((await transactionDB(db, next).run(sql`PRAGMA busy_timeout`)).rows[0].timeout, 5000)
      await transactionDB(db, next).run(sql`INSERT INTO synthetic VALUES (${n})`)
      await db.commitTransaction(next)
    }
    assert.equal((await db.client.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic ORDER BY id')).rows.map(row => row.id), [1, 2, 3, 4])
    await payload.destroy()
    await finalizeStatements()
    assert.equal(handles(filename), 0)
    assert.ok(clients.every(client => client.closed))
  } finally {
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('rollback errors are reported after native closure and metadata cleanup', async () => {
  const { root, filename, payload, db } = await fixture()
  const original = db.client
  const failure = new Error('Synthetic rollback acknowledgement failure')
  try {
    const id = String(await db.beginTransaction())
    const session = db.sessions![id]
    await transactionDB(db, id).run(sql`INSERT INTO synthetic VALUES (99)`)
    const reject = session.reject
    session.reject = async () => { await reject(); throw failure }
    await assert.rejects(payload.destroy(), error => error === failure)
    assert.equal(original.closed, true)
    assert.equal(Reflect.get(db, 'client'), undefined)
    assert.equal(db.drizzle, undefined)
    assert.deepEqual(Object.keys(db.sessions!), [id])
    await finalizeStatements()
    assert.equal(handles(filename), 0)
    await db.init!()
    await db.connect!({ hotReload: true })
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic')).rows, [])
  } finally {
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('writers queued behind an abandoned session cannot begin during destruction', async () => {
  const { root, filename, payload, db } = await fixture()
  try {
    const id = String(await db.beginTransaction())
    await transactionDB(db, id).run(sql`INSERT INTO synthetic VALUES (99)`)
    const req = await createLocalReq({}, payload)
    let transactionSettled = false, accountSettled = false
    const queuedTransaction = db.beginTransaction().finally(() => { transactionSettled = true })
    const queuedAccount = db.updateOne({ collection: 'users', id: 1, data: { loginAttempts: 1 }, req }).finally(() => { accountSettled = true })
    const rejects = [assert.rejects(queuedTransaction, /adapter was destroyed/), assert.rejects(queuedAccount, /adapter was destroyed/)]
    await setImmediate()
    assert.equal(transactionSettled, false)
    assert.equal(accountSettled, false)
    await payload.destroy()
    await Promise.all(rejects)
    assert.deepEqual(Object.keys(db.sessions!), [id])
    await assert.rejects(db.beginTransaction(), /adapter was destroyed/)
    await assert.rejects(db.updateOne({ collection: 'users', id: 1, data: { loginAttempts: 1 }, req }), /adapter was destroyed/)
    await finalizeStatements()
    assert.equal(handles(filename), 0)
    await db.init!()
    await db.connect!({ hotReload: true })
    const next = String(await db.beginTransaction())
    await transactionDB(db, next).run(sql`INSERT INTO synthetic VALUES (1)`)
    await db.commitTransaction(next)
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic')).rows.map(row => row.id), [1])
  } finally {
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('old request IDs cannot write in autocommit after repeated HMR or owner finalization', async () => {
  const { root, payload, db } = await fixture()
  try {
    const fresh = await createLocalReq({}, payload)
    const stored = await db.create({ collection: records, data: { value: 'committed-before-HMR' }, req: fresh })
    const id = String(await db.beginTransaction())
    const req = await createLocalReq({}, payload)
    req.transactionID = id
    await db.create({ collection: records, data: { value: 'abandoned-before-HMR' }, req })
    await payload.destroy()
    const marker = db.sessions![id]
    for (let cycle = 0; cycle < 2; cycle++) {
      await db.init!()
      await db.connect!({ hotReload: true })
      await assert.rejects(db.create({ collection: records, data: { value: 'must-not-autocommit' }, req }), /adapter was destroyed/)
      await assert.rejects(db.updateOne({ collection: records, id: stored.id, data: { value: 'must-not-update' }, req }), /adapter was destroyed/)
      await assert.rejects(db.updateMany({ collection: records, where: { id: { equals: stored.id } }, data: { value: 'must-not-update-many' }, req }), /adapter was destroyed/)
      await assert.rejects(db.commitTransaction(id), /adapter was destroyed/)
      await db.rollbackTransaction(id)
      assert.equal(db.sessions![id], marker, 'finalizing one owner cannot prove that all copies of the request ID have gone')
      await assert.rejects(db.create({ collection: records, data: { value: 'must-not-autocommit-after-finalization' }, req }), /adapter was destroyed/)
      assert.deepEqual((await db.client.execute('SELECT value FROM synthetic_records')).rows.map(row => row.value), ['committed-before-HMR'])
      const next = String(await db.beginTransaction())
      const nextReq = await createLocalReq({}, payload)
      nextReq.transactionID = next
      await db.updateOne({ collection: records, id: stored.id, data: { value: 'fresh-transaction' }, req: nextReq })
      await db.rollbackTransaction(next)
      assert.deepEqual((await db.client.execute('SELECT value FROM synthetic_records')).rows.map(row => row.value), ['committed-before-HMR'])
      await payload.destroy()
      assert.equal(db.sessions![id], marker, 'another reload must not prune the tombstone')
    }
  } finally {
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('BEGIN completed before registration is aborted when HMR destroys its generation', async () => {
  const { root, filename, payload, db } = await fixture()
  const originalClient = db.client
  let proceed: (() => void) | undefined
  let begun: ReturnType<SQLiteAdapter['beginTransaction']> | undefined
  let destroying: Promise<void> | undefined
  let destroySettled = false
  try {
    let entered!: () => void
    const inGap = new Promise<void>(resolve => { entered = resolve })
    const resume = new Promise<void>(resolve => { proceed = resolve })
    const drizzle = db.drizzle
    const originalTransaction = drizzle.transaction.bind(drizzle)
    drizzle.transaction = (run, options) => {
      const completion = originalTransaction(async tx => {
        await tx.run(sql`INSERT INTO synthetic VALUES (99)`)
        entered()
        await resume
        return run(tx)
      }, options)
      // The driver's BEGIN is synchronous; call destroy before the wrapper
      // receives this promise or its callback can register the session.
      destroying = payload.destroy().finally(() => { destroySettled = true })
      return completion
    }
    begun = db.beginTransaction()
    const rejection = assert.rejects(begun, /adapter was destroyed/)
    await inGap
    assert.equal(activeWriteTransactionCount(db), 1, 'count includes BEGIN before session registration')
    assert.deepEqual(Object.keys(db.sessions!), [], 'the native BEGIN has completed but the wrapper has not registered a session')
    await setImmediate()
    assert.equal(destroySettled, false, 'destroy must wait for the unregistered BEGIN to abort')
    assert.equal(originalClient.closed, false, 'ROLLBACK must complete before the native client is closed')
    proceed!()
    await rejection
    await destroying!
    assert.equal(activeWriteTransactionCount(db), 0)
    assert.equal(originalClient.closed, true)
    assert.deepEqual(Object.keys(db.sessions!), [])
    await db.init!()
    await db.connect!({ hotReload: true })
    const nextID = String(await db.beginTransaction())
    assert.deepEqual(Object.keys(db.sessions!), [nextID], 'the obsolete BEGIN must never register a session')
    await transactionDB(db, nextID).run(sql`INSERT INTO synthetic VALUES (1)`)
    await db.commitTransaction(nextID)
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic')).rows.map(row => row.id), [1])
    await payload.destroy()
    await finalizeStatements()
    assert.equal(handles(filename), 0)
  } finally {
    proceed?.()
    await begun?.catch(() => undefined)
    await destroying
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an old queued writer is rejected even if its shared lease becomes free after HMR reconnect', async () => {
  const { root, payload, db } = await fixture()
  let release: (() => void) | undefined
  try {
    release = await writeLease(db).acquire()
    const req = await createLocalReq({}, payload)
    let transactionSettled = false, accountSettled = false
    const queuedTransaction = db.beginTransaction().finally(() => { transactionSettled = true })
    const queuedAccount = db.updateOne({ collection: 'users', id: 1, data: { loginAttempts: 1 }, req }).finally(() => { accountSettled = true })
    const rejects = [assert.rejects(queuedTransaction, /adapter was destroyed/), assert.rejects(queuedAccount, /adapter was destroyed/)]
    await setImmediate()
    assert.equal(transactionSettled, false)
    assert.equal(accountSettled, false)
    assert.equal(activeWriteTransactionCount(db), 0, 'waiting for the lease is not an unfinished native transaction')
    await payload.destroy()
    await db.init!()
    await db.connect!({ hotReload: true })
    release(); release = undefined
    await Promise.all(rejects)
    assert.deepEqual(Object.keys(db.sessions!), [])
    const next = String(await db.beginTransaction())
    await transactionDB(db, next).run(sql`INSERT INTO synthetic VALUES (1)`)
    await db.commitTransaction(next)
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic')).rows.map(row => row.id), [1])
  } finally {
    release?.()
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})

test('destroy waits for owner COMMIT and ROLLBACK already in flight after their session is removed', async () => {
  for (const outcome of ['commit', 'rollback'] as const) {
    const { root, payload, db } = await fixture()
    const originalClient = db.client
    let release!: () => void, entered!: () => void
    const pause = new Promise<void>(resolve => { release = resolve })
    const finalizing = new Promise<void>(resolve => { entered = resolve })
    let owner: Promise<void> | undefined, destroying: Promise<void> | undefined
    try {
      assert.equal(activeWriteTransactionCount(db), 0)
      const drizzle = db.drizzle, originalTransaction = drizzle.transaction.bind(drizzle)
      drizzle.transaction = (run, options) => originalTransaction(async tx => {
        // A controlled window after owner finish, before native COMMIT or
        // ROLLBACK. This await is instrumentation, not a production SDK path.
        try { return await run(tx) } finally { entered(); await pause }
      }, options)
      const id = String(await db.beginTransaction())
      await transactionDB(db, id).run(sql`INSERT INTO synthetic VALUES (99)`)
      owner = outcome === 'commit' ? db.commitTransaction(id) : db.rollbackTransaction(id)
      await finalizing
      assert.equal(db.sessions![id], undefined)
      assert.equal(activeWriteTransactionCount(db), 1, 'session removal does not prove native finalization has completed')
      let destroySettled = false
      destroying = payload.destroy().finally(() => { destroySettled = true })
      await setImmediate()
      assert.equal(destroySettled, false)
      assert.equal(originalClient.closed, false)
      assert.equal(activeWriteTransactionCount(db), 1)
      release()
      await owner
      await destroying
      assert.equal(originalClient.closed, true)
      assert.equal(activeWriteTransactionCount(db), 0)
      await db.init!()
      await db.connect!({ hotReload: true })
      // No statement GC or retry before the next native BEGIN and data check.
      const next = String(await db.beginTransaction())
      assert.equal(activeWriteTransactionCount(db), 1)
      await transactionDB(db, next).run(sql`INSERT INTO synthetic VALUES (1)`)
      await db.commitTransaction(next)
      assert.equal(activeWriteTransactionCount(db), 0)
      assert.deepEqual((await db.client.execute('SELECT id FROM synthetic ORDER BY id')).rows.map(row => row.id), outcome === 'commit' ? [1, 99] : [1])
    } finally {
      release()
      await Promise.allSettled([owner, destroying])
      await payload.destroy()
      await finalizeStatements() // FD finalization is cleanup, after the no-GC assertions.
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a second concurrent destroy waits for the first rollback despite its retained tombstone', async () => {
  const { root, payload, db } = await fixture()
  const originalClient = db.client
  let release!: () => void, entered!: () => void
  const pause = new Promise<void>(resolve => { release = resolve })
  const rollingBack = new Promise<void>(resolve => { entered = resolve })
  let first: Promise<void> | undefined, second: Promise<void> | undefined
  try {
    const id = String(await db.beginTransaction())
    await transactionDB(db, id).run(sql`INSERT INTO synthetic VALUES (99)`)
    const session = db.sessions![id], reject = session.reject
    session.reject = async () => { entered(); await pause; return reject() }
    let firstSettled = false, secondSettled = false
    first = payload.destroy().finally(() => { firstSettled = true })
    await rollingBack
    const marker = db.sessions![id]
    assert.notEqual(marker, session)
    assert.equal(activeWriteTransactionCount(db), 1)
    second = payload.destroy().finally(() => { secondSettled = true })
    await setImmediate()
    assert.equal(firstSettled, false)
    assert.equal(secondSettled, false)
    assert.equal(originalClient.closed, false)
    assert.equal(activeWriteTransactionCount(db), 1)
    release()
    await Promise.all([first, second])
    assert.equal(originalClient.closed, true)
    assert.equal(activeWriteTransactionCount(db), 0)
    assert.equal(db.sessions![id], marker)
    await db.init!()
    await db.connect!({ hotReload: true })
    // The V3 instrumented failure was SQLITE_BUSY here without GC or retry.
    const next = String(await db.beginTransaction())
    await transactionDB(db, next).run(sql`INSERT INTO synthetic VALUES (1)`)
    await db.commitTransaction(next)
    assert.equal(activeWriteTransactionCount(db), 0)
    assert.deepEqual((await db.client.execute('SELECT id FROM synthetic ORDER BY id')).rows.map(row => row.id), [1])
    await assert.rejects(db.commitTransaction(id), /adapter was destroyed/)
  } finally {
    release()
    await Promise.allSettled([first, second])
    await payload.destroy()
    await finalizeStatements()
    rmSync(root, { recursive: true, force: true })
  }
})
