import { randomUUID } from 'node:crypto'
import type { EmailAdapter } from 'payload'
import { email } from './commerce/input'

// Payload's default transport logs email bodies. Replace it with a private,
// database-backed capture transport, including CMS password reset messages.
export const captureEmail: EmailAdapter = ({ payload }) => ({
  name: 'underwater-private-capture', defaultFromAddress: 'preview@programo.pl', defaultFromName: 'Underwater — podgląd',
  async sendEmail(message) {
    const rawRecipients = Array.isArray(message.to) ? message.to : [message.to]
    if (rawRecipients.length > 10) throw new Error('Capture recipient limit exceeded.')
    const messageId = randomUUID()
    for (const recipient of rawRecipients) {
      const address = email(typeof recipient === 'string' ? recipient : recipient?.address)
      const body = typeof message.text === 'string' ? message.text : typeof message.html === 'string' ? message.html : 'Captured message without a text body.'
      await payload.create({ collection: 'outbox', context: { systemAction: 'form-service' }, overrideAccess: true, data: { deduplicationKey: `cms-email:${messageId}:${address}`, recipient: address, subject: String(message.subject || 'Wiadomość testowa').slice(0, 200), body: body.slice(0, 100_000), status: 'captured' } })
    }
    return { messageId, captured: true }
  },
})
