'use client'
import Link from 'next/link'
import { useCart } from './cart'

export function CartButton() {
  const { count, ready } = useCart()
  return (
    <Link href="/koszyk" className="cart-btn" aria-label="Koszyk">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.5" /><circle cx="9.5" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></svg>
      <span>Koszyk</span>
      {ready && count > 0 && <b className="cart-count">{count}</b>}
    </Link>
  )
}
