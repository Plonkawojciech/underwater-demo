// Pure presentation helpers: no I/O, no framework imports, safe on server and client.
// Shapes below are narrow views of the coordinator's Payload types; only fields the UI reads.

export type MediaRef = number | null | undefined | {
  id?: number
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  sizes?: { thumb?: { url?: string | null } | null; card?: { url?: string | null } | null } | null
}

export type Seo = { title?: string | null; description?: string | null; image?: MediaRef } | null | undefined

type Content = { id: number; published?: boolean | null; legacyPath?: string | null; seo?: Seo }

export type CategoryDoc = Content & { name: string; slug: string; parent?: number | CategoryDoc | null; image?: MediaRef; order?: number | null }

export type VariantDoc = {
  id?: string | null
  label: string
  sku?: string | null
  priceCents?: number | null
  stock?: number | null
  image?: MediaRef
}

export type ProductDoc = Content & {
  name: string
  slug: string
  vmId?: number | null
  category?: number | CategoryDoc | null
  categories?: (number | CategoryDoc)[] | null
  manufacturer?: string | null
  sku?: string | null
  priceCents?: number | null
  salePriceCents?: number | null
  /** Legacy złoty fields; used only when the cents fields are empty. */
  price?: number | null
  salePrice?: number | null
  stock?: number | null
  images?: MediaRef[] | null
  short?: string | null
  body?: string | null
  features?: { id?: string | null; text: string }[] | null
  variants?: VariantDoc[] | null
  specs?: { id?: string | null; key: string; value: string }[] | null
  featured?: boolean | null
  warranty?: string | null
}

export type CourseDoc = Content & {
  name: string
  slug: string
  org?: string | null
  level?: string | null
  maxDepth?: number | null
  minAge?: number | null
  price?: number | null
  lead?: string | null
  body?: string | null
  image?: MediaRef
  gallery?: MediaRef[] | null
  sections?: { id?: string | null; title: string; body: string }[] | null
  includes?: { id?: string | null; text: string }[] | null
  featured?: boolean | null
  order?: number | null
}

export type SessionDoc = Content & {
  title: string
  course: number | CourseDoc
  startsAt: string
  endsAt?: string | null
  location?: string | null
  priceCents?: number | null
  capacity?: number | null
  reserved?: number | null
}

export type PageKind = 'page' | 'news' | 'report' | 'legal'
export type PageDoc = Content & {
  title: string
  path: string
  kind: PageKind
  lead?: string | null
  body?: string | null
  image?: MediaRef
  album?: number | AlbumDoc | null
  publishedAt?: string | null
}

export type TripDoc = Content & {
  title: string
  path: string
  location?: string | null
  startsAt?: string | null
  endsAt?: string | null
  priceCents?: number | null
  lead?: string | null
  body?: string | null
  image?: MediaRef
  album?: number | AlbumDoc | null
}

export type AlbumDoc = Content & {
  title: string
  path: string
  description?: string | null
  date?: string | null
  photos?: { id?: string | null; image: MediaRef; caption?: string | null }[] | null
}

export type EventDoc = Content & {
  title: string
  startsAt: string
  endsAt?: string | null
  location?: string | null
  path?: string | null
  body?: string | null
  courseSession?: number | SessionDoc | null
  trip?: number | TripDoc | null
}

export type SettingsDoc = {
  banner?: string | null
  heroTitle?: string | null
  heroText?: string | null
  heroImage?: MediaRef
  priceGuarantee?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  nip?: string | null
  facebook?: string | null
  youtube?: string | null
}

// ---------- media ----------

export const asObject = <T extends object>(v: number | T | null | undefined): T | null =>
  v && typeof v === 'object' ? v : null

export function mediaUrl(m: MediaRef, size: 'thumb' | 'card' | 'full' = 'card'): string {
  const o = asObject(m)
  if (!o) return ''
  const url = size === 'full' ? o.url : o.sizes?.[size]?.url || o.url
  // Payload upload URLs are absolute; a relative own-server path works in both
  // local HTTP tests and HTTPS preview, and survives an own-host alias change.
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url, 'https://underwater-demo.programo.pl')
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.pathname.startsWith('/api/media/file/')) return parsed.pathname
    } catch { /* The normal asset allowlist rejects malformed values below. */ }
  }
  return safeAssetUrl(url) || ''
}
export const mediaAlt = (m: MediaRef) => asObject(m)?.alt?.trim() || ''

