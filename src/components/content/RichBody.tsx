import { SafeHTML } from '@/components/SafeHTML'

/**
 * Long CMS body (HTML imported from the source site). Sanitising belongs to the
 * coordinator's SafeHTML, which renders its own wrapper; this only sets the reading column.
 */
export function RichBody({ html, dark, className }: { html?: string | null; dark?: boolean; className?: string }) {
  if (!html?.trim()) return null
  return <SafeHTML html={html} className={['longform', dark ? 'longform-dark' : '', className || ''].filter(Boolean).join(' ')} />
}
