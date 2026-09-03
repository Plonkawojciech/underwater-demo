'use client'
import { createContext, useContext, useState } from 'react'
import { useCart } from './cart'

type Variant = { label: string; stock?: number | null; image?: string }
type Img = { url: string; thumb: string; alt: string }
const VariantCtx = createContext<{ image?: string; setImage: (u?: string) => void }>({ setImage: () => {} })

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const [image, setImage] = useState<string | undefined>()
  return <VariantCtx.Provider value={{ image, setImage }}>{children}</VariantCtx.Provider>
}

export function Gallery({ images }: { images: Img[] }) {
  const { image, setImage } = useContext(VariantCtx)
  const main = image || images[0]?.url
  return (
    <div className="gallery">
      <div className="main">{main && <img src={main} alt={images.find((i) => i.url === main)?.alt || ''} />}</div>
      {images.length > 1 && <div className="thumbs">{images.map((i) => <button type="button" key={i.url} onClick={() => setImage(i.url)} className={'thumb' + (main === i.url ? ' thumb-on' : '')} aria-label="Pokaż zdjęcie"><img src={i.thumb} alt={i.alt} /></button>)}</div>}
    </div>
  )
}

export function AddToCart({ product, variants }: { product: { id: number; slug: string; name: string; price: number; image?: string; stock?: number | null }; variants: Variant[] }) {
  const { add } = useCart()
  const { setImage } = useContext(VariantCtx)
  const [variant, setVariant] = useState(variants[0]?.label)
  const [qty, setQty] = useState(1)
  const [done, setDone] = useState(false)
  const chosen = variants.find((v) => v.label === variant)
  const inStock = variants.length ? (chosen?.stock ?? 0) > 0 : (product.stock ?? 0) > 0
  return (
    <div className="buy">
      {variants.length > 0 && (
        <fieldset className="variants">
          <legend>Wariant</legend>
          {variants.map((v) => (
            <label key={v.label} className={'chip' + (variant === v.label ? ' chip-on' : '') + ((v.stock ?? 0) > 0 ? '' : ' chip-off')}>
              <input type="radio" name="variant" value={v.label} checked={variant === v.label} onChange={() => { setVariant(v.label); setImage(v.image) }} />
              {v.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="buy-row">
        <div className="qty" aria-label="Ilość">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Mniej">−</button>
          <output>{qty}</output>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Więcej">+</button>
        </div>
        <button type="button" className="btn btn-accent" disabled={!inStock} onClick={() => { add({ id: product.id, slug: product.slug, name: product.name, price: product.price, image: chosen?.image || product.image, variant: variants.length ? variant : undefined }, qty); setDone(true); setTimeout(() => setDone(false), 2500) }}>
          {done ? 'Dodano do koszyka' : inStock ? 'Dodaj do koszyka' : 'Chwilowo niedostępny'}
        </button>
      </div>
      <p className="buy-note">{inStock ? `${chosen ? `Dostępne sztuki: ${chosen.stock}. ` : ''}Wysyłka w 24 h lub odbiór w Warszawie, ul. Okopowa 31.` : 'Zapytaj o termin dostawy: 504 16 20 14.'}</p>
    </div>
  )
}
