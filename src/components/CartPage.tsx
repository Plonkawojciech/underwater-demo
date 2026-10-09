'use client'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import {
  fingerprint, formatMoney, parseQuote, productHref, quoteLineFor, safePaymentPath, stableJson, type Quote,
} from '@/lib/presentation'
import { lineKey, useCart } from './cart'
import { Notice } from './content/States'
import { Honeypot } from './FormBits'

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading'; key: string; last?: Quote }
  | { status: 'ready'; key: string; quote: Quote }
  | { status: 'error'; key: string; message: string }

const KEY_STORE = 'uw-checkout-key'

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * One idempotency key per checkout payload: a retry of the same order reuses it (also after
 * a reload in this tab); any change to items, delivery or customer data starts a new one.
 * Only a hash of the payload is stored, never the form data itself.
 */
function keyFor(fp: string, mem: { current: { fp: string; key: string } | null }): string {
  try {
    const raw = sessionStorage.getItem(KEY_STORE)
    const saved = raw ? JSON.parse(raw) : null
    if (saved && saved.fp === fp && typeof saved.key === 'string') return saved.key
  } catch { /* fall back to memory */ }
  if (mem.current?.fp === fp) return mem.current.key
  const next = { fp, key: uuid() }
  mem.current = next
  try { sessionStorage.setItem(KEY_STORE, JSON.stringify(next)) } catch { /* memory only */ }
  return next.key
}
function forgetKey(mem: { current: unknown }) {
  mem.current = null
  try { sessionStorage.removeItem(KEY_STORE) } catch { /* nothing stored */ }
}

const message = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : fallback)

type PaymentOption = { id: string; label: string; offline: boolean; surchargeCents: number }
type CheckoutMeta = {
  paymentMethods: PaymentOption[]; paymentMethod: string; methodPayments: Record<string, string[]>
  paymentSurchargeCents: number; freeShippingApplied: boolean; freeShippingThresholdCents: number | null
  addressRequired: boolean; pickupPointRequired: boolean; offlineReservationMinutes: number | null
}
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
/**
 * Payment and delivery metadata from the server quote. A response without it (an older
 * server) falls back to the former behaviour: online payment and a required address.
 */
function checkoutMeta(q: Quote): CheckoutMeta {
  const r = q as unknown as Record<string, unknown>
  const payments = Array.isArray(r.paymentMethods) ? r.paymentMethods.filter((p): p is PaymentOption =>
    !!p && typeof p === 'object' && str((p as PaymentOption).id, 40) && str((p as PaymentOption).label) && int((p as PaymentOption).surchargeCents)) : []
  const methodPayments: Record<string, string[]> = {}
  for (const m of q.deliveryMethods as Array<{ id: string; paymentMethods?: unknown }>) {
    methodPayments[m.id] = Array.isArray(m.paymentMethods) ? m.paymentMethods.filter((id): id is string => str(id, 40)) : ['online']
  }
  return {
    paymentMethods: payments.length ? payments : [{ id: 'online', label: 'Płatność online (symulacja testowa)', offline: false, surchargeCents: 0 }],
    paymentMethod: str(r.paymentMethod, 40) ? r.paymentMethod : 'online',
    methodPayments,
    paymentSurchargeCents: int(r.paymentSurchargeCents) ? r.paymentSurchargeCents : 0,
    freeShippingApplied: r.freeShippingApplied === true,
    freeShippingThresholdCents: int(r.freeShippingThresholdCents) ? r.freeShippingThresholdCents : null,
    addressRequired: r.addressRequired !== false,
    pickupPointRequired: r.pickupPointRequired === true,
    offlineReservationMinutes: int(r.offlineReservationMinutes) ? r.offlineReservationMinutes : null,
  }
}
const duration = (minutes: number) => minutes % 60 === 0 ? `${minutes / 60} godz.` : `${minutes} min.`

