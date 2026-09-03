'use client'
import { useActionState } from 'react'
import { createSignup, type FormState } from '@/lib/actions'

export function SignupForm({ courseId, courseName }: { courseId: number; courseName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSignup, { ok: false, message: '' })
  if (state.ok) return <div className="form-done"><strong>Dziękujemy.</strong> {state.message}</div>
  return (
    <form action={action} className="form">
      <input type="hidden" name="course" value={courseId} />
      <p className="form-lead">Zapisz się na kurs <strong>{courseName}</strong>. Zgłoszenie trafia od razu do naszego panelu, oddzwaniamy w ciągu jednego dnia roboczego.</p>
      <label>Imię i nazwisko<input name="name" required autoComplete="name" /></label>
      <div className="form-row">
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Telefon<input name="phone" type="tel" required autoComplete="tel" /></label>
      </div>
      <label>Wiadomość (opcjonalnie)<textarea name="message" rows={3} placeholder="Np. preferowany termin, doświadczenie, pytania" /></label>
      {state.message && !state.ok && <p className="form-err">{state.message}</p>}
      <button className="btn btn-accent" disabled={pending}>{pending ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}</button>
    </form>
  )
}
