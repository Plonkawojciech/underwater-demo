import Link from 'next/link'
import type { Where } from 'payload'
import {
  albumSlice, asObject, CALENDAR_KIND, centsOf, contentHref, courseHref, enquiryHref, excerpt, formatMoney, groupByMonth, mediaAlt,
  mediaId, mediaUrl, mergeCalendar, monthKey, monthLabel, monthOf, monthRange, plainText, shiftMonth, TRIP_VIEW_PARAM, withQuery,
  type AlbumDoc, type AlbumPhotoRow, type CourseDoc, type EventDoc, type Month, type PageDoc, type SessionDoc, type TripDoc, type TripView,
} from '@/lib/presentation'
import { AlbumGrid, type Photo } from '@/components/Lightbox'
import {
  ArchiveItem, ArchiveList, Crumbs, DateRange, DateText, EmptyState, Notice, Pagination, PlainText, RangeSummary, RichBody,
} from '@/components/content'
import { nowISO, PAGE_SIZE, publicFind, publicMedia } from './query'
import { FIXED_META, hrefOf } from './meta'

// ---------- album photos ----------

/** Photo pages and album previews read only the media of the rows they show. */
const ALBUM_PAGE = 48
const ALBUM_PREVIEW = 12

/** Lightbox photos for a bounded set of album rows, in album order; rows whose media is gone are skipped. */
async function photosFor(rows: AlbumPhotoRow[]): Promise<Photo[]> {
  const media = await publicMedia(rows.map((r) => (typeof r.image === 'number' ? r.image : null)))
  return rows.flatMap((p) => {
    const img = typeof p.image === 'number' ? media.get(p.image) ?? null : asObject(p.image)
    const src = mediaUrl(img, 'full')
    return img && src ? [{ src, thumb: mediaUrl(img, 'thumb'), alt: mediaAlt(img), caption: p.caption, width: img.width, height: img.height }] : []
  })
}

/** An album shown inside a page or trip: the first photos, and a link to the album for the rest. */
async function AlbumPreview({ album, label, className }: { album: AlbumDoc; label: string; className: string }) {
  const href = hrefOf({ kind: 'album', doc: album })
  const total = album.photos?.length || 0
  // Without an album address the preview is the album's first full page.
  const rows = (album.photos || []).slice(0, href ? ALBUM_PREVIEW : ALBUM_PAGE)
  const photos = await photosFor(rows)
  if (!photos.length) return null
  return (
    <section className={className} aria-labelledby="zdjecia">
      <h2 id="zdjecia" className="h3">{album.title || 'Zdjęcia'}</h2>
      <AlbumGrid photos={photos} label={album.title || label} />
      {href && total > rows.length ? <p className="album-more"><Link className="textlink" href={href}>Zobacz cały album ({total} zdj.)</Link></p> : null}
    </section>
  )
}

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

export async function ArticlePage({ page: d }: { page: PageDoc }) {
  const parent = d.kind === 'news' ? FIXED_META.news : d.kind === 'report' ? FIXED_META.reports : null
  const img = mediaUrl(d.image, 'card')
  const album = asObject(d.album)
  const hasAlbum = !!album?.photos?.length
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
            : !d.lead && !hasAlbum ? <EmptyState title="Ta strona nie ma jeszcze treści" action={{ href: '/', label: 'Strona główna' }} /> : null
        )}
        {album && hasAlbum ? <AlbumPreview album={album} label={d.title} className="article-album" /> : null}
      </article>
    </div></div>
  )
}

// ---------- trips ----------

const TRIP_TABS: { view: TripView; label: string }[] = [
  { view: 'upcoming', label: 'Najbliższe' },
  { view: 'past', label: 'Minione' },
  { view: 'undated', label: 'Bez podanej daty' },
]

/**
 * Every trip is in exactly one list. Upcoming and past need a start date; a trip without one is
 * listed separately, so an old undated record is never shown as the nearest trip.
 */
