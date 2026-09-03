import Link from 'next/link'
import { db, imgUrl, imgAlt, dateLong, dateTime, dateShort, zl } from '@/lib/data'
import { SignupForm } from '@/components/SignupForm'

const LEVEL: Record<string, string> = { intro: 'Wprowadzenie', basic: 'Podstawowy', advanced: 'Zaawansowany', rescue: 'Ratownictwo', pro: 'Profesjonalny', specialty: 'Specjalizacja' }

export async function CoursesIndex() {
  const payload = await db()
  const r = await payload.find({ collection: 'courses', sort: 'order', limit: 100 })
  const groups = ['PADI', 'IANTD', 'TDI/SDI', 'Freediving', 'Inne'].map((g) => ({ g, items: r.docs.filter((c) => c.org === g) })).filter((x) => x.items.length)
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Kursy nurkowania</div>
      <p className="eyebrow">Szkolenia</p>
      <h1 className="h1">Kursy nurkowania w Warszawie</h1>
      <p className="lead">Od pierwszego zanurzenia w basenie po stopnie zawodowe. Zajęcia teoretyczne i basenowe w Warszawie, nurkowania w wodach otwartych w Polsce lub na wyprawie. Kurs można rozłożyć na raty.</p>
      {groups.map(({ g, items }) => (
        <section key={g} style={{ marginTop: 44 }}>
          <h2 className="h3" style={{ marginBottom: 14 }}>{g === 'Inne' ? 'Pozostałe' : g === 'Freediving' ? 'Freediving' : `Kursy ${g}`}</h2>
          <div className="ladder">
            {items.map((c) => (
              <Link key={c.id} href={`/kursy-nurkowania/${c.slug}.html`} className="rung">
                <div className="m">{c.maxDepth ? <>{c.maxDepth}<small>metrów</small></> : <>—<small>{c.level ? LEVEL[c.level] : ''}</small></>}</div>
                <div><strong>{c.name}</strong><span>{c.lead}</span></div>
                <span className="go">{c.nextDate ? `Start ${dateShort(c.nextDate)}` : 'Zapytaj o termin'} →</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export async function CoursePage({ course: c }: { course: any }) {
  return (
    <>
      <section className="chero"><div className="wrap">
        <div>
          <div className="crumbs" style={{ color: '#9fb6c8' }}><Link href="/" style={{ color: '#9fb6c8' }}>Strona główna</Link><span>/</span><Link href="/kursy-nurkowania.html" style={{ color: '#9fb6c8' }}>Kursy nurkowania</Link><span>/</span>{c.name}</div>
          <p className="eyebrow" style={{ color: '#9fb6c8' }}>{c.org} · {c.level ? LEVEL[c.level] : ''}</p>
          <h1 className="h1">Kurs nurkowania {c.name}</h1>
          <p className="lead" style={{ color: '#c7d6e2' }}>{c.lead}</p>
          <div className="facts">
            {c.maxDepth && <div><b>{c.maxDepth} m</b><span>Uprawnienia</span></div>}
            {c.minAge && <div><b>{c.minAge}+</b><span>Minimalny wiek</span></div>}
            {c.nextDate && <div><b>{dateShort(c.nextDate)}</b><span>Najbliższy start</span></div>}
            <div><b>{c.price ? zl(c.price) : 'Raty'}</b><span>{c.price ? 'Cena' : 'Możliwość rat'}</span></div>
          </div>
        </div>
        {c.image && <img src={imgUrl(c.image, 'card')} alt={imgAlt(c.image)} />}
      </div></section>
      <div className="wrap section cbody">
        <div>
          {c.nextDate && <p className="tag" style={{ marginBottom: 20 }}>Najbliższy kurs: {dateTime(c.nextDate)}</p>}
          {(c.sections || []).map((s: any) => <section key={s.id}><h2 className="h3">{s.title}</h2><p>{s.body}</p></section>)}
          {!c.sections?.length && <section><h2 className="h3">Program kursu</h2><p>Szczegółowy opis tego kursu w wersji demo jest skrócony. Pełne treści z obecnej strony przeniesiemy przy migracji. Zobacz w pełni opisany <Link href="/kursy-nurkowania/padi-open-water-diver.html">kurs PADI Open Water Diver</Link>.</p></section>}
          {c.gallery?.length > 1 && <div className="grid-3" style={{ marginTop: 32 }}>{c.gallery.filter((g: any) => typeof g === 'object').map((g: any) => <img key={g.id} src={imgUrl(g, 'card')} alt={imgAlt(g)} style={{ borderRadius: 6 }} loading="lazy" />)}</div>}
        </div>
        <aside className="aside">
          {c.includes?.length > 0 && <><h2 className="h3" style={{ marginBottom: 12 }}>W cenie kursu</h2><ul className="incl">{c.includes.map((i: any) => <li key={i.id}>{i.text}</li>)}</ul></>}
          <h2 className="h3" style={{ marginBottom: 12 }}>Zapisz się</h2>
          <SignupForm courseId={c.id} courseName={c.name} />
        </aside>
      </div>
    </>
  )
}

export async function TripsIndex() {
  const payload = await db()
  const r = await payload.find({ collection: 'trips', limit: 50, sort: '-featured' })
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Wyprawy nurkowe</div>
      <p className="eyebrow">Wyprawy</p>
      <h1 className="h1">Wyprawy nurkowe</h1>
      <p className="lead">Jeździmy tam, gdzie woda jest cieplejsza i przejrzystsza niż w Polsce. Małe grupy, instruktor na miejscu, sprzęt do wypożyczenia.</p>
      <div className="list-grid" style={{ marginTop: 36 }}>
        {r.docs.map((t) => <Link key={t.id} href={`/wyprawy-nurkowe/${t.slug}.html`} className="tcard">{t.image && <img src={imgUrl(t.image, 'card')} alt={imgAlt(t.image)} loading="lazy" />}<div><strong>{t.name}</strong><span className="muted">{t.lead}</span>{t.dateFrom && <span className="mono" style={{ fontSize: 13 }}>{dateShort(t.dateFrom)} – {dateLong(t.dateTo)}</span>}</div></Link>)}
      </div>
    </div>
  )
}

export async function TripPage({ trip: t }: { trip: any }) {
  return (
    <>
      <section className="chero"><div className="wrap">
        <div>
          <div className="crumbs" style={{ color: '#9fb6c8' }}><Link href="/" style={{ color: '#9fb6c8' }}>Strona główna</Link><span>/</span><Link href="/wyprawy-nurkowe.html" style={{ color: '#9fb6c8' }}>Wyprawy nurkowe</Link><span>/</span>{t.name}</div>
          <p className="eyebrow" style={{ color: '#9fb6c8' }}>{[t.country, t.place].filter(Boolean).join(' · ')}</p>
          <h1 className="h1">{t.name}</h1>
          <p className="lead" style={{ color: '#c7d6e2' }}>{t.lead}</p>
          <div className="facts">
            {t.dateFrom && <div><b>{dateShort(t.dateFrom)} – {dateShort(t.dateTo)}</b><span>Termin</span></div>}
            {typeof t.spotsLeft === 'number' && <div><b>{t.spotsLeft}</b><span>Wolne miejsca</span></div>}
            {t.price && <div><b>{zl(t.price)}</b><span>Cena</span></div>}
          </div>
        </div>
        {t.image && <img src={imgUrl(t.image, 'full')} alt={imgAlt(t.image)} />}
      </div></section>
      <div className="wrap section cbody">
        <div>
          {t.flights && <p className="tag" style={{ marginBottom: 20 }}>Przelot: {t.flights}</p>}
          {(t.sections || []).map((s: any) => <section key={s.id}><h2 className="h3">{s.title}</h2><p>{s.body}</p></section>)}
          {!t.sections?.length && <p className="muted">Szczegółowy program tej wyprawy w wersji demo jest skrócony.</p>}
        </div>
        <aside className="aside"><h2 className="h3" style={{ marginBottom: 12 }}>Zapytaj o miejsce</h2><p className="muted" style={{ marginTop: 0 }}>Zadzwoń: <a href="tel:+48504162014">504 16 20 14</a> lub napisz: <a href="mailto:underwater@underwater.pl">underwater@underwater.pl</a>.</p><Link className="btn btn-accent" href="/kontakt.html">Formularz kontaktowy</Link></aside>
      </div>
    </>
  )
}
