import Link from 'next/link'
import { db, imgUrl, imgAlt, zl } from '@/lib/data'
import { ProductCard } from '@/components/ProductCard'
import { AddToCart, Gallery, ProductProvider } from '@/components/AddToCart'

async function catTree() {
  const payload = await db()
  const all = await payload.find({ collection: 'categories', limit: 200, sort: 'order', depth: 0 })
  const roots = all.docs.filter((c) => !c.parent)
  const kids = (id: number) => all.docs.filter((c) => (typeof c.parent === 'object' ? c.parent?.id : c.parent) === id)
  return { all: all.docs, roots, kids }
}

export function CatNav({ roots, kids, active }: { roots: any[]; kids: (id: number) => any[]; active?: string }) {
  return (
    <nav className="catnav" aria-label="Kategorie sklepu">
      <Link href="/sklep-nurkowy.html" className={!active ? 'on' : ''}>Wszystkie kategorie</Link>
      {roots.map((c) => (
        <div key={c.id} style={{ display: 'contents' }}>
          <Link href={`/${c.slug}.html`} className={active === c.slug ? 'on' : ''}>{c.name}</Link>
          {kids(c.id).map((k) => <Link key={k.id} href={`/${k.slug}.html`} className={'sub' + (active === k.slug ? ' on' : '')}>{k.name}</Link>)}
        </div>
      ))}
    </nav>
  )
}

export async function ShopIndex() {
  const payload = await db()
  const { roots, kids } = await catTree()
  const s = await payload.findGlobal({ slug: 'settings' })
  const promo = await payload.find({ collection: 'products', where: { salePrice: { greater_than: 0 } }, limit: 12, depth: 1 })
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span>Sklep nurkowy</div>
      <div className="shop">
        <CatNav roots={roots} kids={kids} />
        <div>
          <p className="eyebrow">Sklep nurkowy Warszawa</p>
          <h1 className="h1">Sprzęt nurkowy z gwarancją najniższej ceny</h1>
          <p className="lead">{s.priceGuarantee}</p>
          <h2 className="h3" style={{ margin: '36px 0 14px' }}>Promocje</h2>
          <div className="grid-3">{promo.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          <h2 className="h3" style={{ margin: '40px 0 14px' }}>Kategorie</h2>
          <div className="catgrid">{roots.map((c) => <Link key={c.id} href={`/${c.slug}.html`}>{c.name}</Link>)}</div>
        </div>
      </div>
    </div>
  )
}

export async function CategoryPage({ category }: { category: any }) {
  const payload = await db()
  const { all, roots, kids } = await catTree()
  const ids = [category.id, ...kids(category.id).map((k) => k.id)]
  const products = await payload.find({ collection: 'products', where: { category: { in: ids } }, limit: 48, depth: 1 })
  const parent = typeof category.parent === 'object' ? category.parent : all.find((c) => c.id === category.parent)
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span><Link href="/sklep-nurkowy.html">Sklep nurkowy</Link>{parent && <><span>/</span><Link href={`/${parent.slug}.html`}>{parent.name}</Link></>}<span>/</span>{category.name}</div>
      <div className="shop">
        <CatNav roots={roots} kids={kids} active={category.slug} />
        <div>
          <h1 className="h1">{category.name}</h1>
          {kids(category.id).length > 0 && <div className="catgrid" style={{ margin: '20px 0 30px' }}>{kids(category.id).map((k) => <Link key={k.id} href={`/${k.slug}.html`}>{k.name}</Link>)}</div>}
          {products.docs.length ? <div className="grid-3" style={{ marginTop: 24 }}>{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
            : <div className="empty" style={{ marginTop: 24 }}><strong>W wersji demo ta kategoria jest jeszcze pusta.</strong><br />Po migracji znajdą się tu wszystkie produkty z obecnego sklepu, z zachowanymi adresami. Zobacz przykład: <Link href="/80-maski-i-fajki.html">Maski i fajki</Link>, <Link href="/67-komputery-nurkowe.html">Komputery nurkowe</Link>, <Link href="/345-junior.html">Junior</Link>.</div>}
        </div>
      </div>
    </div>
  )
}

export async function ProductPage({ product: p }: { product: any }) {
  const payload = await db()
  const cat = p.category
  const related = await payload.find({ collection: 'products', where: { id: { not_equals: p.id } }, limit: 3, depth: 1 })
  const imgs: any[] = (p.images || []).filter((i: any) => typeof i === 'object')
  const variants = (p.variants || []).map((v: any) => ({ label: v.label, stock: v.stock, image: imgUrl(v.image, 'card') || undefined }))
  const price = p.salePrice || p.price
  return (
    <div className="wrap section">
      <div className="crumbs"><Link href="/">Strona główna</Link><span>/</span><Link href="/sklep-nurkowy.html">Sklep nurkowy</Link>{cat?.parent && typeof cat.parent === 'object' && <><span>/</span><Link href={`/${cat.parent.slug}.html`}>{cat.parent.name}</Link></>}{cat && <><span>/</span><Link href={`/${cat.slug}.html`}>{cat.name}</Link></>}<span>/</span>{p.name}</div>
      <ProductProvider><div className="product">
        <Gallery images={imgs.map((i) => ({ url: imgUrl(i, 'card'), thumb: imgUrl(i, 'thumb'), alt: imgAlt(i) }))} />
        <div className="pinfo">
          <h1 className="h1">{p.name}</h1>
          <p className="maker">{[p.manufacturer && `Producent: ${p.manufacturer}`, `Nr ${p.vmId}`, p.warranty && `Gwarancja ${p.warranty}`].filter(Boolean).join(' · ')}</p>
          <div className="pprice">{p.salePrice ? <><b>{zl(p.salePrice)}</b><s>{zl(p.price)}</s><span className="tag tag-accent">−{Math.round((1 - p.salePrice / p.price) * 100)}%</span></> : <b>{zl(p.price)}</b>}</div>
          {p.short && <p className="lead" style={{ marginTop: 0 }}>{p.short}</p>}
          <AddToCart product={{ id: p.id, slug: p.slug, name: p.name, price, image: imgUrl(imgs[0], 'thumb') || undefined, stock: p.stock }} variants={variants} />
          {p.features?.length > 0 && <><h2 className="h3">Cechy</h2><ul className="feats">{p.features.map((f: any) => <li key={f.id}>{f.text}</li>)}</ul></>}
          {p.specs?.length > 0 && <><h2 className="h3">Dane techniczne</h2><table className="specs"><tbody>{p.specs.map((s: any) => <tr key={s.id}><td>{s.key}</td><td>{s.value}</td></tr>)}</tbody></table></>}
        </div>
      </div></ProductProvider>
      {related.docs.length > 0 && <div style={{ marginTop: 64 }}><div className="sec-head"><h2 className="h2">Zobacz też</h2></div><div className="grid-3">{related.docs.map((r) => <ProductCard key={r.id} p={r} />)}</div></div>}
    </div>
  )
}
