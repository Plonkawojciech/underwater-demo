import type { Payload, PayloadRequest } from 'payload'
import { InputError, tokenHash } from '../commerce/input'
import { transaction } from '../commerce/transaction'

export async function expireSignups(payload: Payload, req: PayloadRequest, now = new Date()) {
  const expired = await payload.find({ collection: 'signups', where: { and: [{ status: { not_equals: 'enrolled' } }, { reservationReleased: { not_equals: true } }, { emailConfirmedAt: { exists: false } }, { reservationExpiresAt: { less_than_equal: now.toISOString() } }] }, limit: 200, depth: 0, req, overrideAccess: true })
  for (const signup of expired.docs) {
    if (signup.session) {
      const id = typeof signup.session === 'number' ? signup.session : signup.session.id
      const session = await payload.findByID({ collection: 'course-sessions', id, depth: 0, req, overrideAccess: true })
      await payload.update({ collection: 'course-sessions', id, data: { reserved: Math.max(0, Number(session.reserved || 0) - 1) }, req, overrideAccess: true })
    }
    await payload.update({ collection: 'signups', id: signup.id, data: { reservationReleased: true }, req, overrideAccess: true })
  }
  return expired.docs.length
}
export async function confirmSignup(payload: Payload, token: unknown) {
  const digest = tokenHash(token)
  return transaction(payload, 'form-service', async req => {
    await expireSignups(payload, req)
    const found = await payload.find({ collection: 'signups', where: { confirmationTokenHash: { equals: digest } }, limit: 1, depth: 0, req, overrideAccess: true })
    const signup = found.docs[0]
    if (!signup) throw new InputError('Nieprawidłowy link potwierdzenia.', 404)
    if (signup.reservationReleased || !signup.reservationExpiresAt || new Date(signup.reservationExpiresAt).getTime() <= Date.now() && !signup.emailConfirmedAt) throw new InputError('Link zgłoszenia wygasł. Wyślij zgłoszenie ponownie.', 410)
    if (!signup.emailConfirmedAt) await payload.update({ collection: 'signups', id: signup.id, data: { emailConfirmedAt: new Date().toISOString() }, req, overrideAccess: true })
    return { ok: true, message: 'E-mail zgłoszenia został potwierdzony. Obsługa uzgodni szczegóły kursu.' }
  })
}
