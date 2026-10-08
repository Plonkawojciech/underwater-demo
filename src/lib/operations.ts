import type { Payload, TypedUser } from 'payload'
import { InputError, positiveID } from './commerce/input'
import { releaseOrder } from './commerce/order'
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
      if (!['shipped', 'cancelled'].includes(status)) throw new InputError('Płatności zmienia wyłącznie zweryfikowany komunikat operatora.')
      const order = await payload.findByID({ collection: 'orders', id, depth: 0, req, overrideAccess: false })
      beforeStatus = order.status
      if (status === 'shipped' && order.paymentStatus !== 'paid') throw new InputError('Można oznaczyć wysłanie tylko opłaconego zamówienia.', 409)
      if (status === 'cancelled' && order.paymentStatus === 'paid') throw new InputError('Opłacone zamówienie wymaga osobnej obsługi zwrotu.', 409)
      if (status === 'cancelled') {
        await releaseOrder(payload, req, order)
        await payload.update({ collection: 'orders', id, data: { status: 'cancelled', paymentStatus: order.paymentStatus === 'expired' ? 'expired' : 'cancelled', stockReleased: true }, req })
        await payload.update({ collection: 'payment-attempts', where: { order: { equals: id } }, data: { status: order.paymentStatus === 'expired' ? 'expired' : 'cancelled' }, req })
      } else await payload.update({ collection: 'orders', id, data: { status: 'shipped' }, req })
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
