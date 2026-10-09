import { createHmac } from 'node:crypto'
import { cents, equalDigest, hash, InputError, text } from './input'

export type PaymentOutcome = 'paid' | 'failed' | 'cancelled'
/**
 * merchantKey is the start idempotencyKey, present only when the operator signed it
 * with the event. An adapter whose callback can arrive before its start result was
 * stored (timeout, crash) must provide it; without it such an event is unknown.
 */
export type PaymentNotification = { eventKey: string; reference: string; amountCents: number; currency: 'PLN'; outcome: PaymentOutcome; merchantKey?: string }
/** Identical on every repeated start of one attempt; an adapter forwards idempotencyKey to its operator. No customer token is sent. */
export type PaymentStartInput = { readonly idempotencyKey: string; readonly number: string; readonly amountCents: number; readonly currency: 'PLN' }
/** reference is the operator's raw reference; it is unique only within one adapter. */
export type PaymentStart = { reference: string; paymentURL: string }
/**
 * Contract for a future operator adapter (none is registered yet; only internal-test runs):
 * - start() sends the merchant key as the operator's idempotency key and stores it in the
 *   operator's signed payment metadata. Every notification of that payment must return it
 *   in its signed body (PaymentNotification.merchantKey): a payment whose start result was
 *   never stored (timeout, crash) is otherwise unknown to the shop and cannot reach review.
 * - The raw reference is unique per adapter only; the shop namespaces it by adapter id.
 * - The customer's return address after the operator page is an explicit, fixed shop page
 *   chosen when the operator is configured. It never contains the private order token or
 *   order data; the customer reopens the status page from the captured order message.
 * - Callbacks arrive at /api/payments/webhook/<id>. The preview Basic Auth still covers
 *   them; an exception is a separate decision once a real sandbox is configured.
 */
export interface PaymentProvider {
  readonly id: string
  readonly mode: 'test'
  /** Explicit HTTPS sandbox origins the customer may be sent to. Empty: only the shop's own test payment page. */
  readonly redirectOrigins: readonly string[]
  /** Request header with the notification signature; defaults to DEFAULT_SIGNATURE_HEADER. */
  readonly signatureHeader?: string
  /**
   * Runs after COMMIT, never inside a database transaction, and may be repeated
   * after a timeout or crash: the same idempotencyKey must return the same intent.
   */
  start(input: PaymentStartInput, options?: { signal?: AbortSignal }): Promise<PaymentStart>
  verify(rawBody: string, signature: string): PaymentNotification
}
export const INTERNAL_TEST_PROVIDER = 'internal-test'
export const DEFAULT_SIGNATURE_HEADER = 'x-underwater-signature'
export const OWN_PAYMENT_PATH = '/platnosc-testowa'
export const ownPaymentURL = (token: string) => `${OWN_PAYMENT_PATH}?token=${encodeURIComponent(token)}`
const MERCHANT_KEY = /^underwater-UW-[A-Za-z0-9-]{1,80}$/
/** Merchant idempotency key derived from the immutable order number. */
export function paymentStartKey(number: string) {
  if (!/^UW-[A-Za-z0-9-]{1,80}$/.test(number)) throw new Error('An immutable order number is required for a payment start.')
  return `underwater-${number}`
}
export function merchantKey(value: unknown): string {
  if (typeof value !== 'string' || !MERCHANT_KEY.test(value)) throw new InputError('Nieprawidłowy klucz płatności.')
  return value
}
/** The globally unique stored reference of an adapter's raw reference; equal raw references of two adapters never collide. */
export const namespacedReference = (provider: string, raw: string) => `${provider}:${hash(`${provider}\n${raw}`)}`
const isHTTPSOrigin = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value } catch { return false } }
/**
 * The form stored on an attempt. The internal adapter may return only the shop's
 * own page path, rebuilt with the private token for the verified holder. Another
 * adapter's page must be HTTPS on one of its declared sandbox origins without the token.
 */
