import type { MetadataRoute } from 'next'
// Demo nie może konkurować w Google z prawdziwą stroną klienta — całość poza indeksem.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
