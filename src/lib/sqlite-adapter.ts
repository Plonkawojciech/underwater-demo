import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { sqliteAdapter, type SQLiteAdapter, type SQLiteAdapterArgs } from '@payloadcms/db-sqlite'
import type { BaseDatabaseAdapter, DatabaseAdapterObj } from 'payload'

// libsql runs BEGIN IMMEDIATE and COMMIT synchronously on the Node thread. If
// one transaction holds the SQLite write lock across an await, a second BEGIN
// from the same process busy-waits on that thread, so the holder can never
// finish and the waiter fails with SQLITE_BUSY after busy_timeout. Every write
// transaction of this process (CMS operations, financial services, imports,
// migrations) therefore waits for one shared lease per database file before
// BEGIN. busy_timeout still arbitrates between separate processes.
//
// Payload's generic begin/commit observe the drizzle transaction through a
// catch that turns a failed COMMIT into success. These replacements await the
// real completion, so a failed COMMIT rejects the operation.

const LEASE_WAIT_MS = 15_000
const MAX_HOLD_MS = 5 * 60_000

export class WriteLeaseTimeout extends Error {
  code = 'UNDERWATER_WRITE_LEASE_TIMEOUT'
  constructor(waitedMs: number) {
    super(`Write transaction waited ${waitedMs} ms for the in-process write lease. A write without the caller req inside another transaction can cause this.`)
    this.name = 'WriteLeaseTimeout'
  }
}

class WriteLease {
  waitTimeoutMs = LEASE_WAIT_MS
  maxHoldMs = MAX_HOLD_MS
  #held = false
  #waiters: (() => void)[] = []
  acquire(): Promise<() => void> {
    if (!this.#held) { this.#held = true; return Promise.resolve(this.#releaser()) }
    return new Promise((resolve, reject) => {
      const waitedMs = this.waitTimeoutMs
      const grant = () => { clearTimeout(timer); resolve(this.#releaser()) }
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter(waiter => waiter !== grant)
        reject(new WriteLeaseTimeout(waitedMs))
      }, waitedMs)
      this.#waiters.push(grant)
    })
  }
  #releaser() {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.#waiters.shift()
      if (next) next(); else this.#held = false
    }
  }
}

// Shared through globalThis so reloaded modules and several Payload instances
// on the same file in one process use the same lease.
const registry = globalThis as typeof globalThis & {
  underwaterWriteLeases?: Map<string, WriteLease>
  underwaterWriteAdapters?: WeakMap<object, WriteLease>
  underwaterWriteCompletions?: WeakMap<object, Set<Promise<void>>>
  underwaterTransactionContext?: AsyncLocalStorage<{ open: boolean }>
}
function leaseFor(url: string) {
  const file = url.startsWith('file:') ? url.slice('file:'.length).split('?')[0] : ''
  if (!file || file.includes(':memory:')) return new WriteLease()
  const leases = registry.underwaterWriteLeases ||= new Map()
  const key = path.resolve(file)
  let lease = leases.get(key)
  if (!lease) leases.set(key, lease = new WriteLease())
  return lease
}

// Marks code that runs while its own transaction holds the lease. A new
// transaction started there could only wait for itself, so it fails at once.
// Next emits separate configuration, RSC, instrumentation and route modules,
// while Payload caches one adapter on globalThis. Both its registration and
// the callback context must therefore survive these module boundaries.
const holding = registry.underwaterTransactionContext ||= new AsyncLocalStorage<{ open: boolean }>()
export async function holdingTransaction<T>(run: () => Promise<T>): Promise<T> {
  const marker = { open: true }
  try { return await holding.run(marker, run) } finally { marker.open = false }
}

const leases = registry.underwaterWriteAdapters ||= new WeakMap<object, WriteLease>()
const writeCompletions = registry.underwaterWriteCompletions ||= new WeakMap<object, Set<Promise<void>>>()
export function writeLease(db: BaseDatabaseAdapter) {
  const lease = leases.get(db)
  if (!lease) throw new Error('The database adapter is not wrapped by leasedSqliteAdapter.')
  return lease
}
export function activeWriteTransactionCount(db: BaseDatabaseAdapter) {
  const pending = writeCompletions.get(db)
  if (!pending) throw new Error('The database adapter is not wrapped by leasedSqliteAdapter.')
  return pending.size
}

