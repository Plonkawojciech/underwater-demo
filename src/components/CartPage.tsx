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

export function CartPage({ termsHref, privacyHref }: { termsHref?: string; privacyHref?: string }) {
  const { lines, remove, setQty, clear, ready, persisted } = useCart()
  const uid = useId()
  const [method, setMethod] = useState('')
  const [retry, setRetry] = useState(0)
  const [q, setQ] = useState<QuoteState>({ status: 'idle' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ number: string; path: string | null } | null>(null)
  const seq = useRef(0)
  const idem = useRef<{ fp: string; key: string } | null>(null)

  // What the server prices: ids, variant and quantity only. No price leaves the browser.
  const items = useMemo(() => lines.map((l) => ({
    id: l.id, ...(l.variantId ? { variantId: l.variantId } : {}), ...(l.variant ? { variant: l.variant } : {}), qty: l.qty,
  })), [lines])
  const reqKey = stableJson({ items, deliveryMethod: method || undefined })

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
          body: JSON.stringify({ items, ...(method ? { deliveryMethod: method } : {}) }),
          signal: ctrl.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const data = await res.json().catch(() => null)
        if (my !== seq.current) return
        const quote = data?.ok === true ? parseQuote(data.quote) : null
        if (quote) setQ({ status: 'ready', key: reqKey, quote })
        else setQ({ status: 'error', key: reqKey, message: message(data?.message, 'Nie udało się przeliczyć koszyka.') })
      } catch {
        if (ctrl.signal.aborted || my !== seq.current) return
        setQ({ status: 'error', key: reqKey, message: 'Brak połączenia ze sklepem. Sprawdź internet i spróbuj ponownie.' })
      }
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
    // reqKey carries items and method.
  }, [reqKey, ready, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  const quote = q.status === 'ready' && q.key === reqKey ? q.quote : null
  const shown = quote || (q.status === 'loading' ? q.last : undefined)
  // The quote must cover exactly what is in the cart; otherwise the customer would order something else.
  const mismatch = !!quote && (quote.items.length !== lines.length || lines.some((l) => quoteLineFor(quote.items, l)?.qty !== l.qty))
  const canSubmit = !!quote && !mismatch && !sending

  if (done) {
    return (
      <div className="section light"><div className="wrap">
        <div className="done big" role="status">
          <h1 className="h2">Zamówienie testowe {done.number} zapisane</h1>
          {done.path
            ? <><p className="lead lead-tight">Przechodzisz do testowej płatności.</p><Link className="btn btn-solid" href={done.path}>Przejdź do płatności testowej</Link></>
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
    const payload = {
      customerName: field('customerName'), email: field('email'), phone: field('phone'), address: field('address'),
      items, deliveryMethod: quote.deliveryMethod,
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
        setDone({ number: data.number.slice(0, 40), path })
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
          <div><dt>Dostawa</dt><dd>{shown ? formatMoney(shown.deliveryCents, shown.currency) : '…'}</dd></div>
          <div className="sum-total"><dt>Razem</dt><dd>{shown ? formatMoney(shown.totalCents, shown.currency) : '…'}</dd></div>
        </dl>
        <p className="note" role="status">
          {q.status === 'loading' ? 'Przeliczanie cen w sklepie…' : quote ? 'Ceny i dostawa wyliczone przez sklep na podstawie aktualnego katalogu.' : ''}
        </p>
        {q.status === 'error' && q.key === reqKey ? (
          <Notice tone="error" live title="Nie można przeliczyć koszyka">
            <p>{q.message}</p>
            <p><button type="button" className="linkbtn" onClick={() => setRetry((n) => n + 1)}>Spróbuj ponownie</button></p>
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
        {shown && shown.deliveryMethods.length > 0 ? (
          <fieldset className="delivery">
            <legend>Dostawa</legend>
            {shown.deliveryMethods.map((m) => (
              <label key={m.id} className="check">
                <input type="radio" name="delivery" value={m.id} checked={(method || shown.deliveryMethod) === m.id} onChange={() => setMethod(m.id)} />
                <span>{m.label} <span className="mono">{formatMoney(m.priceCents, shown.currency)}</span></span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <h2 className="subh">Dane zamawiającego</h2>
        <label>Imię i nazwisko<input name="customerName" required autoComplete="name" maxLength={120} /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" maxLength={200} /></label>
        <label>Telefon<input name="phone" type="tel" required autoComplete="tel" maxLength={40} /></label>
        <label>Adres dostawy<textarea name="address" rows={3} required autoComplete="street-address" maxLength={500} /></label>
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
