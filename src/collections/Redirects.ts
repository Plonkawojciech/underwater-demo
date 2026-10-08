import { APIError, type CollectionConfig, type Where } from 'payload'
import { publicContentAccess } from '../lib/access'
import { legacyPath } from '../lib/import/bundle'
import { fixedRoute, isAppRoute, resolveSourceRoute, routeKey, type RouteFinder } from '../lib/source-routes'
import { contentFields } from './fields'

const MAX_CHAIN = 20
const invalid = (message: string) => new APIError(message, 400)
/** Route key of a redirect target's path part, decoded where possible. */
function targetRoute(to: string): string {
  const path = to.split(/[?#]/)[0]
  try { return routeKey(decodeURIComponent(path).normalize('NFC')) } catch { return routeKey(path) }
}

export const Redirects: CollectionConfig = {
  slug: 'redirects', admin: { group: 'Treści', useAsTitle: 'from' }, access: publicContentAccess,
  hooks: { beforeValidate: [async ({ data, req, originalDoc }) => {
    for (const key of ['from', 'to']) {
      const value = data?.[key]
      if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001F]/.test(value) || value.split('/').includes('..')) throw invalid('Przekierowanie musi wskazywać ścieżkę w tej witrynie.')
    }
    // The proxy matches the decoded request path, so `from` is stored in the importer's canonical form.
    let from: string
    try { from = legacyPath((data!.from as string).replace(/ /g, '%20')) } catch { throw invalid('Adres przekierowania jest nieprawidłowy.') }
    data!.from = from
    const source = routeKey(from)
    if (isAppRoute(source) || fixedRoute(source)) throw invalid('Ten adres obsługuje sama aplikacja; przekierowanie nie może go zastąpić.')
    if (source === targetRoute(data!.to)) throw invalid('Przekierowanie nie może prowadzić do siebie.')
    if (data!.published !== true) return data

    // Reads go through the caller's req (and its transaction); Payload errors are never caught here.
    const first = async (collection: Parameters<RouteFinder>[0], where: Where) =>
      (await req.payload.find({ collection, where: { and: [{ published: { equals: true } }, where] }, limit: 1, depth: 0, req, overrideAccess: true })).docs[0] ?? null
    const find: RouteFinder = (collection, where) => first(collection, where) as never
    const key = from.split('/').slice(1).map(encodeURIComponent).join('/')
    if (await resolveSourceRoute(key, find, { redirects: false, depth: false })) throw invalid('Pod tym adresem jest opublikowana treść; przekierowanie by ją ukryło.')

    // Follow the chain through stored published redirects; the proxy only ever checks one hop.
    const seen = new Set([source])
    for (let to = data!.to as string, step = 0; ; step++) {
      const route = targetRoute(to)
      if (seen.has(route)) throw invalid('Przekierowanie tworzy pętlę z istniejącymi przekierowaniami.')
      if (step === MAX_CHAIN) throw invalid('Łańcuch przekierowań jest zbyt długi.')
      seen.add(route)
      const where: Where = originalDoc?.id != null
        ? { and: [{ from: { in: [`/${route}`, `/${route}.html`, `/${route}/`] } }, { id: { not_equals: originalDoc.id } }] }
        : { from: { in: [`/${route}`, `/${route}.html`, `/${route}/`] } }
      const next = await first('redirects', where) as { to?: unknown } | null
      if (typeof next?.to !== 'string') break
      to = next.to
    }
    return data
  }] },
  fields: [{ name: 'from', type: 'text', required: true, unique: true }, { name: 'to', type: 'text', required: true }, { name: 'reason', type: 'text' }, ...contentFields],
}
