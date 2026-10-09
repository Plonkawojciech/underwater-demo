'use client'
import Link from 'next/link'
import { useActionState, useId } from 'react'
import { createSignup, type FormState } from '@/lib/actions'
import { formatDateTime } from '@/lib/presentation'
import { Honeypot } from './FormBits'

export type SignupSession = { id: number; title: string; startsAt: string; remaining?: number | null }

export function SignupForm({ courseId, courseName, sessions = [], privacyHref }: {
  courseId: number
  courseName: string
  sessions?: SignupSession[]
  /** Published privacy policy, when the CMS has one. */
  privacyHref?: string
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSignup, { ok: false, message: '' })
  const uid = useId()
  const errId = `${uid}-err`
  const open = sessions.filter((s) => s.remaining !== 0)

  if (state.ok) {
    return (
      <div className="done" role="status">
        <strong>Zgłoszenie zapisane{state.number ? ` (nr ${state.number})` : ''}.</strong> {state.message}
      </div>
    )
  }
  const invalid = !!state.message
  return (
    <form action={action} className="form" aria-describedby={invalid ? errId : undefined}>
      <input type="hidden" name="course" value={courseId} />
      <p className="note note-first">Zgłoszenie na kurs {courseName} trafia do obsługi szkoły. Termin i szczegóły potwierdzimy po jego przejrzeniu.</p>
      {sessions.length > 0 && (
        <label>
          Termin
          <select name="session" defaultValue={open[0] ? String(open[0].id) : ''}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id} disabled={s.remaining === 0}>
                {/* Date and time (Warsaw) tell apart sessions that share a title. */}
                {[s.title, formatDateTime(s.startsAt)].filter(Boolean).join(', ')}{s.remaining === 0 ? ' (brak miejsc)' : typeof s.remaining === 'number' ? ` (wolne: ${s.remaining})` : ''}
              </option>
            ))}
            <option value="">Inny termin, do ustalenia</option>
          </select>
        </label>
      )}
      {sessions.length > 0 && open.length === 0 ? <p className="note">Na opublikowanych terminach nie ma wolnych miejsc. Możesz zgłosić się na inny termin.</p> : null}
      <label>Imię i nazwisko<input name="name" required autoComplete="name" maxLength={120} /></label>
      <label>E-mail<input name="email" type="email" required autoComplete="email" maxLength={200} /></label>
      <label>Telefon<input name="phone" type="tel" required autoComplete="tel" maxLength={40} /></label>
      <label>Wiadomość<textarea name="message" rows={3} maxLength={2000} placeholder="Doświadczenie, pytania" /></label>
      <label className="check">
        <input type="checkbox" name="privacyAccepted" value="true" required />
        <span>
          Zgadzam się na przetwarzanie moich danych w celu obsługi zgłoszenia.{' '}
          {privacyHref ? <Link href={privacyHref} className="textlink">Polityka prywatności</Link> : <span className="muted">Polityka prywatności nie jest jeszcze opublikowana w tej wersji podglądowej.</span>}
        </span>
      </label>
      <Honeypot />
      <p id={errId} className="form-err" role="alert">{invalid ? state.message : ''}</p>
      <button className="btn btn-solid" disabled={pending}>{pending ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}</button>
    </form>
  )
}
