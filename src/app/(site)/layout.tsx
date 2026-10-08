import type { Metadata } from 'next'
import { Newsreader, Archivo, IBM_Plex_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { CartProvider } from '@/components/cart'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { SITE_NAV } from '@/components/nav'
import { DateText } from '@/components/content'
import { courseHref, telHref, type CourseDoc, type SessionDoc } from '@/lib/presentation'
import { getLegalLinks, getSettings, isPreview, nowISO, publicFind, siteOrigin } from '@/views/query'

const display = Newsreader({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], style: ['normal', 'italic'], variable: '--font-display' })
const body = Archivo({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-mono' })

export async function generateMetadata(): Promise<Metadata> {
  const origin = siteOrigin()
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: 'Underwater.pl — centrum nurkowe w Warszawie', template: '%s — Underwater.pl' },
    description: 'Centrum nurkowe w Warszawie: kursy nurkowania, sklep nurkowy, wyprawy i kalendarz terminów.',
    openGraph: { siteName: 'Underwater.pl', locale: 'pl_PL', type: 'website' },
    // Every environment today is a preview: never indexed, whatever robots.txt says.
    robots: isPreview() ? { index: false, follow: false, nocache: true } : undefined,
  }
}
export const dynamic = 'force-dynamic'

/** The soonest published course session, for the line above the header. */
async function nearestSession() {
  const r = await publicFind<SessionDoc>('course-sessions', {
    where: { startsAt: { greater_than_equal: nowISO() } }, limit: 1, depth: 1, sort: 'startsAt',
  })
  return r.docs[0] ?? null
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [s, legal, next] = await Promise.all([getSettings(), getLegalLinks(), nearestSession()])
  const preview = isPreview()
  const tel = telHref(s.phone)
  const course = next && typeof next.course === 'object' ? (next.course as CourseDoc) : null
  return (
    <html lang="pl" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <CartProvider>
          {next || s.phone ? (
            <div className="topline"><div className="wrap">
              {next
                ? <span>
                    <b>Najbliższy kurs</b>{' '}
                    {course ? <Link href={courseHref(course.slug)}>{course.name}, <DateText value={next.startsAt} format="short" /></Link> : <>{next.title}, <DateText value={next.startsAt} format="short" /></>}
                  </span>
                : <span />}
              {s.phone ? (tel ? <a href={tel}>{s.phone}</a> : <span>{s.phone}</span>) : null}
            </div></div>
          ) : null}
          <Header nav={SITE_NAV} phone={s.phone} />
          <main id="tresc" tabIndex={-1}>{children}</main>
          <Footer s={s} nav={SITE_NAV} legal={legal} preview={preview} />
          {preview ? <p className="preview-badge" title="Wersja podglądowa: zamówienia i płatności są testowe, strona nie jest indeksowana">Wersja podglądowa</p> : null}
        </CartProvider>
      </body>
    </html>
  )
}
