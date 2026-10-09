import type { Metadata } from 'next'
import {
  canonicalPath, categoryHref, contentHref, courseHref, excerpt, listCanonical, mediaUrl, plainText, productHref,
  type ListKind, type MediaRef, type Query, type Seo,
} from '@/lib/presentation'
import type { FixedRoute, Resolved } from '@/lib/source-routes'
import { isPreview } from './query'
import { FIXED_SEO_PATHS, publicSeoCanonical } from '@/lib/seo'

export const FIXED_META: Record<FixedRoute, { title: string; description?: string; path: string }> = {
  shop: { title: 'Sklep nurkowy', path: FIXED_SEO_PATHS.shop },
  courses: { title: 'Kursy nurkowania', path: FIXED_SEO_PATHS.courses },
  contact: { title: 'Kontakt', path: FIXED_SEO_PATHS.contact },
  trips: { title: 'Wyprawy nurkowe', path: FIXED_SEO_PATHS.trips },
  calendar: { title: 'Kalendarz', path: FIXED_SEO_PATHS.calendar },
  news: { title: 'Aktualności', path: FIXED_SEO_PATHS.news },
  reports: { title: 'Relacje', path: FIXED_SEO_PATHS.reports },
  albums: { title: 'Galerie', path: FIXED_SEO_PATHS.albums },
}

const robots = () => (isPreview() ? { index: false, follow: false } : undefined)

export function pageMeta({ title, description, path, image, seo }: {
  title: string
  description?: string | null
  path: string | null
  image?: MediaRef
  seo?: Seo
}): Metadata {
  const desc = excerpt(seo?.description || description || '', 160) || undefined
  const img = mediaUrl(seo?.image ?? image, 'card')
  const canonical = publicSeoCanonical(path)
  return {
    // A stored SEO title is the source's full <title>, which already names the site.
    title: seo?.title ? { absolute: seo.title } : title,
    description: desc,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: { title: seo?.title || title, description: desc, ...(canonical ? { url: canonical } : {}), ...(img ? { images: [img] } : {}) },
    robots: robots(),
  }
}

/** Canonical site path of a resolved record. */
export function hrefOf(r: Resolved): string | null {
  switch (r.kind) {
    case 'redirect': return r.to
    case 'fixed': return canonicalPath(FIXED_META[r.route].path, r.source?.legacyPath)
    case 'product': return canonicalPath(productHref(r.doc.slug), r.doc.legacyPath)
    case 'category': return canonicalPath(categoryHref(r.doc.slug), r.doc.legacyPath)
    case 'course': return canonicalPath(courseHref(r.doc.slug), r.doc.legacyPath)
    default: return canonicalPath(contentHref(r.doc.path), r.doc.legacyPath)
  }
}

/** Lists whose later pages hold different records; the calendar and contact page are not paged by URL here. */
const LIST_KIND: Partial<Record<FixedRoute, ListKind>> = { shop: 'shop', courses: 'courses', trips: 'trips', news: 'paged', reports: 'paged', albums: 'paged' }
function listKindOf(r: Resolved): ListKind | undefined {
  if (r.kind === 'fixed') return LIST_KIND[r.route]
  return r.kind === 'category' || r.kind === 'album' ? 'paged' : undefined
}

/** `q` is the request query; without it every canonical is the first page. */
export function resolvedMeta(r: Resolved, q?: Query): Metadata {
  const base = hrefOf(r)
  const kind = listKindOf(r)
  const path = base && kind && q ? listCanonical(base, kind, q) : base
  switch (r.kind) {
    case 'redirect': return {}
    case 'fixed': return r.source ? pageMeta({ title: r.source.title, description: r.source.lead || plainText(r.source.body), image: r.source.image, seo: r.source.seo, path }) : pageMeta({ ...FIXED_META[r.route], path })
    case 'product': return pageMeta({ title: r.doc.name, description: r.doc.short || plainText(r.doc.body), path, image: r.doc.images?.[0], seo: r.doc.seo })
    case 'category': return pageMeta({ title: r.doc.name, path, image: r.doc.image, seo: r.doc.seo })
    case 'course': return pageMeta({ title: r.doc.name, description: r.doc.lead || plainText(r.doc.body), path, image: r.doc.image, seo: r.doc.seo })
    case 'page': return pageMeta({ title: r.doc.title, description: r.doc.lead || plainText(r.doc.body), path, image: r.doc.image, seo: r.doc.seo })
    case 'trip': return pageMeta({ title: r.doc.title, description: r.doc.lead || plainText(r.doc.body), path, image: r.doc.image, seo: r.doc.seo })
    case 'album': return pageMeta({ title: r.doc.title, description: r.doc.description, path, image: r.doc.photos?.[0]?.image, seo: r.doc.seo })
    case 'event': return pageMeta({ title: r.doc.title, description: plainText(r.doc.body), path, seo: r.doc.seo })
  }
}
