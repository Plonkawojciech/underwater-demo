import Link from 'next/link'
import { db, imgUrl, imgAlt, dateLong, dateShort } from '@/lib/data'
import { DepthScale } from '@/components/DepthScale'
import { ProductCard } from '@/components/ProductCard'

export default async function Home() {
  const payload = await db()
  const [s, products, courses, trips, posts] = await Promise.all([
    payload.findGlobal({ slug: 'settings' }),
    payload.find({ collection: 'products', where: { featured: { equals: true } }, limit: 6, depth: 1 }),
    payload.find({ collection: 'courses', where: { featured: { equals: true } }, sort: 'order', limit: 6 }),
    payload.find({ collection: 'trips', where: { featured: { equals: true } }, limit: 1 }),
    payload.find({ collection: 'posts', sort: '-publishedAt', limit: 2 }),
  ])
  const owd = courses.docs.find((c) => c.slug === 'padi-open-water-diver')
  const trip = trips.docs[0]
  const marks = courses.docs.filter((c) => c.maxDepth).map((c) => ({ depth: c.maxDepth as number, label: c.name.replace('PADI ', '') }))
    .filter((m, i, a) => a.findIndex((x) => x.depth === m.depth) === i)
  return (
    <>
      <section className="hero">
        {s.heroImage && <img className="hero-img" src={imgUrl(s.heroImage, 'full')} alt="" fetchPriority="high" />}
        <div className="wrap">
          <div>
            {owd?.nextDate && <div className="hero-next"><i />Najbliższy kurs OWD: {dateLong(owd.nextDate)}, Warszawa</div>}
            <h1 className="display">{s.heroTitle}</h1>
            <p className="lead">{s.heroText}</p>
            <div className="hero-ctas">
              <Link className="btn btn-accent" href="/kursy-nurkowania/padi-open-water-diver.html">Zapisz się na kurs OWD</Link>
              <Link className="btn btn-ghost" href="/sklep-nurkowy.html">Sklep nurkowy</Link>
            </div>
          </div>
          <DepthScale marks={marks} />
        </div>
      </section>

      <section className="section"><div className="wrap">
        <div className="pillars">
          <Link href="/kursy-nurkowania.html" className="pillar"><img src="/img/kursy.jpg" alt="" loading="lazy" /><div><strong>Kursy nurkowania</strong><span>PADI, TDI/SDI, IANTD, freediving</span></div></Link>
          <Link href="/sklep-nurkowy.html" className="pillar"><img src="/img/sklep.jpg" alt="" loading="lazy" /><div><strong>Sklep nurkowy</strong><span>Gwarancja najniższej ceny</span></div></Link>
          <Link href="/wyprawy-nurkowe.html" className="pillar"><img src="/img/wyprawy.jpg" alt="" loading="lazy" /><div><strong>Wyprawy nurkowe</strong><span>Malta, Egipt, Chorwacja, Sardynia</span></div></Link>
          <Link href="/serwis-sprzetu-nurkowego.html" className="pillar"><img src="/img/serwis.jpg" alt="" loading="lazy" /><div><strong>Serwis sprzętu</strong><span>Automaty, butle, jackety, suche skafandry</span></div></Link>
        </div>
      </div></section>

      <section className="section band"><div className="wrap">
        <div className="sec-head"><div><p className="eyebrow">Sklep nurkowy</p><h2 className="h2">Promocje</h2></div><Link className="more" href="/sklep-nurkowy.html">Wszystkie kategorie →</Link></div>
        <div className="grid-3">{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div></section>

      {trip && <section className="section"><div className="wrap">
        <p className="eyebrow">Najbliższa wyprawa</p>
        <div className="trip">
          <img src={imgUrl(trip.image, 'full')} alt={imgAlt(trip.image)} loading="lazy" />
          <div>
            <h2 className="h2">{trip.name}</h2>
            <p>{trip.lead}</p>
            <dl><dt>Termin</dt><dd>{dateShort(trip.dateFrom)} – {dateLong(trip.dateTo)}</dd>{trip.flights && <><dt>Przelot</dt><dd>{trip.flights}</dd></>}{typeof trip.spotsLeft === 'number' && <><dt>Wolne miejsca</dt><dd>{trip.spotsLeft}</dd></>}</dl>
            <Link className="btn btn-accent" href={`/wyprawy-nurkowe/${trip.slug}.html`}>Szczegóły wyprawy</Link>
          </div>
        </div>
      </div></section>}

      <section className="section band"><div className="wrap">
        <div className="sec-head"><div><p className="eyebrow">Ścieżka szkolenia</p><h2 className="h2">Od pierwszego oddechu pod wodą do 40 metrów</h2></div><Link className="more" href="/kursy-nurkowania.html">Wszystkie kursy →</Link></div>
        <div className="ladder">
          {courses.docs.map((c) => (
            <Link key={c.id} href={`/kursy-nurkowania/${c.slug}.html`} className="rung">
              <div className="m">{c.maxDepth ? <>{c.maxDepth}<small>metrów</small></> : <>—<small>bez limitu</small></>}</div>
              <div><strong>{c.name}</strong><span>{c.lead}</span></div>
              <span className="go">{c.nextDate ? `Start ${dateShort(c.nextDate)}` : 'Zapytaj o termin'} →</span>
            </Link>
          ))}
        </div>
      </div></section>

      <section className="section"><div className="wrap guar">
        <div className="box"><p className="eyebrow" style={{ color: '#9fb6c8' }}>Sklep</p><h2 className="h2">Gwarancja najniższej ceny</h2><p>{s.priceGuarantee}</p></div>
        <div>
          <p className="eyebrow">Aktualności</p>
          <div className="news" style={{ gridTemplateColumns: '1fr' }}>
            {posts.docs.map((p) => <article key={p.id}>{p.image ? <img src={imgUrl(p.image, 'thumb')} alt="" loading="lazy" /> : <span />}<div><time>{dateLong(p.publishedAt)}</time><h3><Link href={`/aktualnosci/${p.slug}.html`}>{p.title}</Link></h3><p className="muted" style={{ margin: 0 }}>{p.excerpt}</p></div></article>)}
          </div>
        </div>
      </div></section>

      <section className="section band"><div className="wrap contact-strip">
        <div><b>Telefon</b><a href={`tel:${(s.phone || '').replace(/\s/g, '')}`}>{s.phone}</a></div>
        <div><b>E-mail</b><a href={`mailto:${s.email}`}>{s.email}</a></div>
        <div><b>Adres</b>{(s.address || '').replace('\n', ', ')}</div>
        <div><b>Szkolimy</b>PADI · TDI/SDI · IANTD</div>
      </div></section>
    </>
  )
}
