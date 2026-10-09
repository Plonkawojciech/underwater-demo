import Link from 'next/link'
import type { Metadata } from 'next'
import {
  asObject, contentHref, courseHref, mediaUrl, plainText, excerpt, phoneParts,
  type CourseDoc, type EventDoc, type PageDoc, type ProductDoc, type SessionDoc, type TripDoc,
} from '@/lib/presentation'
import { ProductCard } from '@/components/ProductCard'
import { ArchiveItem, ArchiveList, DateRange, DateText } from '@/components/content'
import { getSettings, isPreview, nowISO, publicFind } from '@/views/query'
import { CourseLadder, nextByCourse, upcomingSessions } from '@/views/training'
import { hrefOf } from '@/views/meta'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: isPreview() ? { index: false, follow: false } : undefined,
}

export default async function Home() {
  const now = nowISO()
  const [s, featured, courses, sessions, trips, events, news] = await Promise.all([
    getSettings(),
    publicFind<ProductDoc>('products', { where: { featured: { equals: true } }, limit: 4, depth: 1, sort: 'name' }),
    publicFind<CourseDoc>('courses', { limit: 6, depth: 0, sort: 'order' }),
    upcomingSessions(),
    publicFind<TripDoc>('trips', { where: { or: [{ startsAt: { greater_than_equal: now } }, { endsAt: { greater_than_equal: now } }] }, limit: 3, depth: 1, sort: 'startsAt' }),
    publicFind<EventDoc>('events', { where: { startsAt: { greater_than_equal: now } }, limit: 5, depth: 2, sort: 'startsAt' }),
    publicFind<PageDoc>('pages', { where: { kind: { in: ['news', 'report'] } }, limit: 3, depth: 1, sort: '-publishedAt' }),
  ])
  // Without featured products the shop section shows the first page of the catalogue instead.
  const products = featured.docs.length ? featured.docs : (await publicFind<ProductDoc>('products', { limit: 4, depth: 1, sort: 'name' })).docs
  const next = nextByCourse(sessions)
  const first = sessions[0]
  const firstCourse = first ? courses.docs.find((c) => c.id === (typeof first.course === 'object' ? first.course.id : first.course)) : undefined
  const hero = mediaUrl(s.heroImage, 'full') || '/img/wyprawa.jpg'
  const phone = phoneParts(s.phone).find(part => part.href)
  const trip = trips.docs[0]
  const tripHref = trip ? hrefOf({ kind: 'trip', doc: trip }) : null
  return (
    <>
      <section className="hero">
        <div className="hero-media"><img src={hero} alt="" fetchPriority="high" /></div>
        <div className="wrap">
          {first ? (
            <p className="hero-next">
              <em aria-hidden="true" />
              {firstCourse
                ? <Link href={courseHref(firstCourse.slug)}>Najbliższy kurs: {firstCourse.name}, <DateText value={first.startsAt} /></Link>
                : <>Najbliższy termin: {first.title}, <DateText value={first.startsAt} /></>}
            </p>
          ) : null}
          <h1 className="display">{s.heroTitle || 'Underwater.pl'}</h1>
          {s.heroText ? <p className="lead">{s.heroText}</p> : null}
          <div className="hero-cta">
            <Link className="btn btn-solid" href="/kursy-nurkowania.html">Kursy nurkowania</Link>
            <Link className="btn btn-line" href="/sklep-nurkowy.html">Sklep nurkowy</Link>
          </div>
        </div>
      </section>

      {courses.docs.length > 0 && (
        <section className="section light" aria-labelledby="h-kursy"><div className="wrap">
          <div className="sechead">
            <div><h2 id="h-kursy" className="h2">Kursy nurkowania</h2></div>
            <Link className="textlink" href="/kursy-nurkowania.html">Wszystkie kursy</Link>
          </div>
          <CourseLadder courses={courses.docs} next={next} />
        </div></section>
      )}

      {trip && tripHref && (
        <section className="band" aria-labelledby="h-wyprawy">
          <img src={mediaUrl(trip.image, 'full') || '/img/wyprawa.jpg'} alt="" loading="lazy" />
          <div className="wrap">
            <p className="band-d mono">{trip.startsAt ? <DateRange from={trip.startsAt} to={trip.endsAt} /> : null}{trip.location ? `${trip.startsAt ? ', ' : ''}${trip.location}` : ''}</p>
            <h2 id="h-wyprawy" className="h2">{trip.title}</h2>
            {trip.lead ? <p className="lead">{trip.lead}</p> : null}
            <div className="hero-cta">
              <Link className="btn btn-line" href={tripHref}>Szczegóły wyprawy</Link>
              <Link className="btn btn-line" href="/wyprawy.html">Wszystkie wyprawy</Link>
            </div>
          </div>
        </section>
      )}

      {events.docs.length > 0 && (
        <section className="section light" aria-labelledby="h-kal"><div className="wrap">
          <div className="sechead">
            <div><h2 id="h-kal" className="h2">Najbliższe terminy</h2></div>
            <Link className="textlink" href="/kalendarz.html">Cały kalendarz</Link>
          </div>
          <ul className="ladder cal">
            {events.docs.map((e) => {
              const course = asObject(asObject<SessionDoc>(e.courseSession)?.course ?? null)
              const t = asObject(e.trip)
              const href = e.path ? contentHref(e.path) : t ? hrefOf({ kind: 'trip', doc: t }) : course ? courseHref(course.slug) : '/kalendarz.html'
              return (
                <li key={e.id}>
                  <Link href={href || '/kalendarz.html'} className="rowlink">
                    <span className="depth cal-d"><DateText value={e.startsAt} format="short" /></span>
                    <span className="rowtext"><strong>{e.title}</strong><span className="rowlead"><DateRange from={e.startsAt} to={e.endsAt} />{e.location ? `, ${e.location}` : ''}</span></span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div></section>
      )}

      {products.length > 0 && (
        <section className="section light" aria-labelledby="h-sklep"><div className="wrap">
          <div className="sechead">
            <div>
              <h2 id="h-sklep" className="h2">Sklep nurkowy</h2>
              {s.priceGuarantee ? <p className="lead">{s.priceGuarantee}</p> : null}
            </div>
            <Link className="textlink" href="/sklep-nurkowy.html">Cały sklep</Link>
          </div>
          <div className="grid">{products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div></section>
      )}

      {news.docs.length > 0 && (
        <section className="section light section-tight" aria-labelledby="h-news"><div className="wrap">
          <div className="sechead">
            <div><h2 id="h-news" className="h2">Aktualności i relacje</h2></div>
            <Link className="textlink" href="/aktualnosci.html">Wszystkie aktualności</Link>
          </div>
          <ArchiveList label="Najnowsze wpisy">
            {news.docs.map((d) => {
              const href = hrefOf({ kind: 'page', doc: d })
              return href ? <ArchiveItem key={d.id} level="h3" href={href} title={d.title} date={d.publishedAt} excerpt={d.lead || excerpt(plainText(d.body), 180)} /> : null
            })}
          </ArchiveList>
        </div></section>
      )}

      {(s.address || s.phone) && (
        <section className="section dark" aria-labelledby="h-kontakt"><div className="wrap">
          <div className="sechead sechead-end">
            <div>
              <h2 id="h-kontakt" className="h2">Centrum nurkowe</h2>
              {s.address ? <p className="lead pre">{s.address}</p> : null}
            </div>
            <div className="cta-stack">
              {phone ? <a className="btn btn-solid" href={phone.href!}>{phone.text}</a> : null}
              <Link className="btn btn-line" href="/kontakt.html">Napisz do nas</Link>
            </div>
          </div>
        </div></section>
      )}
    </>
  )
}