function tripWhere(view: TripView, now: string): Where {
  if (view === 'undated') return { startsAt: { exists: false } }
  const dated: Where = { startsAt: { exists: true } }
  return view === 'past'
    ? { and: [dated, { or: [{ endsAt: { less_than: now } }, { and: [{ endsAt: { exists: false } }, { startsAt: { less_than: now } }] }] }] }
    : { and: [dated, { or: [{ endsAt: { greater_than_equal: now } }, { and: [{ endsAt: { exists: false } }, { startsAt: { greater_than_equal: now } }] }] }] }
}

/** `view` wins over the older `past` flag. */
export async function TripsIndex({ page, past, view: v }: { page: number; past?: boolean; view?: TripView }) {
  const view: TripView = v ?? (past ? 'past' : 'upcoming')
  const now = nowISO()
  const [r, undated] = await Promise.all([
    publicFind<TripDoc>('trips', { where: tripWhere(view, now), limit: PAGE_SIZE, page, depth: 1, sort: view === 'past' ? '-startsAt' : view === 'undated' ? 'title' : 'startsAt' }),
    publicFind<TripDoc>('trips', { where: tripWhere('undated', now), limit: 1, depth: 0, select: { title: true } }),
  ])
  const self = FIXED_META.trips.path
  const hrefFor = (to: TripView, n?: number) => withQuery(self, { widok: TRIP_VIEW_PARAM[to], strona: n })
  const tabs = TRIP_TABS.filter((t) => t.view !== 'undated' || undated.totalDocs > 0 || view === 'undated')
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Wyprawy' }]} />
      <h1 className="h2">Wyprawy nurkowe</h1>
      <nav className="filters" aria-label="Wyprawy">
        <ul>
          {tabs.map((t) => (
            <li key={t.view}>
              <Link href={hrefFor(t.view)} aria-current={view === t.view ? 'page' : undefined}>
                {t.label}{t.view === 'undated' && undated.totalDocs ? <span className="filters-n">{undated.totalDocs}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view === 'undated' ? <p className="lead lead-tight trips-note">Opublikowane wyjazdy, przy których nie ma daty. Zapytaj, czy planujemy kolejny termin.</p> : null}
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
                      <span className="trip-d mono">{t.startsAt ? <DateRange from={t.startsAt} to={t.endsAt} /> : 'Bez podanej daty'}</span>
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
          <Pagination page={page} totalPages={r.totalPages} hrefFor={(n) => hrefFor(view, n)} label="Strony listy wypraw" />
        </>
      ) : (
        <EmptyState
          title={page > 1 ? 'Ta strona listy wypraw jest pusta'
            : view === 'past' ? 'Brak opublikowanych minionych wypraw'
            : view === 'undated' ? 'Wszystkie opublikowane wyprawy mają daty'
            : 'Nie ma opublikowanych nadchodzących wypraw'}
          action={view === 'upcoming' && page === 1 ? { href: '/kontakt.html', label: 'Zapytaj o najbliższy wyjazd' } : { href: self, label: 'Pokaż najbliższe' }}
        >
          {view === 'upcoming' && page === 1 ? (
            <p>
              {undated.totalDocs ? <><Link className="textlink" href={hrefFor('undated')}>Wyjazdy bez podanej daty</Link> są na osobnej liście. </> : null}
              Relacje z dawnych wyjazdów znajdziesz w <Link className="textlink" href={FIXED_META.reports.path}>relacjach</Link>.
            </p>
          ) : null}
        </EmptyState>
      )}
    </div></div>
  )
}

export function TripPage({ trip: t }: { trip: TripDoc }) {
  const img = mediaUrl(t.image, 'full')
  const price = centsOf(t.priceCents)
  const album = asObject(t.album)
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
          {album?.photos?.length ? <AlbumPreview album={album} label={t.title} className="csec" /> : null}
        </div>
        <aside className="aside">
          <h2 className="subh subh-first">Zapytaj o wyjazd</h2>
          <p className="note note-first">Szczegóły, wolne miejsca i warunki zapisu potwierdzamy indywidualnie.</p>
          <div className="aside-cta"><Link className="btn btn-solid" href={enquiryHref('trip', t.id)}>Napisz do nas</Link></div>
        </aside>
      </div></div>
    </>
  )
}

