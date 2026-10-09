import sanitizeHtml from 'sanitize-html'

export function sanitizeContent(raw: string | null | undefined, resolveMedia?: (src: string) => string | undefined, resolveLink?: (href: string) => string): string {
  if (!raw) return ''
  // Import DTOs cap source HTML at 1 MB; rendering also accepts its expanded,
  // already normalized form. Keep both input and output explicitly bounded.
  if (raw.length > 8_000_000) throw new Error('Content exceeds the permitted size.')
  const normalized = sanitizeHtml(raw, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'div', 'span', 'sup', 'sub', 'dl', 'dt', 'dd'],
    allowedAttributes: { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], ol: ['start'] },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'], allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'template', 'svg', 'math'],
    transformTags: {
      a: (_tag, attributes) => {
        let href = attributes.href || ''
        if (resolveLink) href = resolveLink(href)
        try { const url = new URL(href); if (['underwater.pl', 'www.underwater.pl'].includes(url.hostname)) href = `${url.pathname}${url.search}${url.hash}` } catch { /* Relative links remain relative. */ }
        return { tagName: 'a', attribs: { href, ...(attributes.title ? { title: attributes.title } : {}), rel: 'noopener noreferrer' } }
      },
      img: (_tag, attributes) => {
        // Imported media must be rewritten to this application's media routes.
        const original = attributes.src || ''
        const src = resolveMedia ? resolveMedia(original) || '' : original
        const safe = /^\/(?:api\/media\/file|media|assets)\//.test(src) && !/[\\\u0000-\u001F]/.test(src) && !/%(?:2e|2f|5c)/i.test(src) && !src.split('/').includes('..')
        if (!safe) return { tagName: 'span', attribs: {} }
        const attribs: Record<string, string> = { src, alt: attributes.alt || '', loading: 'lazy' }
        for (const key of ['width', 'height']) if (/^[1-9]\d{0,3}$/.test(attributes[key] || '')) attribs[key] = attributes[key]
        return { tagName: 'img', attribs }
      },
    },
  })
  if (normalized.length > 8_000_000) throw new Error('Normalized content exceeds the permitted size.')
  return normalized
}
