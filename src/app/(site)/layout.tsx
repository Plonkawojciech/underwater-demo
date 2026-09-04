import type { Metadata } from 'next'
import { Newsreader, Archivo, IBM_Plex_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { CartProvider } from '@/components/cart'
import { Header } from '@/components/Header'
import { db } from '@/lib/data'

const display = Newsreader({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], style: ['normal', 'italic'], variable: '--font-display' })
const body = Archivo({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'Underwater.pl — centrum nurkowe w Warszawie', template: '%s — Underwater.pl' },
  description: 'Kursy nurkowania PADI, TDI/SDI i IANTD w Warszawie, sklep nurkowy z gwarancją najniższej ceny, wyprawy i autoryzowany serwis sprzętu. Szkolimy od 1998 roku.',
  openGraph: { siteName: 'Underwater.pl', locale: 'pl_PL', type: 'website' },
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const payload = await db()
  const s = await payload.findGlobal({ slug: 'settings' })
  const tel = (s.phone || '').replace(/\s/g, '')
  return (
    <html lang="pl" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <CartProvider>
          <div className="topline"><div className="wrap">
            <span><b>Najbliższy kurs</b> · {(s.banner || '').replace(/^Najbliższy kurs OWD: /, '')}</span>
            <a href={`tel:${tel}`}>{s.phone}</a>
          </div></div>
          <Header />
          <main>{children}</main>
          <footer className="foot"><div className="wrap">
            <div>
              <h4>Underwater.pl</h4>
              <p className="fb">Centrum nurkowe na warszawskiej Woli. Szkolimy, sprzedajemy sprzęt, serwisujemy go i zabieramy ludzi na wyprawy — od 1998 roku.</p>
              <p style={{ margin: '18px 0 0' }} className="mono">{(s.address || '').split('\n').map((l) => <span key={l} style={{ display: 'block' }}>{l}</span>)}</p>
            </div>
            <div><h4>Nawigacja</h4><ul>
              <li><Link href="/kursy-nurkowania.html">Kursy nurkowania</Link></li>
              <li><Link href="/sklep-nurkowy.html">Sklep nurkowy</Link></li>
              <li><Link href="/kontakt.html">Kontakt</Link></li>
              <li><Link href="/koszyk">Koszyk</Link></li>
            </ul></div>
            <div><h4>Kontakt</h4><ul>
              <li><a href={`tel:${tel}`}>{s.phone}</a></li>
              <li><a href={`mailto:${s.email}`}>{s.email}</a></li>
              {s.facebook && <li><a href={s.facebook} rel="noopener">Facebook</a></li>}
              {s.youtube && <li><a href={s.youtube} rel="noopener">YouTube</a></li>}
            </ul></div>
            <div className="cr"><span>© 1998–{new Date().getFullYear()} Underwater.pl</span><span>Demo nowej strony · Programo s.j.</span></div>
          </div></footer>
        </CartProvider>
      </body>
    </html>
  )
}
