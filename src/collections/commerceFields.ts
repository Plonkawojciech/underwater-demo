import { APIError, type CollectionBeforeChangeHook, type Field } from 'payload'

export const serviceWrite: CollectionBeforeChangeHook = ({ data, req }) => {
  if (!['order-service', 'payment-service', 'reservation-service', 'form-service', 'newsletter-service', 'import-service', 'operations-service'].includes(String(req.context.systemAction || ''))) {
    throw new APIError('Ten zapis wymaga zweryfikowanego procesu aplikacji.', 403)
  }
  return data
}
export function internal(name: string, type: 'text' | 'number' | 'date' = 'text', unique = false): Field {
  const common = { name, unique, index: unique, admin: { readOnly: true, hidden: name.endsWith('Hash') || name === 'fingerprint' } }
  if (type === 'number') return { ...common, type: 'number' }
  if (type === 'date') return { ...common, type: 'date' }
  return { ...common, type: 'text' }
}
export const readOnlyAdmin = { read: ({ req }: { req: { user?: unknown } }) => !!req.user, create: () => false, update: () => false, delete: () => false }
