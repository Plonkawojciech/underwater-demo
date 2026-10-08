import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="section light"><div className="wrap">
      <h1 className="h2">Nie ma strony pod tym adresem</h1>
      <p className="lead">Sprawdź adres albo przejdź do jednej z głównych sekcji.</p>
      <ul className="hero-cta plain">
        <li><Link className="btn btn-solid" href="/">Strona główna</Link></li>
        <li><Link className="btn btn-line" href="/kursy-nurkowania.html">Kursy</Link></li>
        <li><Link className="btn btn-line" href="/sklep-nurkowy.html">Sklep</Link></li>
        <li><Link className="btn btn-line" href="/kontakt.html">Kontakt</Link></li>
      </ul>
    </div></div>
  )
}
