'use server'
import { db } from './data'

export type FormState = { ok: boolean; message: string; number?: string }

export async function createSignup(_prev: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get('name') || '').trim()
  const email = String(form.get('email') || '').trim()
  const phone = String(form.get('phone') || '').trim()
  const course = Number(form.get('course'))
  if (!name || !email || !phone || !course) return { ok: false, message: 'Uzupełnij imię, e-mail i telefon.' }
  const payload = await db()
  await payload.create({ collection: 'signups', data: { name, email, phone, course, message: String(form.get('message') || '') } })
  return { ok: true, message: 'Zgłoszenie przyjęte. Oddzwonimy w ciągu jednego dnia roboczego.' }
}

type CartItem = { id: number; variant?: string; qty: number; price: number }

export async function createOrder(_prev: FormState, form: FormData): Promise<FormState> {
  const customerName = String(form.get('name') || '').trim()
  const email = String(form.get('email') || '').trim()
  const phone = String(form.get('phone') || '').trim()
  const address = String(form.get('address') || '').trim()
  let items: CartItem[] = []
  try { items = JSON.parse(String(form.get('items') || '[]')) } catch { items = [] }
  if (!customerName || !email || !address) return { ok: false, message: 'Uzupełnij dane do wysyłki.' }
  if (!items.length) return { ok: false, message: 'Koszyk jest pusty.' }
  const payload = await db()
  const total = items.reduce((s, i) => s + i.price * i.qty, 0)
  const number = 'UW-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000)
  await payload.create({ collection: 'orders', data: {
    number, customerName, email, phone, address, total,
    items: items.map((i) => ({ product: i.id, variant: i.variant, qty: i.qty, price: i.price })),
  } })
  return { ok: true, message: 'Zamówienie przyjęte.', number }
}
