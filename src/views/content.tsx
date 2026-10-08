import Link from 'next/link'
import type { Where } from 'payload'
import {
  asObject, centsOf, contentHref, courseHref, excerpt, formatMoney, groupByMonth, mediaAlt, mediaUrl, monthKey, monthLabel,
  monthOf, monthRange, plainText, shiftMonth, withQuery,
  type AlbumDoc, type EventDoc, type Month, type PageDoc, type SessionDoc, type TripDoc,
} from '@/lib/presentation'
import { AlbumGrid, type Photo } from '@/components/Lightbox'
import {
  ArchiveItem, ArchiveList, Crumbs, DateRange, DateText, EmptyState, Notice, Pagination, PlainText, RangeSummary, RichBody,
} from '@/components/content'
import { nowISO, PAGE_SIZE, publicFind } from './query'
import { FIXED_META, hrefOf } from './meta'

const photosOf = (album: AlbumDoc | null): Photo[] =>
  (album?.photos || []).flatMap((p) => {
    const img = asObject(p.image)
    const src = mediaUrl(img, 'full')
    return img && src ? [{ src, thumb: mediaUrl(img, 'thumb'), alt: mediaAlt(img), caption: p.caption, width: img.width, height: img.height }] : []
  })

// ---------- news and reports ----------

const ARCHIVE = {
  news: { route: 'news', title: 'Aktualności', empty: 'Nie ma jeszcze opublikowanych aktualności' },
  report: { route: 'reports', title: 'Relacje', empty: 'Nie ma jeszcze opublikowanych relacji' },
} as const

export async function ArticleIndex({ kind, page }: { kind: 'news' | 'report'; page: number }) {
  const a = ARCHIVE[kind]
  const self = FIXED_META[a.route].path
  const r = await publicFind<PageDoc>('pages', { where: { kind: { equals: kind } }, limit: PAGE_SIZE, page, depth: 1, sort: '-publishedAt' })
  const other = kind === 'news' ? FIXED_META.reports : FIXED_META.news
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: a.title }]} />
      <div className="sechead">
        <div><h1 className="h2">{a.title}</h1></div>
        <Link className="textlink" href={other.path}>{other.title}</Link>
      </div>
      {r.docs.length ? (
        <>
          <RangeSummary page={page} perPage={PAGE_SIZE} total={r.totalDocs} />
          <ArchiveList label={a.title}>
            {r.docs.map((d) => {
              const href = hrefOf({ kind: 'page', doc: d })
              if (!href) return null
              const src = mediaUrl(d.image, 'thumb')
              return <ArchiveItem key={d.id} href={href} title={d.title} date={d.publishedAt} excerpt={d.lead || excerpt(plainText(d.body), 220)} image={src ? { src, alt: '' } : null} />
            })}
          </ArchiveList>
          <Pagination page={page} totalPages={r.totalPages} hrefFor={(n) => withQuery(self, { strona: n })} label={`Strony: ${a.title}`} />
        </>
      ) : <EmptyState title={page > 1 ? 'Ta strona archiwum jest pusta' : a.empty} action={page > 1 ? { href: self, label: 'Wróć do pierwszej strony' } : { href: '/', label: 'Strona główna' }} />}
    </div></div>
  )
}

export function ArticlePage({ page: d }: { page: PageDoc }) {
  const parent = d.kind === 'news' ? FIXED_META.news : d.kind === 'report' ? FIXED_META.reports : null
  const img = mediaUrl(d.image, 'card')
  const album = asObject(d.album)
  const photos = photosOf(album)
  const hasBody = !!d.body?.trim()
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[...(parent ? [{ label: parent.title, href: parent.path }] : []), { label: d.title }]} />
      <article className="article">
        <header>
          <h1 className="h2">{d.title}</h1>
          {d.publishedAt && d.kind !== 'legal' && d.kind !== 'page' ? <p className="arc-m"><DateText value={d.publishedAt} /></p> : null}
          {d.lead ? <p className="lead">{d.lead}</p> : null}
        </header>
        {img ? <figure className="article-img"><img src={img} alt={mediaAlt(d.image)} /></figure> : null}
        {hasBody ? <RichBody html={d.body} /> : (
          d.kind === 'legal'
            ? <Notice tone="warning" title="Wersja podglądowa: brak treści dokumentu">Ta strona jest przygotowana na dokument sklepu, ale jego treść nie została jeszcze przeniesiona. Nie jest to obowiązujący tekst.</Notice>
            : !d.lead && !photos.length ? <EmptyState title="Ta strona nie ma jeszcze treści" action={{ href: '/', label: 'Strona główna' }} /> : null
        )}
        {photos.length ? (
          <section className="article-album" aria-labelledby="zdjecia">
            <h2 id="zdjecia" className="h3">{album?.title || 'Zdjęcia'}</h2>
            <AlbumGrid photos={photos} label={album?.title || d.title} />
          </section>
        ) : null}
      </article>
    </div></div>
  )
}

