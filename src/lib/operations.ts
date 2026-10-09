import type { Payload, TypedUser } from 'payload'
import type { Order } from '@/payload-types'
import { hash, InputError, positiveID } from './commerce/input'
import { expireReservations, formatCents, MANUAL_TEST_PROVIDER, orderPaymentMethod, releaseOrder } from './commerce/order'
import { transaction } from './commerce/transaction'

export async function adjustInventory(payload: Payload, user: TypedUser, input: { id?: unknown; variantId?: unknown; stock?: unknown; expectedStock?: unknown }) {
  if (!['admin', 'operations'].includes(String(user.role))) throw new InputError('Brak uprawnień obsługi magazynu.', 403)
  const id = positiveID(input.id), stock = input.stock
  if (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000) throw new InputError('Podaj nieujemny, całkowity stan magazynu.')
  return transaction(payload, 'operations-service', async req => {
    req.user = user
    const product = await payload.findByID({ collection: 'products', id, req, depth: 0, overrideAccess: false })
    const variants = (product.variants || []).map(item => ({ ...item }))
    const variant = variants.length ? variants.find(item => item.id === input.variantId) : undefined
    if (variants.length && !variant || !variants.length && input.variantId) throw new InputError('Wybierz aktualny wariant produktu.', 409)
    const before = (variant ? variant.stock : product.stock) ?? null
    if (input.expectedStock !== before) throw new InputError('Stan zmienił się od otwarcia formularza. Odśwież i sprawdź korektę ponownie.', 409)
    if (variant) { variant.stock = stock; await payload.update({ collection: 'products', id, data: { variants }, req, overrideAccess: true }) }
    else await payload.update({ collection: 'products', id, data: { stock }, req, overrideAccess: true })
    await payload.create({ collection: 'audit-events', data: { actor: user.id, targetCollection: 'products', targetId: id, command: 'inventory-adjustment', beforeStatus: JSON.stringify({ stock: before, variantId: variant?.id }), afterStatus: JSON.stringify({ stock, variantId: variant?.id }) }, req })
    return { ok: true, message: 'Stan magazynu zapisany z wpisem w audycie.' }
  })
}

export async function updateOperationalStatus(payload: Payload, user: TypedUser, input: { collection?: unknown; id?: unknown; status?: unknown }) {
  if (!['admin', 'operations'].includes(String(user.role))) throw new InputError('Brak uprawnień obsługi.', 403)
  const id = positiveID(input.id)
  const collection = input.collection, status = String(input.status || '')
  if (!['orders', 'signups', 'contacts'].includes(String(collection))) throw new InputError('Niedozwolony typ zgłoszenia.')
  return transaction(payload, 'operations-service', async req => {
    req.user = user
    let beforeStatus: string | null | undefined
    if (collection === 'orders') {
      if (!ORDER_COMMANDS.includes(status)) throw new InputError('Płatności zmienia wyłącznie zweryfikowany komunikat operatora.')
      // Close lapsed reservations first, so no command acts on stock that is no longer held.
      await expireReservations(payload, req)
      const order = await payload.findByID({ collection: 'orders', id, depth: 0, req, overrideAccess: false })
      beforeStatus = order.status
      if (status === 'bank-paid' || status === 'cod-collected') return confirmOfflinePayment(payload, req, user, order, status)
      if (status === 'shipped') {
        if (order.status === 'shipped') throw new InputError('Zamówienie jest już oznaczone jako wysłane.', 409)
        const cod = orderPaymentMethod(order) === 'cod'
        if (cod ? order.paymentStatus !== 'pending' || order.status !== 'new' || order.stockReleased : order.paymentStatus !== 'paid') throw new InputError(cod ? 'Testowo nadać można tylko oczekujące, niezamknięte zamówienie za pobraniem.' : 'Można oznaczyć wysłanie tylko opłaconego zamówienia.', 409)
        // A shipped cash-on-delivery parcel keeps its stock and waits for collection without expiry.
        await payload.update({ collection: 'orders', id, data: { status: 'shipped', shippedAt: new Date().toISOString(), ...(cod ? { expiresAt: null } : {}) }, req })
      } else {
        if (order.status === 'shipped') throw new InputError('Wysłanego zamówienia nie można anulować; zwrot wymaga osobnej obsługi.', 409)
        if (order.paymentStatus === 'paid') throw new InputError('Opłacone zamówienie wymaga osobnej obsługi zwrotu.', 409)
        if (order.paymentStatus !== 'pending') return { ok: true, message: 'Zamówienie jest już zamknięte.', status: order.status, duplicate: true }
        await releaseOrder(payload, req, order)
        await payload.update({ collection: 'orders', id, data: { status: 'cancelled', paymentStatus: 'cancelled', stockReleased: true }, req })
        await payload.update({ collection: 'payment-attempts', where: { order: { equals: id } }, data: { status: 'cancelled' }, req })
      }
    } else if (collection === 'signups') {
      if (!['contacted', 'enrolled', 'rejected'].includes(status)) throw new InputError('Nieprawidłowy status zgłoszenia.')
      const signup = await payload.findByID({ collection: 'signups', id, depth: 0, req, overrideAccess: false })
      beforeStatus = signup.status
      if (status === 'enrolled' && signup.reservationReleased && signup.session) {
        const sessionId = typeof signup.session === 'number' ? signup.session : signup.session.id
        const session = await payload.findByID({ collection: 'course-sessions', id: sessionId, req, depth: 0, overrideAccess: true })
        if (new Date(session.startsAt).getTime() <= Date.now() || session.capacity != null && Number(session.reserved || 0) >= session.capacity) throw new InputError('Termin nie ma już wolnych miejsc.', 409)
        await payload.update({ collection: 'course-sessions', id: sessionId, data: { reserved: Number(session.reserved || 0) + 1 }, req })
      }
      if (status === 'rejected' && !signup.reservationReleased && signup.session) {
        const sessionId = typeof signup.session === 'number' ? signup.session : signup.session.id
        const session = await payload.findByID({ collection: 'course-sessions', id: sessionId, req, depth: 0, overrideAccess: true })
        await payload.update({ collection: 'course-sessions', id: sessionId, data: { reserved: Math.max(0, Number(session.reserved || 0) - 1) }, req })
      }
      await payload.update({ collection: 'signups', id, data: { status: status as 'contacted' | 'enrolled' | 'rejected', reservationReleased: status === 'rejected' ? true : status === 'enrolled' ? false : signup.reservationReleased }, req })
    } else {
      if (!['contacted', 'closed'].includes(status)) throw new InputError('Nieprawidłowy status wiadomości.')
      const contact = await payload.findByID({ collection: 'contacts', id, depth: 0, req, overrideAccess: false }); beforeStatus = contact.status
      await payload.update({ collection: 'contacts', id, data: { status: status as 'contacted' | 'closed' }, req })
    }
    await payload.create({ collection: 'audit-events', data: { actor: user.id, targetCollection: String(collection), targetId: id, command: 'update-status', beforeStatus, afterStatus: status }, req })
    return { ok: true, message: 'Status zapisany.', status }
  })
}

