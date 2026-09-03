'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { lineKey, useCart } from './cart'
import { createOrder, type FormState } from '@/lib/actions'

const zl = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' zł'

export function CartPage() {
  const { lines, remove, setQty, total, clear, ready } = useCart()
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => { const r = await createOrder(prev, form); if (r.ok) clear(); return r }, { ok: false, message: '' })
  if (state.ok) return (
    <div className="wrap section">
      <div className="form-done big"><h1 className="h2">Zamówienie {state.number} przyjęte</h1><p>Potwierdzenie wysłaliśmy e-mailem. W wersji produkcyjnej w tym miejscu następuje płatność Przelewy24 lub BLIK.</p><Link className="btn" href="/sklep-nurkowy.html">Wróć do sklepu</Link></div>
    </div>
  )
  if (!ready) return <div className="wrap section" />
  if (!lines.length) return (
    <div className="wrap section">
      <h1 className="h1">Koszyk</h1>
      <p className="empty">Koszyk jest pusty. <Link href="/sklep-nurkowy.html">Przejdź do sklepu</Link> albo zobacz <Link href="/122-wyprzedaz.html">wyprzedaż</Link>.</p>
    </div>
  )
  return (
    <div className="wrap section cart-grid">
      <div>
        <h1 className="h1">Koszyk</h1>
        <ul className="cart-lines">
          {lines.map((l) => (
            <li key={lineKey(l)} className="cart-line">
              {l.image ? <img src={l.image} alt="" /> : <span className="cart-noimg" />}
              <div>
                <Link href={`/${l.slug}.html`} className="cart-name">{l.name}</Link>
                {l.variant && <div className="muted">{l.variant}</div>}
                <div className="mono">{zl(l.price)}</div>
              </div>
              <div className="qty"><button type="button" onClick={() => setQty(lineKey(l), l.qty - 1)} aria-label="Mniej">−</button><output>{l.qty}</output><button type="button" onClick={() => setQty(lineKey(l), l.qty + 1)} aria-label="Więcej">+</button></div>
              <div className="mono cart-sum">{zl(l.price * l.qty)}</div>
              <button type="button" className="link-btn" onClick={() => remove(lineKey(l))}>Usuń</button>
            </li>
          ))}
        </ul>
        <div className="cart-total"><span>Razem</span><span className="mono">{zl(total)}</span></div>
      </div>
      <form action={action} className="form checkout">
        <h2 className="h3">Dane do wysyłki</h2>
        <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ id: l.id, variant: l.variant, qty: l.qty, price: l.price })))} />
        <label>Imię i nazwisko<input name="name" required autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Telefon<input name="phone" type="tel" autoComplete="tel" /></label>
        <label>Adres dostawy<textarea name="address" rows={3} required autoComplete="street-address" /></label>
        <div className="pay-note"><span className="mono">Płatność</span> Przelewy24, BLIK, karta lub odbiór osobisty w Warszawie</div>
        {state.message && !state.ok && <p className="form-err">{state.message}</p>}
        <button className="btn btn-accent" disabled={pending}>{pending ? 'Przetwarzanie…' : 'Zamawiam'}</button>
      </form>
    </div>
  )
}
