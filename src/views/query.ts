import { runtimeOrigin } from '@/lib/origin'
import { cache } from 'react'
import type { Where } from 'payload'
import { db } from '@/lib/data'
import { legalRole, type LegalLink, type MediaRef, type PageDoc, type SettingsDoc, contentHref } from '@/lib/presentation'

// Every public read goes through this module: access control on (anonymous user, so
// drafts stay hidden), an explicit published filter as a second guard, and bounded
// limit/depth. Views never call payload.find directly.

export const PAGE_SIZE = 24
const MAX_LIMIT = 500
const MAX_DEPTH = 2

export type PublicCollection = 'products' | 'categories' | 'courses' | 'course-sessions' | 'pages' | 'trips' | 'albums' | 'events' | 'redirects'

type FindArgs = {
  where?: Where
  limit: number
  depth: number
  page?: number
  sort?: string
  select?: Record<string, true>
}
export type Paged<T> = { docs: T[]; totalDocs: number; totalPages: number; page: number }

// The generated types in this tree predate the coordinator's new collections; the
// local API is narrowed to what is used here instead of widening the generated config.
type LocalAPI = {
  find(args: Record<string, unknown>): Promise<{ docs: unknown[]; totalDocs: number; totalPages: number; page?: number }>
  findGlobal(args: Record<string, unknown>): Promise<unknown>
}
const api = async () => (await db()) as unknown as LocalAPI

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.floor(n) || lo, lo), hi)
const PUBLISHED: Where = { published: { equals: true } }

export async function publicFind<T>(collection: PublicCollection, a: FindArgs): Promise<Paged<T>> {
  const r = await (await api()).find({
    collection,
    where: a.where ? { and: [PUBLISHED, a.where] } : PUBLISHED,
    limit: clamp(a.limit, 1, MAX_LIMIT),
    depth: clamp(a.depth, 0, MAX_DEPTH),
    page: clamp(a.page ?? 1, 1, 100_000),
    ...(a.sort ? { sort: a.sort } : {}),
    ...(a.select ? { select: a.select } : {}),
    overrideAccess: false,
    draft: false,
  })
  return { docs: r.docs as T[], totalDocs: r.totalDocs, totalPages: r.totalPages, page: r.page ?? 1 }
}

export async function publicFirst<T>(collection: PublicCollection, where: Where, depth: number): Promise<T | null> {
  const r = await publicFind<T>(collection, { where, limit: 1, depth })
  return r.docs[0] ?? null
}

const MAX_MEDIA = 100
type MediaDoc = Exclude<MediaRef, number | null | undefined>

/**
 * Media documents by id, for one gallery page or a set of album covers. Media has no
 * `published` field, so the published guard does not apply; collection read access stays on.
 */
export async function publicMedia(ids: (number | null)[]): Promise<Map<number, MediaDoc>> {
  const unique = [...new Set(ids.filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0))].slice(0, MAX_MEDIA)
  if (!unique.length) return new Map()
  const r = await (await api()).find({
    collection: 'media', where: { id: { in: unique } }, limit: unique.length, depth: 0, overrideAccess: false, draft: false,
  })
  return new Map((r.docs as (MediaDoc & { id: number })[]).map((m) => [m.id, m]))
}

export const getSettings = cache(async (): Promise<SettingsDoc> => {
  const s = await (await api()).findGlobal({ slug: 'settings', depth: 1, overrideAccess: false })
  return (s || {}) as SettingsDoc
})

/** Published legal documents from the CMS. Empty until the client's documents are imported. */
export const getLegalLinks = cache(async (): Promise<LegalLink[]> => {
  const r = await publicFind<Pick<PageDoc, 'id' | 'title' | 'path'>>('pages', {
    where: { kind: { equals: 'legal' } }, limit: 20, depth: 0, sort: 'title', select: { title: true, path: true },
  })
  return r.docs.flatMap((p) => {
    const href = contentHref(p.path)
    return href ? [{ title: p.title, href, role: legalRole(p) }] : []
  })
})

/** Preview origin for canonicals and structured data. Empty when not configured. */
export function siteOrigin(): string {
  try { return runtimeOrigin() } catch { return '' }
}

/** Every environment that exists today is a preview; nothing is indexable yet. */
export const isPreview = () => process.env.UNDERWATER_ENVIRONMENT !== 'production'

export const nowISO = () => new Date().toISOString()
