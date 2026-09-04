'use client'
import { useActionState } from 'react'
import { createSignup, type FormState } from '@/lib/actions'

export function SignupForm({ courseId, courseName }: { courseId: number; courseName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSignup, { ok: false, message: '' })
  if (state.ok) return <div className="done"><strong>Dziękujemy.</strong> {state.message}</div>
  return (
    <form action={action} className="form">
      <input type="hidden" name="course" value={courseId} />
      <p className="note" style={{ margin: 0 }}>Zgłoszenie na kurs {courseName} trafia prosto do naszego panelu. Oddzwaniamy w ciągu jednego dnia roboczego.</p>
      <label>Imię i nazwisko<input name="name" required autoComplete="name" /></label>
      <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
      <label>Telefon<input name="phone" type="tel" required autoComplete="tel" /></label>
      <label>Wiadomość<textarea name="message" rows={3} placeholder="Termin, doświadczenie, pytania" /></label>
      {state.message && !state.ok && <p className="form-err">{state.message}</p>}
      <button className="btn btn-solid" disabled={pending}>{pending ? 'Wysyłanie…' : 'Wyślij zgłoszenie'} <span className="arrow">→</span></button>
    </form>
  )
}
