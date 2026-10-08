import Link from 'next/link'
import { cache } from 'react'
import type { Where } from 'payload'
import {
  asObject, categoryHref, categoryTree, mediaAlt, mediaUrl, productPrice, productSchema, variantPrice, withQuery,
  type CategoryDoc, type ProductDoc, type TreeNode,
} from '@/lib/presentation'
import { ProductCard } from '@/components/ProductCard'
import { AddToCart, Gallery, ProductProvider } from '@/components/AddToCart'
import { Crumbs, EmptyState, JsonLd, Pagination, RangeSummary, RichBody, TableScroll, type Crumb } from '@/components/content'
import { getSettings, PAGE_SIZE, publicFind, siteOrigin } from './query'
import { hrefOf } from './meta'

const SHOP = '/sklep-nurkowy.html'

// The whole published tree in one bounded query; only the fields navigation needs.
const getTree = cache(async () => {
  const nodes: TreeNode[] = []
  for (let page = 1; ; page++) {
    const r = await publicFind<TreeNode>('categories', { page, limit: 500, depth: 0, sort: 'order', select: { name: true, slug: true, parent: true, order: true } })
    nodes.push(...r.docs)
    if (page >= r.totalPages) break
    if (nodes.length > 100_000) throw new Error('Category inventory exceeds the supported import size.')
  }
  return categoryTree(nodes)
})
type Tree = Awaited<ReturnType<typeof getTree>>

