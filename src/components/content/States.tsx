import Link from 'next/link'
import type { ReactNode } from 'react'

/** Empty list or missing content. Copy should say what to do next, not apologise. */
export function EmptyState({ title, children, action, level = 'h2' }: {
  title: string
  children?: ReactNode
  action?: { href: string; label: string }
  level?: 'h2' | 'h3'
}) {
  const H = level
  return (
    <div className="empty-state">
      <H className="h3">{title}</H>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <Link className="textlink" href={action.href}>{action.label}</Link> : null}
    </div>
  )
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'error'

/**
 * Inline message. Set `live` only for messages that appear after a user action;
 * errors are then announced immediately, the rest politely.
 */
export function Notice({ tone = 'info', title, children, live }: {
  tone?: NoticeTone
  title?: string
  children?: ReactNode
  live?: boolean
}) {
  const role = live ? (tone === 'error' ? 'alert' : 'status') : undefined
  return (
    <div className={`notice notice-${tone}`} role={role}>
      {title ? <p className="notice-t">{title}</p> : null}
      {children ? <div className="notice-b">{children}</div> : null}
    </div>
  )
}
