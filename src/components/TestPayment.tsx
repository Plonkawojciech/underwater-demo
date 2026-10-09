'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatMoney, PAYMENT_STATUS } from '@/lib/presentation'
import { DateText } from './content/DateText'
import { Notice } from './content/States'

type Info = {
  number: string; totalCents: number; currency: string; status: string; expiresAt?: string
  paymentMethod: string; orderStatus?: string; deliveryLabel?: string; pickupPointName?: string; paymentSurchargeCents: number
  payment: 'ready' | 'preparing' | 'review'; paymentLink?: string; simulation: boolean
}
type State = { s: 'loading' } | { s: 'error'; message: string } | { s: 'ready'; info: Info }
type Outcome = 'paid' | 'failed' | 'cancelled'
type Action = Outcome | 'resume'

/** The server validates the operator's sandbox page; this only refuses anything that is not a plain HTTPS link without the private token. */
function sandboxLink(value: unknown, token: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && !value.includes(token) ? u.href : undefined
  } catch { return undefined }
}

function parseInfo(d: unknown, token: string): Info | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  if (r.ok !== true || typeof r.number !== 'string' || typeof r.status !== 'string' || typeof r.currency !== 'string') return null
  if (typeof r.totalCents !== 'number' || !Number.isSafeInteger(r.totalCents)) return null
  return {
    number: r.number.slice(0, 40), status: r.status.slice(0, 40), currency: r.currency.slice(0, 8), totalCents: r.totalCents,
    expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : undefined,
    // Older responses carry no method: they were online payments.
    paymentMethod: typeof r.paymentMethod === 'string' ? r.paymentMethod.slice(0, 40) : 'online',
    orderStatus: typeof r.orderStatus === 'string' ? r.orderStatus.slice(0, 40) : undefined,
    deliveryLabel: typeof r.deliveryLabel === 'string' ? r.deliveryLabel.slice(0, 200) : undefined,
    pickupPointName: typeof r.pickupPointName === 'string' ? r.pickupPointName.slice(0, 120) : undefined,
    paymentSurchargeCents: typeof r.paymentSurchargeCents === 'number' && Number.isSafeInteger(r.paymentSurchargeCents) ? r.paymentSurchargeCents : 0,
    // Older responses carry no preparation state: their online payment was the internal simulation.
    payment: r.payment === 'preparing' || r.payment === 'review' ? r.payment : 'ready',
    paymentLink: sandboxLink(r.paymentLink, token),
    simulation: typeof r.simulation === 'boolean' ? r.simulation : true,
  }
}
const errorOf = (d: unknown, fallback: string) => {
  const m = d && typeof d === 'object' ? (d as { message?: unknown }).message : undefined
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : fallback
}

const METHOD: Record<string, string> = {
  online: 'Online (symulacja)',
  bank_transfer: 'Przelew tradycyjny (test)',
  cod: 'Za pobraniem (test)',
}

/**
 * Simulated payment for a test order. The status shown always comes from the server;
 * nothing here marks an order as paid. Buttons exist only while the payment is pending.
 * Offline payments are confirmed by signed-in shop staff; the link holder may only cancel.
 */
