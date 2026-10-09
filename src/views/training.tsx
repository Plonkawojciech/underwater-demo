import Link from 'next/link'
import { MediaImage } from '@/components/MediaImage'
import type { Where } from 'payload'
import {
  asObject, centsOf, COURSE_LEVEL, courseHref, formatMoney, jsonLd, mediaAlt, mediaUrl, seatsLeft, withQuery,
  type CourseDoc, type SessionDoc,
} from '@/lib/presentation'
import { SignupForm } from '@/components/SignupForm'
import { AlbumGrid } from '@/components/Lightbox'
import { Crumbs, DateRange, DateText, EmptyState, Pagination, PlainText, RichBody } from '@/components/content'
import { getLegalLinks, nowISO, PAGE_SIZE, publicFind, siteOrigin } from './query'
import { courseSchema } from '@/lib/seo'

const ORGS = ['PADI', 'IANTD', 'TDI/SDI', 'Freediving', 'Inne'] as const
const COURSES = '/kursy-nurkowania.html'

/** Upcoming published sessions (start in the future), soonest first. */
export async function upcomingSessions(where?: Where, limit = 200) {
  const future: Where = { startsAt: { greater_than_equal: nowISO() } }
  const r = await publicFind<SessionDoc>('course-sessions', {
    where: where ? { and: [future, where] } : future, limit, depth: 0, sort: 'startsAt',
  })
  return r.docs
}

const courseIdOf = (s: SessionDoc) => (typeof s.course === 'object' ? s.course.id : s.course)

/** Next session per course id. */
export function nextByCourse(sessions: SessionDoc[]) {
  const m = new Map<number, SessionDoc>()
  for (const s of sessions) if (!m.has(courseIdOf(s))) m.set(courseIdOf(s), s)
  return m
}

/** Price shown on a course row: the next session's price, else the course price field. */
const coursePrice = (c: CourseDoc, s?: SessionDoc) => centsOf(s?.priceCents) ?? centsOf(null, c.price)

