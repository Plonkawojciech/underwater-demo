'use client'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type CartLine = { id: number; slug: string; name: string; variant?: string; price: number; image?: string; qty: number }
type Ctx = { lines: CartLine[]; add: (l: Omit<CartLine, 'qty'>, qty?: number) => void; remove: (key: string) => void; setQty: (key: string, qty: number) => void; clear: () => void; count: number; total: number; ready: boolean }
const CartCtx = createContext<Ctx | null>(null)
export const lineKey = (l: { id: number; variant?: string }) => `${l.id}::${l.variant || ''}`

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => { try { const raw = localStorage.getItem('uw-cart'); if (raw) setLines(JSON.parse(raw)) } catch {} setReady(true) }, [])
  useEffect(() => { if (ready) try { localStorage.setItem('uw-cart', JSON.stringify(lines)) } catch {} }, [lines, ready])
  const api = useMemo<Ctx>(() => ({
    lines, ready,
    add: (l, qty = 1) => setLines((prev) => { const k = lineKey(l); const i = prev.findIndex((p) => lineKey(p) === k); if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + qty }; return c } return [...prev, { ...l, qty }] }),
    remove: (key) => setLines((prev) => prev.filter((p) => lineKey(p) !== key)),
    setQty: (key, qty) => setLines((prev) => prev.map((p) => (lineKey(p) === key ? { ...p, qty: Math.max(1, qty) } : p))),
    clear: () => setLines([]),
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: lines.reduce((s, l) => s + l.qty * l.price, 0),
  }), [lines, ready])
  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>
}
export const useCart = () => { const c = useContext(CartCtx); if (!c) throw new Error('CartProvider'); return c }
