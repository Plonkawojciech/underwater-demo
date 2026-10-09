'use server'
import { db } from './data'
import { contact, signup, subscribe } from './forms/service'
import { actionOrigin, rateLimit } from './http'
import { email, hash, InputError } from './commerce/input'

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
