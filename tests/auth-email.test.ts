import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AuthenticationError, createLocalReq, getPayload, LockedAuth, type Payload, type PayloadRequest } from 'payload'
import { transaction } from '../src/lib/commerce/transaction'
import { sql } from '@payloadcms/db-sqlite'

const root = mkdtempSync(path.join(tmpdir(), 'underwater-auth-capture-'))
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-auth-capture-secret-not-for-deployment-20261008' })
let payload: Payload
test.before(async () => {
  payload = await getPayload({ config: (await import('../src/payload.config')).default, disableOnInit: true })
  await payload.db.migrate()
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

test('SDK password reset captures its link atomically, throttles retry and excludes operations staff', async () => {
  const admin = await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, overrideAccess: true, data: { email: 'auth-admin@example.invalid', password: 'synthetic-initial-admin-password-20261008', role: 'admin' } })
  const started = Date.now()
  const token = await payload.forgotPassword({ collection: 'users', data: { email: admin.email } })
  assert.ok(token)
  assert.ok(Date.now() - started < 4000, 'reset must not wait for another write connection')
  const captured = await payload.find({ collection: 'outbox', depth: 0 })
  assert.equal(captured.totalDocs, 1)
  assert.ok(captured.docs[0].body.includes(`/admin/reset/${token}`))
  assert.equal(captured.docs[0].recipient, admin.email)
  assert.equal(captured.docs[0].status, 'captured')
  const user = await payload.findByID({ collection: 'users', id: admin.id, showHiddenFields: true })
  assert.ok(user.resetPasswordRequestedAt)
  assert.equal(await payload.forgotPassword({ collection: 'users', data: { email: admin.email } }), null)
  const throttled = await payload.findByID({ collection: 'users', id: admin.id, showHiddenFields: true })
  assert.equal(throttled.resetPasswordToken, token)
  assert.equal(throttled.resetPasswordExpiration, user.resetPasswordExpiration)
  assert.equal(throttled.resetPasswordRequestedAt, user.resetPasswordRequestedAt)
  assert.equal((await payload.find({ collection: 'outbox' })).totalDocs, 1)
  const unknown = await payload.forgotPassword({ collection: 'users', data: { email: 'unknown@example.invalid' } })
  assert.equal(unknown, null)
  const operator = await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, overrideAccess: true, data: { email: 'auth-operations@example.invalid', password: 'synthetic-operations-password-20261008', role: 'operations' } })
  await assert.rejects(payload.find({ collection: 'outbox', overrideAccess: false, user: operator }), (error: any) => error.status === 403)
  await payload.resetPassword({ collection: 'users', overrideAccess: true, data: { token: token!, password: 'synthetic-new-admin-password-20261008' } })
  const logged = await payload.login({ collection: 'users', data: { email: admin.email, password: 'synthetic-new-admin-password-20261008' } })
  assert.equal(logged.user?.id, admin.id)
})

// Payload records a failed login through db.updateOne without req, so the
// attempt is visible to parallel requests. It must queue behind a held write
// transaction instead of busy-waiting the event loop into SQLITE_BUSY.
const wrongPassword = 'synthetic-wrong-password-20261008'
const rightPassword = 'synthetic-staff-password-20261008'
let staffCount = 0
async function staff() {
  const email = `auth-staff-${++staffCount}@example.invalid`
  const user = await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, overrideAccess: true, data: { email, password: rightPassword, role: 'editor' } })
  return { id: user.id, email }
}
async function stored(id: number) {
  const user = await payload.db.findOne<{ id: number, loginAttempts?: number | null, lockUntil?: string | null, sessions?: unknown[] }>({ collection: 'users', where: { id: { equals: id } } })
  return { loginAttempts: user?.loginAttempts ?? 0, lockUntil: user?.lockUntil ?? null, sessions: user?.sessions?.length ?? 0 }
}
const openSessions = () => Object.keys(payload.db.sessions || {}).length
const login = (email: string, password: string) => payload.login({ collection: 'users', data: { email, password } })

type Hold = (body: (req: PayloadRequest) => Promise<void>) => Promise<unknown>
const financialHold: Hold = body => transaction(payload, 'order-service', body)
const cmsHold: Hold = async body => {
  const id = String(await payload.db.beginTransaction())
  const req = await createLocalReq({}, payload)
  req.transactionID = id
  try { await body(req) } catch (error) { await payload.db.rollbackTransaction(id); throw error }
  await payload.db.commitTransaction(id)
}

