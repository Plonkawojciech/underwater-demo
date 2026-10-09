import { sitemapPaths, sitemapXml, SITEMAP_COLLECTIONS, type SitemapDocument, type SitemapRecords } from '@/lib/seo'
import { FIXED_META } from '@/views/meta'
import { publicFind, siteOrigin } from '@/views/query'
import type { FixedRoute } from '@/lib/source-routes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const records: SitemapRecords = {}
  await Promise.all(SITEMAP_COLLECTIONS.map(async (collection) => {
    const docs: SitemapDocument[] = []
    for (let page = 1; ; page += 1) {
      const fields: Record<string, true> = collection === 'products' || collection === 'categories' || collection === 'courses' ? { slug: true } : { path: true }
      const result = await publicFind<SitemapDocument>(collection, {
        page, limit: 500, depth: 0, sort: 'id', select: { id: true, published: true, legacyPath: true, ...fields },
      })
      docs.push(...result.docs)
      if (page >= result.totalPages) break
      if (!result.docs.length) throw new Error('Sitemap pagination ended before the published collection was read.')
    }
    records[collection] = docs
  }))
  const fixed = Object.fromEntries(Object.entries(FIXED_META).map(([key, value]) => [key, value.path])) as Record<FixedRoute, string>
  const xml = sitemapXml(await sitemapPaths(records, fixed), siteOrigin())
  return new Response(xml, { headers: {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
  } })
}
