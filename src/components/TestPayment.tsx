'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatMoney, PAYMENT_STATUS } from '@/lib/presentation'
import { DateText } from './content/DateText'
import { Notice } from './content/States'

type Info = { number: string; totalCents: number; currency: string; status: string; expiresAt?: string }
type State = { s: 'loading' } | { s: 'error'; message: string } | { s: 'ready'; info: Info }
type Outcome = 'paid' | 'failed' | 'cancelled'

function parseInfo(d: unknown): Info | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  if (r.ok !== true || typeof r.number !== 'string' || typeof r.status !== 'string' || typeof r.currency !== 'string') return null
  if (typeof r.totalCents !== 'number' || !Number.isSafeInteger(r.totalCents)) return null
  return {
    number: r.number.slice(0, 40), status: r.status.slice(0, 40), currency: r.currency.slice(0, 8), totalCents: r.totalCents,
    expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : undefined,
  }
}
const errorOf = (d: unknown, fallback: string) => {
  const m = d && typeof d === 'object' ? (d as { message?: unknown }).message : undefined
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : fallback
}

/**
 * Simulated payment for a test order. The status shown always comes from the server;
 * nothing here marks an order as paid. Buttons exist only while the payment is pending.
 */
export function TestPayment({ token }: { token: string }) {
  const [state, setState] = useState<State>({ s: 'loading' })
  const [busy, setBusy] = useState<Outcome | null>(null)
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/payments/test?token=${encodeURIComponent(token)}`, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        const d = await res.json().catch(() => null)
        const info = parseInfo(d)
        setState(info ? { s: 'ready', info } : { s: 'error', message: errorOf(d, 'Link do płatności jest nieprawidłowy albo wygasł.') })
      })
      .catch(() => { if (!ctrl.signal.aborted) setState({ s: 'error', message: 'Brak połączenia ze sklepem. Odśwież stronę.' }) })
    return () => ctrl.abort()
  }, [token])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const act = async (outcome: Outcome) => {
    setBusy(outcome)
    setActionError('')
    try {
      const res = await fetch('/api/payments/test', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, outcome }),
        cache: 'no-store', credentials: 'same-origin',
      })
      const d = await res.json().catch(() => null)
      const info = parseInfo(d)
      if (info) setState({ s: 'ready', info })
      else setActionError(errorOf(d, 'Sklep nie przyjął wyniku płatności testowej.'))
    } catch {
      setActionError('Brak połączenia ze sklepem. Spróbuj ponownie.')
    } finally {
      setBusy(null)
    }
  }

  if (state.s === 'loading') return <p className="lead" role="status">Wczytywanie płatności…</p>
  if (state.s === 'error') {
    return (
      <Notice tone="error" title="Nie można otworzyć płatności">
        <p>{state.message}</p>
        <p><Link href="/koszyk">Wróć do koszyka</Link></p>
      </Notice>
    )
  }
  const { info } = state
  const expires = info.expiresAt ? new Date(info.expiresAt).getTime() : NaN
  const expired = info.status === 'expired' || (info.status === 'pending' && Number.isFinite(expires) && expires <= now)
  const pending = info.status === 'pending' && !expired
  return (
    <div className="pay">
      <dl className="pay-dl">
        <div><dt>Zamówienie</dt><dd className="mono">{info.number}</dd></div>
        <div><dt>Kwota</dt><dd className="mono">{formatMoney(info.totalCents, info.currency)}</dd></div>
        <div><dt>Status</dt><dd role="status">{expired ? PAYMENT_STATUS.expired : PAYMENT_STATUS[info.status] || info.status}</dd></div>
        {pending && info.expiresAt ? <div><dt>Link ważny do</dt><dd><DateText value={info.expiresAt} format="datetime" /></dd></div> : null}
      </dl>
      {pending ? (
        <div className="pay-act">
          <button type="button" className="btn btn-solid" disabled={!!busy} onClick={() => act('paid')}>{busy === 'paid' ? 'Zapisywanie…' : 'Symuluj udaną płatność'}</button>
          <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => act('failed')}>{busy === 'failed' ? 'Zapisywanie…' : 'Symuluj odrzucenie'}</button>
          <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => act('cancelled')}>{busy === 'cancelled' ? 'Zapisywanie…' : 'Anuluj płatność'}</button>
        </div>
      ) : expired ? (
        <p>Link do tej płatności wygasł. Złóż zamówienie ponownie albo skontaktuj się ze sklepem.</p>
      ) : (
        <p>Wynik płatności testowej jest zapisany w sklepie. <Link className="textlink" href="/sklep-nurkowy.html">Wróć do sklepu</Link></p>
      )}
      <p className="form-err" role="alert">{actionError}</p>
    </div>
  )
}
