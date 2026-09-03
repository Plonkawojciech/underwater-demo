import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { CartProvider } from '@/components/cart'
import { CartButton } from '@/components/CartButton'
import { db } from '@/lib/data'

const display = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], weight: ['700', '800'], variable: '--font-display' })
const body = IBM_Plex_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['500', '600'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'Kursy nurkowania i sklep nurkowy – Underwater.pl', template: '%s – Underwater.pl' },
  description: 'Centrum nurkowe w Warszawie od 1998 roku: kursy PADI, TDI/SDI i IANTD, sklep nurkowy z gwarancją najniższej ceny, wyprawy nurkowe i serwis sprzętu.',
  openGraph: { siteName: 'Underwater.pl', locale: 'pl_PL', type: 'website' },
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

const NAV = [
  ['Kursy nurkowania', '/kursy-nurkowania.html'], ['Sklep nurkowy', '/sklep-nurkowy.html'], ['Wyprawy', '/wyprawy-nurkowe.html'],
  ['Serwis', '/serwis-sprzetu-nurkowego.html'], ['Aktualności', '/aktualnosci.html'], ['O nas', '/centrum-nurkowe.html'], ['Kontakt', '/kontakt.html'],
]

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const payload = await db()
  const s = await payload.findGlobal({ slug: 'settings' })
  return (
    <html lang="pl" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <CartProvider>
          <div className="topbar"><div className="wrap">
            <span className="banner">{s.banner ? <><b>Najbliższy kurs</b> · {s.banner.replace(/^Rozpocznij kurs nurkowania /, '')}</> : 'Centrum nurkowe Underwater.pl · Warszawa'}</span>
            <a href={`tel:${(s.phone || '').replace(/\s/g, '')}`}>{s.phone}</a>
          </div></div>
          <header className="header"><div className="wrap">
            <Link href="/" className="brand"><img src="/img/logo_under.png" alt="" width={40} height={49} /><span>Underwater.pl<small>Centrum nurkowe · Warszawa</small></span></Link>
            <nav className="nav" aria-label="Główne">{NAV.map(([l, h]) => <Link key={h} href={h}>{l}</Link>)}</nav>
            <form className="search" action="/szukaj" role="search"><input name="q" placeholder="Szukaj w sklepie" aria-label="Szukaj w sklepie" /></form>
            <a className="nav-toggle" href="#menu" aria-label="Menu">Menu</a>
            <CartButton />
          </div></header>
          <nav id="menu" className="mnav" aria-label="Menu mobilne">{NAV.map(([l, h]) => <Link key={h} href={h}>{l}</Link>)}</nav>
          <main>{children}</main>
          <footer className="footer"><div className="wrap">
            <div><h4>Underwater.pl</h4><p style={{ whiteSpace: 'pre-line', margin: 0 }}>{s.address}</p><p style={{ margin: '8px 0 0' }}>NIP {s.nip}<br />tel. <a href={`tel:${(s.phone || '').replace(/\s/g, '')}`}>{s.phone}</a><br /><a href={`mailto:${s.email}`}>{s.email}</a></p></div>
            <div><h4>Szkolenia</h4><ul><li><Link href="/kursy-nurkowania.html">Kursy nurkowania</Link></li><li><Link href="/kursy-nurkowania/padi-open-water-diver.html">PADI Open Water Diver</Link></li><li><Link href="/wyprawy-nurkowe.html">Wyprawy nurkowe</Link></li></ul></div>
            <div><h4>Sklep</h4><ul><li><Link href="/sklep-nurkowy.html">Wszystkie kategorie</Link></li><li><Link href="/122-wyprzedaz.html">Wyprzedaż</Link></li><li><Link href="/regulamin-sklepu.html">Regulamin sklepu</Link></li><li><Link href="/koszyk">Koszyk</Link></li></ul></div>
            <div><h4>Firma</h4><ul><li><Link href="/centrum-nurkowe.html">O nas</Link></li><li><Link href="/serwis-sprzetu-nurkowego.html">Serwis sprzętu</Link></li><li><Link href="/kontakt.html">Kontakt</Link></li>{s.facebook && <li><a href={s.facebook} rel="noopener">Facebook</a></li>}{s.youtube && <li><a href={s.youtube} rel="noopener">YouTube</a></li>}</ul></div>
            <div className="copy"><span>© 1998–{new Date().getFullYear()} Underwater.pl</span><span>Demo nowej strony · Programo s.j.</span></div>
          </div></footer>
        </CartProvider>
      </body>
    </html>
  )
}