/** Same-origin path or https URL; nothing else reaches an src attribute. */
export function safeAssetUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > 1000) return null
  if (/^\/(?![/\\])/.test(s)) return s
  if (/^https:\/\/[^/\\]/i.test(s)) return s
  return null
}

/** Only http(s) links from CMS settings (social profiles). */
export function safeExternalUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch { return null }
}

// ---------- money ----------

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

/** Cents field first; the legacy złoty field only when cents are empty. */
export function centsOf(cents?: number | null, zl?: number | null): number | null {
  if (isCents(cents)) return cents
  if (typeof zl === 'number' && Number.isFinite(zl) && zl >= 0 && zl < 10_000_000) return Math.round(zl * 100)
  return null
}

const PLN = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function formatMoney(cents: number | null | undefined, currency = 'PLN'): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  const f = currency === 'PLN' ? PLN : new Intl.NumberFormat('pl-PL', { style: 'currency', currency })
  return f.format(cents / 100)
}

export type Price = { base: number | null; sale: number | null; current: number | null }

/** A sale price counts only when it is a real reduction of a known base price. */
export function productPrice(p: Pick<ProductDoc, 'priceCents' | 'salePriceCents' | 'price' | 'salePrice'>): Price {
  const base = centsOf(p.priceCents, p.price)
  const sale = centsOf(p.salePriceCents, p.salePrice)
  const onSale = base !== null && sale !== null && sale > 0 && sale < base
  return { base, sale: onSale ? sale : null, current: onSale ? sale : base === 0 ? null : base }
}

/** A variant's own price replaces the product price (and its promotion). */
export function variantPrice(p: Parameters<typeof productPrice>[0], v?: Pick<VariantDoc, 'priceCents'> | null): Price {
  if (v && isCents(v.priceCents)) return { base: v.priceCents, sale: null, current: v.priceCents === 0 ? null : v.priceCents }
  return productPrice(p)
}

/** Lowest and highest current price across variants, for "od …" on cards. */
export function priceSpan(p: Parameters<typeof productPrice>[0] & { variants?: Pick<VariantDoc, 'priceCents'>[] | null }) {
  const prices = (p.variants?.length ? p.variants.map((v) => variantPrice(p, v).current) : [productPrice(p).current])
    .filter((n): n is number => n !== null)
  if (!prices.length) return null
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

const stockNum = (s: unknown) => (typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.floor(s)) : null)

/**
 * Known stock from CMS data (sum of variants when present), or null when the record does not say.
 * Variants of which only some are known to be at zero are not "sold out": the rest is unknown.
 */
export function knownStock(p: { stock?: number | null; variants?: Pick<VariantDoc, 'stock'>[] | null }): number | null {
  if (p.variants?.length) {
    const all = p.variants.map((v) => stockNum(v.stock))
    const known = all.filter((n): n is number => n !== null)
    const sum = known.reduce((a, b) => a + b, 0)
    return !known.length || (sum === 0 && known.length < all.length) ? null : sum
  }
  return stockNum(p.stock)
}

/** `unknown` (no stock in the record) is not `out` (a known zero); only `in` can be bought online. */
export type StockState = 'in' | 'out' | 'unknown'
export function stockState(stock: number | null | undefined): StockState {
  const n = stockNum(stock)
  return n === null ? 'unknown' : n > 0 ? 'in' : 'out'
}
export const STOCK_LABEL: Record<Exclude<StockState, 'in'>, string> = {
  unknown: 'Dostępność do potwierdzenia',
  out: 'Chwilowo niedostępny',
}

// ---------- routing ----------

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return null } }

