import Link from 'next/link'
export default function NotFound() {
  return <div className="wrap section"><p className="eyebrow">Błąd 404</p><h1 className="h1">Tej strony nie ma</h1><p className="lead">Adres mógł się zmienić. Wróć na <Link href="/">stronę główną</Link> albo przejdź do <Link href="/sklep-nurkowy.html">sklepu</Link>.</p></div>
}
