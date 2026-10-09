'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useCart } from './cart'
import { isNavCurrent, SITE_NAV, type NavItem } from './nav'
import { phoneParts } from '@/lib/presentation'

export type { NavItem }
export const DEFAULT_NAV = SITE_NAV

// Focus <main> itself so the next Tab starts inside the content.
const focusMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const main = document.getElementById('tresc') || document.querySelector('main')
  if (!main) return
  e.preventDefault()
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
  main.focus()
  main.scrollIntoView()
}

export function Header({ nav = DEFAULT_NAV, phone }: { nav?: NavItem[]; phone?: string | null } = {}) {
  const { count, ready } = useCart()
  const [open, setOpen] = useState(false)
  const path = usePathname() || '/'
  const toggle = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)

  useEffect(() => setOpen(false), [path])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      toggle.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (!drawer.current?.contains(t) && !toggle.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const items = nav.length ? nav : DEFAULT_NAV
  const hasCount = ready && count > 0
  const cartLabel = hasCount ? `Koszyk, ${count} szt.` : 'Koszyk'

  return (
    <header
      className={'head' + (open ? ' head-open' : '')}
      onBlur={(event) => {
        // This is a navigation disclosure, not a modal. When Tab leaves the header,
        // remove the drawer so it cannot cover the newly focused page control.
        const next = event.relatedTarget
        if (open && next && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <a href="#tresc" className="skip" onClick={focusMain}>Przejdź do treści</a>
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Underwater.pl, strona główna">
          <img src="/img/logo_under.png" alt="" width={34} height={42} />
          <span aria-hidden="true"><b>Underwater.pl</b><small>Centrum nurkowe, Warszawa</small></span>
        </Link>
        <nav className="nav" aria-label="Główna">
          {items.map((i) => {
            const on = isNavCurrent(path, i)
            return <Link key={i.href} href={i.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>{i.label}</Link>
          })}
        </nav>
        <div className="head-act">
          <Link href="/koszyk" className="cart-btn" aria-label={cartLabel} aria-current={path === '/koszyk' ? 'page' : undefined}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 4h2.2l2.3 11.1a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6.4" /><circle cx="9.5" cy="20" r="1.1" /><circle cx="17" cy="20" r="1.1" /></svg>
            <span className="cart-txt">Koszyk</span>
            {hasCount ? <i aria-hidden="true">{count > 99 ? '99+' : count}</i> : null}
          </Link>
          <button
            ref={toggle}
            type="button"
            className="burger"
            aria-expanded={open}
            aria-controls="menu-mobilne"
            aria-label={open ? 'Zamknij menu' : 'Otwórz menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
      {/* Close on any link, including one to the current page (the path does not change then). */}
      <nav ref={drawer} id="menu-mobilne" className="drawer" aria-label="Menu" hidden={!open} onClick={(e) => { if ((e.target as Element).closest('a')) setOpen(false) }}>
        <ul>
          {items.map((i) => {
            const on = isNavCurrent(path, i)
            return <li key={i.href}><Link href={i.href} aria-current={on ? 'page' : undefined}>{i.label}</Link></li>
          })}
          <li><Link href="/koszyk" aria-current={path === '/koszyk' ? 'page' : undefined}>Koszyk{hasCount ? <span className="drawer-n">{count} szt.</span> : null}</Link></li>
          {/* One row per number: each keeps its own text and full-width touch target. */}
          {phoneParts(phone).map((p, n) => <li key={`${p.text}-${n}`}>{p.href ? <a href={p.href} className="drawer-tel">{p.text}</a> : <span className="drawer-tel drawer-txt">{p.text}</span>}</li>)}
        </ul>
      </nav>
    </header>
  )
}
