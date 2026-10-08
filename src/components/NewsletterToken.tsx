'use client'
import { useState } from 'react'

const COPY = {
  signup: { endpoint: '/api/signups/confirm', button: 'Potwierdź e-mail zgłoszenia', busy: 'Potwierdzanie…', ok: 'E-mail zgłoszenia na kurs został potwierdzony.' },
  confirm: { endpoint: '/api/newsletter/confirm', button: 'Potwierdź zapis', busy: 'Potwierdzanie…', ok: 'Zapis na newsletter jest potwierdzony.' },
  unsubscribe: { endpoint: '/api/newsletter/unsubscribe', button: 'Wypisz mnie z newslettera', busy: 'Wypisywanie…', ok: 'Adres został wypisany z newslettera.' },
} as const

/**
 * Opening the link changes nothing (mail scanners follow links); the change happens only
 * after the person presses the button, as a POST.
 */
export function NewsletterToken({ token, action }: { token: string; action: keyof typeof COPY }) {
  const c = COPY[action]
  const [state, setState] = useState<{ s: 'idle' | 'busy' | 'ok' | 'error'; message?: string }>({ s: 'idle' })
  const send = async () => {
    setState({ s: 'busy' })
    try {
      const res = await fetch(c.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store', credentials: 'same-origin',
      })
      const d = await res.json().catch(() => null)
      if (d?.ok === true) setState({ s: 'ok' })
      else setState({ s: 'error', message: typeof d?.message === 'string' ? d.message.slice(0, 300) : 'Link jest nieprawidłowy albo wygasł.' })
    } catch {
      setState({ s: 'error', message: 'Brak połączenia. Spróbuj ponownie.' })
    }
  }
  if (state.s === 'ok') return <p className="done" role="status">{c.ok}</p>
  return (
    <div className="nl-act">
      <button type="button" className="btn btn-solid" onClick={send} disabled={state.s === 'busy'}>{state.s === 'busy' ? c.busy : c.button}</button>
      <p className="form-err" role="alert">{state.s === 'error' ? state.message : ''}</p>
    </div>
  )
}
