import { createHmac } from 'node:crypto'
import { INTERNAL_TEST_PROVIDER, testProvider, type PaymentProvider } from './provider'
import { paymentProviderID } from './payment-selection'

// Adding a provider affects only this registry and its adapter. Checkout and
// notification handling share the same provider contract and server validation.
const adapters: Readonly<Record<string, () => PaymentProvider>> = { [INTERNAL_TEST_PROVIDER]: testProvider }
export type PaymentRegistry = {
  /** The configured adapter; used only when a new order is created. */
  current(): PaymentProvider
  /** The adapter recorded on an attempt; null when it is no longer registered. */
  byID(id: string): PaymentProvider | null
}
export function registeredPaymentProvider(id: unknown): PaymentProvider | null {
  if (typeof id !== 'string' || !Object.hasOwn(adapters, id)) return null
  const provider = adapters[id]()
  if (provider.id !== id || provider.mode !== 'test') throw new Error('The payment adapter registry is inconsistent.')
  return provider
}
export function paymentProvider(): PaymentProvider {
  return registeredPaymentProvider(paymentProviderID(process.env.UNDERWATER_PAYMENT_PROVIDER))!
}
export const paymentRegistry: PaymentRegistry = { current: paymentProvider, byID: registeredPaymentProvider }
export function orderAccessToken(idempotencyKey: string, fingerprint: string): string {
  const secret = process.env.PAYLOAD_SECRET || ''
  if (secret.length < 32) throw new Error('A private order access secret is required.')
  return createHmac('sha256', secret).update(`underwater-order-access\n${idempotencyKey}\n${fingerprint}`).digest('base64url')
}
