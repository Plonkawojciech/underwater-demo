'use client'
import Link from 'next/link'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { enquiryHref, formatMoney, STOCK_LABEL, stockState, type Price } from '@/lib/presentation'
import { clampQty, MAX_LINE_QTY, sameLine, useCart } from './cart'

/**
 * `id` is the stable variant identifier (Payload array row id); `label` is the visible name.
 * `price` is already resolved on the server: the variant's own price or the product price.
 */
type Variant = { label: string; stock?: number | null; image?: string; id?: string | null; sku?: string | null; price: Price }
type Img = { url: string; thumb: string; alt: string }

function PriceTag({ price }: { price: Price }) {
  if (price.current === null) return <p className="pprice"><span className="pprice-none">Cena na zapytanie</span></p>
  return (
    <p className="pprice">
      {price.sale !== null && price.base !== null
        ? <>
            <b><span className="sr-only">Cena promocyjna </span>{formatMoney(price.sale)}</b>
            <s><span className="sr-only">Cena regularna </span>{formatMoney(price.base)}</s>
            <em>−{Math.round((1 - price.sale / price.base) * 100)}%</em>
          </>
        : <b>{formatMoney(price.current)}</b>}
    </p>
  )
}
const VariantCtx = createContext<{ image?: string; setImage: (u?: string) => void }>({ setImage: () => {} })

const variantKey = (v: Variant) => v.id || v.sku || v.label
const stockOf = (s?: number | null) => (typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0)

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const [image, setImage] = useState<string | undefined>()
  return <VariantCtx.Provider value={{ image, setImage }}>{children}</VariantCtx.Provider>
}

