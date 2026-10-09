// This fixture is compiled ahead of time and runs in plain native Node, with
// no concurrent tsx loader graphs. IPC owns the ready/start/release barrier.
export {}
const { getPayload } = await import('payload')
const config = (await import('../src/payload.config')).default
const { checkout } = await import('../src/lib/commerce/order')
const { InputError } = await import('../src/lib/commerce/input')
const payload = await getPayload({ config, disableOnInit: true })
type Start = { kind: 'start'; hold: boolean; input: Parameters<typeof checkout>[1] }
const messages: unknown[] = []
let receive: ((value: any) => void) | undefined
process.on('message', message => { if (receive) { const run = receive; receive = undefined; run(message) } else messages.push(message) })
const nextMessage = () => messages.length ? Promise.resolve(messages.shift() as any) : new Promise<any>(resolve => { receive = resolve })
process.send?.({ kind: 'ready' })
try {
  const start = await nextMessage() as Start
  if (start.kind !== 'start') throw new Error('Invalid synthetic worker command.')
  const begin = payload.db.beginTransaction.bind(payload.db)
  let firstBegin = true, beginWaitMs = 0
  payload.db.beginTransaction = async options => {
    if (!firstBegin) return begin(options)
    firstBegin = false
    if (start.hold) {
      const id = await begin(options)
      process.send?.({ kind: 'locked' })
      if ((await nextMessage())?.kind !== 'release') throw new Error('Invalid synthetic release command.')
      return id
    }
    process.send?.({ kind: 'contending' })
    const started = performance.now()
    const id = await begin(options)
    beginWaitMs = performance.now() - started
    return id
  }
  try { await checkout(payload, start.input); console.log(JSON.stringify({ ok: true })) }
  catch (error) {
    if (!(error instanceof InputError)) throw error
    console.log(JSON.stringify({ ok: false, error: error.name, status: error.status, beginWaitMs }))
  }
} finally {
  await payload.destroy()
  if (process.connected) process.disconnect()
}
