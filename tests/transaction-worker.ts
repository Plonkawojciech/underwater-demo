import { getPayload } from 'payload'
import config from '../src/payload.config'
import { checkout } from '../src/lib/commerce/order'
const parts: Buffer[] = []
for await (const part of process.stdin) parts.push(Buffer.from(part))
const input = JSON.parse(Buffer.concat(parts).toString('utf8'))
const payload = await getPayload({ config, disableOnInit: true })
try { console.log(JSON.stringify({ ok: true, ...await checkout(payload, input) })) }
catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.name : 'Error' })) }
finally { await payload.destroy() }
