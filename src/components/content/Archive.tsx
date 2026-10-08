import Link from 'next/link'
import type { ReactNode } from 'react'
import { DateText } from './DateText'

/** List for news, trip reports and other archives. Pair with Pagination for long lists. */
export function ArchiveList({ children, label }: { children: ReactNode; label?: string }) {
  return <ul className="archive" aria-label={label}>{children}</ul>
}

/**
 * One archive entry. Every field except title and href is optional and only rendered
 * when the record has it; nothing is filled in by the component.
 */
export function ArchiveItem({ href, title, date, excerpt, meta, image, level = 'h2' }: {
  href: string
  title: string
  date?: string | null
  excerpt?: string | null
  /** Short facts from the record, e.g. place or organisation. */
  meta?: ReactNode
  image?: { src: string; alt?: string } | null
  level?: 'h2' | 'h3'
}) {
  const H = level
  return (
    <li className={'arc' + (image ? ' arc-img' : '')}>
      {image ? <img src={image.src} alt={image.alt || ''} loading="lazy" decoding="async" /> : null}
      <div>
        <H className="arc-t"><Link href={href}>{title}</Link></H>
        {date || meta ? <p className="arc-m">{date ? <DateText value={date} /> : null}{date && meta ? <span aria-hidden="true">, </span> : null}{meta}</p> : null}
        {excerpt ? <p className="arc-x">{excerpt}</p> : null}
      </div>
    </li>
  )
}
