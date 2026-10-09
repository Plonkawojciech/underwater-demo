import { Fragment } from 'react'
import { phoneParts } from '@/lib/presentation'

/** Phone numbers from settings as written, each valid one with its own link. No hooks: works in client and server components. */
export function PhoneLinks({ value, className }: { value?: string | null; className?: string }) {
  const parts = phoneParts(value)
  if (!parts.length) return null
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={`${p.text}-${i}`}>
          {i ? ', ' : null}
          {p.href ? <a href={p.href} className={className}>{p.text}</a> : <span className={className}>{p.text}</span>}
        </Fragment>
      ))}
    </>
  )
}
