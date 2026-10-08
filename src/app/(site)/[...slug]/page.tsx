import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { firstParam, parseMonth, parsePage, searchQuery } from '@/lib/presentation'
import { resolveRoute, type FixedRoute } from '@/views/resolve'
import { resolvedMeta } from '@/views/meta'
import { ShopIndex, CategoryPage, ProductPage } from '@/views/shop'
import { CoursesIndex, CoursePage } from '@/views/training'
import { ArticleIndex, ArticlePage, AlbumPage, AlbumsIndex, CalendarPage, EventPage, TripPage, TripsIndex } from '@/views/content'
import { ContactPage } from '@/views/pages'
import { RichBody } from '@/components/content'

type Props = {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await resolveRoute((await params).slug.join('/'))
  return r ? resolvedMeta(r) : { title: 'Nie znaleziono strony', robots: { index: false, follow: false } }
}

function fixedView(route: FixedRoute, page: number, q: Record<string, string | string[] | undefined>) {
  switch (route) {
    case 'shop': return <ShopIndex page={page} q={searchQuery(q.q)} />
    case 'courses': return <CoursesIndex page={page} org={firstParam(q.org)} />
    case 'contact': return <ContactPage />
    case 'trips': return <TripsIndex page={page} past={firstParam(q.widok) === 'minione'} />
    case 'calendar': return <CalendarPage page={page} month={parseMonth(q.miesiac)} />
    case 'news': return <ArticleIndex kind="news" page={page} />
    case 'reports': return <ArticleIndex kind="report" page={page} />
    case 'albums': return <AlbumsIndex page={page} />
  }
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, q] = await Promise.all([params, searchParams])
  const r = await resolveRoute(slug.join('/'))
  if (!r) notFound()
  const page = parsePage(q.strona)
  switch (r.kind) {
    case 'redirect': permanentRedirect(r.to)
    case 'fixed': return <>{r.source?.body || r.source?.lead ? <section className="section light"><div className="wrap article">{r.source.lead ? <p className="lead">{r.source.lead}</p> : null}{r.source.body ? <RichBody html={r.source.body} /> : null}</div></section> : null}{fixedView(r.route, page, q)}</>
    case 'product': return <ProductPage product={r.doc} />
    case 'category': return <CategoryPage category={r.doc} page={page} />
    case 'course': return <CoursePage course={r.doc} />
    case 'page': return <ArticlePage page={r.doc} />
    case 'trip': return <TripPage trip={r.doc} />
    case 'album': return <AlbumPage album={r.doc} page={page} />
    case 'event': return <EventPage event={r.doc} />
  }
}
