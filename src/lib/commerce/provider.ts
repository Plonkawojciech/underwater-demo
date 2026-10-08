import { createHmac, randomUUID } from 'node:crypto'
import { cents, equalDigest, InputError, text } from './input'

export type PaymentOutcome = 'paid' | 'failed' | 'cancelled'
export type PaymentNotification = { eventKey: string; reference: string; amountCents: number; currency: 'PLN'; outcome: PaymentOutcome }
export interface PaymentProvider {
  readonly id: string
  readonly mode: 'test'
  start(input: { number: string; amountCents: number; currency: 'PLN'; token: string }): { reference: string; paymentURL: string }
  verify(rawBody: string, signature: string): PaymentNotification
}
export class TestPaymentProvider implements PaymentProvider {
  readonly id = 'internal-test'
  readonly mode = 'test'
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('Payment signing secret is required.')
  }
  start(input: { number: string; amountCents: number; currency: 'PLN'; token: string }) {
    cents(input.amountCents)
    return { reference: `test-${randomUUID()}`, paymentURL: `/platnosc-testowa?token=${encodeURIComponent(input.token)}` }
  }
  sign(rawBody: string) { return createHmac('sha256', this.secret).update('underwater-test-webhook\n').update(rawBody).digest('hex') }
  accessToken(idempotencyKey: string, fingerprint: string) { return createHmac('sha256', this.secret).update(`underwater-order-access\n${idempotencyKey}\n${fingerprint}`).digest('base64url') }
  verify(rawBody: string, signature: string): PaymentNotification {
    if (rawBody.length > 8192 || !equalDigest(this.sign(rawBody), signature)) throw new InputError('Nieprawidłowy podpis płatności.', 401)
    let value: Record<string, unknown>
    try { value = JSON.parse(rawBody) } catch { throw new InputError('Nieprawidłowy komunikat płatności.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Nieprawidłowy komunikat płatności.')
    if (value.currency !== 'PLN' || !['paid', 'failed', 'cancelled'].includes(String(value.outcome))) throw new InputError('Nieprawidłowa waluta lub status płatności.')
    return { eventKey: text(value.eventKey, 'zdarzenie', 100), reference: text(value.reference, 'referencja', 100), amountCents: cents(value.amountCents), currency: 'PLN', outcome: value.outcome as PaymentOutcome }
  }
}
export function testProvider() {
  if (!['preview', 'test'].includes(process.env.UNDERWATER_ENVIRONMENT || '')) throw new Error('Test payments require an isolated environment.')
  return new TestPaymentProvider(process.env.PAYLOAD_SECRET || '')
}
