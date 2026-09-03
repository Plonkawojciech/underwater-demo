import Link from 'next/link'
import { imgUrl, imgAlt, zl } from '@/lib/data'

export function ProductCard({ p }: { p: any }) {
  const img = p.images?.[0]
  const cat = typeof p.category === 'object' ? p.category?.name : ''
  return (
    <Link href={`/${p.slug}.html`} className="card">
      <div className="ph">{img ? <img src={imgUrl(img, 'thumb')} alt={imgAlt(img)} loading="lazy" /> : null}</div>
      <div className="cb">
        {p.salePrice ? <span className="tag tag-accent" style={{ alignSelf: 'start' }}>Promocja</span> : null}
        <span className="cn">{p.name}</span>
        <span className="cm">{[p.manufacturer, cat].filter(Boolean).join(' · ')}</span>
        <span className="price">{p.salePrice ? <><b>{zl(p.salePrice)}</b><s>{zl(p.price)}</s></> : <b>{zl(p.price)}</b>}</span>
      </div>
    </Link>
  )
}
