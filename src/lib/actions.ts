'use server'
import { db } from './data'
import { contact, signup, subscribe } from './forms/service'
import { actionOrigin, rateLimit } from './http'
import { email, hash, InputError } from './commerce/input'
import { checkout } from './commerce/order'

export type FormState = { ok: boolean; message: string; number?: string }
function fromForm(form: FormData) {
  const value: Record<string, unknown> = Object.fromEntries(form.entries())
  for (const key of ['privacyAccepted', 'termsAccepted', 'consent']) value[key] = ['on', 'true', '1'].includes(String(form.get(key) || ''))
  for (const key of ['course', 'session']) if (form.get(key)) value[key] = Number(form.get(key))
  return value
}
async function runForm(form: FormData, operation: 'contact' | 'signup' | 'newsletter'): Promise<FormState> {
  try {
    await actionOrigin(); rateLimit(`form:${operation}:global`, 100)
    const input = fromForm(form)
    rateLimit(`form:${operation}:${hash(email(input.email))}`, 5)
    const payload = await db()
    return operation === 'contact' ? await contact(payload, input) : operation === 'signup' ? await signup(payload, input) : await subscribe(payload, input)
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message }
    console.error('[underwater] Form failed:', error instanceof Error ? error.name : 'UnknownError')
    return { ok: false, message: 'Nie udało się zapisać zgłoszenia. Spróbuj ponownie.' }
  }
}
export async function createSignup(_prev: FormState, form: FormData) { return runForm(form, 'signup') }
export async function createContact(_prev: FormState, form: FormData) { return runForm(form, 'contact') }
export async function subscribeNewsletter(_prev: FormState, form: FormData) { return runForm(form, 'newsletter') }
// Compatibility for the former demo action: no trust in submitted prices.
export async function createOrder(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await actionOrigin()
    const input = fromForm(form)
    let items: unknown
    try { items = JSON.parse(String(form.get('items') || '[]')) } catch { throw new InputError('Nieprawidłowy koszyk.') }
    const result = await checkout(await db(), { idempotencyKey: input.idempotencyKey, customerName: input.name, email: input.email, phone: input.phone, address: input.address, deliveryMethod: input.deliveryMethod, privacyAccepted: input.privacyAccepted, termsAccepted: input.termsAccepted, website: input.website, items })
    return { ok: true, message: 'Zapisaliśmy zamówienie testowe.', number: result.number }
  } catch (error) { return { ok: false, message: error instanceof InputError ? error.message : 'Nie udało się zapisać zamówienia.' } }
}
