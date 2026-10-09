import Link from 'next/link'
import { formatMoney, knownStock, priceSpan, productHref, productPrice, STOCK_LABEL, stockState, type ProductDoc } from '@/lib/presentation'
import { mediaImageProps } from './MediaImage'

export function ProductCard({ p, eager = false }: { p: ProductDoc; eager?: boolean }) {
  const image = mediaImageProps(p.images?.[0], 'thumb')
  const src = image.src
  const price = productPrice(p)
  const span = priceSpan(p)
  // Variants with their own prices: show the range start instead of the base price.
  const ranged = !!p.variants?.length && span !== null && span.min !== span.max
  // Same rule as AddToCart: buyable only with a positive known stock. Unknown stock is not
  // shown as sold out; only a known zero dims the photo.
  const state = stockState(knownStock(p))
  return (
    <Link href={productHref(p.slug)} className={'prod' + (state === 'out' ? ' prod-out' : '')}>
      <span className="ph">
        {price.sale !== null && !ranged ? <span className="flag">Promocja</span> : null}
        {/* The product name follows as text, so the image is decorative inside the link. */}
        {src ? <img {...image} alt="" sizes={image.srcSet ? '(max-width: 599px) calc(100vw - 80px), (max-width: 959px) 40vw, 260px' : undefined} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding="async" /> : <span className="ph-none" aria-hidden="true">Brak zdjęcia</span>}
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
        {state !== 'in' ? <span className={'avail avail-' + state}>{STOCK_LABEL[state]}</span> : null}
      </span>
    </Link>
  )
}