export function TestPayment({ token }: { token: string }) {
  const [state, setState] = useState<State>({ s: 'loading' })
  const [busy, setBusy] = useState<Action | null>(null)
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/payments/test?token=${encodeURIComponent(token)}`, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        const d = await res.json().catch(() => null)
        const info = parseInfo(d, token)
        setState(info ? { s: 'ready', info } : { s: 'error', message: errorOf(d, 'Link do płatności jest nieprawidłowy albo wygasł.') })
      })
      .catch(() => { if (!ctrl.signal.aborted) setState({ s: 'error', message: 'Brak połączenia ze sklepem. Odśwież stronę.' }) })
    return () => ctrl.abort()
  }, [token])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // 'resume' repeats only the preparation of this saved order: no new order, quote or reservation.
  const act = async (action: Action) => {
    setBusy(action)
    setActionError('')
    try {
      const res = await fetch(action === 'resume' ? '/api/payments/resume' : '/api/payments/test', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'resume' ? { token } : { token, outcome: action }),
        cache: 'no-store', credentials: 'same-origin',
      })
      const d = await res.json().catch(() => null)
      const info = parseInfo(d, token)
      if (info) {
        setState({ s: 'ready', info })
        if (action === 'resume' && info.status === 'pending' && info.payment === 'preparing') setActionError('Operator płatności jeszcze nie odpowiedział. Zamówienie i rezerwacja są zapisane; spróbuj ponownie za chwilę.')
      } else setActionError(errorOf(d, action === 'resume' ? 'Nie udało się przygotować płatności. Spróbuj ponownie.' : 'Sklep nie przyjął wyniku płatności testowej.'))
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
  const offline = info.paymentMethod === 'bank_transfer' || info.paymentMethod === 'cod'
  const shipped = info.orderStatus === 'shipped'
  const pending = info.status === 'pending' && !expired && !shipped
  const statusLabel = expired ? PAYMENT_STATUS.expired
    : shipped && info.status === 'pending' ? 'Nadane testowo — oczekuje na pobranie'
    : offline && info.status === 'pending' ? 'Oczekuje na potwierdzenie obsługi (test)'
    : PAYMENT_STATUS[info.status] || info.status
  return (
    <div className="pay">
      <dl className="pay-dl">
        <div><dt>Zamówienie</dt><dd className="mono">{info.number}</dd></div>
        <div><dt>Kwota</dt><dd className="mono">{formatMoney(info.totalCents, info.currency)}</dd></div>
        {info.paymentSurchargeCents > 0 ? <div><dt>W tym dopłata za pobranie</dt><dd className="mono">{formatMoney(info.paymentSurchargeCents, info.currency)}</dd></div> : null}
        <div><dt>Płatność</dt><dd>{METHOD[info.paymentMethod] || info.paymentMethod}</dd></div>
        {info.deliveryLabel ? <div><dt>Dostawa</dt><dd>{info.deliveryLabel}</dd></div> : null}
        {info.pickupPointName ? <div><dt>Punkt odbioru</dt><dd>{info.pickupPointName}</dd></div> : null}
        <div><dt>Status</dt><dd role="status">{statusLabel}</dd></div>
        {pending && info.expiresAt ? <div><dt>{offline ? 'Rezerwacja do' : 'Link ważny do'}</dt><dd><DateText value={info.expiresAt} format="datetime" /></dd></div> : null}
      </dl>
      {pending && offline ? (
        <>
          {info.paymentMethod === 'bank_transfer' ? (
            <Notice tone="info" title="Przelew testowy">
              <p>Wersja podglądowa nie podaje numeru rachunku. Nie wykonuj przelewu. W prawdziwym sklepie tytułem przelewu byłby numer zamówienia: <span className="mono">{info.number}</span>.</p>
              <p>Status zmieni się dopiero wtedy, gdy obsługa sklepu potwierdzi w panelu symulowany wpływ.</p>
            </Notice>
          ) : (
            <Notice tone="info" title="Płatność przy odbiorze (test)">
              <p>Obsługa oznaczy testowe nadanie, a potem potwierdzi testowe pobranie. Nic nie zostanie wysłane ani pobrane.</p>
            </Notice>
          )}
          <div className="pay-act">
            <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => act('cancelled')}>{busy === 'cancelled' ? 'Zapisywanie…' : 'Anuluj zamówienie'}</button>
          </div>
        </>
      ) : shipped && info.status === 'pending' ? (
        <p>Przesyłka testowa jest oznaczona jako nadana. Anulowanie wymaga kontaktu ze sklepem.</p>
      ) : pending && info.payment === 'review' ? (
        <Notice tone="info" title="Płatność wymaga kontaktu ze sklepem">
          <p>Zamówienie jest zapisane. Obsługa sklepu sprawdzi płatność; nie ponawiaj jej samodzielnie.</p>
        </Notice>
      ) : pending && info.payment === 'preparing' ? (
        <Notice tone="info" title="Płatność jest przygotowywana">
          <p>Zamówienie i rezerwacja są zapisane. Ponowienie dotyczy tego samego zamówienia i nie utworzy drugiego.</p>
          <div className="pay-act">
            <button type="button" className="btn btn-solid" disabled={!!busy} onClick={() => act('resume')}>{busy === 'resume' ? 'Przygotowywanie…' : 'Ponów przygotowanie płatności'}</button>
          </div>
        </Notice>
      ) : pending && info.paymentLink ? (
        <div className="pay-act">
          {/* The operator's sandbox page; the private status link is never passed to it. */}
          <a className="btn btn-solid" href={info.paymentLink} rel="noopener noreferrer" referrerPolicy="no-referrer">Przejdź do płatności testowej operatora</a>
        </div>
      ) : pending && !info.simulation ? (
        <p>Oczekujemy na potwierdzenie operatora płatności. Status odświeży się po ponownym otwarciu tej strony.</p>
      ) : pending ? (
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