function TreeList({ tree, nodes, open, active }: { tree: Tree; nodes: TreeNode[]; open: Set<number>; active?: number }) {
  return (
    <ul>
      {nodes.map((c) => {
        const kids = tree.kids(c.id)
        return (
          <li key={c.id}>
            <Link href={categoryHref(c.slug)} aria-current={active === c.id ? 'page' : undefined}>{c.name}</Link>
            {kids.length > 0 && open.has(c.id) ? <TreeList tree={tree} nodes={kids} open={open} active={active} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** Category navigation: roots, with the branch of the current category opened. */
function Rail({ tree, active }: { tree: Tree; active?: TreeNode }) {
  const open = new Set<number>(active ? [...tree.ancestors(active.id).map((a) => a.id), active.id] : [])
  if (!tree.roots.length) return null
  const list = <TreeList tree={tree} nodes={tree.roots} open={open} active={active?.id} />
  return (
    <>
      <nav className="rail rail-d" aria-label="Kategorie sklepu">
        <p className="rail-h">Kategorie</p>
        <Link href={SHOP} className="rail-all" aria-current={!active ? 'page' : undefined}>Wszystkie produkty</Link>
        {list}
      </nav>
      <details className="rail-m">
        <summary>Kategorie{active ? <span>: {active.name}</span> : null}</summary>
        <nav aria-label="Kategorie sklepu">
          <Link href={SHOP} className="rail-all" aria-current={!active ? 'page' : undefined}>Wszystkie produkty</Link>
          {list}
        </nav>
      </details>
    </>
  )
}

function SearchForm({ q }: { q: string }) {
  return (
    <form action={SHOP} method="get" role="search" className="search">
      <label htmlFor="shop-q">Szukaj w sklepie</label>
      <div className="search-row">
        <input id="shop-q" name="q" type="search" defaultValue={q} minLength={2} maxLength={80} placeholder="Nazwa, producent lub kod" autoComplete="off" />
        <button className="btn btn-solid" type="submit">Szukaj</button>
      </div>
    </form>
  )
}

function ProductGrid({ docs, page, totalPages, totalDocs, hrefFor, empty }: {
  docs: ProductDoc[]; page: number; totalPages: number; totalDocs: number; hrefFor: (n: number) => string; empty: React.ReactNode
}) {
  if (!docs.length) return <>{empty}</>
  return (
    <>
      <RangeSummary page={page} perPage={PAGE_SIZE} total={totalDocs} />
      <div className="grid">{docs.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      <Pagination page={page} totalPages={totalPages} hrefFor={hrefFor} label="Strony katalogu" />
    </>
  )
}

export async function ShopIndex({ page, q }: { page: number; q: string }) {
  const where: Where | undefined = q
    ? { or: [{ name: { like: q } }, { manufacturer: { like: q } }, { sku: { equals: q } }] }
    : undefined
  const [tree, s, products] = await Promise.all([
    getTree(),
    getSettings(),
    publicFind<ProductDoc>('products', { where, limit: PAGE_SIZE, page, depth: 1, sort: 'name' }),
  ])
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Sklep' }]} />
      <h1 className="h2">Sklep nurkowy</h1>
      {s.priceGuarantee ? <p className="lead">{s.priceGuarantee}</p> : null}
      <div className="shop">
        <Rail tree={tree} />
        <div>
          <SearchForm q={q} />
          {q ? <h2 className="h3 results-h">Wyniki dla „{q}”</h2> : null}
          <ProductGrid
            {...products}
            hrefFor={(n) => withQuery(SHOP, { q, strona: n })}
            empty={q
              ? <EmptyState title="Brak produktów pasujących do wyszukiwania" action={{ href: SHOP, label: 'Pokaż cały katalog' }}>
                  <p>Sprawdź pisownię albo wpisz krótszą nazwę lub sam kod produktu.</p>
                </EmptyState>
              : page > 1
                ? <EmptyState title="Ta strona katalogu jest pusta" action={{ href: SHOP, label: 'Wróć do pierwszej strony' }} />
                : <EmptyState title="Katalog nie ma jeszcze opublikowanych produktów" action={{ href: '/kontakt.html', label: 'Zapytaj o sprzęt' }} />}
          />
        </div>
      </div>
    </div></div>
  )
}

const crumbsFor = (tree: Tree, id: number): Crumb[] =>
  tree.ancestors(id).map((a) => ({ label: a.name, href: categoryHref(a.slug) }))

export async function CategoryPage({ category, page }: { category: CategoryDoc; page: number }) {
  const tree = await getTree()
  const ids = tree.subtree(category.id)
  const products = await publicFind<ProductDoc>('products', {
    where: { or: [{ category: { in: ids } }, { categories: { in: ids } }] },
    limit: PAGE_SIZE, page, depth: 1, sort: 'name',
  })
  const kids = tree.kids(category.id)
  const self = hrefOf({ kind: 'category', doc: category }) || categoryHref(category.slug)
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[{ label: 'Sklep', href: SHOP }, ...crumbsFor(tree, category.id), { label: category.name }]} />
      <h1 className="h2">{category.name}</h1>
      <div className="shop">
        <Rail tree={tree} active={tree.byId.get(category.id) || category} />
        <div>
          {kids.length > 0 && (
            <nav className="subcats" aria-label={`Podkategorie: ${category.name}`}>
              <ul>{kids.map((k) => <li key={k.id}><Link href={categoryHref(k.slug)}>{k.name}</Link></li>)}</ul>
            </nav>
          )}
          <ProductGrid
            {...products}
            hrefFor={(n) => withQuery(self, { strona: n })}
            empty={page > 1
              ? <EmptyState title="Ta strona kategorii jest pusta" action={{ href: self, label: 'Wróć do pierwszej strony' }} />
              : <EmptyState title="W tej kategorii nie ma jeszcze opublikowanych produktów" action={{ href: SHOP, label: 'Zobacz cały sklep' }}>
                  {kids.length ? <p>Wybierz jedną z podkategorii powyżej.</p> : null}
                </EmptyState>}
          />
        </div>
      </div>
    </div></div>
  )
}

export async function ProductPage({ product: p }: { product: ProductDoc }) {
  const tree = await getTree()
  const primary = asObject(p.category) || (p.categories || []).map((c) => asObject(c)).find(Boolean) || null
  const related = primary
    ? await publicFind<ProductDoc>('products', {
        where: { and: [{ id: { not_equals: p.id } }, { or: [{ category: { equals: primary.id } }, { categories: { in: [primary.id] } }] }] },
        limit: 4, depth: 1, sort: 'name',
      })
    : null
  const imgs = (p.images || []).filter((i) => asObject(i))
  const variants = (p.variants || []).map((v) => ({
    id: v.id, sku: v.sku, label: v.label, stock: v.stock, image: mediaUrl(v.image, 'card') || undefined, price: variantPrice(p, v),
  }))
  const url = hrefOf({ kind: 'product', doc: p }) || `/${p.slug}.html`
  const origin = siteOrigin()
  return (
    <div className="section light"><div className="wrap">
      <Crumbs items={[
        { label: 'Sklep', href: SHOP },
        ...(primary ? [...crumbsFor(tree, primary.id), { label: primary.name, href: categoryHref(primary.slug) }] : []),
        { label: p.name },
      ]} />
      <ProductProvider><div className="product">
        <Gallery images={imgs.map((i) => ({ url: mediaUrl(i, 'card'), thumb: mediaUrl(i, 'thumb'), alt: mediaAlt(i) || p.name }))} />
        <div>
          <h1 className="h2">{p.name}</h1>
          {(p.manufacturer || p.sku || p.warranty) && (
            <p className="pmeta">
              {p.manufacturer && <span>{p.manufacturer}</span>}
              {p.sku && <span>Kod {p.sku}</span>}
              {p.warranty && <span>Gwarancja {p.warranty}</span>}
            </p>
          )}
          {p.short && <p className="lead lead-tight">{p.short}</p>}
          <AddToCart
            product={{ id: p.id, slug: p.slug, name: p.name, sku: p.sku, price: productPrice(p), image: mediaUrl(imgs[0], 'thumb') || undefined, stock: p.stock }}
            variants={variants}
          />
          {!!p.features?.length && <><h2 className="subh">Cechy</h2><ul className="feats">{p.features.map((f, i) => <li key={f.id || i}>{f.text}</li>)}</ul></>}
          {!!p.specs?.length && (
            <>
              <h2 className="subh">Dane techniczne</h2>
              <TableScroll label="Dane techniczne"><table className="specs"><tbody>{p.specs.map((x, i) => <tr key={x.id || i}><th scope="row">{x.key}</th><td>{x.value}</td></tr>)}</tbody></table></TableScroll>
            </>
          )}
        </div>
      </div></ProductProvider>
      {p.body?.trim() ? (
        <section className="pbody" aria-labelledby="opis">
          <h2 id="opis" className="h3">Opis produktu</h2>
          <RichBody html={p.body} />
        </section>
      ) : null}
      {related && related.docs.length > 0 && primary && (
        <section className="related" aria-labelledby="related-h">
          <div className="sechead"><h2 id="related-h" className="h3">Więcej w kategorii {primary.name}</h2><Link className="textlink" href={categoryHref(primary.slug)}>Cała kategoria</Link></div>
          <div className="grid">{related.docs.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </section>
      )}
      {origin ? <JsonLd data={productSchema(p, origin + url, origin)} /> : null}
    </div></div>
  )
}