function withWriteLease(adapter: SQLiteAdapter) {
  const lease = leaseFor(adapter.clientConfig.url)
  leases.set(adapter, lease)
  const sessions = adapter.sessions!
  const pendingCompletions = new Set<Promise<void>>()
  writeCompletions.set(adapter, pendingCompletions)
  type Session = (typeof sessions)[string]
  type Transaction = Session['db']
  const closedSessions = new WeakSet<Session>()
  function closedSession(error: Error): Session {
    const session = {
      db: new Proxy({}, { get() { throw error } }) as Transaction,
      resolve: () => Promise.reject(error), reject: () => Promise.resolve(),
    }
    closedSessions.add(session)
    return session
  }
  const resolveID = async (incoming: number | string | Promise<number | string>) => String((await incoming) ?? '')
  // A shared lease can outlive this adapter's HMR cycle. Old waiters must
  // remain cancelled even if a new connection opens before they are granted.
  let destroying = false, lifecycle = 0
  const assertWritable = (generation: number) => {
    if (destroying || generation !== lifecycle) throw new Error('The SQLite adapter was destroyed before this write could start; wait for reconnect.')
  }
  const connect = adapter.connect!
  adapter.connect = async function (options) {
    await connect.call(this, options)
    destroying = false
  }

  adapter.beginTransaction = async options => {
    const generation = lifecycle
    assertWritable(generation)
    if (holding.getStore()?.open) throw new Error('A new write transaction was started inside a held transaction; pass the caller req (or its transaction was already rolled back).')
    await adapter.initializing
    assertWritable(generation)
    const release = await lease.acquire()
    try {
      assertWritable(generation)
      const id = randomUUID()
      const cancelled = new Error('UNDERWATER_TRANSACTION_CANCELLED')
      let finish!: () => void, abort!: () => void
      let opened!: (tx: Transaction) => void, failed!: (error: unknown) => void
      const ready = new Promise<Transaction>((resolve, reject) => { opened = resolve; failed = reject })
      // Register before calling drizzle: native BEGIN runs synchronously and
      // destruction may be reentrant before transaction() returns its promise.
      let finishCompletion!: () => void, failCompletion!: (error: unknown) => void
      const settled = new Promise<void>((resolve, reject) => { finishCompletion = resolve; failCompletion = reject })
      pendingCompletions.add(settled)
      settled.then(() => pendingCompletions.delete(settled), () => pendingCompletions.delete(settled))
      let completion: Promise<void>
      try {
        completion = adapter.drizzle.transaction(tx => new Promise<void>((resolve, reject) => {
          finish = resolve
          abort = () => reject(cancelled)
          opened(tx as unknown as Transaction)
        }), (options || adapter.transactionOptions) as never)
      } catch (error) { failCompletion(error); throw error }
      // The lease is released only after SQLite has finished COMMIT or ROLLBACK
      // (or BEGIN failed), whatever the outcome.
      completion.then(release, release)
      completion.catch(failed)
      // Keep tracking through session registration and owner finalization.
      // A removed session or another destroy's tombstone does not mean its
      // native COMMIT/ROLLBACK has finished, so close must still wait for it.
      completion.then(finishCompletion, error => { if (error === cancelled) finishCompletion(); else failCompletion(error) })
      const tx = await ready
      try { assertWritable(generation) } catch (error) {
        abort()
        await completion.catch(rollbackError => { if (rollbackError !== cancelled) throw rollbackError })
        throw error
      }
      // A session abandoned by its caller would otherwise block every writer.
      const heldMs = lease.maxHoldMs
      const watchdog = setTimeout(() => {
        const session = sessions[id]
        if (!session || closedSessions.has(session)) return
        adapter.payload.logger.error({ msg: `Rolling back a write transaction held for over ${heldMs} ms.` })
        // Payload falls back to autocommit for an unknown transaction ID, so the
        // owner keeps a closed session: its later queries and COMMIT fail.
        const closed = new Error(`The write transaction was rolled back after being held for over ${heldMs} ms.`)
        sessions[id] = closedSession(closed)
        void session.reject().catch(() => undefined)
      }, heldMs)
      watchdog.unref()
      completion.then(() => clearTimeout(watchdog), () => clearTimeout(watchdog))
      sessions[id] = {
        db: tx,
        resolve: () => { finish(); return completion },
        reject: async () => { abort(); await completion.catch(error => { if (error !== cancelled) throw error }) },
      }
      return id
    } catch (error) {
      release()
      throw error
    }
  }

  adapter.commitTransaction = async incoming => {
    const id = await resolveID(incoming)
    if (!id) return
    const session = sessions[id]
    if (!session) throw new Error('The transaction is no longer open at COMMIT; it was rolled back.')
    if (!closedSessions.has(session)) delete sessions[id]
    await session.resolve()
  }

  adapter.rollbackTransaction = async incoming => {
    const id = await resolveID(incoming)
    const session = sessions[id]
    if (!session) return
    if (!closedSessions.has(session)) delete sessions[id]
    await session.reject()
  }

  // Payload records a failed login (incrementLoginAttempts) through
  // db.updateOne without req, so the attempt is visible to parallel requests.
  // On the shared connection that autocommit UPDATE would busy-wait behind a
  // held transaction. Account writes outside a transaction therefore wait for
  // the lease and still run in autocommit, keeping the SDK's atomic $inc.
  // drizzle's updateOne never calls updateOne or begins a transaction itself.
  const updateOne = adapter.updateOne
  adapter.updateOne = async function (args) {
    const generation = lifecycle
    assertWritable(generation)
    if (!adapter.payload.collections[args.collection]?.config.auth) return updateOne.call(this, args)
    const id = args.req?.transactionID ? await resolveID(args.req.transactionID) : ''
    assertWritable(generation)
    if (id) {
      // Payload would silently fall back to autocommit for a closed session.
      if (!sessions[id]) throw new Error('The caller transaction of this account write is no longer open; it was rolled back.')
      return updateOne.call(this, args)
    }
    if (holding.getStore()?.open) throw new Error('An account write without req was started inside a held transaction; pass the caller req.')
    await adapter.initializing
    assertWritable(generation)
    const release = await lease.acquire()
    try { assertWritable(generation); return await updateOne.call(this, args) } finally { release() }
  }

  // Destroy is also Payload's HMR boundary: rollback first, then close and
  // detach the native client so connect() creates a fresh one after init().
  // The generic drizzle destroy only resets schema metadata. Finish cleanup
  // even when rollback fails, but never turn that failure into success.
  const destroy = adapter.destroy
  adapter.destroy = async function () {
    destroying = true
    lifecycle++
    // Missing sessions fall back to autocommit in upstream getTransaction.
    // Install markers before any rollback can wake an old request. Keep them
    // through later HMR and owner finalization: copies of its req may survive,
    // and the adapter cannot prove they have all discarded the old ID. These
    // markers retain no native transaction and live only with this adapter.
    const live = Object.entries(sessions).flatMap(([id, session]) => {
      if (closedSessions.has(session)) return []
      sessions[id] = closedSession(new Error('The write transaction was rolled back because its SQLite adapter was destroyed.'))
      return [session]
    })
    const results = await Promise.allSettled(live.map(session => Promise.resolve().then(() => session.reject())))
    const pending = await Promise.allSettled([...pendingCompletions])
    const errors = [...results, ...pending].flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    try {
      this.client?.close()
      if (!Reflect.deleteProperty(this, 'client')) throw new Error('The destroyed SQLite client could not be detached.')
    } catch (error) { errors.push(error) }
    try { await destroy?.call(this) } catch (error) { errors.push(error) }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'SQLite adapter destruction failed.')
  }
  return adapter
}

export function leasedSqliteAdapter(args: SQLiteAdapterArgs): DatabaseAdapterObj<SQLiteAdapter> {
  const base = sqliteAdapter(args)
  return { ...base, init: options => withWriteLease(base.init(options)) }
}
