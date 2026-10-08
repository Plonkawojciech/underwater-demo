'use client'
import Link from 'next/link'

// No error details are shown: they can contain internal data. The digest helps find the log entry.
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="section light"><div className="wrap">
      <h1 className="h2">Nie udało się wczytać strony</h1>
      <p className="lead">Spróbuj ponownie za chwilę. Ten błąd nie usuwa zawartości koszyka.</p>
      <div className="hero-cta">
        <button type="button" className="btn btn-solid" onClick={reset}>Spróbuj ponownie</button>
        <Link className="btn btn-line" href="/">Strona główna</Link>
      </div>
      {error.digest ? <p className="note mono">Kod błędu: {error.digest}</p> : null}
    </div></div>
  )
}
