import type { Metadata } from 'next'
import { Newsreader, Archivo, IBM_Plex_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { CartProvider } from '@/components/cart'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { SITE_NAV } from '@/components/nav'
import { DateText } from '@/components/content'
import { PhoneLinks } from '@/components/Phone'
import { JsonLd } from '@/components/content'
import { organizationSchema } from '@/lib/seo'
import { AnalyticsPreview } from '@/components/AnalyticsPreview'
import { courseHref, type CourseDoc, type SessionDoc } from '@/lib/presentation'
import { getLegalLinks, getSettings, isPreview, nowISO, publicFind, siteOrigin } from '@/views/query'

// CSS discovers the used faces without spending the image's critical bandwidth on
// unused weights/subsets. Latin-ext stays available for Polish names and content.
const display = Newsreader({ subsets: ['latin', 'latin-ext'], weight: ['400'], style: ['normal'], preload: false, variable: '--font-display' })
const body = Archivo({ subsets: ['latin', 'latin-ext'], preload: false, variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], preload: false, adjustFontFallback: false, fallback: ['Courier New', 'monospace'], variable: '--font-mono' })

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
  // Plain text from settings, shown as written; nothing is shown when the field is empty.
  const banner = s.banner?.replace(/\s+/g, ' ').trim()
  const course = next && typeof next.course === 'object' ? (next.course as CourseDoc) : null
  const organization = organizationSchema(s, siteOrigin())
  return (
    <html lang="pl" data-scroll-behavior="smooth" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {organization ? <JsonLd data={organization} /> : null}
        <CartProvider>
          {preview ? <AnalyticsPreview /> : null}
          {banner ? <div className="site-banner" role="region" aria-label="Komunikat"><p className="wrap">{banner}</p></div> : null}
          {next || s.phone?.trim() ? (
            <div className="topline"><div className="wrap">
              {next
                ? <span>
                    <b>Najbliższy kurs</b>{' '}
                    {course ? <Link href={courseHref(course.slug)}>{course.name}, <DateText value={next.startsAt} format="short" /></Link> : <>{next.title}, <DateText value={next.startsAt} format="short" /></>}
                  </span>
                : <span />}
              {s.phone?.trim() ? <span className="topline-tel"><PhoneLinks value={s.phone} /></span> : null}
            </div></div>
          ) : null}
          <Header nav={SITE_NAV} phone={s.phone} />
          <div id="privacy-notice" />
          <main id="tresc" tabIndex={-1}>{children}</main>
          <Footer s={s} nav={SITE_NAV} legal={legal} preview={preview} />
          {preview ? <p className="preview-badge" title="Wersja podglądowa: zamówienia i płatności są testowe, strona nie jest indeksowana">Wersja podglądowa</p> : null}
        </CartProvider>
      </body>
    </html>
  )
}
