import Link from 'next/link'
import { db, imgUrl, imgAlt, zl } from '@/lib/data'
import { ProductCard } from '@/components/ProductCard'
import { AddToCart, Gallery, ProductProvider } from '@/components/AddToCart'

async function tree() {
  const payload = await db()
  const all = await payload.find({ collection: 'categories', limit: 100, sort: 'order', depth: 0 })
  const roots = all.docs.filter((c) => !c.parent)
  const kids = (id: number) => all.docs.filter((c) => (typeof c.parent === 'object' ? c.parent?.id : c.parent) === id)
  return { all: all.docs, roots, kids }
}

function Rail({ roots, kids, active }: { roots: any[]; kids: (id: number) => any[]; active?: string }) {
  return (
    <nav className="rail" aria-label="Kategorie">
      <p className="rail-h">Kategorie</p>
      <Link href="/sklep-nurkowy.html" className={!active ? 'on' : ''}>Wszystko</Link>
      {roots.map((c) => (
        <span key={c.id} style={{ display: 'contents' }}>
          <Link href={`/${c.slug}.html`} className={active === c.slug ? 'on' : ''}>{c.name}</Link>
          {kids(c.id).map((k) => <Link key={k.id} href={`/${k.slug}.html`} className={'sub' + (active === k.slug ? ' on' : '')}>{k.name}</Link>)}
        </span>
      ))}
    </nav>
  )
}

export async function ShopIndex() {
  const payload = await db()
  const { roots, kids } = await tree()
  const s = await payload.findGlobal({ slug: 'settings' })
  const products = await payload.find({ collection: 'products', limit: 24, depth: 1 })
  return (
    <div className="section light"><div className="wrap">
      <div className="crumbs"><Link href="/">Start</Link><span>/</span><span>Sklep</span></div>
      <p className="kicker">Sklep nurkowy · Warszawa</p>
      <h1 className="h2" style={{ maxWidth: '18ch' }}>Sprzęt, który sami zabieramy pod wodę</h1>
      <p className="lead">{s.priceGuarantee}</p>
      <div className="shop" style={{ marginTop: 56 }}>
        <Rail roots={roots} kids={kids} />
        <div><div className="grid">{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div></div>
      </div>
    </div></div>
  )
}

export async function CategoryPage({ category }: { category: any }) {
  const payload = await db()
  const { all, roots, kids } = await tree()
  const ids = [category.id, ...kids(category.id).map((k) => k.id)]
  const products = await payload.find({ collection: 'products', where: { category: { in: ids } }, limit: 24, depth: 1 })
  const parent = typeof category.parent === 'object' ? category.parent : all.find((c) => c.id === category.parent)
  return (
    <div className="section light"><div className="wrap">
      <div className="crumbs">
        <Link href="/">Start</Link><span>/</span><Link href="/sklep-nurkowy.html">Sklep</Link>
        {parent && <><span>/</span><Link href={`/${parent.slug}.html`}>{parent.name}</Link></>}
        <span>/</span><span>{category.name}</span>
      </div>
      <h1 className="h2">{category.name}</h1>
      <div className="shop" style={{ marginTop: 48 }}>
        <Rail roots={roots} kids={kids} active={category.slug} />
        <div>
          {products.docs.length
            ? <div className="grid">{products.docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
            : <div className="empty">W tej wersji demo ta kategoria jest pusta. Po migracji trafią tu wszystkie produkty z obecnego sklepu, pod tymi samymi adresami. Zobacz przykład: <Link href="/80-maski-i-fajki.html" className="textlink">Maski i fajki</Link>.</div>}
        </div>
      </div>
    </div></div>
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
    <div className="section light"><div className="wrap">
      <div className="crumbs">
        <Link href="/">Start</Link><span>/</span><Link href="/sklep-nurkowy.html">Sklep</Link>
        {cat?.parent && typeof cat.parent === 'object' && <><span>/</span><Link href={`/${cat.parent.slug}.html`}>{cat.parent.name}</Link></>}
        {cat && <><span>/</span><Link href={`/${cat.slug}.html`}>{cat.name}</Link></>}
      </div>
      <ProductProvider><div className="product">
        <Gallery images={imgs.map((i) => ({ url: imgUrl(i, 'card'), thumb: imgUrl(i, 'thumb'), alt: imgAlt(i) }))} />
        <div>
          <h1 className="h2">{p.name}</h1>
          <p className="pmeta">
            {p.manufacturer && <span>{p.manufacturer}</span>}
            <span>Nr {p.vmId}</span>
            {p.warranty && <span>Gwarancja {p.warranty}</span>}
          </p>
          {p.short && <p className="lead" style={{ marginTop: 0 }}>{p.short}</p>}
          <p className="pprice">
            {p.salePrice ? <><b>{zl(p.salePrice)}</b><s>{zl(p.price)}</s><em>−{Math.round((1 - p.salePrice / p.price) * 100)}%</em></> : <b>{zl(p.price)}</b>}
          </p>
          <AddToCart product={{ id: p.id, slug: p.slug, name: p.name, price, image: imgUrl(imgs[0], 'thumb') || undefined, stock: p.stock }} variants={variants} />
          {p.features?.length > 0 && <><p className="subh">Cechy</p><ul className="feats">{p.features.map((f: any) => <li key={f.id}>{f.text}</li>)}</ul></>}
          {p.specs?.length > 0 && <><p className="subh">Dane techniczne</p><table className="specs"><tbody>{p.specs.map((x: any) => <tr key={x.id}><td>{x.key}</td><td>{x.value}</td></tr>)}</tbody></table></>}
        </div>
      </div></ProductProvider>
      {related.docs.length > 0 && (
        <div style={{ marginTop: 96 }}>
          <div className="sechead"><h2 className="h3">Zobacz też</h2><Link className="textlink" href="/sklep-nurkowy.html">Cały sklep →</Link></div>
          <div className="grid">{related.docs.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </div>
      )}
    </div></div>
  )
}
