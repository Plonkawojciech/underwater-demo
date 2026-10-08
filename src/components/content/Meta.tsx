import Link from 'next/link'
import { jsonLd } from '@/lib/presentation'

/**
 * Structured data. Accepts a plain object only and serialises it with every character
 * that could end the script or open markup escaped; it is not an HTML wrapper.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
}

export type Crumb = { label: string; href?: string }

/** Breadcrumb trail; the last item is the current page. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Ścieżka" className="crumbs">
      <ol>
        <li><Link href="/">Start</Link></li>
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`}>
            {c.href && i < items.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}
