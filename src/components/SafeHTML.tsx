import { sanitizeContent } from '@/lib/html'
export function SafeHTML({ html, className = 'prose' }: { html?: string | null; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeContent(html) }} />
}
export default SafeHTML
