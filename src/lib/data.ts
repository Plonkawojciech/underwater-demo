import { getPayload } from 'payload'
import config from '@payload-config'

export const db = () => getPayload({ config })

export type Img = { url?: string | null; alt?: string | null; sizes?: { thumb?: { url?: string | null }; card?: { url?: string | null } } } | number | null | undefined

export const imgUrl = (m: Img, size: 'thumb' | 'card' | 'full' = 'card') => {
  if (!m || typeof m === 'number') return ''
  if (size === 'full') return m.url || ''
  return m.sizes?.[size]?.url || m.url || ''
}
export const imgAlt = (m: Img) => (m && typeof m !== 'number' && m.alt) || ''

export const zl = (n: number | null | undefined) =>
  typeof n === 'number' ? n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł' : ''

export const dateLong = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
export const dateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
export const dateShort = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : ''
