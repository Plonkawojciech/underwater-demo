import { runtimeOrigin } from './lib/origin'
import { NextResponse, type NextRequest } from 'next/server'
import type { Where } from 'payload'
import { validHealthToken, validPreviewAuthorization } from './lib/preview-auth'

export async function proxy(request: NextRequest) {
  const env = process.env.UNDERWATER_ENVIRONMENT
  const responseHeaders = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  const ownOrigin = runtimeOrigin()
  // Host isolation remains enforced even when the database cannot initialize.
  const expectedHost = new URL(ownOrigin).host
  const incomingHost = request.headers.get('host')
  if (incomingHost !== expectedHost) {
    if (incomingHost === 'underwater.programo.pl' && expectedHost === 'underwater-demo.programo.pl') {
      const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, ownOrigin)
      const redirect = NextResponse.redirect(destination, 301)
      for (const [key, value] of Object.entries(responseHeaders)) redirect.headers.set(key, value)
      return redirect
    }
    return new NextResponse('Nieprawidłowy host podglądu.', { status: 421, headers: responseHeaders })
  }
  const localTest = env === 'test' && ['localhost', '127.0.0.1', '[::1]'].includes(request.nextUrl.hostname)
  if (!localTest) {
    if (env !== 'preview') return new NextResponse('Podgląd nie jest skonfigurowany.', { status: 503, headers: responseHeaders })
    const username = process.env.UNDERWATER_PREVIEW_USER, password = process.env.UNDERWATER_PREVIEW_PASSWORD
    if (!username || !password || password.length < 24) return new NextResponse('Podgląd oczekuje na konfigurację dostępu.', { status: 503, headers: responseHeaders })
    const health = request.nextUrl.pathname === '/api/health' && validHealthToken(request.headers.get('x-underwater-health'), process.env.PAYLOAD_SECRET || '')
    if (!health && !validPreviewAuthorization(request.headers.get('authorization'), username, password)) return new NextResponse('Prywatny podgląd Underwater.', { status: 401, headers: { ...responseHeaders, 'WWW-Authenticate': 'Basic realm="Underwater preview", charset="UTF-8"' } })
  }
  // Resolve permanent source redirects before React starts streaming a document.
  // Keeping this outside a page component preserves the actual HTTP 301 status.
  const pathname = request.nextUrl.pathname
  if (['GET', 'HEAD'].includes(request.method) && pathname.length <= 2048 && !/^\/(?:api|admin|_next|img|favicon|robots|sitemap)(?:\/|\.|$)/.test(pathname)) {
    // A malformed percent-encoding is the client's error, not an outage.
    let decoded: string
    try { decoded = decodeURIComponent(pathname).normalize('NFC') } catch {
      return new NextResponse('Nieprawidłowy adres.', { status: 400, headers: responseHeaders })
    }
    try {
      if (!/[\\\u0000-\u001F]/.test(decoded) && !decoded.split('/').includes('..')) {
        const { db } = await import('./lib/data')
        const payload = await db()
        const published = (where: Where) => ({ and: [{ published: { equals: true } }, where] })
        // Stored addresses are canonical without a trailing slash; older rows may still carry one.
        const result = await payload.find({ collection: 'redirects', where: published({ from: { in: [pathname, decoded, pathname + '/', decoded + '/'] } }), limit: 1, depth: 0, overrideAccess: false })
        const to = result.docs[0]?.to
        if (to && /^\/(?![/\\])/.test(to) && !/[\\\u0000-\u001F]/.test(to) && ![pathname, decoded].includes(to)) {
          // Live content always wins over a redirect stored for the same address.
          const { resolveSourceRoute } = await import('./lib/source-routes')
          const live = await resolveSourceRoute(pathname.slice(1), async (collection, where) => (await payload.find({ collection, where: published(where), limit: 1, depth: 0, overrideAccess: false })).docs[0] as never ?? null, { redirects: false, depth: false })
          if (!live) {
            const destination = new URL(to, ownOrigin)
            if (!destination.search) destination.search = request.nextUrl.search
            const response = NextResponse.redirect(destination, 301)
            for (const [key, value] of Object.entries(responseHeaders)) response.headers.set(key, value)
            return response
          }
        }
      }
    } catch {
      return new NextResponse('Podgląd jest chwilowo niedostępny.', { status: 503, headers: responseHeaders })
    }
  }
  const response = NextResponse.next(); for (const [key, value] of Object.entries(responseHeaders)) response.headers.set(key, value); return response
}
export const config = { matcher: '/:path*' }
