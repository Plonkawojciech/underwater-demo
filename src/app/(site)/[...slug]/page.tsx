import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/data'
import { ShopIndex, CategoryPage, ProductPage } from '@/views/shop'
import { CoursesIndex, CoursePage } from '@/views/training'
import { ContactPage } from '@/views/pages'

type Props = { params: Promise<{ slug: string[] }> }
const parse = (segs: string[]) => segs.map((s, i) => (i === segs.length - 1 ? s.replace(/\.html$/, '') : s))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const segs = parse((await params).slug)
  const p = segs.join('/')
  const payload = await db()
  const fixed: Record<string, string> = {
    'sklep-nurkowy': 'Sklep nurkowy Warszawa',
    'kursy-nurkowania': 'Kursy nurkowania PADI w Warszawie',
    kontakt: 'Kontakt',
  }
  if (fixed[p]) return { title: fixed[p] }
  if (segs[0] === 'kursy-nurkowania' && segs[1]) {
    const r = await payload.find({ collection: 'courses', where: { slug: { equals: segs[1] } }, limit: 1 })
    return r.docs[0] ? { title: `Kurs nurkowania ${r.docs[0].name}`, description: r.docs[0].lead || undefined } : {}
  }
  if (/^\d+-/.test(segs[segs.length - 1])) {
    const pr = await payload.find({ collection: 'products', where: { slug: { equals: p } }, limit: 1 })
    if (pr.docs[0]) return { title: pr.docs[0].name, description: pr.docs[0].short || undefined }
    const c = await payload.find({ collection: 'categories', where: { slug: { equals: p } }, limit: 1 })
    if (c.docs[0]) return { title: `${c.docs[0].name} — sklep nurkowy` }
  }
  return {}
}

export default async function Page({ params }: Props) {
  const segs = parse((await params).slug)
  const p = segs.join('/')
  const payload = await db()
  if (p === 'sklep-nurkowy') return <ShopIndex />
  if (p === 'kursy-nurkowania') return <CoursesIndex />
  if (p === 'kontakt') return <ContactPage />
  if (segs[0] === 'kursy-nurkowania' && segs.length === 2) {
    const r = await payload.find({ collection: 'courses', where: { slug: { equals: segs[1] } }, limit: 1, depth: 1 })
    if (!r.docs[0]) notFound()
    return <CoursePage course={r.docs[0]} />
  }
  if (/^\d+-/.test(segs[segs.length - 1])) {
    const pr = await payload.find({ collection: 'products', where: { slug: { equals: p } }, limit: 1, depth: 2 })
    if (pr.docs[0]) return <ProductPage product={pr.docs[0]} />
    const c = await payload.find({ collection: 'categories', where: { slug: { equals: p } }, limit: 1, depth: 1 })
    if (c.docs[0]) return <CategoryPage category={c.docs[0]} />
  }
  notFound()
}