// Runs `during` while `hold` keeps its write transaction open for holdMs and
// records the longest gap between 10 ms timer ticks.
async function whileHeld<T>(hold: Hold, label: string, during: () => Promise<T>, holdMs = 300) {
  let entered!: () => void, resume!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { resume = resolve })
  const slug = `test-auth-hold-${label}-${Date.now()}`
  const holder = hold(async req => {
    await payload.create({ collection: 'categories', req, overrideAccess: true, data: { name: `TEST ${label}`, slug, published: false } })
    entered(); await gate
  })
  await inside
  let last = Date.now(), maxGap = 0
  const ticker = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now }, 10)
  const started = Date.now()
  const work = during()
  setTimeout(resume, holdMs)
  const [held, result] = await Promise.allSettled([holder, work])
  clearInterval(ticker)
  assert.equal(held.status, 'fulfilled', String(held.status === 'rejected' && held.reason))
  assert.equal((await payload.count({ collection: 'categories', where: { slug: { equals: slug } } })).totalDocs, 1, 'the holder must commit')
  return { result, elapsed: Date.now() - started, maxGap }
}

for (const [kind, hold] of [['financial', financialHold], ['CMS', cmsHold]] as const) {
  test(`a failed login overlapping a held ${kind} transaction records the attempt after release without blocking the event loop`, async () => {
    const user = await staff()
    const { result, elapsed, maxGap } = await whileHeld(hold, `failed-${kind}`, () => login(user.email, wrongPassword))
    assert.equal(result.status, 'rejected')
    const reason = (result as PromiseRejectedResult).reason
    assert.ok(reason instanceof AuthenticationError, `expected AuthenticationError, got ${reason} (cause ${reason?.cause?.code}) after ${elapsed} ms, event loop stalled ${maxGap} ms`)
    assert.ok(maxGap < 1000, `the event loop stalled for ${maxGap} ms`)
    assert.ok(elapsed >= 250 && elapsed < 3000, `the attempt must complete after release, took ${elapsed} ms`)
    assert.deepEqual(await stored(user.id), { loginAttempts: 1, lockUntil: null, sessions: 0 })
    assert.equal(openSessions(), 0)
  })
}

test('five sequential wrong passwords lock the account; the right password is then refused', async () => {
  const user = await staff()
  for (let attempt = 1; attempt <= 5; attempt++) {
    await assert.rejects(login(user.email, wrongPassword), AuthenticationError)
    assert.equal((await stored(user.id)).loginAttempts, attempt)
  }
  const locked = await stored(user.id)
  assert.ok(locked.lockUntil && Date.parse(locked.lockUntil) > Date.now() + 14 * 60_000, 'lockTime is 15 minutes')
  await assert.rejects(login(user.email, rightPassword), LockedAuth)
  await assert.rejects(login(user.email, wrongPassword), LockedAuth)
  assert.equal((await stored(user.id)).loginAttempts, 5)
})

test('parallel wrong passwords queued behind a held transaction still reach the lockout', async () => {
  const user = await staff()
  const { result, maxGap } = await whileHeld(financialHold, 'parallel', () => Promise.allSettled(Array.from({ length: 6 }, () => login(user.email, wrongPassword))))
  assert.equal(result.status, 'fulfilled')
  const attempts = (result as PromiseFulfilledResult<PromiseSettledResult<unknown>[]>).value
  for (const attempt of attempts) {
    assert.equal(attempt.status, 'rejected')
    const reason = (attempt as PromiseRejectedResult).reason
    assert.ok(reason instanceof AuthenticationError || reason instanceof LockedAuth, String(reason))
  }
  assert.ok(maxGap < 1000, `the event loop stalled for ${maxGap} ms`)
  const locked = await stored(user.id)
  assert.equal(locked.loginAttempts, 6)
  assert.ok(locked.lockUntil && Date.parse(locked.lockUntil) > Date.now())
  await assert.rejects(login(user.email, rightPassword), LockedAuth)
  assert.equal(openSessions(), 0)
})

