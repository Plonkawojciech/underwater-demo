import Link from 'next/link'
import { imgUrl, imgAlt, zl } from '@/lib/data'

export function ProductCard({ p }: { p: any }) {
  const img = p.images?.[0]
  return (
    <Link href={`/${p.slug}.html`} className="prod">
      <span className="ph">
        {p.salePrice ? <span className="flag">Promocja</span> : null}
        {img ? <img src={imgUrl(img, 'thumb')} alt={imgAlt(img)} loading="lazy" /> : null}
      </span>
      <span className="cb">
        {p.manufacturer ? <span className="maker">{p.manufacturer}</span> : null}
        <span className="nm">{p.name}</span>
        <span className="pr">{p.salePrice ? <><b>{zl(p.salePrice)}</b><s>{zl(p.price)}</s></> : <b>{zl(p.price)}</b>}</span>
      </span>
    </Link>
  )
}