export function CartPage({ termsHref, privacyHref }: { termsHref?: string; privacyHref?: string }) {
  const { lines, remove, setQty, clear, ready, persisted } = useCart()
  const uid = useId()
  const [method, setMethod] = useState('')
  const [payment, setPayment] = useState('')
  // Last accepted quote keeps the choices visible when a changed selection is refused.
  const [lastGood, setLastGood] = useState<Quote | null>(null)
  const [retry, setRetry] = useState(0)
  const [q, setQ] = useState<QuoteState>({ status: 'idle' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ number: string; path: string | null; offline: boolean } | null>(null)
  const seq = useRef(0)
  const idem = useRef<{ fp: string; key: string } | null>(null)

  // What the server prices: ids, variant and quantity only. No price leaves the browser.
  const items = useMemo(() => lines.map((l) => ({
    id: l.id, ...(l.variantId ? { variantId: l.variantId } : {}), ...(l.variant ? { variant: l.variant } : {}), qty: l.qty,
  })), [lines])
  const reqKey = stableJson({ items, deliveryMethod: method || undefined, paymentMethod: payment || undefined })

  useEffect(() => {
    if (!ready || !items.length) { setQ({ status: 'idle' }); return }
    const my = ++seq.current
    const ctrl = new AbortController()
    setQ((prev) => ({ status: 'loading', key: reqKey, last: prev.status === 'ready' ? prev.quote : prev.status === 'loading' ? prev.last : undefined }))
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/store/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items, ...(method ? { deliveryMethod: method } : {}), ...(payment ? { paymentMethod: payment } : {}) }),
          signal: ctrl.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const data = await res.json().catch(() => null)
        if (my !== seq.current) return
        const quote = data?.ok === true ? parseQuote(data.quote) : null
        if (quote) { setQ({ status: 'ready', key: reqKey, quote }); setLastGood(quote) }
        else setQ({ status: 'error', key: reqKey, message: message(data?.message, 'Nie udało się przeliczyć koszyka.') })
      } catch {
        if (ctrl.signal.aborted || my !== seq.current) return
        setQ({ status: 'error', key: reqKey, message: 'Brak połączenia ze sklepem. Sprawdź internet i spróbuj ponownie.' })
      }
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
    // reqKey carries items, delivery and payment.
  }, [reqKey, ready, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  const quote = q.status === 'ready' && q.key === reqKey ? q.quote : null
  const shown = quote || (q.status === 'loading' ? q.last : undefined)
  // The quote must cover exactly what is in the cart; otherwise the customer would order something else.
  const mismatch = !!quote && (quote.items.length !== lines.length || lines.some((l) => quoteLineFor(quote.items, l)?.qty !== l.qty))
  const canSubmit = !!quote && !mismatch && !sending
  const options = quote || shown || lastGood
  const meta = options ? checkoutMeta(options) : null
  const totals = shown ? checkoutMeta(shown) : null
  const chosen = quote ? checkoutMeta(quote) : null
  const offline = !!chosen?.paymentMethods.find((p) => p.id === chosen.paymentMethod)?.offline

  if (done) {
    return (
      <div className="section light"><div className="wrap">
        <div className="done big" role="status">
          <h1 className="h2">Zamówienie testowe {done.number} zapisane</h1>
          {done.path
            ? <><p className="lead lead-tight">{done.offline ? 'Przechodzisz do statusu zamówienia i instrukcji płatności testowej.' : 'Przechodzisz do testowej płatności.'}</p><Link className="btn btn-solid" href={done.path}>{done.offline ? 'Przejdź do statusu zamówienia' : 'Przejdź do płatności testowej'}</Link></>
            : <p className="lead lead-tight">Sklep nie zwrócił prawidłowego adresu płatności testowej. Zachowaj numer zamówienia i skontaktuj się ze sklepem.</p>}
        </div>
      </div></div>
    )
  }
  if (!ready) return <div className="section light" aria-busy="true"><div className="wrap"><h1 className="h2">Koszyk</h1></div></div>
  if (!lines.length) {
    return (
      <div className="section light"><div className="wrap">
        <h1 className="h2">Koszyk</h1>
        <p className="lead">Koszyk jest pusty.</p>
        <div className="hero-cta"><Link className="btn btn-solid" href="/sklep-nurkowy.html">Przejdź do sklepu</Link></div>
      </div></div>
    )
  }

  const onSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!quote || mismatch || sending) return
    const fd = new FormData(e.currentTarget)
    const field = (n: string) => String(fd.get(n) || '').trim()
    const selected = checkoutMeta(quote)
    const payload = {
      customerName: field('customerName'), email: field('email'), phone: field('phone'), address: field('address'),
      items, deliveryMethod: quote.deliveryMethod, paymentMethod: selected.paymentMethod,
      ...(selected.pickupPointRequired ? { pickupPoint: { id: field('pickupPointId'), name: field('pickupPointName'), address: field('pickupPointAddress') } } : {}),
      privacyAccepted: fd.get('privacyAccepted') === 'true', termsAccepted: fd.get('termsAccepted') === 'true',
      website: String(fd.get('website') || ''),
    }
    if (!payload.privacyAccepted || !payload.termsAccepted) { setError('Zaznacz wymagane zgody.'); return }
    const idempotencyKey = keyFor(fingerprint(payload), idem)
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey, ...payload, expectedTotalCents: quote.totalCents, privacyAccepted: true, termsAccepted: true }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => null)
      if (data?.ok === true && typeof data.number === 'string') {
        // Accepted: the order exists on the server, so the browser cart can go.
        const path = safePaymentPath(data.paymentURL, window.location.origin)
        forgetKey(idem)
        clear()
        setDone({ number: data.number.slice(0, 40), path, offline })
        if (path) window.location.assign(path)
        return
      }
      // A rejected conflict cannot accept this key again (for example a closed
      // order). Keep the items, but issue a new key on the next explicit submit.
      if (res.status === 409) forgetKey(idem)
      // Network failures retain the original key, so a lost response is safe.
      setError(message(data?.message, 'Sklep nie przyjął zamówienia. Sprawdź dane i spróbuj ponownie.'))
      setRetry((n) => n + 1)
    } catch {
      setError('Brak połączenia ze sklepem. Koszyk został zachowany; ponowne wysłanie tego samego zamówienia nie utworzy drugiego.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="section light"><div className="wrap cart">
      <div>
        <h1 className="h2">Koszyk</h1>
        {!persisted ? <Notice tone="info">Ta przeglądarka nie zapisuje koszyka. Po zamknięciu karty jego zawartość zniknie.</Notice> : null}
        <ul className="lines">
          {lines.map((l) => {
            const k = lineKey(l)
            const ql = shown ? quoteLineFor(shown.items, l) : undefined
            const atMax = l.qty >= (l.maxQty ?? 99)
            return (
              <li key={k} className="line">
                {l.image ? <img src={l.image} alt="" /> : <span className="line-ph" />}
                <div>
                  <Link href={productHref(l.slug)} className="nm">{l.name}</Link>
                  {l.variant ? <div className="vr">{l.variant}</div> : null}
                  {quote && ql && ql.qty !== l.qty ? <p className="form-err">Sklep może przyjąć {ql.qty} szt. Zmień ilość.</p> : null}
                  {quote && !ql ? <p className="form-err">Tego produktu nie można teraz zamówić. Usuń go z koszyka.</p> : null}
                  <div className="qty" role="group" aria-label={`Ilość: ${l.name}`}>
                    <button type="button" onClick={() => setQty(k, l.qty - 1)} disabled={l.qty <= 1} aria-label="Zmniejsz ilość">−</button>
                    <output aria-live="polite">{l.qty}</output>
                    <button type="button" onClick={() => setQty(k, l.qty + 1)} disabled={atMax} aria-label="Zwiększ ilość">+</button>
                  </div>
                  <button type="button" className="rm" onClick={() => remove(k)}>Usuń<span className="sr-only"> {l.name}</span></button>
                </div>
                <div className="amt">{ql ? formatMoney(ql.lineTotalCents, shown?.currency) : <span className="muted" aria-label="Przeliczanie">…</span>}</div>
              </li>
            )
          })}
        </ul>
        <dl className="sum" aria-busy={q.status === 'loading'}>
          <div><dt>Produkty</dt><dd>{shown ? formatMoney(shown.subtotalCents, shown.currency) : '…'}</dd></div>
          <div><dt>Dostawa{totals?.freeShippingApplied ? ' (darmowa od progu)' : ''}</dt><dd>{shown ? formatMoney(shown.deliveryCents, shown.currency) : '…'}</dd></div>
          {shown && totals && totals.paymentSurchargeCents > 0 ? <div><dt>Dopłata za pobranie</dt><dd>{formatMoney(totals.paymentSurchargeCents, shown.currency)}</dd></div> : null}
          <div className="sum-total"><dt>Razem</dt><dd>{shown ? formatMoney(shown.totalCents, shown.currency) : '…'}</dd></div>
        </dl>
        <p className="note" role="status">
          {q.status === 'loading' ? 'Przeliczanie cen w sklepie…' : quote ? 'Ceny, dostawa i dopłaty wyliczone przez sklep na podstawie aktualnego katalogu.' : ''}
        </p>
        {quote && totals?.freeShippingThresholdCents != null && !totals.freeShippingApplied
          ? <p className="note">Darmowa dostawa od {formatMoney(totals.freeShippingThresholdCents, quote.currency)} wartości produktów.</p> : null}
        {q.status === 'error' && q.key === reqKey ? (
          <Notice tone="error" live title="Nie można przeliczyć koszyka">
            <p>{q.message}</p>
            <p><button type="button" className="linkbtn" onClick={() => { setMethod(''); setPayment(''); setRetry((n) => n + 1) }}>Spróbuj ponownie</button></p>
          </Notice>
        ) : null}
        {mismatch ? <Notice tone="warning" live>Koszyk różni się od tego, co sklep może przyjąć. Popraw zaznaczone pozycje.</Notice> : null}
      </div>

      <form onSubmit={onSubmit} className="form checkout" aria-describedby={`${uid}-test`}>
        <div id={`${uid}-test`}>
          <Notice tone="warning" title="Zamówienie testowe">
            To sklep w wersji podglądowej. Zamówienie zostanie zapisane jako testowe, płatność jest symulowana. Nic nie zostanie pobrane ani wysłane.
          </Notice>
        </div>
        {options && meta && options.deliveryMethods.length > 0 ? (
          <fieldset className="delivery">
            <legend>Dostawa</legend>
            {options.deliveryMethods.map((m) => (
              <label key={m.id} className="check">
                <input type="radio" name="delivery" value={m.id} checked={(method || options.deliveryMethod) === m.id} onChange={() => {
                  setMethod(m.id)
                  // Keep the payment only where the server allows it for the new delivery.
                  if (payment && !(meta.methodPayments[m.id] || []).includes(payment)) setPayment('')
                }} />
                <span>{m.label} <span className="mono">{formatMoney(m.priceCents, options.currency)}</span></span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {meta?.pickupPointRequired ? (
          <fieldset className="delivery">
            <legend>Punkt odbioru</legend>
            <Notice tone="info">Wersja testowa nie łączy się z mapą ani systemem przewoźnika. Wpisz punkt ręcznie; sklep nie sprawdza, czy taki punkt istnieje.</Notice>
            <label>Kod punktu<input name="pickupPointId" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" autoComplete="off" spellCheck={false} /></label>
            <label>Nazwa punktu<input name="pickupPointName" required maxLength={120} autoComplete="off" /></label>
            <label>Adres punktu<input name="pickupPointAddress" required maxLength={300} autoComplete="off" /></label>
          </fieldset>
        ) : null}
        {options && meta ? (
          <fieldset className="delivery">
            <legend>Płatność</legend>
            {meta.paymentMethods.map((p) => (
              <label key={p.id} className="check">
                <input type="radio" name="payment" value={p.id} checked={(payment || meta.paymentMethod) === p.id} onChange={() => setPayment(p.id)} />
                <span>{p.label}{p.surchargeCents > 0 ? <span className="mono">+{formatMoney(p.surchargeCents, options.currency)}</span> : null}</span>
              </label>
            ))}
            {(payment || meta.paymentMethod) === 'bank_transfer' ? (
              <p className="note note-first">Po złożeniu zamówienia zobaczysz instrukcję przelewu testowego. Wersja podglądowa nie podaje numeru rachunku — nie wykonuj przelewu.{meta.offlineReservationMinutes ? ` Towar pozostaje zarezerwowany przez ${duration(meta.offlineReservationMinutes)}` : ''}</p>
            ) : (payment || meta.paymentMethod) === 'cod' ? (
              <p className="note note-first">Zapłata przy odbiorze (symulacja). Przesyłka nie zostanie nadana.{meta.offlineReservationMinutes ? ` Towar pozostaje zarezerwowany przez ${duration(meta.offlineReservationMinutes)} do testowego nadania.` : ''}</p>
            ) : null}
          </fieldset>
        ) : null}
        <h2 className="subh">Dane zamawiającego</h2>
        <label>Imię i nazwisko<input name="customerName" required autoComplete="name" maxLength={120} /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" maxLength={200} /></label>
        <label>Telefon<input name="phone" type="tel" required autoComplete="tel" maxLength={40} /></label>
        <label>{meta && !meta.addressRequired ? 'Adres (opcjonalnie)' : 'Adres dostawy'}<textarea name="address" rows={3} required={!meta || meta.addressRequired} autoComplete="street-address" maxLength={500} /></label>
        <label className="check">
          <input type="checkbox" name="termsAccepted" value="true" required />
          <span>Akceptuję regulamin sklepu. {termsHref ? <Link href={termsHref} className="textlink">Regulamin</Link> : <span className="muted">Regulamin nie jest jeszcze opublikowany w tej wersji podglądowej.</span>}</span>
        </label>
        <label className="check">
          <input type="checkbox" name="privacyAccepted" value="true" required />
          <span>Zgadzam się na przetwarzanie danych w celu realizacji zamówienia. {privacyHref ? <Link href={privacyHref} className="textlink">Polityka prywatności</Link> : <span className="muted">Polityka prywatności nie jest jeszcze opublikowana w tej wersji podglądowej.</span>}</span>
        </label>
        <Honeypot />
        <p className="form-err" role="alert">{error}</p>
        <button className="btn btn-solid" disabled={!canSubmit} aria-describedby={!quote ? `${uid}-wait` : undefined}>
          {sending ? 'Zapisywanie zamówienia…' : 'Złóż zamówienie testowe'}
        </button>
        {!quote ? <p id={`${uid}-wait`} className="note note-first">Przycisk będzie aktywny po przeliczeniu koszyka przez sklep.</p> : null}
      </form>
    </div></div>
  )
}
