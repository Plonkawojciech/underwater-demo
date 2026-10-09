import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { firstParam, parseMonth, parsePage, searchQuery, tripView } from '@/lib/presentation'
import { resolveRoute, type FixedRoute } from '@/views/resolve'
import { resolvedMeta } from '@/views/meta'
import { ShopIndex, CategoryPage, ListingPage, ProductPage } from '@/views/shop'
import { CoursesIndex, CoursePage } from '@/views/training'
import { ArticleIndex, ArticlePage, AlbumPage, AlbumsIndex, CalendarPage, EventPage, TripPage, TripsIndex } from '@/views/content'
import { ContactPage } from '@/views/pages'
import { RichBody } from '@/components/content'
import { publicMedia } from '@/views/query'

type Props = {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, q] = await Promise.all([params, searchParams])
  const r = await resolveRoute(slug.join('/'))
  // Hydrate only metadata copies: the route is cached with the page renderer,
  // whose complete list of image IDs must remain intact for pagination.
  let metadataRoute = r
  if (r?.kind === 'album') {
    const refs = [r.doc.seo?.image, r.doc.photos?.[0]?.image]
    const media = await publicMedia(refs.map(ref => typeof ref === 'number' ? ref : null))
    const doc = { ...r.doc, seo: r.doc.seo ? { ...r.doc.seo } : undefined, photos: r.doc.photos ? [...r.doc.photos] : undefined }
    if (typeof doc.seo?.image === 'number') doc.seo.image = media.get(doc.seo.image) || null
    if (typeof doc.photos?.[0]?.image === 'number') doc.photos[0] = { ...doc.photos[0], image: media.get(doc.photos[0].image) || null }
    metadataRoute = { ...r, doc }
  }
  return metadataRoute ? resolvedMeta(metadataRoute, q) : { title: 'Nie znaleziono strony', robots: { index: false, follow: false } }
}

function fixedView(route: FixedRoute, page: number, q: Record<string, string | string[] | undefined>) {
  switch (route) {
    case 'shop': return <ShopIndex page={page} q={searchQuery(q.q)} />
    case 'courses': return <CoursesIndex page={page} org={firstParam(q.org)} />
    case 'contact': return <ContactPage query={q} />
    case 'trips': return <TripsIndex page={page} view={tripView(q.widok)} />
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
    case 'page': return r.doc.listing ? <ListingPage page={r.doc} /> : <ArticlePage page={r.doc} />
    case 'trip': return <TripPage trip={r.doc} />
    case 'album': return <AlbumPage album={r.doc} page={page} />
    case 'event': return <EventPage event={r.doc} />
  }
}