export function storedPaymentURL(provider: PaymentProvider, url: unknown, token: string): string {
  const invalid = new InputError('Operator płatności zwrócił nieprawidłowy adres płatności.', 502)
  if (typeof url !== 'string' || !url || url.length > 2048 || /[\s\u0000-\u001F\u007F\\]/.test(url)) throw invalid
  if (!provider.redirectOrigins.length) {
    if (url !== OWN_PAYMENT_PATH) throw invalid
    return OWN_PAYMENT_PATH
  }
  return externalPaymentURL(provider, url, token, invalid)
}
/** The explicit sandbox link shown on the private status page; null for the shop's own page. */
export function sandboxPaymentLink(provider: PaymentProvider | null, stored: string, token: string): string | null {
  if (stored === OWN_PAYMENT_PATH) return null
  const invalid = new InputError('Płatność tego zamówienia wymaga kontaktu ze sklepem.', 409)
  if (!provider) throw invalid
  return externalPaymentURL(provider, stored, token, invalid)
}
function externalPaymentURL(provider: PaymentProvider, url: string, token: string, invalid: InputError) {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw invalid }
  const allowed = provider.redirectOrigins.filter(isHTTPSOrigin)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowed.includes(parsed.origin) || (token && url.includes(token))) throw invalid
  return parsed.href
}
/** Reads at most 8 KiB of the exact raw notification bytes before any verification. */
export async function readNotificationBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > 8192) throw new InputError('Zbyt duży komunikat.', 413)
  const reader = request.body?.getReader(); if (!reader) throw new InputError('Brak komunikatu.')
  const chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw new InputError('Zbyt duży komunikat.', 413) }; chunks.push(value) } } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
export class TestPaymentProvider implements PaymentProvider {
  readonly id = INTERNAL_TEST_PROVIDER
  readonly mode = 'test'
  readonly redirectOrigins: readonly string[] = []
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('Payment signing secret is required.')
  }
  // No network: the reference is derived from the merchant key, so a repeated start returns the same intent.
  async start(input: PaymentStartInput) {
    cents(input.amountCents)
    if (input.currency !== 'PLN' || !MERCHANT_KEY.test(input.idempotencyKey)) throw new InputError('Nieprawidłowe dane płatności testowej.')
    const reference = createHmac('sha256', this.secret).update(`underwater-test-reference\n${input.idempotencyKey}`).digest('hex').slice(0, 32)
    return { reference: `test-${reference}`, paymentURL: OWN_PAYMENT_PATH }
  }
  sign(rawBody: string) { return createHmac('sha256', this.secret).update('underwater-test-webhook\n').update(rawBody).digest('hex') }
  accessToken(idempotencyKey: string, fingerprint: string) { return createHmac('sha256', this.secret).update(`underwater-order-access\n${idempotencyKey}\n${fingerprint}`).digest('base64url') }
  verify(rawBody: string, signature: string): PaymentNotification {
    if (rawBody.length > 8192 || !equalDigest(this.sign(rawBody), signature)) throw new InputError('Nieprawidłowy podpis płatności.', 401)
    let value: Record<string, unknown>
    try { value = JSON.parse(rawBody) } catch { throw new InputError('Nieprawidłowy komunikat płatności.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Nieprawidłowy komunikat płatności.')
    if (value.currency !== 'PLN' || !['paid', 'failed', 'cancelled'].includes(String(value.outcome))) throw new InputError('Nieprawidłowa waluta lub status płatności.')
    // Older signed events carry no merchant key and stay valid.
    return { eventKey: text(value.eventKey, 'zdarzenie', 100), reference: text(value.reference, 'referencja', 100), amountCents: cents(value.amountCents), currency: 'PLN', outcome: value.outcome as PaymentOutcome, ...(value.merchantKey != null ? { merchantKey: merchantKey(value.merchantKey) } : {}) }
  }
}
export function testProvider() {
  if (!['preview', 'test'].includes(process.env.UNDERWATER_ENVIRONMENT || '')) throw new Error('Test payments require an isolated environment.')
  return new TestPaymentProvider(process.env.PAYLOAD_SECRET || '')
}
