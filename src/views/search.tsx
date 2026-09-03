import Link from 'next/link'
import { db } from '@/lib/data'
import { ProductCard } from '@/components/ProductCard'

export async function SearchPage({ q }: { q: string }) {
  const payload = await db()
  const term = q.trim()
  const [products, categories, courses] = term ? await Promise.all([
    payload.find({ collection: 'products', where: { or: [{ name: { like: term } }, { manufacturer: { like: term } }, { short: { like: term } }] }, limit: 24, depth: 1 }),
    payload.find({ collection: 'categories', where: { name: { like: term } }, limit: 12 }),
    payload.find({ collection: 'courses', where: { name: { like: term } }, limit: 12 }),
  ]) : [{ docs: [] }, { docs: [] }, { docs: [] }]
  const total = products.docs.length + categories.docs.length + courses.docs.length
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Szukaj</div>
      <form action="/szukaj" role="search" className="form" style={{ maxWidth: 560 }}><label>Czego szukasz?<input name="q" defaultValue={q} autoFocus placeholder="Np. maska, Scubapro, nitrox" /></label></form>
      {term && <p className="lead" style={{ marginTop: 18 }}>{total ? `Wyniki dla „${term}”` : `Brak wyników dla „${term}”. Spróbuj krótszego hasła albo przejrzyj kategorie.`}</p>}
      {categories.docs.length > 0 && <><h2 className="h3" style={{ margin: '28px 0 12px' }}>Kategorie</h2><div className="catgrid">{categories.docs.map((c) => <Link key={c.id} href={`/${c.slug}.html`}>{c.name}</Link>)}</div></>}
      {products.docs.length > 0 && <><h2 className="h3" style={{ margin: '28px 0 12px' }}>Produkty</h2><div className="grid-3">{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div></>}
      {courses.docs.length > 0 && <><h2 className="h3" style={{ margin: '28px 0 12px' }}>Kursy</h2><div className="catgrid">{courses.docs.map((c) => <Link key={c.id} href={`/kursy-nurkowania/${c.slug}.html`}>{c.name}</Link>)}</div></>}
    </div>
  )
}
