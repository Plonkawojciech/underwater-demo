import type { ReactNode } from 'react'

/**
 * Reading column for long content (articles, course descriptions, legal pages).
 * Styles whatever children it gets; it never injects HTML itself. Source HTML must be
 * sanitized by the caller before it reaches this component.
 */
export function Prose({ children, as: Tag = 'div', className, dark }: {
  children: ReactNode
  as?: 'div' | 'article' | 'section'
  className?: string
  /** Light text for use on the navy background. */
  dark?: boolean
}) {
  return <Tag className={['longform', dark ? 'longform-dark' : '', className || ''].filter(Boolean).join(' ')}>{children}</Tag>
}

/**
 * Plain source text as paragraphs: blank lines split paragraphs, single newlines become
 * line breaks. React escapes the text, so markup in the source is shown, not executed.
 */
export function PlainText({ text, className }: { text?: string | null; className?: string }) {
  const paras = (text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!paras.length) return null
  return (
    <div className={['longform', className || ''].filter(Boolean).join(' ')}>
      {paras.map((p, i) => {
        const rows = p.split('\n')
        return <p key={i}>{rows.map((r, j) => <span key={j}>{j > 0 && <br />}{r}</span>)}</p>
      })}
    </div>
  )
}

/** Wide tables scroll inside their own box instead of widening the page on mobile. */
export function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>
}
