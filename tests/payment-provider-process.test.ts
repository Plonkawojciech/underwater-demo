import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import type { Payload } from 'payload'
import type { PaymentStart } from '../src/lib/commerce/provider'
import type { PaymentWorkerMessage } from './fixtures/payment-provider-child'

type Kind = PaymentWorkerMessage['kind']
type Message<K extends Kind> = Extract<PaymentWorkerMessage, { kind: K }>
type Operator = (request: Message<'adapter-started'>, respond: (payment: PaymentStart) => void) => void

function paymentWorker(file: string, env: NodeJS.ProcessEnv, operator: Operator) {
  const bootstrap = fileURLToPath(new URL('./transaction-worker-bootstrap.mjs', import.meta.url))
  const child = spawn(process.execPath, [bootstrap, file], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const messages: PaymentWorkerMessage[] = []
  const waiters = new Map<Kind, { resolve: (message: PaymentWorkerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let closed = false, terminalError: Error | undefined, stderr = '', stdout = '', result: Message<'result'> | undefined
  const rejectWaiters = (error: Error) => {
    for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    waiters.clear()
  }
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000) })
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2000) })
  const send = (message: unknown) => {
    if (closed || !child.connected) throw terminalError || new Error('The synthetic payment worker is closed.')
    child.send(message as object, error => {
      if (error) { terminalError = error; rejectWaiters(error) }
    })
  }
  child.on('message', incoming => {
    const message = incoming as PaymentWorkerMessage
    messages.push(message)
    if (message.kind === 'result') result = message
    if (message.kind === 'failure') { terminalError = new Error(message.message); rejectWaiters(terminalError) }
    const waiter = waiters.get(message.kind)
    if (waiter) { clearTimeout(waiter.timer); waiters.delete(message.kind); waiter.resolve(message) }
    if (message.kind === 'adapter-started') {
      try { operator(message, payment => send({ kind: 'intent-response', ...payment })) }
      catch (error) {
        terminalError = error instanceof Error ? error : new Error('Synthetic parent operator failed.')
        rejectWaiters(terminalError)
        child.kill('SIGTERM')
      }
    }
  })
  const completion = new Promise<Message<'result'>>((resolve, reject) => {
    child.once('error', error => { terminalError = error; rejectWaiters(error); reject(error) })
    child.once('close', code => {
      closed = true
      terminalError ||= new Error(`Synthetic payment worker closed (${code}): ${stderr.slice(-400)} ${stdout.slice(-300)}`)
      rejectWaiters(terminalError)
      if (code !== 0 || !result) reject(terminalError); else resolve(result)
    })
  })
  // Failure cleanup may precede an awaited completion; do not leave rejections unhandled.
  void completion.catch(() => undefined)
  const wait = <K extends Kind>(kind: K): Promise<Message<K>> => {
    const seen = messages.find(message => message.kind === kind)
    if (seen) return Promise.resolve(seen as Message<K>)
    if (terminalError || closed) return Promise.reject(terminalError || new Error('Synthetic worker closed before its barrier.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(kind); reject(new Error(`Synthetic payment worker never reached ${kind}: ${stderr.slice(-400)} ${stdout.slice(-300)}`)) }, kind === 'ready' ? 35_000 : 20_000)
      waiters.set(kind, { timer, resolve: message => resolve(message as Message<K>), reject })
    })
  }
  const stop = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!closed) { child.kill('SIGTERM'); timer = setTimeout(() => { if (!closed) child.kill('SIGKILL') }, 1000) }
      await completion.catch(() => undefined)
    } finally { clearTimeout(timer) }
  }
  return { send, wait, completion, messages, stop }
}