export type NormalizedPath = {
  /** Decoded segments, `.html` removed from the last one. */
  segments: string[]
  /** `a/b` — the lookup key for slugs and fixed routes. */
  path: string
  /** `/a/b.html` exactly as requested, decoded — for legacy path matching. */
  requested: string
}

/** Decodes and validates catch-all segments. Returns null for traversal or malformed input. */
export function normalizeSegments(raw: string[] | undefined): NormalizedPath | null {
  if (!raw?.length || raw.length > 12) return null
  const decoded: string[] = []
  for (const r of raw) {
    const d = decode(r)
    if (d === null) return null
    const s = d.normalize('NFC')
    if (!s || s === '.' || s === '..' || s.length > 200 || /[/\\\u0000-\u001f]/.test(s)) return null
    decoded.push(s)
  }
  const segments = [...decoded]
  segments[segments.length - 1] = segments[segments.length - 1].replace(/\.html$/i, '')
  if (!segments[segments.length - 1]) return null
  return { segments, path: segments.join('/'), requested: '/' + decoded.join('/') }
}

const uniq = <T,>(a: T[]) => [...new Set(a)]

/** Exact forms a stored legacy path may take for this request. */
export function legacyCandidates(raw: string[], n: NormalizedPath): string[] {
  const encoded = '/' + raw.join('/')
  return uniq([n.requested, encoded, n.requested.slice(1), encoded.slice(1)])
}

/** Forms a CMS `path` field may take for this request (with or without slash and `.html`). */
export function pathCandidates(path: string): string[] {
  return uniq([path, `${path}.html`, `/${path}`, `/${path}.html`])
}

/** Slug segments: letters and digits in any script, `_ - . ~`; no empty, dot-only or encoded parts. */
const SEGMENT = /^[\p{L}\p{M}\p{N}_~-][\p{L}\p{M}\p{N}_.~-]*$/u
export function isSafeSlug(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 200) return false
  return v.split('/').every((s) => SEGMENT.test(s) && !/^\.+$/.test(s))
}

export const productHref = (slug: string) => `/${slug}.html`
export const categoryHref = (slug: string) => `/${slug}.html`
export const courseHref = (slug: string) => `/kursy-nurkowania/${slug}.html`

/** Site-relative link for a CMS `path`; rejects schemes and protocol-relative values. */
export function contentHref(path?: string | null): string | null {
  const p0 = path?.trim()
  if (!p0 || /^[a-z][a-z0-9+.-]*:/i.test(p0) || p0.startsWith('//') || p0.includes('\\')) return null
  const p = '/' + p0.replace(/^\/+/, '')
  if (p === '/' || p.endsWith('/') || /\.html$/i.test(p)) return p
  return `${p}.html`
}