// ---------- albums ----------

export async function AlbumsIndex({ page }: { page: number }) {
  // Depth 0: photo rows carry media ids only; the covers are read in one bounded query.
  const r = await publicFind<AlbumDoc>('albums', { limit: PAGE_SIZE, page, depth: 0, sort: '-date' })
  const covers = await publicMedia(r.docs.map((a) => mediaId(a.photos?.[0]?.image)))
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
              const first = a.photos?.[0]?.image
              const cover = mediaUrl(typeof first === 'number' ? covers.get(first) : first, 'card')
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

/** One page of an album: the row list gives the total, only this page's media is read. */
export async function AlbumPage({ album: a, page }: { album: AlbumDoc; page: number }) {
  const s = albumSlice(a.photos, page, ALBUM_PAGE)
  const photos = await photosFor(s.rows)
  const self = hrefOf({ kind: 'album', doc: a }) || FIXED_META.albums.path
  return (
    <div className="section dark"><div className="wrap">
      <Crumbs items={[{ label: 'Galerie', href: FIXED_META.albums.path }, { label: a.title }]} />
      <h1 className="h2">{a.title}</h1>
      {a.date ? <p className="arc-m"><DateText value={a.date} /></p> : null}
      {a.description ? <PlainText text={a.description} className="longform-dark album-desc" /> : null}
      {s.pages > 1 ? <RangeSummary page={s.page} perPage={ALBUM_PAGE} total={s.total} /> : null}
      {photos.length
        ? <AlbumGrid photos={photos} label={s.pages > 1 ? `${a.title}, strona ${s.page} z ${s.pages}` : a.title} />
        : <EmptyState title="Album nie ma jeszcze zdjęć" action={{ href: FIXED_META.albums.path, label: 'Wszystkie galerie' }} />}
      <Pagination page={s.page} totalPages={s.pages} hrefFor={(n) => withQuery(self, { strona: n })} label="Strony albumu" />
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

const sessionHref = (s: SessionDoc) => {
  const c = asObject<CourseDoc>(s.course)
  return c ? hrefOf({ kind: 'course', doc: c }) : null
}

const CAL_BATCH = 500
const CAL_MAX_PAGES = 20

/** Every page of a bounded date query. `truncated` when the safety cap stopped it early. */
async function allPages<T>(collection: 'events' | 'course-sessions' | 'trips', args: Omit<Parameters<typeof publicFind>[1], 'limit' | 'page'>) {
  const docs: T[] = []
  for (let page = 1; page <= CAL_MAX_PAGES; page++) {
    const r = await publicFind<T>(collection, { ...args, limit: CAL_BATCH, page })
    docs.push(...r.docs)
    if (page >= r.totalPages) return { docs, truncated: false }
  }
  return { docs, truncated: true }
}

/**
 * Published events, course sessions and dated trips in one list, so a session or trip does not
 * need a duplicate event. A month view reads what overlaps that month; the default view reads
 * what has not ended. Trips without a start date are not on the calendar.
 */
export async function CalendarPage({ page, month }: { page: number; month: Month | null }) {
  const now = nowISO()
  let when: Where
  if (month) {
    const { start, end } = monthRange(month)
    // Overlaps the month: starts before its end and has not finished before its start.
    when = { and: [
      { startsAt: { less_than: end.toISOString() } },
      { or: [{ startsAt: { greater_than_equal: start.toISOString() } }, { endsAt: { greater_than_equal: start.toISOString() } }] },
    ] }
  } else {
    when = { or: [{ startsAt: { greater_than_equal: now } }, { endsAt: { greater_than_equal: now } }] }
  }
  const [events, sessions, trips] = await Promise.all([
    allPages<EventDoc>('events', { where: when, depth: 2, sort: 'startsAt' }),
    allPages<SessionDoc>('course-sessions', { where: when, depth: 1, sort: 'startsAt' }),
    allPages<TripDoc>('trips', {
      where: { and: [{ startsAt: { exists: true } }, when] }, depth: 0, sort: 'startsAt',
      select: { title: true, path: true, legacyPath: true, startsAt: true, endsAt: true, location: true },
    }),
  ])
  const entries = mergeCalendar(
    { events: events.docs, sessions: sessions.docs, trips: trips.docs },
    { event: eventHref, session: sessionHref, trip: (t) => hrefOf({ kind: 'trip', doc: t }) },
  )
  const truncated = events.truncated || sessions.truncated || trips.truncated
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const shown = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const self = FIXED_META.calendar.path
  const base = month || monthOf(new Date())
  const prev = shiftMonth(base, -1)
  const next = shiftMonth(base, 1)
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Kalendarz' }]} />
      <h1 className="h2">Kalendarz</h1>
      <p className="lead">{month ? `Terminy: ${monthLabel(month)}.` : 'Kursy, wyjazdy i spotkania, które jeszcze się nie zakończyły.'}</p>
      <nav className="monthnav" aria-label="Miesiące">
        <Link href={withQuery(self, { miesiac: monthKey(prev) })}>{monthLabel(prev)}</Link>
        {month ? <Link href={self}>Nadchodzące</Link> : <Link href={withQuery(self, { miesiac: monthKey(base) })}>{monthLabel(base)}</Link>}
        <Link href={withQuery(self, { miesiac: monthKey(next) })}>{monthLabel(next)}</Link>
      </nav>
      {truncated ? <Notice tone="warning" title="Lista jest niepełna">{month ? 'Terminów w tym miesiącu jest więcej, niż kalendarz może odczytać naraz.' : 'Terminów jest więcej, niż kalendarz może odczytać naraz. Wybierz miesiąc, aby zobaczyć wszystkie terminy z tego okresu.'}</Notice> : null}
      {shown.length ? (
        <>
          {entries.length > PAGE_SIZE ? <RangeSummary page={page} perPage={PAGE_SIZE} total={entries.length} /> : null}
          {groupByMonth(shown).map((g) => (
            <section key={monthKey(g.month)} className="cal-m" aria-labelledby={`m-${monthKey(g.month)}`}>
              <h2 id={`m-${monthKey(g.month)}`} className="h3 cal-h">{monthLabel(g.month)}</h2>
              <ul className="ladder cal">
                {g.items.map((e) => {
                  const inner = (
                    <>
                      <span className="depth cal-d"><DateText value={e.startsAt} format="short" /></span>
                      <span className="rowtext">
                        <span className="cal-k">{CALENDAR_KIND[e.kind]}</span>
                        <strong>{e.title}</strong>
                        <span className="rowlead">
                          {e.detail ? <>{e.detail}, </> : null}<DateRange from={e.startsAt} to={e.endsAt} showTime={e.kind !== 'trip'} />{e.location ? `, ${e.location}` : ''}
                        </span>
                      </span>
                    </>
                  )
                  return <li key={e.key}>{e.href ? <Link href={e.href} className="rowlink">{inner}</Link> : <div className="rowlink rowstatic">{inner}</div>}</li>
                })}
              </ul>
            </section>
          ))}
          <Pagination page={page} totalPages={totalPages} hrefFor={(n) => withQuery(self, { miesiac: month ? monthKey(month) : undefined, strona: n })} label="Strony kalendarza" />
        </>
      ) : (
        <EmptyState
          title={page > 1 && entries.length ? 'Ta strona kalendarza jest pusta' : month ? `Brak terminów: ${monthLabel(month)}` : 'Nie ma jeszcze opublikowanych terminów'}
          action={page > 1 && entries.length ? { href: withQuery(self, { miesiac: month ? monthKey(month) : undefined }), label: 'Wróć do pierwszej strony' } : { href: '/kursy-nurkowania.html', label: 'Zobacz kursy' }}
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
          <p className="arc-m"><DateRange from={e.startsAt} to={e.endsAt} showTime />{e.location ? `, ${e.location}` : ''}</p>
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
