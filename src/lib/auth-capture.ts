import { createHash } from 'node:crypto'
import { createLocalReq, type PayloadRequest } from 'payload'
import { validateEnvironment } from './environment'

// Payload 3.90's default reset transport performs an independent rate-limit
// write and awaits email before COMMIT. Both conflict with BEGIN IMMEDIATE.
// The Users hooks disable that transport and capture the reset inside the
// caller transaction, including its 15-second per-account request interval.
type ResetSnapshot = { id: number | string; token: string | null; expiration: string | null; throttled: boolean }
const snapshots = new WeakMap<PayloadRequest, ResetSnapshot>()

export async function preparePasswordResetCapture(req: PayloadRequest, data: { email?: unknown }) {
  if (!req.transactionID) throw new Error('A password reset capture requires its caller transaction.')
  snapshots.delete(req)
  const address = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  if (!address) return
  const user = await req.payload.db.findOne<{ id: number | string; resetPasswordToken?: string | null; resetPasswordExpiration?: string | null; resetPasswordRequestedAt?: string | null }>({
    collection: 'users', where: { email: { equals: address } }, req,
    select: { id: true, resetPasswordToken: true, resetPasswordExpiration: true, resetPasswordRequestedAt: true },
  })
  if (!user) return
  const auth = req.payload.collections.users.config.auth
  const interval = typeof auth === 'object' ? auth.forgotPassword?.minRequestInterval ?? 15_000 : 15_000
  snapshots.set(req, { id: user.id, token: user.resetPasswordToken ?? null, expiration: user.resetPasswordExpiration ?? null, throttled: interval > 0 && !!user.resetPasswordRequestedAt && Date.parse(user.resetPasswordRequestedAt) > Date.now() - interval })
}

export async function capturePasswordReset(req: PayloadRequest, token: string) {
  if (!req.transactionID || !/^[a-f0-9]{40}$/.test(token)) throw new Error('A password reset capture requires its caller transaction.')
  const snapshot = snapshots.get(req)
  snapshots.delete(req)
  if (!snapshot) throw new Error('The reset capture lacks its original transaction state.')
  const payload = req.payload
  // SDK has already replaced the token before afterOperation. Restore it
  // inside the same transaction on a throttled request, then return null like
  // the SDK's unknown-account path. The previously captured link stays valid.
  if (snapshot.throttled) {
    await payload.db.updateOne({ collection: 'users', id: snapshot.id, data: { resetPasswordToken: snapshot.token, resetPasswordExpiration: snapshot.expiration }, req })
    return false
  }
  const result = await payload.find({ collection: 'users', where: { resetPasswordToken: { equals: token } }, limit: 1, depth: 0, showHiddenFields: true, overrideAccess: true, req })
  const user = result.docs[0]
  if (!user?.email || user.id !== snapshot.id) throw new Error('The reset token does not identify its original transaction user.')
  const now = Date.now()
  await payload.update({ collection: 'users', id: user.id, data: { resetPasswordRequestedAt: new Date(now).toISOString() }, overrideAccess: true, req })
  const origin = validateEnvironment(process.env).serverURL
  const admin = payload.config.routes.admin.replace(/\/+$/, '')
  const reset = payload.config.admin.routes.reset.replace(/^\/+|\/+$/g, '')
  const url = `${origin}${admin}/${reset}/${token}`
  const mailReq = await createLocalReq({ context: { systemAction: 'form-service' } }, payload)
  mailReq.transactionID = req.transactionID
  await payload.create({ collection: 'outbox', overrideAccess: true, req: mailReq, data: {
    deduplicationKey: 'cms-email:reset:' + createHash('sha256').update(token).digest('hex'),
    recipient: user.email, subject: 'Reset hasła — prywatny podgląd Underwater',
    body: `Link resetu hasła do panelu: ${url}\nWiadomość jest przechwycona w podglądzie. Nie została wysłana.`, status: 'captured',
  } })
  return true
}