// ---------- trips ----------

export async function TripsIndex({ page, past }: { page: number; past: boolean }) {
  const now = nowISO()
  // Upcoming: not yet ended, or no dates set. Past: ended (or started, without an end date).
  const where: Where = past
    ? { or: [{ endsAt: { less_than: now } }, { and: [{ endsAt: { exists: false } }, { startsAt: { less_than: now } }] }] }
    : { or: [{ endsAt: { greater_than_equal: now } }, { and: [{ endsAt: { exists: false } }, { or: [{ startsAt: { greater_than_equal: now } }, { startsAt: { exists: false } }] }] }] }
  const r = await publicFind<TripDoc>('trips', { where, limit: PAGE_SIZE, page, depth: 1, sort: past ? '-startsAt' : 'startsAt' })
  const self = FIXED_META.trips.path
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Wyprawy' }]} />
      <h1 className="h2">Wyprawy nurkowe</h1>
      <nav className="filters" aria-label="Wyprawy">
        <ul>
          <li><Link href={self} aria-current={!past ? 'page' : undefined}>Najbliższe</Link></li>
          <li><Link href={withQuery(self, { widok: 'minione' })} aria-current={past ? 'page' : undefined}>Minione</Link></li>
        </ul>
      </nav>
      {r.docs.length ? (
        <>
          <ul className="trips">
            {r.docs.map((t) => {
              const href = hrefOf({ kind: 'trip', doc: t })
              const src = mediaUrl(t.image, 'card')
              const price = centsOf(t.priceCents)
              if (!href) return null
              return (
                <li key={t.id} className="trip">
                  <Link href={href} className="trip-link">
                    <span className="trip-ph">{src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}</span>
                    <span className="trip-b">
                      <span className="trip-d mono">{t.startsAt ? <DateRange from={t.startsAt} to={t.endsAt} /> : 'Termin do ustalenia'}</span>
                      <strong>{t.title}</strong>
                      {t.location ? <span className="muted">{t.location}</span> : null}
                      {t.lead ? <span className="trip-x">{t.lead}</span> : null}
                      {price !== null ? <span className="trip-p mono">{formatMoney(price)}</span> : null}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <Pagination page={page} totalPages={r.totalPages} hrefFor={(n) => withQuery(self, { widok: past ? 'minione' : undefined, strona: n })} label="Strony listy wypraw" />
        </>
      ) : (
        <EmptyState
          title={past ? 'Brak opublikowanych minionych wypraw' : 'Nie ma jeszcze opublikowanych terminów wypraw'}
          action={past ? { href: self, label: 'Pokaż najbliższe' } : { href: '/kontakt.html', label: 'Zapytaj o najbliższy wyjazd' }}
        >
          {!past ? <p>Relacje z dawnych wyjazdów znajdziesz w <Link className="textlink" href={FIXED_META.reports.path}>relacjach</Link>.</p> : null}
        </EmptyState>
      )}
    </div></div>
  )
}

export function TripPage({ trip: t }: { trip: TripDoc }) {
  const img = mediaUrl(t.image, 'full')
  const price = centsOf(t.priceCents)
  const album = asObject(t.album)
  const photos = photosOf(album)
  return (
    <>
      <section className="chero">
        {img ? <img src={img} alt="" /> : <img src="/img/wyprawa.jpg" alt="" />}
        <div className="wrap">
          <Crumbs items={[{ label: 'Wyprawy', href: FIXED_META.trips.path }, { label: t.title }]} />
          <h1 className="h2">{t.title}</h1>
          {t.lead ? <p className="lead">{t.lead}</p> : null}
          {(t.startsAt || t.location || price !== null) && (
            <dl className="stats">
              {t.startsAt ? <div><dt>Termin</dt><dd><DateRange from={t.startsAt} to={t.endsAt} /></dd></div> : null}
              {t.location ? <div><dt>Miejsce</dt><dd>{t.location}</dd></div> : null}
              {price !== null ? <div><dt>Cena</dt><dd>{formatMoney(price)}</dd></div> : null}
            </dl>
          )}
        </div>
      </section>
      <div className="section light"><div className="wrap cbody">
        <div>
          {t.body?.trim() ? <RichBody html={t.body} /> : <p className="muted">Program wyjazdu nie jest jeszcze opublikowany.</p>}
          {photos.length ? (
            <section className="csec" aria-labelledby="zdjecia">
              <h2 id="zdjecia" className="h3">{album?.title || 'Zdjęcia'}</h2>
              <AlbumGrid photos={photos} label={album?.title || t.title} />
            </section>
          ) : null}
        </div>
        <aside className="aside">
          <h2 className="subh subh-first">Zapytaj o wyjazd</h2>
          <p className="note note-first">Szczegóły, wolne miejsca i warunki zapisu potwierdzamy indywidualnie.</p>
          <div className="aside-cta"><Link className="btn btn-solid" href="/kontakt.html">Napisz do nas</Link></div>
        </aside>
      </div></div>
    </>
  )
}

// ---------- albums ----------

export async function AlbumsIndex({ page }: { page: number }) {
  const r = await publicFind<AlbumDoc>('albums', { limit: PAGE_SIZE, page, depth: 1, sort: '-date' })
  const self = FIXED_META.albums.path
  return (
    <div className="section dark"><div className="wrap">
      <Crumbs items={[{ label: 'Galerie' }]} />
      <h1 className="h2">Galerie</h1>
      {r.docs.length ? (
        <>
          <ul className="albums">
            {r.docs.map((a) => {
              const href = hrefOf({ kind: 'album', doc: a })
              if (!href) return null
              const cover = mediaUrl(asObject(a.photos?.[0]?.image), 'card')
              const count = a.photos?.length || 0
              return (
                <li key={a.id}>
                  <Link href={href} className="albumcard">
                    <span className="albumcard-ph">{cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : null}</span>
                    <strong>{a.title}</strong>
                    <span className="mono muted">{a.date ? <DateText value={a.date} /> : null}{a.date && count ? ', ' : ''}{count ? `${count} zdj.` : ''}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <Pagination page={page} totalPages={r.totalPages} hrefFor={(n) => withQuery(self, { strona: n })} label="Strony galerii" />
        </>
      ) : <EmptyState title={page > 1 ? 'Ta strona galerii jest pusta' : 'Nie ma jeszcze opublikowanych galerii'} action={page > 1 ? { href: self, label: 'Wróć do pierwszej strony' } : { href: '/', label: 'Strona główna' }} />}
    </div></div>
  )
}

const ALBUM_PAGE = 48

export function AlbumPage({ album: a, page }: { album: AlbumDoc; page: number }) {
  const all = photosOf(a)
  const pages = Math.max(1, Math.ceil(all.length / ALBUM_PAGE))
  const cur = Math.min(page, pages)
  const photos = all.slice((cur - 1) * ALBUM_PAGE, cur * ALBUM_PAGE)
  const self = hrefOf({ kind: 'album', doc: a }) || FIXED_META.albums.path
  return (
    <div className="section dark"><div className="wrap">
      <Crumbs items={[{ label: 'Galerie', href: FIXED_META.albums.path }, { label: a.title }]} />
      <h1 className="h2">{a.title}</h1>
      {a.date ? <p className="arc-m"><DateText value={a.date} /></p> : null}
      {a.description ? <PlainText text={a.description} className="longform-dark album-desc" /> : null}
      {photos.length
        ? <AlbumGrid photos={photos} label={a.title} />
        : <EmptyState title="Album nie ma jeszcze zdjęć" action={{ href: FIXED_META.albums.path, label: 'Wszystkie galerie' }} />}
      <Pagination page={cur} totalPages={pages} hrefFor={(n) => withQuery(self, { strona: n })} label="Strony albumu" />
    </div></div>
  )
}

// ---------- calendar ----------

/** Where an event leads: its own page, the linked trip, or the course of the linked session. */
function eventHref(e: EventDoc): string | null {
  if (e.path) return contentHref(e.path)
  const trip = asObject(e.trip)
  if (trip) return hrefOf({ kind: 'trip', doc: trip })
  const course = asObject(asObject<SessionDoc>(e.courseSession)?.course ?? null)
  return course ? courseHref(course.slug) : null
}

export async function CalendarPage({ page, month }: { page: number; month: Month | null }) {
  const now = nowISO()
  let where: Where
  if (month) {
    const { start, end } = monthRange(month)
    // Overlaps the month: starts before its end and has not finished before its start.
    where = { and: [
      { startsAt: { less_than: end.toISOString() } },
      { or: [{ startsAt: { greater_than_equal: start.toISOString() } }, { endsAt: { greater_than_equal: start.toISOString() } }] },
    ] }
  } else {
    where = { or: [{ startsAt: { greater_than_equal: now } }, { endsAt: { greater_than_equal: now } }] }
  }
  const r = await publicFind<EventDoc>('events', { where, limit: PAGE_SIZE, page, depth: 2, sort: 'startsAt' })
  const self = FIXED_META.calendar.path
  const base = month || monthOf(new Date())
  const prev = shiftMonth(base, -1)
  const next = shiftMonth(base, 1)
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Kalendarz' }]} />
      <h1 className="h2">Kalendarz</h1>
      <p className="lead">{month ? `Wydarzenia: ${monthLabel(month)}.` : 'Kursy, wyjazdy i spotkania, które jeszcze się nie zakończyły.'}</p>
      <nav className="monthnav" aria-label="Miesiące">
        <Link href={withQuery(self, { miesiac: monthKey(prev) })}>{monthLabel(prev)}</Link>
        {month ? <Link href={self}>Nadchodzące</Link> : <Link href={withQuery(self, { miesiac: monthKey(base) })}>{monthLabel(base)}</Link>}
        <Link href={withQuery(self, { miesiac: monthKey(next) })}>{monthLabel(next)}</Link>
      </nav>
      {r.docs.length ? (
        <>
          {groupByMonth(r.docs).map((g) => (
            <section key={monthKey(g.month)} className="cal-m" aria-labelledby={`m-${monthKey(g.month)}`}>
              <h2 id={`m-${monthKey(g.month)}`} className="h3 cal-h">{monthLabel(g.month)}</h2>
              <ul className="ladder cal">
                {g.items.map((e) => {
                  const href = eventHref(e)
                  const inner = (
                    <>
                      <span className="depth cal-d"><DateText value={e.startsAt} format="short" /></span>
                      <span className="rowtext">
                        <strong>{e.title}</strong>
                        <span className="rowlead">
                          <DateRange from={e.startsAt} to={e.endsAt} />{e.location ? `, ${e.location}` : ''}
                        </span>
                      </span>
                    </>
                  )
                  return <li key={e.id}>{href ? <Link href={href} className="rowlink">{inner}</Link> : <div className="rowlink rowstatic">{inner}</div>}</li>
                })}
              </ul>
            </section>
          ))}
          <Pagination page={page} totalPages={r.totalPages} hrefFor={(n) => withQuery(self, { miesiac: month ? monthKey(month) : undefined, strona: n })} label="Strony kalendarza" />
        </>
      ) : (
        <EmptyState
          title={month ? `Brak wydarzeń: ${monthLabel(month)}` : 'Nie ma jeszcze opublikowanych terminów'}
          action={{ href: '/kursy-nurkowania.html', label: 'Zobacz kursy' }}
        />
      )}
    </div></div>
  )
}

export function EventPage({ event: e }: { event: EventDoc }) {
  const trip = asObject(e.trip)
  const course = asObject(asObject<SessionDoc>(e.courseSession)?.course ?? null)
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Kalendarz', href: FIXED_META.calendar.path }, { label: e.title }]} />
      <article className="article">
        <header>
          <h1 className="h2">{e.title}</h1>
          <p className="arc-m"><DateRange from={e.startsAt} to={e.endsAt} />{e.location ? `, ${e.location}` : ''}</p>
        </header>
        <RichBody html={e.body} />
        {trip || course ? (
          <p className="related-links">
            {trip ? <Link className="textlink" href={hrefOf({ kind: 'trip', doc: trip }) || FIXED_META.trips.path}>Wyprawa: {trip.title}</Link> : null}
            {course ? <Link className="textlink" href={courseHref(course.slug)}>Kurs: {course.name}</Link> : null}
          </p>
        ) : null}
      </article>
    </div></div>
  )
}