test('two application processes share one committed initialization lease and start one operator intent', { timeout: 90_000 }, async context => {
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const data = mkdtempSync(path.join(tmpdir(), 'underwater-payment-process-'))
  mkdirSync(path.join(data, 'media'))
  mkdirSync(path.join(repo, 'tmp'), { recursive: true })
  const helper = mkdtempSync(path.join(repo, 'tmp/underwater-payment-process-'))
  const env = {
    NODE_ENV: 'test' as const, UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: data,
    DATABASE_URI: `file:${data}/underwater-test.db`, MEDIA_DIR: path.join(data, 'media'),
    NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', UNDERWATER_PAYMENT_PROVIDER: 'internal-test',
    PAYLOAD_SECRET: 'synthetic-multiprocess-payment-secret-not-runtime',
  }
  Object.assign(process.env, env)
  delete process.env.UNDERWATER_ORIGIN
  let payload: Payload | undefined
  const workers: ReturnType<typeof paymentWorker>[] = []
  const abort = () => { for (const worker of workers) void worker.stop() }
  context.signal.addEventListener('abort', abort, { once: true })
  try {
    const file = path.join(helper, 'payment-child.mjs')
    buildSync({
      entryPoints: [path.join(repo, 'tests/fixtures/payment-provider-child.ts')], outfile: file,
      bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
      define: { 'import.meta.url': JSON.stringify(new URL('../src/payload.config.ts', import.meta.url).href) },
    })
    const { getPayload } = await import('payload')
    const storedConfig = await (await import('../src/payload.config')).default
    const config = {
      ...storedConfig,
      typescript: { ...storedConfig.typescript, autoGenerate: false },
      admin: { ...storedConfig.admin, importMap: { ...storedConfig.admin.importMap, autoGenerate: false } },
    }
    payload = await getPayload({ config, disableOnInit: true })
    await payload.db.migrate()
    const category = await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST process', slug: 'test-process', published: true } })
    const product = await payload.create({ collection: 'products', overrideAccess: true, data: { vmId: 81000001, name: 'TEST process — not for sale', slug: 'test-process-item', category: category.id, price: 10, priceCents: 1000, stock: 1, published: true } })
    const input = { idempotencyKey: randomUUID(), customerName: 'TEST two processes', email: 'process@example.invalid', address: 'Synthetic address', items: [{ id: product.id, qty: 1 }], deliveryMethod: 'test-pickup', privacyAccepted: true, termsAccepted: true }
    // The fake operator exists only in this parent: its one intent is created
    // when A starts, and its response remains paused until B reads A's lease.
    const intents = new Map<string, PaymentStart>()
    let releaseHolder: (() => void) | undefined
    const operator = (hold: boolean): Operator => (request, respond) => {
      let payment = intents.get(request.input.idempotencyKey)
      if (!payment) {
        const reference = 'process-' + createHash('sha256').update(request.input.idempotencyKey).digest('hex').slice(0, 24)
        payment = { reference, paymentURL: `https://process-sandbox.example.invalid/pay/${reference}` }
        intents.set(request.input.idempotencyKey, payment)
      }
      if (hold) releaseHolder = () => respond(payment!); else respond(payment)
    }
    const holder = paymentWorker(file, env, operator(true)); workers.push(holder)
    const contender = paymentWorker(file, env, operator(false)); workers.push(contender)
    const [aReady, bReady] = await Promise.all([holder.wait('ready'), contender.wait('ready')])
    assert.notEqual(aReady.pid, bReady.pid, 'the two callers must be separate OS processes')
    assert.notEqual(aReady.pid, process.pid); assert.notEqual(bReady.pid, process.pid)
    holder.send({ kind: 'start', role: 'holder', input })
    const started = await holder.wait('adapter-started')
    assert.equal(started.openSessions, 0, 'the holder must pause outside every SQLite transaction')
    assert.equal(started.attempt.initialization, 'initializing')
    assert.equal(started.attempt.initializationKey, started.input.idempotencyKey)
    assert.ok(started.attempt.lease && started.attempt.leaseUntil && Date.parse(started.attempt.leaseUntil) > Date.now())
    const committed = (await payload.find({ collection: 'payment-attempts', where: { id: { equals: started.attempt.id } }, depth: 0, overrideAccess: true })).docs[0]
    assert.equal(committed.initializationLease, started.attempt.lease, 'the parent connection must see the committed holder claim')
    assert.equal((await payload.findByID({ collection: 'products', id: product.id, depth: 0 })).stock, 0)
    contender.send({ kind: 'start', role: 'contender', input })
    const foreign = await contender.wait('foreign-lease')
    assert.equal(foreign.transactionalRead, true)
    assert.equal(foreign.attempt.id, started.attempt.id)
    assert.equal(foreign.attempt.order, started.attempt.order)
    assert.equal(foreign.attempt.lease, started.attempt.lease)
    assert.equal(foreign.attempt.leaseUntil, started.attempt.leaseUntil)
    assert.equal(foreign.attempt.initializationKey, started.input.idempotencyKey)
    assert.equal(holder.messages.filter(message => message.kind === 'adapter-started').length, 1)
    assert.equal(contender.messages.filter(message => message.kind === 'adapter-started').length, 0, 'B must observe the active foreign lease without calling the operator')
    assert.ok(releaseHolder, 'the parent must control the outstanding operator response')
    releaseHolder()
    const [a, b] = await Promise.all([holder.completion, contender.completion])
    assert.deepEqual(b.result, a.result)
    assert.equal(a.result.payment, 'ready')
    assert.match(a.result.paymentURL, /^\/platnosc-testowa\?token=[A-Za-z0-9_-]+$/)
    assert.deepEqual(b.summary, a.summary)
    assert.deepEqual(b.attempt, a.attempt)
    assert.equal(a.attempt.initialization, 'ready')
    assert.equal(a.attempt.lease, null); assert.equal(a.attempt.leaseUntil, null)
    const remote = intents.get(started.input.idempotencyKey)!
    assert.equal(a.attempt.providerReference, remote.reference)
    assert.equal(a.summary.paymentLink, remote.paymentURL)
    assert.equal(a.summary.simulation, false)
    assert.equal(intents.size, 1)
    assert.equal(workers.flatMap(worker => worker.messages).filter(message => message.kind === 'adapter-started').length, 1, 'exactly one cross-process start')
    assert.equal((await payload.count({ collection: 'orders', where: { idempotencyKey: { equals: input.idempotencyKey } }, overrideAccess: true })).totalDocs, 1)
    assert.equal((await payload.count({ collection: 'payment-attempts', where: { order: { equals: started.attempt.order } }, overrideAccess: true })).totalDocs, 1)
    assert.equal((await payload.findByID({ collection: 'products', id: product.id, depth: 0 })).stock, 0, 'the last stock unit was reserved exactly once')
    assert.equal((await payload.count({ collection: 'outbox', where: { deduplicationKey: { equals: `order:${started.attempt.order}` } }, overrideAccess: true })).totalDocs, 1)
  } finally {
    context.signal.removeEventListener('abort', abort)
    try {
      await Promise.all(workers.map(worker => worker.stop()))
      if (payload) await payload.destroy()
    } finally {
      try { rmSync(helper, { recursive: true, force: true }) }
      finally { rmSync(data, { recursive: true, force: true }) }
    }
  }
})
