import { runtimeOrigin } from '../origin'
import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import { email, hash, InputError, opaqueToken, positiveID, text, tokenHash } from '../commerce/input'
import { expireSignups } from './reservations'
import { transaction } from '../commerce/transaction'

export type FormInput = Record<string, unknown>
function common(input: FormInput) {
  if (input.website) throw new InputError('Zgłoszenie odrzucone.')
  if (input.privacyAccepted !== true) throw new InputError('Potwierdź zgodę na przetwarzanie danych zgłoszenia.')
  return { name: text(input.name, 'imię i nazwisko', 160), email: email(input.email), phone: text(input.phone ?? '', 'telefon', 40, false), message: text(input.message ?? '', 'wiadomość', 5000, false), privacyAccepted: true, consentVersion: 'preview-v1' }
}
export async function contact(payload: Payload, input: FormInput) {
  const data = common(input)
  if (!data.message) throw new InputError('Napisz wiadomość.')
  return transaction(payload, 'form-service', async req => {
    let context: { contextKind?: 'product' | 'trip'; contextID?: number; contextTitle?: string; contextPath?: string } = {}
    if (input.contextKind != null && input.contextKind !== '' || input.contextID != null && input.contextID !== '') {
      if (input.contextKind !== 'product' && input.contextKind !== 'trip') throw new InputError('Nieprawidłowy temat zapytania.')
      const value = typeof input.contextID === 'string' && /^[1-9]\d{0,9}$/.test(input.contextID) ? Number(input.contextID) : input.contextID
      const id = positiveID(value)
      const collection = input.contextKind === 'product' ? 'products' : 'trips'
      const record = (await payload.find({ collection, where: { and: [{ id: { equals: id } }, { published: { equals: true } }] }, limit: 1, depth: 0, req, overrideAccess: false })).docs[0]
      if (!record) throw new InputError('Przedmiot zapytania nie jest dostępny.', 409)
      context = input.contextKind === 'product'
        ? { contextKind: 'product', contextID: id, contextTitle: (record as { name: string }).name, contextPath: (record as { legacyPath?: string; slug: string }).legacyPath || '/' + (record as { slug: string }).slug + '.html' }
        : { contextKind: 'trip', contextID: id, contextTitle: (record as { title: string }).title, contextPath: (record as { path: string }).path }
    }
    const created = await payload.create({ collection: 'contacts', data: { ...data, ...context }, req, overrideAccess: true })
    await payload.create({ collection: 'outbox', data: { deduplicationKey: `contact:${created.id}`, recipient: data.email, subject: 'Testowe zgłoszenie kontaktowe', body: 'Zapisaliśmy wiadomość w podglądzie projektu. Ta wiadomość jest przechwycona w skrzynce testowej i nie została wysłana.' }, req, overrideAccess: true })
    return { ok: true, message: 'Zapisaliśmy zgłoszenie. W tym podglądzie wiadomości pozostają w skrzynce testowej.' }
  })
}
export async function signup(payload: Payload, input: FormInput) {
  const data = common(input)
  if (!data.phone) throw new InputError('Podaj telefon kontaktowy.')
  const course = positiveID(input.course)
  const sessionID = input.session == null || input.session === '' ? undefined : positiveID(input.session)
  return transaction(payload, 'form-service', async req => {
    await expireSignups(payload, req)
    const deduplicationKey = hash(JSON.stringify([course, sessionID || 0, data.email]))
    const previous = (await payload.find({ collection: 'signups', where: { deduplicationKey: { equals: deduplicationKey } }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0]
    const response = { ok: true, message: 'Zapisaliśmy zgłoszenie. Potwierdzenie e-mail jest wymagane; w podglądzie link znajduje się w skrzynce testowej administratora.' }
    if (previous && !previous.reservationReleased) return response
    const found = await payload.find({ collection: 'courses', where: { and: [{ id: { equals: course } }, { published: { equals: true } }] }, limit: 1, depth: 0, req, overrideAccess: false })
    if (!found.docs[0]) throw new InputError('Kurs nie jest dostępny.', 409)
    if (sessionID) {
      const sessions = await payload.find({ collection: 'course-sessions', where: { and: [{ id: { equals: sessionID } }, { published: { equals: true } }, { startsAt: { greater_than: new Date().toISOString() } }] }, limit: 1, depth: 0, req, overrideAccess: false })
      const session = sessions.docs[0]
      const related = session && (typeof session.course === 'number' ? session.course : session.course.id)
      if (!session || related !== course) throw new InputError('Termin nie jest dostępny dla tego kursu.', 409)
      const reserved = session.reserved || 0
      if (!Number.isSafeInteger(reserved) || (session.capacity != null && reserved >= session.capacity)) throw new InputError('Brak wolnych miejsc w wybranym terminie.', 409)
      await payload.update({ collection: 'course-sessions', id: session.id, data: { reserved: reserved + 1 }, req, overrideAccess: true })
    }
    const token = opaqueToken()
    const signupData = { ...data, course, session: sessionID, status: 'new' as const, deduplicationKey, confirmationTokenHash: hash(token), emailConfirmedAt: null, reservationReleased: false, reservationExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    const record = previous ? await payload.update({ collection: 'signups', id: previous.id, data: signupData, req, overrideAccess: true }) : await payload.create({ collection: 'signups', data: signupData, req, overrideAccess: true })
    await payload.create({ collection: 'outbox', data: { deduplicationKey: `signup:${record.id}:${hash(token)}`, recipient: data.email, subject: 'Testowe zgłoszenie na kurs', body: `Zgłoszenie na ${found.docs[0].name} zapisane. Potwierdź adres w ciągu 30 minut: ${runtimeOrigin()}/zgloszenie/potwierdz?token=${token}\nTryb testowy — bez wysłania wiadomości.` }, req, overrideAccess: true })
    return response
  })
}
export async function subscribe(payload: Payload, input: FormInput) {
  if (input.website) throw new InputError('Zgłoszenie odrzucone.')
  if (input.consent !== true && input.privacyAccepted !== true) throw new InputError('Potwierdź zgodę na newsletter.')
  const address = email(input.email)
  return transaction(payload, 'newsletter-service', async req => {
    const existing = await payload.find({ collection: 'newsletter', where: { email: { equals: address } }, limit: 1, depth: 0, req, overrideAccess: true })
    // Every response is identical; subscription existence must not be disclosed.
    const result = { ok: true, message: 'Zapis wymaga potwierdzenia. W podglądzie link znajduje się wyłącznie w skrzynce testowej administratora.' }
    const previous = existing.docs[0]
    if (previous?.status === 'active') return result
    if (previous?.status === 'pending' && previous.confirmationExpiresAt && new Date(previous.confirmationExpiresAt).getTime() > Date.now()) return result
    const confirmation = opaqueToken(), unsubscribe = opaqueToken()
    const data = { email: address, status: 'pending' as const, confirmationTokenHash: hash(confirmation), unsubscribeTokenHash: hash(unsubscribe), confirmationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), confirmedAt: null, unsubscribedAt: null, consentVersion: 'preview-v1' }
    const subscriber = previous ? await payload.update({ collection: 'newsletter', id: previous.id, data, req, overrideAccess: true }) : await payload.create({ collection: 'newsletter', data, req, overrideAccess: true })
    const origin = runtimeOrigin()
    await payload.create({ collection: 'outbox', data: { deduplicationKey: `newsletter:${subscriber.id}:${randomUUID()}`, recipient: address, subject: 'Potwierdzenie zapisu — tryb testowy', body: `Potwierdź zapis: ${origin}/newsletter/potwierdz?token=${confirmation}\nWypisz się: ${origin}/newsletter/wypisz?token=${unsubscribe}\nWiadomość jest przechwycona; nic nie wysłano do odbiorcy.` }, req, overrideAccess: true })
    return result
  })
}
export async function newsletterToken(payload: Payload, token: unknown, operation: 'confirm' | 'unsubscribe') {
  const digest = tokenHash(token)
  return transaction(payload, 'newsletter-service', async req => {
    const field = operation === 'confirm' ? 'confirmationTokenHash' : 'unsubscribeTokenHash'
    const found = await payload.find({ collection: 'newsletter', where: { [field]: { equals: digest } }, limit: 1, depth: 0, req, overrideAccess: true })
    const subscriber = found.docs[0]
    if (!subscriber) throw new InputError('Nieprawidłowy lub wygasły link.', 404)
    if (operation === 'confirm') {
      if (subscriber.status === 'unsubscribed') throw new InputError('Zapis został wcześniej anulowany.', 409)
      if (subscriber.status === 'active') return { ok: true, message: 'Zapis jest już potwierdzony.' }
      if (!subscriber.confirmationExpiresAt || new Date(subscriber.confirmationExpiresAt).getTime() <= Date.now()) throw new InputError('Link potwierdzenia wygasł.', 410)
      await payload.update({ collection: 'newsletter', id: subscriber.id, data: { status: 'active', confirmedAt: new Date().toISOString() }, req, overrideAccess: true })
      return { ok: true, message: 'Zapis na newsletter został potwierdzony.' }
    }
    if (subscriber.status !== 'unsubscribed') await payload.update({ collection: 'newsletter', id: subscriber.id, data: { status: 'unsubscribed', unsubscribedAt: new Date().toISOString() }, req, overrideAccess: true })
    return { ok: true, message: 'Zapis na newsletter został anulowany.' }
  })
}