test('a successful login after failed attempts clears them and commits its session, also behind a held transaction', async () => {
  const user = await staff()
  await assert.rejects(login(user.email, wrongPassword), AuthenticationError)
  await assert.rejects(login(user.email, wrongPassword), AuthenticationError)
  assert.equal((await stored(user.id)).loginAttempts, 2)
  const { result, maxGap } = await whileHeld(cmsHold, 'success', () => login(user.email, rightPassword))
  assert.equal(result.status, 'fulfilled', String(result.status === 'rejected' && result.reason))
  assert.ok((result as PromiseFulfilledResult<Awaited<ReturnType<typeof login>>>).value.token)
  assert.ok(maxGap < 1000, `the event loop stalled for ${maxGap} ms`)
  assert.deepEqual(await stored(user.id), { loginAttempts: 0, lockUntil: null, sessions: 1 })
  assert.equal(openSessions(), 0)
})

test('account writes in a caller transaction stay in it; a lost caller transaction fails closed', async () => {
  const user = await staff()
  const started = Date.now()
  await assert.rejects(transaction(payload, 'order-service', async req => {
    await payload.db.updateOne({ collection: 'users', id: user.id, data: { loginAttempts: 3 }, req, returning: false })
    assert.equal((await payload.db.findOne<{ id: number, loginAttempts: number }>({ collection: 'users', req, where: { id: { equals: user.id } } }))?.loginAttempts, 3)
    throw new Error('Rolled back on purpose')
  }), /Rolled back on purpose/)
  assert.ok(Date.now() - started < 1000, 'a write in its own transaction must not wait for the lease')
  assert.equal((await stored(user.id)).loginAttempts, 0)
  const req = await createLocalReq({}, payload)
  req.transactionID = 'transaction-that-was-already-rolled-back'
  await assert.rejects(payload.db.updateOne({ collection: 'users', id: user.id, data: { loginAttempts: 4 }, req }), /no longer open/)
  assert.equal((await stored(user.id)).loginAttempts, 0)
})

test('a failed login inside a held transaction without its req fails at once instead of waiting for itself', async () => {
  const user = await staff()
  await assert.rejects(transaction(payload, 'order-service', async () => { await login(user.email, wrongPassword) }), /inside a held transaction/)
  // The guard error, rather than a lease timeout, proves no self-wait. Password
  // hashing and BEGIN runtime depend on other Mac jobs, so wall time is not an
  // assertion about this write guard.
  assert.equal(openSessions(), 0)
  await assert.rejects(login(user.email, wrongPassword), AuthenticationError)
  assert.equal((await stored(user.id)).loginAttempts, 1)
})

test('parallel reset requests capture one usable token and give no account-disclosing throttle error', async () => {
  const user = await staff()
  const before = (await payload.count({ collection: 'outbox' })).totalDocs
  const tokens = await Promise.all(Array.from({ length: 3 }, () => payload.forgotPassword({ collection: 'users', data: { email: user.email } })))
  const token = tokens.find(Boolean)
  assert.ok(token)
  assert.equal(tokens.filter(Boolean).length, 1)
  assert.equal((await payload.count({ collection: 'outbox' })).totalDocs, before + 1)
  const current = await payload.findByID({ collection: 'users', id: user.id, showHiddenFields: true })
  assert.equal(current.resetPasswordToken, token)
  await payload.resetPassword({ collection: 'users', overrideAccess: true, data: { token: token!, password: rightPassword } })
  assert.ok((await login(user.email, rightPassword)).token)
})

test('failed password-reset COMMIT rolls back both the reset token and its captured email', async () => {
  const user = await staff()
  const before = (await payload.count({ collection: 'outbox' })).totalDocs
  await payload.db.drizzle.run(sql`CREATE TABLE auth_commit_probe (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED)`)
  const drizzle = payload.db.drizzle
  const original = drizzle.transaction.bind(drizzle)
  drizzle.transaction = ((callback: any, options: any) => {
    drizzle.transaction = original
    return original(async (tx: any) => {
      await callback(tx)
      await tx.run(sql`INSERT INTO auth_commit_probe (user_id) VALUES (2147483646)`)
    }, options)
  }) as typeof drizzle.transaction
  try {
    await assert.rejects(payload.forgotPassword({ collection: 'users', data: { email: user.email } }), /FOREIGN KEY/)
    assert.equal((await payload.count({ collection: 'outbox' })).totalDocs, before)
    const current = await payload.findByID({ collection: 'users', id: user.id, showHiddenFields: true })
    assert.ok(!current.resetPasswordToken)
    assert.ok(!current.resetPasswordRequestedAt)
    assert.equal(openSessions(), 0)
  } finally {
    drizzle.transaction = original
    await payload.db.drizzle.run(sql`DROP TABLE auth_commit_probe`)
  }
  assert.ok(await payload.forgotPassword({ collection: 'users', data: { email: user.email } }))
})
