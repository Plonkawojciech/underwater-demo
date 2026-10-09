import { contactQuery, type ContactContext, type ProductDoc, type Query, type TripDoc } from '@/lib/presentation'
import { ContactForm, NewsletterForm } from '@/components/ContactForm'
import { PhoneLinks } from '@/components/Phone'
import { Crumbs } from '@/components/content'
import { getLegalLinks, getSettings, publicFirst } from './query'
import { hrefOf } from './meta'

/**
 * The published product or trip a contact link names (`?produkt=<id>`, `?wyjazd=<id>`), or null.
 * For display only: the form posts kind and id, and the server action reads the record again.
 */
export async function contactContextFor(q: Query): Promise<ContactContext | null> {
  const ref = contactQuery(q)
  if (!ref) return null
  if (ref.kind === 'product') {
    const p = await publicFirst<ProductDoc>('products', { id: { equals: ref.id } }, 0)
    const href = p && hrefOf({ kind: 'product', doc: p })
    return p && href ? { kind: 'product', id: p.id, title: p.name, href } : null
  }
  const t = await publicFirst<TripDoc>('trips', { id: { equals: ref.id } }, 0)
  const href = t && hrefOf({ kind: 'trip', doc: t })
  return t && href ? { kind: 'trip', id: t.id, title: t.title, href } : null
}

/** `context` when the caller resolved it; otherwise read from `query` when given. */
export async function ContactPage({ context, query }: { context?: ContactContext | null; query?: Query } = {}) {
  const [s, legal, ctx] = await Promise.all([
    getSettings(),
    getLegalLinks(),
    context !== undefined ? context : query ? contactContextFor(query) : null,
  ])
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
              {s.phone?.trim() ? <div><dt>Telefon</dt><dd><PhoneLinks value={s.phone} /></dd></div> : null}
              {s.email ? <div><dt>E-mail</dt><dd><a href={`mailto:${s.email}`}>{s.email}</a></dd></div> : null}
              {s.address ? <div><dt>Adres</dt><dd className="pre">{s.address}</dd></div> : null}
              {s.nip ? <div><dt>NIP</dt><dd className="mono">{s.nip}</dd></div> : null}
            </dl>
          ) : <p className="lead">Dane kontaktowe nie są jeszcze uzupełnione w ustawieniach strony.</p>}
          <div className="contact-nl"><NewsletterForm privacyHref={privacy} /></div>
        </div>
        <div><ContactForm privacyHref={privacy} context={ctx} /></div>
      </div>
    </div></div>
  )
}
