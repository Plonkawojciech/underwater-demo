'use client'
import Link from 'next/link'
import { useActionState, useId } from 'react'
import { createContact, subscribeNewsletter, type FormState } from '@/lib/actions'
import type { ContactContext } from '@/lib/presentation'
import { Honeypot } from './FormBits'

const initial: FormState = { ok: false, message: '' }

function Privacy({ href }: { href?: string }) {
  return href
    ? <Link href={href} className="textlink">Polityka prywatności</Link>
    : <span className="muted">Polityka prywatności nie jest jeszcze opublikowana w tej wersji podglądowej.</span>
}

const CONTEXT_LABEL: Record<ContactContext['kind'], string> = { product: 'Pytanie o produkt', trip: 'Pytanie o wyjazd' }

/**
 * Contact message, sent as a server action (POST); nothing lands in the URL. `context` was read
 * on the server from a published record; only its kind and id are posted, and the server reads
 * the record again before storing it with the message.
 */
export function ContactForm({ privacyHref, context }: { privacyHref?: string; context?: ContactContext | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createContact, initial)
  const uid = useId()
  if (state.ok) {
    return (
      <div className="done" role="status">
        <strong>Wiadomość zapisana{state.number ? ` (nr ${state.number})` : ''}.</strong> {state.message}
      </div>
    )
  }
  return (
    <form action={action} className="form" aria-describedby={state.message ? `${uid}-err` : undefined}>
      <h2 className="subh subh-first">Napisz do nas</h2>
      {context ? (
        <div className="enquiry">
          <p className="enquiry-k">{CONTEXT_LABEL[context.kind]}</p>
          <p className="enquiry-t"><Link href={context.href} className="textlink">{context.title}</Link></p>
          <Link href="/kontakt.html" className="enquiry-x">Napisz bez wskazania {context.kind === 'product' ? 'produktu' : 'wyjazdu'}</Link>
          <input type="hidden" name="contextKind" value={context.kind} />
          <input type="hidden" name="contextID" value={context.id} />
        </div>
      ) : null}
      <label>Imię i nazwisko<input name="name" required autoComplete="name" maxLength={120} /></label>
      <div className="form-row">
        <label>E-mail<input name="email" type="email" required autoComplete="email" maxLength={200} /></label>
        <label>Telefon (opcjonalnie)<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
      </div>
      <label>Wiadomość<textarea name="message" rows={5} required maxLength={5000} /></label>
      <label className="check">
        <input type="checkbox" name="privacyAccepted" value="true" required />
        <span>Zgadzam się na przetwarzanie moich danych w celu odpowiedzi na wiadomość. <Privacy href={privacyHref} /></span>
      </label>
      <Honeypot />
      <p id={`${uid}-err`} className="form-err" role="alert">{state.message}</p>
      <button className="btn btn-solid" disabled={pending}>{pending ? 'Wysyłanie…' : 'Wyślij wiadomość'}</button>
    </form>
  )
}

/** Newsletter sign-up. Subscription becomes active only after the confirmation link. */
export function NewsletterForm({ privacyHref }: { privacyHref?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(subscribeNewsletter, initial)
  const uid = useId()
  if (state.ok) return <div className="done" role="status"><strong>Zapis przyjęty.</strong> {state.message}</div>
  return (
    <form action={action} className="form newsletter" aria-describedby={state.message ? `${uid}-err` : undefined}>
      <h2 className="subh subh-first">Newsletter</h2>
      <label>E-mail<input name="email" type="email" required autoComplete="email" maxLength={200} /></label>
      <label className="check">
        <input type="checkbox" name="consent" value="true" required />
        <span>Chcę otrzymywać informacje o kursach, wyjazdach i ofercie sklepu. Zgodę mogę wycofać w każdej chwili. <Privacy href={privacyHref} /></span>
      </label>
      <Honeypot />
      <p id={`${uid}-err`} className="form-err" role="alert">{state.message}</p>
      <button className="btn btn-line" disabled={pending}>{pending ? 'Zapisywanie…' : 'Zapisz się'}</button>
    </form>
  )
}
