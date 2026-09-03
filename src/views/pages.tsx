import Link from 'next/link'
import { db, imgUrl, dateLong } from '@/lib/data'

export async function PostsIndex() {
  const payload = await db()
  const r = await payload.find({ collection: 'posts', sort: '-publishedAt', limit: 30 })
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Aktualności</div>
      <h1 className="h1" style={{ marginBottom: 32 }}>Aktualności</h1>
      <div className="news">{r.docs.map((p) => <article key={p.id}>{p.image ? <img src={imgUrl(p.image, 'thumb')} alt="" /> : <span />}<div><time>{dateLong(p.publishedAt)}</time><h3><Link href={`/aktualnosci/${p.slug}.html`}>{p.title}</Link></h3><p className="muted" style={{ margin: 0 }}>{p.excerpt}</p></div></article>)}</div>
    </div>
  )
}
export async function PostPage({ post: p }: { post: any }) {
  return (
    <div className="wrap section prose">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span><Link href="/aktualnosci.html">Aktualności</Link></div>
      <time className="mono muted">{dateLong(p.publishedAt)}</time>
      <h1 className="h1" style={{ margin: '8px 0 20px' }}>{p.title}</h1>
      {p.image && <img src={imgUrl(p.image, 'card')} alt="" style={{ borderRadius: 6, marginBottom: 24 }} />}
      <p style={{ fontSize: 18 }}>{p.body}</p>
    </div>
  )
}
export async function AboutPage() {
  const team = [
    ['Robert Borzymek', 'Instruktor PADI MSDT #610780, nurek techniczny GUE T1'], ['Andrzej Trętowski', 'Instruktor PADI MSDT, instruktor EFR'], ['Maciej Chomicz', 'Instruktor PADI'], ['Marek Gabański', 'Instruktor PADI'], ['Max Jasiński', 'Instruktor PADI'], ['Łukasz Saliński', 'Instruktor PADI'], ['Bartek Rozkowski', 'Instruktor PADI'],
  ]
  const brands = ['Apeks', 'Aqualung', 'Atomic Aquatics', 'Bare', 'Bauer', 'Beuchat', 'Cressi', 'Dive Rite', 'DUX', 'Faber', 'Halcyon', 'Hollis', 'OMS', 'Poseidon', 'Santi', 'Scubapro', 'Sopras Sub', 'Suunto', 'TecLine', 'Tusa', 'Ursuit', 'xDeep', 'Zeagle']
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>O nas</div>
      <p className="eyebrow">Centrum nurkowe Underwater.pl</p>
      <h1 className="h1">Szkolimy w Warszawie od 1998 roku</h1>
      <div className="prose" style={{ marginTop: 20 }}>
        <p style={{ fontSize: 18 }}>Jesteśmy grupą instruktorów nurkowania organizacji PADI, TDI/SDI i IANTD. Każdy z instruktorów ma co najmniej dziesięcioletnie doświadczenie nurkowe. Do współpracy zapraszamy też zaprzyjaźnionych instruktorów, którzy pomagają nam w organizowaniu kursów i wypraw.</p>
        <p>Prowadzimy sklep nurkowy ze sprzętem renomowanych producentów w atrakcyjnych cenach, autoryzowany serwis sprzętu oraz wyprawy nurkowe do Egiptu, na Maltę, do Chorwacji i na Sardynię.</p>
        <h2 className="h3">Instruktorzy</h2>
      </div>
      <div className="team" style={{ margin: '16px 0 36px' }}>{team.map(([n, d]) => <div key={n}><b>{n}</b><span>{d}</span></div>)}</div>
      <h2 className="h3" style={{ marginBottom: 12 }}>Marki w sklepie i serwisie</h2>
      <div className="brands">{brands.map((b) => <span key={b}>{b}</span>)}</div>
    </div>
  )
}
export async function ServicePage() {
  const items = [['Automaty oddechowe', 'Przeglądy okresowe i naprawy, oryginalne części serwisowe'], ['Butle nurkowe', 'Legalizacja, czyszczenie, badania techniczne'], ['Jackety i skrzydła', 'Naprawa inflatorów, zaworów, wymiana uszczelnień'], ['Suche skafandry', 'Wymiana manszet, zaworów, naprawa nieszczelności'], ['Komputery i instrumenty', 'Wymiana baterii, testy ciśnieniowe'], ['Napełnianie butli', 'Powietrze, nitrox, trimiks']]
  const brands = ['Apeks', 'Aqualung', 'Atomic Aquatics', 'Bare', 'Bauer', 'DUX', 'ECS', 'Faber', 'Halcyon', 'OMS', 'Poseidon', 'Santi', 'Scubatech', 'Sopras Sub', 'Suunto', 'Tusa', 'TecLine', 'Ursuit', 'VDS Technology', 'Zeagle']
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Serwis sprzętu</div>
      <p className="eyebrow">Usługi i serwis</p>
      <h1 className="h1">Autoryzowany serwis sprzętu nurkowego</h1>
      <p className="lead">Kilkunastoletnia praktyka, szkolenia techniczne bezpośrednio u producentów i tylko oryginalne części. Naprawiamy i robimy przeglądy okresowe automatów, butli, jacketów i suchych skafandrów.</p>
      <div className="team" style={{ margin: '32px 0' }}>{items.map(([n, d]) => <div key={n}><b>{n}</b><span>{d}</span></div>)}</div>
      <h2 className="h3" style={{ marginBottom: 12 }}>Serwisujemy</h2>
      <div className="brands">{brands.map((b) => <span key={b}>{b}</span>)}</div>
      <div className="aside" style={{ position: 'static', marginTop: 36, maxWidth: 560 }}><h2 className="h3">Umów serwis</h2><p className="muted">Zadzwoń <a href="tel:+48504162014">504 16 20 14</a> albo przywieź sprzęt na ul. Okopową 31/94 w Warszawie. Przegląd automatu trwa zwykle kilka dni roboczych.</p><Link className="btn btn-accent" href="/kontakt.html">Napisz do serwisu</Link></div>
    </div>
  )
}
export async function ContactPage() {
  const payload = await db()
  const s = await payload.findGlobal({ slug: 'settings' })
  return (
    <div className="wrap section cbody">
      <div>
        <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Kontakt</div>
        <h1 className="h1">Kontakt</h1>
        <div className="contact-strip" style={{ marginTop: 28, flexDirection: 'column', gap: 18 }}>
          <div><b>Telefon</b><a href={`tel:${(s.phone || '').replace(/\s/g, '')}`}>{s.phone}</a></div>
          <div><b>E-mail</b><a href={`mailto:${s.email}`}>{s.email}</a></div>
          <div><b>Adres</b><span style={{ whiteSpace: 'pre-line' }}>{s.address}</span></div>
          <div><b>NIP</b>{s.nip}</div>
        </div>
      </div>
      <aside className="aside">
        <h2 className="h3" style={{ marginBottom: 12 }}>Napisz do nas</h2>
        <form className="form" action="/kontakt.html?wyslano=1" method="get">
          <label>Imię i nazwisko<input name="name" required /></label>
          <div className="form-row"><label>E-mail<input name="email" type="email" required /></label><label>Telefon<input name="phone" type="tel" /></label></div>
          <label>Temat<input name="subject" /></label>
          <label>Wiadomość<textarea name="message" rows={4} required /></label>
          <button className="btn btn-accent">Wyślij wiadomość</button>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>W wersji produkcyjnej wiadomości trafiają do panelu i na e-mail. Bez captchy z obrazkami: ochrona przed spamem działa w tle.</p>
        </form>
      </aside>
    </div>
  )
}
export async function TermsPage() {
  return (
    <div className="wrap section prose">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Regulamin sklepu</div>
      <h1 className="h1">Regulamin sklepu</h1>
      <p className="lead">Treść regulaminu zostanie przeniesiona z obecnej strony bez zmian. W wersji demo ta strona jest zaślepką.</p>
    </div>
  )
}