export function Gallery({ images }: { images: Img[] }) {
  const { image, setImage } = useContext(VariantCtx)
  const main = image || images[0]?.url
  return (
    <div className="gal">
      <div className="main">{main && <img src={main} alt={images.find((i) => i.url === main)?.alt || ''} />}</div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((i, n) => (
            <button type="button" key={i.url} onClick={() => setImage(i.url)} className={'thumb' + (main === i.url ? ' thumb-on' : '')} aria-pressed={main === i.url} aria-label={`Zdjęcie ${n + 1} z ${images.length}`}>
              <img src={i.thumb} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddToCart({ product, variants, note }: {
  product: { id: number; slug: string; name: string; price: Price; sku?: string | null; image?: string; stock?: number | null }
  variants: Variant[]
  /** Sourced delivery or pickup information. Nothing is shown by default. */
  note?: React.ReactNode
}) {
  const { add, lines } = useCart()
  const { setImage } = useContext(VariantCtx)
  const uid = useId()
  const [selected, setSelected] = useState(() => {
    // In stock first, then unknown (enquiry), and a known zero only when nothing else exists.
    const first = variants.find((v) => stockState(v.stock) === 'in') || variants.find((v) => stockState(v.stock) === 'unknown') || variants[0]
    return first ? variantKey(first) : undefined
  })
  const [qty, setQty] = useState(1)
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const chosen = variants.find((v) => variantKey(v) === selected)
  // UI cap only. The server re-checks stock and price when the order is quoted and placed.
  const state = stockState(variants.length ? chosen?.stock : product.stock)
  const stock = state === 'in' ? stockOf(variants.length ? chosen?.stock : product.stock) : 0
  const price = variants.length ? chosen?.price ?? product.price : product.price
  const lineId = { id: product.id, variant: chosen?.label, variantId: chosen?.id || undefined }
  const inCart = lines.find((l) => sameLine(l, lineId))?.qty ?? 0
  const cap = Math.min(stock, MAX_LINE_QTY)
  const remaining = Math.max(0, cap - inCart)
  const q = Math.min(Math.max(1, qty), Math.max(1, remaining))
  const canBuy = remaining > 0 && price.current !== null

  const commit = () => {
    if (draft === null) return q
    const n = clampQty(draft, Math.max(1, remaining)) ?? q
    setQty(n)
    setDraft(null)
    return n
  }

  const onAdd = () => {
    const n = commit()
    if (price.current === null) return
    const sku = chosen?.sku || (variants.length ? undefined : product.sku) || undefined
    const ok = add({ ...lineId, sku, slug: product.slug, name: product.name, priceCents: price.current, image: chosen?.image || product.image, maxQty: cap }, n)
    clearTimeout(timer.current)
    if (!ok) {
      setStatus('error')
      return
    }
    setQty(1)
    setStatus(`Dodano do koszyka: ${n} szt.`)
    timer.current = setTimeout(() => setStatus(''), 6000)
  }

  // Enquiry instead of a dead button: the message names this product by id; the server reads it again.
  const enquiry = enquiryHref('product', product.id)
  const ask = state === 'unknown' ? 'Zapytaj o dostępność' : state === 'out' ? 'Zapytaj sklep' : price.current === null ? 'Zapytaj o cenę' : null
  const availability = state !== 'in'
    ? <>{STOCK_LABEL[state]}.{state === 'unknown' ? ' Zamówienie przez sklep internetowy jest możliwe, gdy stan produktu jest znany.' : ''}</>
    : price.current === null
      ? <>{variants.length ? 'Ten wariant nie ma' : 'Ten produkt nie ma'} ceny w katalogu.</>
    : !canBuy
      ? <>W koszyku masz już całą dostępną ilość ({inCart} szt.).</>
      : <>Dostępne: {stock} szt.{inCart ? ` W koszyku: ${inCart} szt.` : ''}</>

  return (
    <>
    <PriceTag price={price} />
    <div className="buy">
      {variants.length > 0 && (
        <fieldset className="variants">
          <legend>Wariant</legend>
          {variants.map((v) => {
            const k = variantKey(v)
            // Only a known zero is crossed out; a variant without stock data stays a normal choice.
            const out = stockState(v.stock) === 'out'
            return (
              <label key={k} className={'chip' + (selected === k ? ' chip-on' : '') + (out ? ' chip-off' : '')}>
                <input type="radio" name={`variant-${uid}`} value={k} checked={selected === k} onChange={() => { setSelected(k); setDraft(null); setImage(v.image) }} />
                {v.label}{out ? <span className="sr-only">, chwilowo niedostępny</span> : null}
              </label>
            )
          })}
        </fieldset>
      )}
      {ask ? (
        <div className="buy-row"><Link href={enquiry} className="btn btn-solid">{ask}</Link></div>
      ) : (
      <div className="buy-row">
        <div className="qty" role="group" aria-labelledby={`${uid}-qty`}>
          <span id={`${uid}-qty`} className="sr-only">Ilość</span>
          <button type="button" onClick={() => { setDraft(null); setQty(q - 1) }} disabled={!canBuy || q <= 1} aria-label="Zmniejsz ilość">−</button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, remaining)}
            step={1}
            value={draft ?? String(q)}
            disabled={!canBuy}
            aria-labelledby={`${uid}-qty`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          />
          <button type="button" onClick={() => { setDraft(null); setQty(q + 1) }} disabled={!canBuy || q >= remaining} aria-label="Zwiększ ilość">+</button>
        </div>
        <button type="button" className="btn btn-solid" disabled={!canBuy} onClick={onAdd}>Dodaj do koszyka</button>
      </div>
      )}
      <p className="buy-note">{availability}</p>
      <p className="buy-status" role="status">
        {status === 'error'
          ? <span className="form-err">Nie udało się dodać produktu do koszyka. Odśwież stronę i spróbuj ponownie albo <Link href={enquiry} className="textlink">napisz do sklepu</Link>.</span>
          : status ? <>{status} <Link href="/koszyk" className="textlink">Przejdź do koszyka</Link></> : null}
      </p>
      {note ? <div className="buy-note">{note}</div> : null}
    </div>
    </>
  )
}