/** The old address stays canonical when it is a plain site path; otherwise the built one. */
export function canonicalPath(built: string | null, legacyPath?: string | null): string | null {
  const l = legacyPath?.trim()
  if (l && /^\/(?![/\\])/.test(l) && !/[?#\\\s]/.test(l)) return l
  return built
}

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Page number from the query: bounded at 1000, anything malformed is page 1. */
export function parsePage(v: string | string[] | undefined, max = 1000): number {
  const s = firstParam(v)
  if (!s || !/^\d{1,4}$/.test(s)) return 1
  return Math.min(Math.max(1, Number(s)), max)
}

/** Search text: trimmed, single spaces, at most 80 characters; shorter than 2 is no search. */
export function searchQuery(v: string | string[] | undefined): string {
  const s = (firstParam(v) || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return s.length >= 2 ? s : ''
}

export type Query = Record<string, string | string[] | undefined>

/** Trip list views and their query values; anything else is the upcoming list. */
export type TripView = 'upcoming' | 'past' | 'undated'
export const TRIP_VIEW_PARAM: Record<TripView, string | undefined> = { upcoming: undefined, past: 'minione', undated: 'bez-daty' }
export function tripView(v: string | string[] | undefined): TripView {
  const s = firstParam(v)
  return s === TRIP_VIEW_PARAM.past ? 'past' : s === TRIP_VIEW_PARAM.undated ? 'undated' : 'upcoming'
}

/**
 * Canonical for a list page. Pages after the first keep `strona` (they hold different records).
 * Search results and course filters point at the unfiltered list; the trip view is part of the list.
 */
export type ListKind = 'paged' | 'shop' | 'courses' | 'trips'
export function listCanonical(path: string, kind: ListKind, q: Query = {}): string {
  const page = parsePage(q.strona)
  if (kind === 'shop' && searchQuery(q.q)) return path
  if (kind === 'courses' && firstParam(q.org)) return path
  if (kind === 'trips') return withQuery(path, { widok: TRIP_VIEW_PARAM[tripView(q.widok)], strona: page })
  return withQuery(path, { strona: page })
}

export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (k === 'strona' && Number(v) <= 1) continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

// ---------- category tree ----------

export type TreeNode = Pick<CategoryDoc, 'id' | 'name' | 'slug' | 'order'> & { parent?: number | { id: number } | null }

export const parentId = (c: { parent?: number | { id: number } | null }) =>
  typeof c.parent === 'object' && c.parent ? c.parent.id : typeof c.parent === 'number' ? c.parent : null

export function categoryTree<T extends TreeNode>(all: T[]) {
  const byId = new Map(all.map((c) => [c.id, c]))
  const children = new Map<number | null, T[]>()
  for (const c of all) {
    // A parent that is missing (unpublished) makes the node a root rather than an orphan.
    const pid = parentId(c)
    const key = pid !== null && byId.has(pid) ? pid : null
    children.set(key, [...(children.get(key) || []), c])
  }
  const kids = (id: number | null) => children.get(id) || []
  /** Root first; stops on cycles. */
  const ancestors = (id: number): T[] => {
    const out: T[] = []
    const seen = new Set<number>([id])
    let cur = byId.get(id)
    while (cur) {
      const pid = parentId(cur)
      if (pid === null || seen.has(pid)) break
      seen.add(pid)
      const p = byId.get(pid)
      if (!p) break
      out.unshift(p)
      cur = p
    }
    return out
  }
  /** The node and every descendant, cycle-safe. */
  const subtree = (id: number): number[] => {
    const out: number[] = []
    const stack = [id]
    const seen = new Set<number>()
    while (stack.length) {
      const n = stack.pop() as number
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
      for (const k of kids(n)) stack.push(k.id)
    }
    return out
  }
  return { byId, roots: kids(null), kids, ancestors, subtree }
}

// ---------- dates (Europe/Warsaw) ----------

export const TZ = 'Europe/Warsaw'

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
function zoned(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
const offsetMs = (d: Date) => {
  const z = zoned(d)
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(d.getTime() / 1000) * 1000
}
/** UTC instant of local midnight in Warsaw on the given day (DST-aware). */
export function warsawMidnight(y: number, m: number, d = 1): Date {
  const guess = Date.UTC(y, m - 1, d)
  const o1 = offsetMs(new Date(guess))
  let t = guess - o1
  const o2 = offsetMs(new Date(t))
  if (o2 !== o1) t = guess - o2
  return new Date(t)
}

export type Month = { y: number; m: number }
export function parseMonth(v: string | string[] | undefined): Month | null {
  const s = firstParam(v)
  const r = s && /^(\d{4})-(\d{2})$/.exec(s)
  if (!r) return null
  const y = +r[1]
  const m = +r[2]
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? { y, m } : null
}
export const monthOf = (d: Date): Month => { const z = zoned(d); return { y: z.y, m: z.m } }
export const shiftMonth = ({ y, m }: Month, delta: number): Month => {
  const i = y * 12 + (m - 1) + delta
  return { y: Math.floor(i / 12), m: (i % 12) + 1 }
}
export const monthKey = ({ y, m }: Month) => `${y}-${String(m).padStart(2, '0')}`
export const monthRange = (mo: Month) => {
  const n = shiftMonth(mo, 1)
  return { start: warsawMidnight(mo.y, mo.m), end: warsawMidnight(n.y, n.m) }
}
const monthFmt = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: TZ })
export const monthLabel = (mo: Month) => monthFmt.format(new Date(Date.UTC(mo.y, mo.m - 1, 15, 12)))

/** Groups by Warsaw month of `startsAt`, keeping input order. */
export function groupByMonth<T extends { startsAt: string }>(items: T[]): { month: Month; items: T[] }[] {
  const out: { month: Month; items: T[] }[] = []
  for (const it of items) {
    const d = new Date(it.startsAt)
    if (Number.isNaN(d.getTime())) continue
    const mo = monthOf(d)
    const last = out[out.length - 1]
    if (last && last.month.y === mo.y && last.month.m === mo.m) last.items.push(it)
    else out.push({ month: mo, items: [it] })
  }
  return out
}

const dateLongFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })
/** "14 listopada 2026, 09:00" in Warsaw time; empty for a missing or invalid date. */
export function formatDateTime(v?: string | null): string {
  const d = v ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${dateLongFmt.format(d)}, ${timeFmt.format(d)}`
}

// ---------- calendar ----------

export type CalendarKind = 'event' | 'course' | 'trip'
export const CALENDAR_KIND: Record<CalendarKind, string> = { event: 'Wydarzenie', course: 'Kurs', trip: 'Wyprawa' }
export type CalendarEntry = {
  key: string
  kind: CalendarKind
  title: string
  /** Session name when the title is the course name. */
  detail?: string | null
  startsAt: string
  endsAt?: string | null
  location?: string | null
  href: string | null
}

const relId = (v: unknown): number | null =>
  typeof v === 'number' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number' ? (v as { id: number }).id : null
const validDate = (v?: string | null): v is string => !!v && !Number.isNaN(new Date(v).getTime())
const KIND_ORDER: CalendarKind[] = ['event', 'course', 'trip']

/**
 * One date list from published events, course sessions and dated trips. A session or trip an
 * event already points to is shown once, as the event. Records without a valid start date are left out.
 */
export function mergeCalendar(
  { events, sessions, trips }: { events: EventDoc[]; sessions: SessionDoc[]; trips: TripDoc[] },
  href: { event: (e: EventDoc) => string | null; session: (s: SessionDoc) => string | null; trip: (t: TripDoc) => string | null },
): CalendarEntry[] {
  const coveredSessions = new Set(events.map((e) => relId(e.courseSession)).filter((n): n is number => n !== null))
  const coveredTrips = new Set(events.map((e) => relId(e.trip)).filter((n): n is number => n !== null))
  const out: CalendarEntry[] = []
  for (const e of events) {
    if (validDate(e.startsAt)) out.push({ key: `event-${e.id}`, kind: 'event', title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, location: e.location, href: href.event(e) })
  }
  for (const s of sessions) {
    if (coveredSessions.has(s.id) || !validDate(s.startsAt)) continue
    const course = asObject(s.course)
    out.push({
      key: `course-${s.id}`, kind: 'course', title: course?.name || s.title, detail: course && s.title !== course.name ? s.title : null,
      startsAt: s.startsAt, endsAt: s.endsAt, location: s.location, href: href.session(s),
    })
  }
  for (const t of trips) {
    if (coveredTrips.has(t.id) || !validDate(t.startsAt)) continue
    out.push({ key: `trip-${t.id}`, kind: 'trip', title: t.title, startsAt: t.startsAt, endsAt: t.endsAt, location: t.location, href: href.trip(t) })
  }
  return out.sort((a, b) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    a.title.localeCompare(b.title, 'pl'))
}

// ---------- galleries ----------

export type AlbumPhotoRow = NonNullable<AlbumDoc['photos']>[number]
/** Media id of a relation that may or may not be populated. */
export const mediaId = (m: MediaRef): number | null => relId(m)

/** One page of an album's photo rows; the page is clamped to the album. */
export function albumSlice<T>(rows: T[] | null | undefined, page: number, perPage: number) {
  const all = rows || []
  const pages = Math.max(1, Math.ceil(all.length / perPage))
  const cur = Math.min(Math.max(1, page), pages)
  return { rows: all.slice((cur - 1) * perPage, cur * perPage), page: cur, pages, total: all.length }
}

// ---------- courses ----------

/** Free places, or null when the session has no capacity limit. Never negative. */
export function seatsLeft(s: Pick<SessionDoc, 'capacity' | 'reserved'>): number | null {
  if (typeof s.capacity !== 'number' || !Number.isFinite(s.capacity) || s.capacity < 1) return null
  const reserved = typeof s.reserved === 'number' && Number.isFinite(s.reserved) ? Math.max(0, s.reserved) : 0
  return Math.max(0, Math.floor(s.capacity - reserved))
}

export const COURSE_LEVEL: Record<string, string> = {
  intro: 'Wprowadzenie', basic: 'Podstawowy', advanced: 'Zaawansowany', rescue: 'Ratownictwo', pro: 'Profesjonalny', specialty: 'Specjalizacja',
}

// ---------- text ----------

/** Rough plain text from stored HTML, for meta descriptions only (output is escaped by React/Next). */
export function plainText(html?: string | null): string {
  if (!html) return ''
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function excerpt(text?: string | null, max = 160): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '') + '…'
}

// ---------- phone ----------

/**
 * `tel:` link for one written number, or null. Polish numbers (9 digits, optionally with +48 or
 * 0048) get +48; other numbers must already be international. Letters (extensions, notes) or a
 * wrong digit count give no link, so nothing is dialled that the text does not say.
 */
function telOf(text: string): string | null {
  const t = text.replace(/[\s().-]/g, '')
  const pl = /^(?:\+48|0048)?(\d{9})$/.exec(t)
  if (pl) return `tel:+48${pl[1]}`
  return /^\+[1-9]\d{7,14}$/.test(t) ? `tel:${t}` : null
}

export type PhonePart = { text: string; href: string | null }
/** Settings may hold several numbers ("22 826 47 73, 604 123 456"); each keeps its own text and link. */
export function phoneParts(raw?: string | null): PhonePart[] {
  return (raw || '').split(/[,;\n]|\s\/\s|\s+lub\s+/i).map((s) => s.trim()).filter(Boolean).map((text) => ({ text, href: telOf(text) }))
}
/** The first number that makes a valid link: for places with room for one call button. */
export const telHref = (raw?: string | null): string | null => phoneParts(raw).find((p) => p.href)?.href ?? null

// ---------- enquiries ----------

/** What a contact message is about. The server re-reads the published record before trusting it. */
export type ContactContext = { kind: 'product' | 'trip'; id: number; title: string; href: string }
const CONTACT_PARAM = { product: 'produkt', trip: 'wyjazd' } as const

/** Contact page link that names the record by id only (no titles in the URL). */
export const enquiryHref = (kind: ContactContext['kind'], id: number) =>
  Number.isSafeInteger(id) && id > 0 ? withQuery('/kontakt.html', { [CONTACT_PARAM[kind]]: id }) : '/kontakt.html'

/** The record a contact link points to, or null. Validation only; the record itself is read on the server. */
export function contactQuery(q: Query): { kind: ContactContext['kind']; id: number } | null {
  for (const kind of ['product', 'trip'] as const) {
    const s = firstParam(q[CONTACT_PARAM[kind]])
    if (s && /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2 ** 31 - 1) return { kind, id: Number(s) }
  }
  return null
}

// ---------- legal ----------

export type LegalLink = { title: string; href: string; role: 'privacy' | 'terms' | 'other' }
export function legalRole(p: { title?: string | null; path?: string | null }): LegalLink['role'] {
  const s = `${p.title || ''} ${p.path || ''}`.toLowerCase()
  if (/prywatno|privacy|rodo|cookie/.test(s)) return 'privacy'
  if (/regulamin|terms/.test(s)) return 'terms'
  return 'other'
}

// ---------- checkout ----------

/** Only a same-origin test payment page may be followed after checkout. */
export function safePaymentPath(raw: unknown, origin: string): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null
  let u: URL
  try { u = new URL(raw, origin) } catch { return null }
  if (u.origin !== origin || u.username || u.password || u.pathname !== '/platnosc-testowa') return null
  return u.pathname + u.search
}

/** Opaque tokens from links (payment, newsletter). */
export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._~-]{16,512}$/.test(v)

/** Stable JSON with sorted keys, for change detection. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** FNV-1a 32-bit hex. Change detection only, not security. Stored instead of the raw form data. */
export function fingerprint(v: unknown): string {
  const s = stableJson(v)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export type QuoteItem = {
  product: number; name: string; variantId?: string; variant?: string; sku?: string
  qty: number; unitPriceCents: number; lineTotalCents: number
}
export type Quote = {
  items: QuoteItem[]
  subtotalCents: number; deliveryCents: number; totalCents: number
  currency: string
  deliveryMethods: { id: string; label: string; priceCents: number }[]
  deliveryMethod: string
}

const int = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n)
const str = (s: unknown, max = 300) => typeof s === 'string' && s.length <= max

/** Validates the quote response shape; anything malformed is treated as no quote. */
export function parseQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  if (!Array.isArray(q.items) || !Array.isArray(q.deliveryMethods)) return null
  if (![q.subtotalCents, q.deliveryCents, q.totalCents].every(int) || !str(q.currency, 8) || !str(q.deliveryMethod, 80)) return null
  const items = q.items.every((i) => i && typeof i === 'object' && int((i as QuoteItem).product) && str((i as QuoteItem).name) &&
    int((i as QuoteItem).qty) && int((i as QuoteItem).unitPriceCents) && int((i as QuoteItem).lineTotalCents))
  const methods = q.deliveryMethods.every((m) => m && typeof m === 'object' && str((m as { id: string }).id, 80) &&
    str((m as { label: string }).label) && int((m as { priceCents: number }).priceCents))
  return items && methods ? (q as unknown as Quote) : null
}

/** Quote line for a cart line: by variant id when both have one, else by label. */
export function quoteLineFor(items: QuoteItem[], line: { id: number; variantId?: string; variant?: string }): QuoteItem | undefined {
  return items.find((i) => i.product === line.id && (i.variantId && line.variantId ? i.variantId === line.variantId : (i.variant || '') === (line.variant || '')))
}

export const PAYMENT_STATUS: Record<string, string> = {
  pending: 'Oczekuje na płatność',
  paid: 'Opłacone (test)',
  failed: 'Płatność odrzucona (test)',
  cancelled: 'Płatność anulowana (test)',
  expired: 'Link wygasł',
}

// ---------- structured data ----------

/** JSON for a <script type="application/ld+json">: no sequence can close the tag or start markup. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** schema.org Product from catalogue fields only: no ratings, no invented availability. */
export function productSchema(p: ProductDoc, url: string, origin: string) {
  const abs = (u: string) => (u.startsWith('/') ? origin + u : u)
  const images = (p.images || []).map((m) => mediaUrl(m, 'full')).filter(Boolean).map(abs)
  const span = priceSpan(p)
  const stock = knownStock(p)
  const availability = stock === null ? undefined : stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
  const money = (c: number) => (c / 100).toFixed(2)
  const offers = !span ? undefined : span.min === span.max
    ? { '@type': 'Offer', url, priceCurrency: 'PLN', price: money(span.min), ...(availability ? { availability } : {}) }
    : { '@type': 'AggregateOffer', url, priceCurrency: 'PLN', lowPrice: money(span.min), highPrice: money(span.max), offerCount: p.variants?.length, ...(availability ? { availability } : {}) }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url,
    ...(images.length ? { image: images } : {}),
    ...(p.short ? { description: p.short } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.manufacturer ? { brand: { '@type': 'Brand', name: p.manufacturer } } : {}),
    ...(offers ? { offers } : {}),
  }
}

// ---------- consent ----------

export type Consent = { analytics: boolean }
export const CONSENT_KEY = 'uw-consent'
export function parseConsent(raw: string | null | undefined): Consent {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { analytics: !!(v && typeof v === 'object' && v.v === 1 && v.analytics === true) }
  } catch { return { analytics: false } }
}
export const serializeConsent = (c: Consent) => JSON.stringify({ v: 1, analytics: c.analytics })
