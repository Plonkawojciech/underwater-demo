import { createHmac } from 'node:crypto'
import { request } from 'node:http'
const origin = process.env.UNDERWATER_ORIGIN || process.env.NEXT_PUBLIC_SERVER_URL
const secret = process.env.PAYLOAD_SECRET
if (!origin || !secret || secret.length < 32) process.exit(1)
try {
  const port = Number(process.env.PORT || 3000)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) process.exit(1)
  // Fetch strips custom Host headers in this runtime. Raw HTTP preserves the
  // canonical preview host while connecting only to our container loopback.
  const response = await new Promise((resolve, reject) => {
    const pending = request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', signal: AbortSignal.timeout(8000), headers: { host: new URL(origin).host, 'x-underwater-health': createHmac('sha256', secret).update('underwater-health-only').digest('hex') } }, incoming => {
      const chunks = []; let size = 0
      incoming.on('data', chunk => { size += chunk.length; if (size > 65536) incoming.destroy(new Error('Oversized health response.')); else chunks.push(chunk) })
      incoming.on('error', reject)
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    pending.on('error', reject); pending.end()
  })
  const result = JSON.parse(response.body)
  if (response.status !== 200 || result.ok !== true || result.environment !== 'preview' || result.payments !== 'test' || result.mail !== 'captured') process.exit(1)
} catch { process.exit(1) }
