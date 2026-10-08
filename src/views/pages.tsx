import { telHref } from '@/lib/presentation'
import { ContactForm, NewsletterForm } from '@/components/ContactForm'
import { Crumbs } from '@/components/content'
import { getLegalLinks, getSettings } from './query'

export async function ContactPage() {
  const [s, legal] = await Promise.all([getSettings(), getLegalLinks()])
  const tel = telHref(s.phone)
  const privacy = legal.find((l) => l.role === 'privacy')?.href
  const has = s.phone || s.email || s.address || s.nip
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Kontakt' }]} />
      <div className="contact">
        <div>
          <h1 className="h2">Kontakt</h1>
          {has ? (
            <dl className="dl">
              {s.phone ? <div><dt>Telefon</dt><dd>{tel ? <a href={tel}>{s.phone}</a> : s.phone}</dd></div> : null}
              {s.email ? <div><dt>E-mail</dt><dd><a href={`mailto:${s.email}`}>{s.email}</a></dd></div> : null}
              {s.address ? <div><dt>Adres</dt><dd className="pre">{s.address}</dd></div> : null}
              {s.nip ? <div><dt>NIP</dt><dd className="mono">{s.nip}</dd></div> : null}
            </dl>
          ) : <p className="lead">Dane kontaktowe nie są jeszcze uzupełnione w ustawieniach strony.</p>}
          <div className="contact-nl"><NewsletterForm privacyHref={privacy} /></div>
        </div>
        <div><ContactForm privacyHref={privacy} /></div>
      </div>
    </div></div>
  )
}
