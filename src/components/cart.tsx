'use client'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isSafeSlug, safeAssetUrl } from '@/lib/presentation'

// Prices in the cart are advisory display values. The server quotes every order
// from the catalogue and validates stock; no price from here is sent on checkout.
export type CartLine = {
  id: number
  slug: string
  name: string
  /** Variant label shown to the customer. */
  variant?: string
  /** Stable variant identifier (Payload array row id). Coexists with the label. */
  variantId?: string
  /** Variant or product SKU, display only. */
  sku?: string
  /** Display price in grosze at the time of adding. */
  priceCents: number
  image?: string
  qty: number
  /** UI-only quantity cap from the stock seen when the line was added. */
  maxQty?: number
}
type Ctx = {
  lines: CartLine[]
  /** Returns false when the line is invalid or the cart is full; nothing is added then. */
  add: (l: Omit<CartLine, 'qty'>, qty?: number) => boolean
  remove: (key: string) => void
  setQty: (key: string, qty: number) => void
  clear: () => void
  count: number
  /** Advisory total in grosze. */
  total: number
  ready: boolean
  /** False when localStorage is unavailable or full; the cart then lives only in memory. */
  persisted: boolean
}
const CartCtx = createContext<Ctx | null>(null)

export const CART_STORAGE_KEY = 'uw-cart'
export const MAX_LINE_QTY = 99
export const MAX_LINES = 50
const MAX_PRICE_CENTS = 100_000_000

export const lineKey = (l: { id: number; variant?: string; variantId?: string }) =>
  `${l.id}::${l.variantId ? `#${l.variantId}` : l.variant || ''}`

const VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/

const text = (v: unknown, max: number) => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t && t.length <= max ? t : undefined
}

const safeImage = (v: unknown) => safeAssetUrl(text(v, 500)) || undefined

/** Grosze from `priceCents`, or from the złoty `price` of carts saved before the switch. */
function priceCentsOf(r: Record<string, unknown>): number | null {
  const c = r.priceCents
  if (c !== undefined) return typeof c === 'number' && Number.isSafeInteger(c) && c >= 0 && c <= MAX_PRICE_CENTS ? c : null
  const zl = r.price
  if (typeof zl !== 'number' || !Number.isFinite(zl) || zl < 0 || zl * 100 > MAX_PRICE_CENTS) return null
  return Math.round(zl * 100)
}

/** Whole units in [1, cap]; anything that is not a finite number of at least 1 is rejected. */
export function clampQty(v: unknown, cap = MAX_LINE_QTY): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const q = Math.floor(n)
  if (q < 1) return null
  return Math.min(q, Math.max(1, Math.floor(cap)), MAX_LINE_QTY)
}

/** Validates one stored or incoming line. Returns null for anything unusable. */
export function normalizeLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = r.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null
  const slug = text(r.slug, 200)?.normalize('NFC')
  if (!isSafeSlug(slug)) return null
  const name = text(r.name, 200)
  if (!name) return null
  const priceCents = priceCentsOf(r)
  if (priceCents === null) return null
  const rawMax = r.maxQty
  const maxQty = typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 1 ? Math.min(Math.floor(rawMax), MAX_LINE_QTY) : undefined
  const qty = clampQty(r.qty, maxQty)
  if (qty === null) return null
  const variant = text(r.variant, 120)
  const vid = text(r.variantId, 64)
  const sku = text(r.sku, 64)
  const line: CartLine = { id, slug, name, priceCents, qty }
  if (variant) line.variant = variant
  if (vid && VARIANT_ID.test(vid)) line.variantId = vid
  if (sku) line.sku = sku
  const image = safeImage(r.image)
  if (image) line.image = image
  if (maxQty) line.maxQty = maxQty
  return line
}

// A line saved before variant ids existed (label only) is the same line as one
// carrying both the id and that label.
export const sameLine = (a: Pick<CartLine, 'id' | 'variant' | 'variantId'>, b: Pick<CartLine, 'id' | 'variant' | 'variantId'>) => {
  if (a.id !== b.id) return false
  if (a.variantId && b.variantId) return a.variantId === b.variantId
  return (a.variant || '') === (b.variant || '')
}

function mergeInto(lines: CartLine[], l: CartLine): CartLine[] {
  const i = lines.findIndex((p) => sameLine(p, l))
  if (i < 0) return lines.length >= MAX_LINES ? lines : [...lines, l]
  const prev = lines[i]
  const maxQty = l.maxQty ?? prev.maxQty
  const merged: CartLine = { ...prev, ...l, variantId: prev.variantId || l.variantId, qty: clampQty(prev.qty + l.qty, maxQty) ?? prev.qty }
  if (!merged.variantId) delete merged.variantId
  if (maxQty) merged.maxQty = maxQty
  const next = [...lines]
  next[i] = merged
  return next
}

/** Parses the raw localStorage value. Never throws; drops invalid lines and merges duplicates. */
export function parseCart(raw: string | null | undefined): CartLine[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  let lines: CartLine[] = []
  for (const item of data.slice(0, MAX_LINES * 4)) {
    const l = normalizeLine(item)
    if (l) lines = mergeInto(lines, l)
  }
  return lines
}

/** Display total in grosze. Advisory only; the quote from the server is what the customer pays. */
export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.priceCents * l.qty, 0)
export const cartCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.qty, 0)

function readStorage(): { lines: CartLine[]; ok: boolean } {
  try { return { lines: parseCart(localStorage.getItem(CART_STORAGE_KEY)), ok: true } } catch { return { lines: [], ok: false } }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  const [persisted, setPersisted] = useState(true)
  const written = useRef<string | null>(null)

  useEffect(() => {
    const r = readStorage()
    setLines(r.lines)
    setPersisted(r.ok)
    setReady(true)
    // Keep tabs in sync; an invalid value written elsewhere is parsed the same way.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CART_STORAGE_KEY && e.key !== null) return
      written.current = e.newValue
      setLines(parseCart(e.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!ready) return
    const json = JSON.stringify(lines)
    if (json === written.current) return
    try {
      localStorage.setItem(CART_STORAGE_KEY, json)
      written.current = json
      setPersisted(true)
    } catch {
      setPersisted(false)
    }
  }, [lines, ready])

  const api = useMemo<Ctx>(() => ({
    lines, ready, persisted,
    add: (l, qty = 1) => {
      const line = normalizeLine({ ...l, qty })
      if (!line || (lines.length >= MAX_LINES && !lines.some((p) => sameLine(p, line)))) return false
      setLines((prev) => mergeInto(prev, line))
      return true
    },
    remove: (key) => setLines((prev) => prev.filter((p) => lineKey(p) !== key)),
    setQty: (key, qty) => setLines((prev) => prev.map((p) => {
      if (lineKey(p) !== key) return p
      const q = clampQty(qty, p.maxQty)
      return q === null || q === p.qty ? p : { ...p, qty: q }
    })),
    clear: () => setLines([]),
    count: cartCount(lines),
    total: cartTotal(lines),
  }), [lines, ready, persisted])
  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>
}
export const useCart = () => { const c = useContext(CartCtx); if (!c) throw new Error('CartProvider'); return c }
