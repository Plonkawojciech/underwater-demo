import { createHmac } from 'node:crypto'
import { testProvider, type PaymentProvider } from './provider'

// Adding a provider affects only this registry and its adapter. Checkout and
// notification handling share the same provider contract and server validation.
export function paymentProvider(): PaymentProvider {
  const selected = process.env.UNDERWATER_PAYMENT_PROVIDER || 'internal-test'
  if (selected !== 'internal-test') throw new Error('The selected payment provider has no verified sandbox adapter.')
  return testProvider()
}
export function orderAccessToken(idempotencyKey: string, fingerprint: string): string {
  const secret = process.env.PAYLOAD_SECRET || ''
  if (secret.length < 32) throw new Error('A private order access secret is required.')
  return createHmac('sha256', secret).update(`underwater-order-access\n${idempotencyKey}\n${fingerprint}`).digest('base64url')
}
