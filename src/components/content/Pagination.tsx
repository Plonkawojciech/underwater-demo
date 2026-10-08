import Link from 'next/link'

export type PageItem = number | 'gap'

/**
 * Page numbers to show: first, last, current ± siblings, with gaps.
 * A gap that would hide a single page shows that page instead.
 */
export function pageWindow(current: number, total: number, siblings = 1): PageItem[] {
  const last = Math.max(1, Math.floor(total))
  const cur = Math.min(Math.max(1, Math.floor(current) || 1), last)
  const keep = new Set<number>([1, last])
  for (let p = cur - siblings; p <= cur + siblings; p++) if (p >= 1 && p <= last) keep.add(p)
  const sorted = [...keep].sort((a, b) => a - b)
  const out: PageItem[] = []
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && p - prev === 2) out.push(prev + 1)
    else if (prev !== undefined && p - prev > 2) out.push('gap')
    out.push(p)
  })
  return out
}

/**
 * Archive / catalogue pagination. URL scheme stays with the router: pass `hrefFor`.
 * Renders nothing for a single page.
 */
export function Pagination({ page, totalPages, hrefFor, label = 'Strony wyników' }: {
  page: number
  totalPages: number
  hrefFor: (page: number) => string
  label?: string
}) {
  const total = Math.max(1, Math.floor(totalPages) || 1)
  if (total <= 1) return null
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), total)
  return (
    <nav className="pager" aria-label={label}>
      {cur > 1
        ? <Link className="pager-step" href={hrefFor(cur - 1)} rel="prev">Poprzednia</Link>
        : <span className="pager-step" aria-disabled="true">Poprzednia</span>}
      <ol className="pager-list">
        {pageWindow(cur, total).map((p, i) => (
          <li key={p === 'gap' ? `gap-${i}` : p}>
            {p === 'gap'
              ? <span className="pager-gap" aria-hidden="true">…</span>
              : p === cur
                ? <span className="pager-n pager-on" aria-current="page"><span className="sr-only">Strona </span>{p}</span>
                : <Link className="pager-n" href={hrefFor(p)}><span className="sr-only">Strona </span>{p}</Link>}
          </li>
        ))}
      </ol>
      <span className="pager-of mono">Strona {cur} z {total}</span>
      {cur < total
        ? <Link className="pager-step" href={hrefFor(cur + 1)} rel="next">Następna</Link>
        : <span className="pager-step" aria-disabled="true">Następna</span>}
    </nav>
  )
}

/** "Pozycje 21–40 z 134". Renders nothing when the total is unknown or zero. */
export function RangeSummary({ page, perPage, total }: { page: number; perPage: number; total?: number | null }) {
  if (!total || total < 1 || perPage < 1) return null
  const pages = Math.ceil(total / perPage)
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const from = (cur - 1) * perPage + 1
  const to = Math.min(total, cur * perPage)
  return <p className="range mono">Pozycje {from}–{to} z {total}</p>
}