/** The course ladder: depth on the left in mono, name and lead, then the next date or price. */
export function CourseLadder({ courses, next }: { courses: CourseDoc[]; next: Map<number, SessionDoc> }) {
  return (
    <ul className="ladder">
      {courses.map((c) => {
        const s = next.get(c.id)
        const price = coursePrice(c, s)
        return (
          <li key={c.id}>
            <Link href={courseHref(c.slug)} className="rowlink">
              <span className="depth">{c.maxDepth ? <>{c.maxDepth} m<small>uprawnienia</small></> : <>—<small>{c.level ? COURSE_LEVEL[c.level] || 'kurs' : 'kurs'}</small></>}</span>
              <span className="rowtext"><strong>{c.name}</strong>{c.lead ? <span className="rowlead">{c.lead}</span> : null}</span>
              <span className="go">
                {s ? <>Start <DateText value={s.startsAt} format="short" /></> : price !== null ? formatMoney(price) : 'Terminy na zapytanie'}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export async function CoursesIndex({ page, org }: { page: number; org?: string }) {
  const orgOk = ORGS.find((o) => o === org)
  const [courses, sessions] = await Promise.all([
    publicFind<CourseDoc>('courses', { where: orgOk ? { org: { equals: orgOk } } : undefined, limit: PAGE_SIZE, page, depth: 0, sort: 'order' }),
    upcomingSessions(),
  ])
  const next = nextByCourse(sessions)
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Kursy nurkowania' }]} />
      <h1 className="h2">Kursy nurkowania</h1>
      <p className="lead">Przy każdym kursie podajemy najbliższy termin, jeśli jest już w kalendarzu. Pełną listę terminów znajdziesz w <Link className="textlink" href="/kalendarz.html">kalendarzu</Link>.</p>
      <nav className="filters" aria-label="Federacja">
        <ul>
          <li><Link href={COURSES} aria-current={!orgOk ? 'page' : undefined}>Wszystkie</Link></li>
          {ORGS.map((o) => <li key={o}><Link href={withQuery(COURSES, { org: o })} aria-current={orgOk === o ? 'page' : undefined}>{o}</Link></li>)}
        </ul>
      </nav>
      {courses.docs.length
        ? <CourseLadder courses={courses.docs} next={next} />
        : <EmptyState title={orgOk ? `Brak opublikowanych kursów ${orgOk}` : 'Lista kursów nie jest jeszcze opublikowana'} action={orgOk ? { href: COURSES, label: 'Pokaż wszystkie kursy' } : { href: '/kontakt.html', label: 'Zapytaj o kurs' }} />}
      <Pagination page={page} totalPages={courses.totalPages} hrefFor={(n) => withQuery(COURSES, { org: orgOk, strona: n })} label="Strony listy kursów" />
    </div></div>
  )
}

function SessionTable({ sessions }: { sessions: SessionDoc[] }) {
  return (
    <ul className="sessions">
      {sessions.map((s) => {
        const left = seatsLeft(s)
        const price = centsOf(s.priceCents)
        return (
          <li key={s.id} className={left === 0 ? 'session-full' : undefined}>
            <span className="session-d mono"><DateRange from={s.startsAt} to={s.endsAt} /></span>
            <span className="session-t">{s.title}{s.location ? <span className="muted">, {s.location}</span> : null}</span>
            <span className="session-f mono">
              {price !== null ? <span>{formatMoney(price)}</span> : null}
              {left === null ? null : left === 0 ? <span>Brak miejsc</span> : <span>Wolne miejsca: {left}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export async function CoursePage({ course: c }: { course: CourseDoc }) {
  const [sessions, legal] = await Promise.all([
    upcomingSessions({ course: { equals: c.id } }, PAGE_SIZE),
    getLegalLinks(),
  ])
  const next = sessions[0]
  const price = coursePrice(c, next)
  const gallery = (c.gallery || []).filter((g) => asObject(g))
  const hasBody = !!c.body?.trim()
  const hasSections = !!c.sections?.length
  const schema = courseSchema(c, siteOrigin())
  return (
    <>
      {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} /> : null}
      <section className="chero">
        <MediaImage media={c.image} fallback="/img/kurs.jpg" alt="" sizes="100vw" eager />
        <div className="wrap">
          <Crumbs items={[{ label: 'Kursy nurkowania', href: COURSES }, { label: c.name }]} />
          {(c.org || c.level) && <p className="kicker">{[c.org, c.level ? COURSE_LEVEL[c.level] : null].filter(Boolean).join(', ')}</p>}
          <h1 className="h2">{c.name}</h1>
          {c.lead && <p className="lead">{c.lead}</p>}
          {(c.maxDepth || c.minAge || next || price !== null) && (
            <dl className="stats">
              {c.maxDepth ? <div><dt>Uprawnienia do</dt><dd>{c.maxDepth} m</dd></div> : null}
              {c.minAge ? <div><dt>Minimalny wiek</dt><dd>{c.minAge} lat</dd></div> : null}
              {next ? <div><dt>Najbliższy start</dt><dd><DateText value={next.startsAt} format="short" /></dd></div> : null}
              {price !== null ? <div><dt>{next && centsOf(next.priceCents) !== null ? 'Cena terminu' : 'Cena kursu'}</dt><dd>{formatMoney(price)}</dd></div> : null}
            </dl>
          )}
        </div>
      </section>
      <div className="section light"><div className="wrap cbody">
        <div>
          {hasBody ? <RichBody html={c.body} /> : null}
          {!hasBody && hasSections ? (c.sections || []).map((s, i) => (
            <section key={s.id || i} className="csec"><h2 className="h3">{s.title}</h2><PlainText text={s.body} /></section>
          )) : null}
          {!hasBody && !hasSections ? (
            <EmptyState title="Opis kursu nie jest jeszcze opublikowany" action={{ href: '/kontakt.html', label: 'Zapytaj o program kursu' }} />
          ) : null}
          <section className="csec" aria-labelledby="terminy">
            <h2 id="terminy" className="h3">Terminy</h2>
            {sessions.length
              ? <SessionTable sessions={sessions} />
              : <p className="muted">Nie ma jeszcze opublikowanych terminów. Wyślij zgłoszenie bez terminu, a ustalimy go indywidualnie.</p>}
          </section>
          {gallery.length > 0 && (
            <section className="csec" aria-labelledby="galeria">
              <h2 id="galeria" className="h3">Zdjęcia</h2>
              <AlbumGrid photos={gallery.map((g) => ({ src: mediaUrl(g, 'full'), thumb: mediaUrl(g, 'thumb'), alt: mediaAlt(g) }))} label={`Zdjęcia: ${c.name}`} />
            </section>
          )}
        </div>
        <aside className="aside" aria-labelledby="zapis">
          {!!c.includes?.length && <><h2 className="subh subh-first">W cenie kursu</h2><ul className="incl">{c.includes.map((i, n) => <li key={i.id || n}>{i.text}</li>)}</ul></>}
          <h2 id="zapis" className={'subh' + (c.includes?.length ? '' : ' subh-first')}>Zgłoszenie na kurs</h2>
          <SignupForm
            courseId={c.id}
            courseName={c.name}
            sessions={sessions.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, remaining: seatsLeft(s) }))}
            privacyHref={legal.find((l) => l.role === 'privacy')?.href}
          />
        </aside>
      </div></div>
    </>
  )
}
