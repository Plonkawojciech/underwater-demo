import Link from 'next/link'
import { db } from '@/lib/data'

export async function ContactPage() {
  const payload = await db()
  const s = await payload.findGlobal({ slug: 'settings' })
  const tel = (s.phone || '').replace(/\s/g, '')
  return (
    <div className="section light"><div className="wrap">
      <div className="crumbs"><Link href="/">Start</Link><span>/</span><span>Kontakt</span></div>
      <div className="contact">
        <div>
          <p className="kicker">Centrum nurkowe</p>
          <h1 className="h2">Wpadnij, zadzwoń albo napisz</h1>
          <p className="lead">Jesteśmy na Woli, pięć minut od Ronda Daszyńskiego. Przyjmujemy sprzęt do serwisu, doradzamy przy zakupach i zapisujemy na kursy.</p>
          <div className="dl">
            <div><b>Telefon</b><a href={`tel:${tel}`}>{s.phone}</a></div>
            <div><b>E-mail</b><a href={`mailto:${s.email}`}>{s.email}</a></div>
            <div><b>Adres</b><span style={{ whiteSpace: 'pre-line' }}>{s.address}</span></div>
            <div><b>NIP</b><span className="mono">{s.nip}</span></div>
          </div>
        </div>
        <form className="form" action="/kontakt.html" method="get" style={{ alignSelf: 'start' }}>
          <p className="subh" style={{ marginTop: 0 }}>Napisz do nas</p>
          <label>Imię i nazwisko<input name="name" required /></label>
          <div className="form-row">
            <label>E-mail<input name="email" type="email" required /></label>
            <label>Telefon<input name="phone" type="tel" /></label>
          </div>
          <label>Wiadomość<textarea name="message" rows={5} required /></label>
          <button className="btn btn-solid">Wyślij wiadomość <span className="arrow">→</span></button>
          <p className="note">W wersji produkcyjnej wiadomości trafiają do panelu i na e-mail. Bez captchy z obrazkami — ochrona przed spamem działa w tle.</p>
        </form>
      </div>
    </div></div>
  )
}
