import Link from 'next/link'
import { safeExternalUrl, type LegalLink, type SettingsDoc } from '@/lib/presentation'
import type { NavItem } from './nav'
import { CookieSettings } from './CookieSettings'
import { PhoneLinks } from './Phone'

export function Footer({ s, nav, legal, preview }: { s: SettingsDoc; nav: NavItem[]; legal: LegalLink[]; preview: boolean }) {
  const fb = safeExternalUrl(s.facebook)
  const yt = safeExternalUrl(s.youtube)
  return (
    <footer className="foot"><div className="wrap">
      <div>
        <p className="foot-brand">Underwater.pl</p>
        {s.address ? <p className="mono pre foot-addr">{s.address}</p> : null}
      </div>
      <nav aria-label="Stopka"><h2 className="foot-h">Serwis</h2><ul>
        {nav.map((n) => <li key={n.href}><Link href={n.href}>{n.label}</Link></li>)}
        <li><Link href="/relacje-z-wypraw.html">Relacje</Link></li>
        <li><Link href="/koszyk">Koszyk</Link></li>
      </ul></nav>
      <div><h2 className="foot-h">Kontakt</h2><ul>
        {s.phone?.trim() ? <li><PhoneLinks value={s.phone} /></li> : null}
        {s.email ? <li><a href={`mailto:${s.email}`}>{s.email}</a></li> : null}
        {fb ? <li><a href={fb} rel="noopener noreferrer" target="_blank">Facebook<span className="sr-only"> (nowa karta)</span></a></li> : null}
        {yt ? <li><a href={yt} rel="noopener noreferrer" target="_blank">YouTube<span className="sr-only"> (nowa karta)</span></a></li> : null}
      </ul></div>
      <div><h2 className="foot-h">Dokumenty</h2><ul>
        {legal.map((l) => <li key={l.href}><Link href={l.href}>{l.title}</Link></li>)}
        {!legal.length ? <li className="foot-note">Regulamin i polityka prywatności nie są jeszcze opublikowane w tej wersji podglądowej.</li> : null}
        <li><CookieSettings preview={preview} /></li>
      </ul></div>
      <div className="cr">
        <span>© {new Date().getFullYear()} Underwater.pl</span>
        {s.nip ? <span>NIP {s.nip}</span> : null}
      </div>
    </div></footer>
  )
}