const ORDER_COMMANDS = ['shipped', 'cancelled', 'bank-paid', 'cod-collected']

/**
 * Simulated confirmation of an offline test payment by a signed-in operator.
 * No bank or courier is contacted; the audit trail records who confirmed what.
 */
async function confirmOfflinePayment(payload: Payload, req: Parameters<typeof releaseOrder>[1], user: TypedUser, order: Order, command: 'bank-paid' | 'cod-collected') {
  const method = orderPaymentMethod(order)
  if (command === 'bank-paid' && (method !== 'bank_transfer' || order.paymentStatus !== 'pending' || order.status !== 'new' || order.stockReleased)) throw new InputError('Wpływ przelewu można potwierdzić tylko dla oczekującego zamówienia z przelewem.', 409)
  if (command === 'cod-collected' && (method !== 'cod' || order.paymentStatus !== 'pending' || order.status !== 'shipped')) throw new InputError('Pobranie można potwierdzić tylko po testowym nadaniu zamówienia za pobraniem.', 409)
  const now = new Date().toISOString()
  const attempt = (await payload.find({ collection: 'payment-attempts', where: { and: [{ order: { equals: order.id } }, { provider: { equals: MANUAL_TEST_PROVIDER } }] }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0]
  if (!attempt || attempt.status !== 'pending' || attempt.amountCents !== order.totalCents) throw new InputError('Brak zgodnej oczekującej płatności testowej.', 409)
  await payload.update({ collection: 'orders', id: order.id, data: { paymentStatus: 'paid', paidAt: now, ...(command === 'bank-paid' ? { status: 'paid' } : { codCollectedAt: now }) }, req })
  await payload.update({ collection: 'payment-attempts', id: attempt.id, data: { status: 'paid' }, req, overrideAccess: true })
  const eventKey = `${MANUAL_TEST_PROVIDER}:${attempt.id}:paid`
  await payload.create({ collection: 'payment-events', req, overrideAccess: true, data: { eventKey, attempt: attempt.id, digest: hash(JSON.stringify({ eventKey, order: order.id, amountCents: order.totalCents, actor: user.id, at: now })), outcome: 'paid', accepted: true, reason: `operator:${user.id}:${command}` } })
  const afterStatus = JSON.stringify({ status: command === 'bank-paid' ? 'paid' : order.status, paymentStatus: 'paid' })
  await payload.create({ collection: 'audit-events', data: { actor: user.id, targetCollection: 'orders', targetId: order.id, command: `confirm-${command}`, beforeStatus: JSON.stringify({ status: order.status, paymentStatus: order.paymentStatus }), afterStatus }, req })
  await payload.create({ collection: 'outbox', req, overrideAccess: true, data: { deduplicationKey: `${command}:${order.id}`, recipient: order.email, subject: `Status płatności testowej ${order.number}`, body: `Tryb testowy. Obsługa potwierdziła ${command === 'bank-paid' ? 'symulowany wpływ przelewu' : 'symulowane pobranie przy odbiorze'}: ${formatCents(order.totalCents ?? 0)}. Nie pobrano pieniędzy i nie nadano przesyłki.` } })
  return { ok: true, message: command === 'bank-paid' ? 'Przelew testowy potwierdzony z wpisem w audycie.' : 'Pobranie testowe potwierdzone z wpisem w audycie.', status: command }
}
