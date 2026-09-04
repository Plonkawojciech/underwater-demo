'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { lineKey, useCart } from './cart'
import { createOrder, type FormState } from '@/lib/actions'

const zl = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' zł'

export function CartPage() {
  const { lines, remove, setQty, total, clear, ready } = useCart()
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const r = await createOrder(prev, form)
    if (r.ok) clear()
    return r
  }, { ok: false, message: '' })

  if (state.ok) return (
    <div className="section light"><div className="wrap">
      <div className="done big">
        <p className="kicker" style={{ margin: 0 }}>Zamówienie {state.number}</p>
        <h1 className="h2">Dziękujemy, przyjęliśmy zamówienie</h1>
        <p className="lead" style={{ marginTop: 0 }}>Potwierdzenie poszło e-mailem. W wersji produkcyjnej w tym miejscu następuje płatność Przelewy24 albo BLIK.</p>
        <Link className="btn btn-solid" href="/sklep-nurkowy.html">Wróć do sklepu <span className="arrow">→</span></Link>
      </div>
    </div></div>
  )
  if (!ready) return <div className="section light" />
  if (!lines.length) return (
    <div className="section light"><div className="wrap">
      <h1 className="h2">Koszyk</h1>
      <p className="lead">Koszyk jest pusty.</p>
      <div className="hero-cta"><Link className="btn btn-solid" href="/sklep-nurkowy.html">Przejdź do sklepu <span className="arrow">→</span></Link></div>
    </div></div>
  )
  return (
    <div className="section light"><div className="wrap cart">
      <div>
        <h1 className="h2">Koszyk</h1>
        <ul className="lines">
          {lines.map((l) => (
            <li key={lineKey(l)} className="line">
              {l.image ? <img src={l.image} alt="" /> : <span />}
              <div>
                <Link href={`/${l.slug}.html`} className="nm">{l.name}</Link>
                {l.variant && <div className="vr">{l.variant}</div>}
                <div className="qty">
                  <button type="button" onClick={() => setQty(lineKey(l), l.qty - 1)} aria-label="Mniej">−</button>
                  <output>{l.qty}</output>
                  <button type="button" onClick={() => setQty(lineKey(l), l.qty + 1)} aria-label="Więcej">+</button>
                </div>
                <button type="button" className="rm" onClick={() => remove(lineKey(l))}>Usuń</button>
              </div>
              <div className="amt">{zl(l.price * l.qty)}</div>
            </li>
          ))}
        </ul>
        <div className="total"><span className="mono">Razem</span><b>{zl(total)}</b></div>
      </div>
      <form action={action} className="form checkout">
        <p className="subh" style={{ marginTop: 0 }}>Dane do wysyłki</p>
        <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ id: l.id, variant: l.variant, qty: l.qty, price: l.price })))} />
        <label>Imię i nazwisko<input name="name" required autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Telefon<input name="phone" type="tel" autoComplete="tel" /></label>
        <label>Adres dostawy<textarea name="address" rows={3} required autoComplete="street-address" /></label>
        <p className="note" style={{ margin: 0 }}>Płatność: Przelewy24, BLIK, karta albo odbiór osobisty na Okopowej.</p>
        {state.message && !state.ok && <p className="form-err">{state.message}</p>}
        <button className="btn btn-solid" disabled={pending}>{pending ? 'Przetwarzanie…' : 'Zamawiam'} <span className="arrow">→</span></button>
      </form>
    </div></div>
  )
}
