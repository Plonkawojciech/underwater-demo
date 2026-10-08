import { APIError, type CollectionConfig } from 'payload'
import { adminOnly, adminField, staffRole } from '../lib/access'
import { capturePasswordReset, preparePasswordResetCapture } from '../lib/auth-capture'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Użytkownik', plural: 'Użytkownicy' },
  admin: { useAsTitle: 'email', group: 'System' },
  auth: { maxLoginAttempts: 5, lockTime: 15 * 60 * 1000 },
  access: {
    admin: ({ req }) => !!staffRole(req),
    create: adminOnly,
    update: ({ req }) => staffRole(req) === 'admin' ? true : req.user ? { id: { equals: req.user.id } } : false,
    read: ({ req }) => staffRole(req) === 'admin' ? true : req.user ? { id: { equals: req.user.id } } : false,
    delete: adminOnly,
  },
  hooks: {
    beforeOperation: [async ({ operation, args, req }) => {
      if (operation === 'forgotPassword') {
        req.context.underwaterCMSResetCapture = !(args as { disableEmail?: boolean }).disableEmail
        if (req.context.underwaterCMSResetCapture) await preparePasswordResetCapture(req, (args as { data: { email?: unknown } }).data)
        return { ...args, disableEmail: true }
      }
      return args
    }],
    afterOperation: [async ({ operation, result, req }) => {
      if (operation === 'forgotPassword' && req.context.underwaterCMSResetCapture && typeof result === 'string') {
        if (!await capturePasswordReset(req, result)) return null
      }
      return result
    }],
    beforeChange: [({ req, operation, data, originalDoc }) => {
      const bootstrap = req.context?.systemAction === 'bootstrap-admin'
      if (operation === 'create' && staffRole(req) !== 'admin' && !bootstrap) {
        throw new APIError('Administrator creation requires the private bootstrap command.', 403)
      }
      if (operation === 'update' && data.role && data.role !== originalDoc.role && staffRole(req) !== 'admin') {
        throw new APIError('Only an administrator can change staff roles.', 403)
      }
      return data
    }],
  },
  fields: [
    { name: 'name', label: 'Imię i nazwisko', type: 'text' },
    {
      name: 'role', label: 'Rola', type: 'select', required: true, defaultValue: 'editor',
      options: [
        { label: 'Administrator', value: 'admin' },
        { label: 'Redaktor treści', value: 'editor' },
        { label: 'Obsługa zamówień', value: 'operations' },
      ],
      access: { update: adminField },
    },
  ],
}
