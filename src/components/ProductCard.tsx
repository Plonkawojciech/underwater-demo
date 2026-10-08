import Link from 'next/link'
import { formatMoney, knownStock, mediaUrl, priceSpan, productHref, productPrice, type ProductDoc } from '@/lib/presentation'

export function ProductCard({ p }: { p: ProductDoc }) {
  const src = mediaUrl(p.images?.[0], 'thumb')
  const price = productPrice(p)
  const span = priceSpan(p)
  // Variants with their own prices: show the range start instead of the base price.
  const ranged = !!p.variants?.length && span !== null && span.min !== span.max
  const stock = knownStock(p)
  // Same rule as AddToCart: buyable only with a positive known stock.
  const soldOut = !(stock !== null && stock > 0)
  return (
    <Link href={productHref(p.slug)} className={'prod' + (soldOut ? ' prod-out' : '')}>
      <span className="ph">
        {price.sale !== null && !ranged ? <span className="flag">Promocja</span> : null}
        {/* The product name follows as text, so the image is decorative inside the link. */}
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="ph-none" aria-hidden="true">Brak zdjęcia</span>}
      </span>
      <span className="cb">
        {p.manufacturer ? <span className="maker">{p.manufacturer}</span> : null}
        <span className="nm">{p.name}</span>
        <span className="pr">
          {ranged
            ? <b>od {formatMoney(span.min)}</b>
            : price.sale !== null
              ? <><b><span className="sr-only">Cena promocyjna </span>{formatMoney(price.sale)}</b><s><span className="sr-only">Cena regularna </span>{formatMoney(price.base)}</s></>
              : price.current !== null ? <b>{formatMoney(price.current)}</b> : <span>Cena na zapytanie</span>}
        </span>
        {soldOut ? <span className="avail">{stock === null ? 'Dostępność do potwierdzenia' : 'Chwilowo niedostępny'}</span> : null}
      </span>
    </Link>
  )
}
