import { createHmac } from 'node:crypto'
import { testProvider, type PaymentProvider } from './provider'
import { paymentProviderID } from './payment-selection'

// Adding a provider affects only this registry and its adapter. Checkout and
// notification handling share the same provider contract and server validation.
export function paymentProvider(): PaymentProvider {
  paymentProviderID(process.env.UNDERWATER_PAYMENT_PROVIDER)
  return testProvider()
}
export function orderAccessToken(idempotencyKey: string, fingerprint: string): string {
  const secret = process.env.PAYLOAD_SECRET || ''
  if (secret.length < 32) throw new Error('A private order access secret is required.')
  return createHmac('sha256', secret).update(`underwater-order-access\n${idempotencyKey}\n${fingerprint}`).digest('base64url')
}
