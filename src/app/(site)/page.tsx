import Link from 'next/link'
import { db, imgUrl, imgAlt, dateLong, dateShort, zl } from '@/lib/data'
import { ProductCard } from '@/components/ProductCard'

export default async function Home() {
  const payload = await db()
  const [s, products, courses] = await Promise.all([
    payload.findGlobal({ slug: 'settings' }),
    payload.find({ collection: 'products', where: { featured: { equals: true } }, limit: 3, depth: 1 }),
    payload.find({ collection: 'courses', sort: 'order', limit: 6 }),
  ])
  const owd = courses.docs.find((c) => c.nextDate)
  return (
    <>
      <section className="hero">
        <div className="hero-media">{s.heroImage
          ? <img src={imgUrl(s.heroImage, 'full')} alt="" fetchPriority="high" />
          : <img src="/img/wyprawa.jpg" alt="" fetchPriority="high" />}</div>
        <div className="wrap">
          {owd?.nextDate && <p className="hero-next"><em />Najbliższy kurs {owd.name.replace('PADI ', '')} · {dateLong(owd.nextDate)}</p>}
          <h1 className="display">{s.heroTitle}</h1>
          <p className="lead">{s.heroText}</p>
          <div className="hero-cta">
            <Link className="btn btn-solid" href="/kursy-nurkowania.html">Wybierz kurs <span className="arrow">→</span></Link>
            <Link className="btn btn-line" href="/sklep-nurkowy.html">Sklep nurkowy</Link>
          </div>
        </div>
      </section>

      <section className="facts"><div className="wrap">
        <div className="fact"><b>1998</b><span>Od tego roku szkolimy</span></div>
        <div className="fact"><b>3</b><span>Federacje: PADI, TDI/SDI, IANTD</span></div>
        <div className="fact"><b>4</b><span>Osoby w grupie kursowej</span></div>
        <div className="fact"><b>40 m</b><span>Do tylu metrów szkolimy</span></div>
      </div></section>

      <section className="section light"><div className="wrap">
        <div className="sechead">
          <div>
            <p className="kicker">Szkolenia</p>
            <h2 className="h2">Od pierwszego oddechu pod wodą<br />do stopnia zawodowego</h2>
          </div>
          <Link className="textlink" href="/kursy-nurkowania.html">Wszystkie kursy →</Link>
        </div>
        <div className="ladder">
          {courses.docs.map((c) => (
            <Link key={c.id} href={`/kursy-nurkowania/${c.slug}.html`} className="rowlink">
              <span className="depth">{c.maxDepth ? <>{c.maxDepth} m<small>uprawnienia</small></> : <>—<small>specjalizacja</small></>}</span>
              <span><strong>{c.name}</strong><p>{c.lead}</p></span>
              <span className="go">{c.nextDate ? `Start ${dateShort(c.nextDate)}` : c.price ? zl(c.price) : 'Zapytaj'} <span className="arrow">→</span></span>
            </Link>
          ))}
        </div>
      </div></section>

      <section className="band">
        <img src="/img/wyprawa.jpg" alt="Nurkowanie w jaskini na Morzu Śródziemnym" loading="lazy" />
        <div className="wrap">
          <p className="kicker" style={{ color: 'var(--brass-lift)' }}>Wyprawy</p>
          <h2 className="h2">Nurkujemy tam, gdzie sami chcemy wracać</h2>
          <p className="lead">Malta i Gozo, Morze Czerwone, chorwacki Adriatyk, jaskinie Sardynii. Małe grupy, instruktor z Warszawy na miejscu, plan nurkowy ustalany rano przy kawie, a nie w biurze podróży.</p>
          <div className="hero-cta"><Link className="btn btn-line" href="/kontakt.html">Zapytaj o najbliższy termin</Link></div>
        </div>
      </section>

      <section className="section light"><div className="wrap">
        <div className="sechead">
          <div>
            <p className="kicker">Sklep nurkowy</p>
            <h2 className="h2">Sprzęt, który sami zabieramy pod wodę</h2>
            <p className="lead">{s.priceGuarantee}</p>
          </div>
          <Link className="textlink" href="/sklep-nurkowy.html">Cały sklep →</Link>
        </div>
        <div className="grid">{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div></section>

      <section className="section dark"><div className="wrap">
        <div className="sechead" style={{ marginBottom: 0 }}>
          <div>
            <p className="kicker">Centrum nurkowe</p>
            <h2 className="h2">ul. Okopowa 31/94, Warszawa</h2>
            <p className="lead">Zadzwoń albo wpadnij. Doradzimy sprzęt, przyjmiemy automat do serwisu i powiemy szczerze, który kurs ma dla Ciebie sens, a który jeszcze nie.</p>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <a className="btn btn-solid" href={`tel:${(s.phone || '').replace(/\s/g, '')}`}>{s.phone}</a>
            <Link className="btn btn-line" href="/kontakt.html">Napisz do nas</Link>
          </div>
        </div>
      </div></section>
    </>
  )
}
