'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useCart } from './cart'

const NAV: [string, string][] = [
  ['Kursy nurkowania', '/kursy-nurkowania.html'],
  ['Sklep', '/sklep-nurkowy.html'],
  ['Kontakt', '/kontakt.html'],
]

export function Header() {
  const { count, ready } = useCart()
  const [open, setOpen] = useState(false)
  const path = usePathname()
  useEffect(() => setOpen(false), [path])
  const active = (h: string) => path === h || (h !== '/' && path.startsWith(h.replace('.html', '')))
  return (
    <>
      <header className="head">
        <div className="wrap">
          <Link href="/" className="brand">
            <img src="/img/logo_under.png" alt="" width={34} height={42} />
            <span><b>Underwater.pl</b><small>Centrum nurkowe · Warszawa</small></span>
          </Link>
          <nav className="nav" aria-label="Główne">
            {NAV.map(([l, h]) => <Link key={h} href={h} className={active(h) ? 'on' : ''}>{l}</Link>)}
          </nav>
          <div className="head-act">
            <Link href="/koszyk" className="cart-btn">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 4h2.2l2.3 11.1a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6.4" /><circle cx="9.5" cy="20" r="1.1" /><circle cx="17" cy="20" r="1.1" /></svg>
              Koszyk{ready && count > 0 ? <i>{count}</i> : null}
            </Link>
            <button className="burger" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>
          </div>
        </div>
      </header>
      <nav className={'drawer' + (open ? ' open' : '')} aria-label="Menu mobilne">
        {NAV.map(([l, h]) => <Link key={h} href={h}>{l}</Link>)}
      </nav>
    </>
  )
}
