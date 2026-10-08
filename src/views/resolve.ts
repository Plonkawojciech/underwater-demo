import { cache } from 'react'
import { resolveSourceRoute, type Resolved } from '@/lib/source-routes'
import { publicFirst } from './query'

export { FIXED, type FixedRoute, type Resolved } from '@/lib/source-routes'

/**
 * One lookup per request, shared by generateMetadata and the page. The order lives in
 * `resolveSourceRoute`, which the redirect proxy and redirect validation use as well.
 * Unpublished records never match.
 */
export const resolveRoute = cache((key: string): Promise<Resolved | null> => resolveSourceRoute(key, publicFirst))
