import Link from 'next/link'
import { db, imgUrl, dateTime, dateShort, zl } from '@/lib/data'
import { SignupForm } from '@/components/SignupForm'

const LEVEL: Record<string, string> = { intro: 'Wprowadzenie', basic: 'Podstawowy', advanced: 'Zaawansowany', rescue: 'Ratownictwo', pro: 'Zawodowy', specialty: 'Specjalizacja' }

export async function CoursesIndex() {
  const payload = await db()
  const r = await payload.find({ collection: 'courses', sort: 'order', limit: 30 })
  return (
    <div className="section light"><div className="wrap">
      <div className="crumbs"><Link href="/">Start</Link><span>/</span><span>Kursy</span></div>
      <p className="kicker">Szkolenia PADI · Warszawa</p>
      <h1 className="h2" style={{ maxWidth: '16ch' }}>Kursy nurkowania</h1>
      <p className="lead">Teoria i basen w Warszawie, nurkowania w wodach otwartych w Polsce albo na wyprawie. Grupy do czterech osób, więc instruktor ma czas na każdego. Kurs można rozłożyć na raty.</p>
      <div className="ladder" style={{ marginTop: 56 }}>
        {r.docs.map((c) => (
          <Link key={c.id} href={`/kursy-nurkowania/${c.slug}.html`} className="rowlink">
            <span className="depth">{c.maxDepth ? <>{c.maxDepth} m<small>uprawnienia</small></> : <>—<small>{c.level ? LEVEL[c.level] : 'kurs'}</small></>}</span>
            <span><strong>{c.name}</strong><p>{c.lead}</p></span>
            <span className="go">{c.nextDate ? `Start ${dateShort(c.nextDate)}` : c.price ? zl(c.price) : 'Zapytaj'} <span className="arrow">→</span></span>
          </Link>
        ))}
      </div>
    </div></div>
  )
}

export async function CoursePage({ course: c }: { course: any }) {
  return (
    <>
      <section className="chero">
        <img src={c.image ? imgUrl(c.image, 'card') : '/img/kurs.jpg'} alt="" />
        <div className="wrap">
          <div className="crumbs" style={{ color: 'var(--haze)' }}>
            <Link href="/">Start</Link><span>/</span><Link href="/kursy-nurkowania.html">Kursy</Link><span>/</span><span>{c.name}</span>
          </div>
          <p className="kicker" style={{ color: 'var(--brass-lift)' }}>{c.org}{c.level ? ` · ${LEVEL[c.level]}` : ''}</p>
          <h1 className="h2">{c.name}</h1>
          <p className="lead" style={{ color: '#C6D8E0' }}>{c.lead}</p>
          <div className="stats">
            {c.maxDepth && <div><b>{c.maxDepth} m</b><span>Uprawnienia</span></div>}
            {c.minAge && <div><b>{c.minAge}+</b><span>Minimalny wiek</span></div>}
            {c.nextDate && <div><b>{dateShort(c.nextDate)}</b><span>Najbliższy start</span></div>}
            <div><b>{c.price ? zl(c.price) : 'Raty'}</b><span>{c.price ? 'Cena kursu' : 'Zapytaj o cenę'}</span></div>
          </div>
        </div>
      </section>
      <div className="section light"><div className="wrap cbody">
        <div>
          {(c.sections || []).map((s: any) => (
            <section key={s.id} className="csec"><h2 className="h3">{s.title}</h2><p>{s.body}</p></section>
          ))}
          {!c.sections?.length && <p className="prose">Pełny opis tego kursu przenosimy z obecnej strony przy wdrożeniu. Zobacz w całości opisany <Link href="/kursy-nurkowania/padi-open-water-diver.html" className="textlink">kurs PADI Open Water Diver</Link>.</p>}
          {c.gallery?.length > 1 && (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', marginTop: 44 }}>
              {c.gallery.filter((g: any) => typeof g === 'object').map((g: any) => <img key={g.id} src={imgUrl(g, 'card')} alt="" loading="lazy" style={{ aspectRatio: '4/3', objectFit: 'cover' }} />)}
            </div>
          )}
        </div>
        <aside className="aside">
          {c.nextDate && <p className="mono" style={{ fontSize: 13, margin: '0 0 18px' }}>Najbliższy termin: {dateTime(c.nextDate)}</p>}
          {c.includes?.length > 0 && <><p className="subh" style={{ marginTop: 0 }}>W cenie kursu</p><ul className="incl">{c.includes.map((i: any) => <li key={i.id}>{i.text}</li>)}</ul></>}
          <p className="subh">Zapisz się</p>
          <SignupForm courseId={c.id} courseName={c.name} />
        </aside>
      </div></div>
    </>
  )
}
