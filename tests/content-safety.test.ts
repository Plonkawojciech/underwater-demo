import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { getPayload, type Payload, type Where } from 'payload'
import { NextRequest } from 'next/server'
import { ImportError, legacyPath, shadowedRoute, validateBundle } from '../src/lib/import/bundle'
import { FIXED, resolveSourceRoute, type RouteFinder } from '../src/lib/source-routes'
import { transaction } from '../src/lib/commerce/transaction'

// ---------------------------------------------------------------- pure

const header = { version: 1, source: { kind: 'public-pages', manifestHash: 'a'.repeat(64), capturedAt: '2026-10-08T00:00:00Z', complete: false }, media: [] as unknown[] }
const bundle = (entities: unknown[]) => ({ ...header, entities })
const page = (key: string, data: Record<string, unknown> = {}) => ({ collection: 'pages', key, data: { title: 'Strona', path: `/${key}.html`, kind: 'page', published: true, ...data } })

test('importer, resolver and parser share one list of fixed sections', () => {
  const parser = readFileSync(new URL('../scripts/source/content_parser.py', import.meta.url), 'utf8')
  const block = /FIXED_ROUTES = frozenset\(\{([^}]*)\}\)/.exec(parser)?.[1]
  assert.ok(block, 'parser FIXED_ROUTES not found')
  assert.deepEqual([...block.matchAll(/'([^']+)'/g)].map(m => m[1]).sort(), Object.keys(FIXED).sort())
  for (const route of Object.keys(FIXED)) {
    assert.equal(shadowedRoute(route, 'trips', null), true, route)
    assert.equal(shadowedRoute(route, 'pages', `/${route}.html`), false, route)
  }
  assert.equal(shadowedRoute('kontakt', 'pages', '/o-nas.html'), true)
  assert.equal(shadowedRoute('koszyk/x', 'pages', '/koszyk/x.html'), true)
  assert.equal(shadowedRoute('constructor', 'trips', null), false)
})

test('section introductions are not reported as shadowed; other records at section addresses are', () => {
  const shadowed = (entities: unknown[]) => validateBundle(bundle(entities)).shadowed.map(item => `${item.id}@${item.route}`).sort()
  assert.deepEqual(shadowed([page('kontakt', { legacyPath: '/kontakt.html' }), page('aktualnosci', { path: '/aktualnosci', legacyPath: '/aktualnosci' })]), [])
  assert.deepEqual(shadowed([
    page('wyprawy-nurkowe'),
    { collection: 'albums', key: 'g', data: { title: 'G', path: '/galeria.html', legacyPath: '/galeria.html', published: true } },
    { collection: 'courses', key: 'c', data: { name: 'K', slug: 'kursy-nurkowania-padi-warszawa', published: true } },
  ]), ['albums:g@galeria', 'courses:c@kursy-nurkowania/kursy-nurkowania-padi-warszawa', 'pages:wyprawy-nurkowe@wyprawy-nurkowe'])
})

test('trailing slashes are canonicalised away; the root and malformed paths are unchanged', () => {
  assert.equal(legacyPath('/o-nas/'), '/o-nas')
  assert.equal(legacyPath('/sklep-nurkowy/maski/'), '/sklep-nurkowy/maski')
  assert.equal(legacyPath('/'), '/')
  assert.equal(legacyPath('/3625-maska-soprastek-corona.html'), '/3625-maska-soprastek-corona.html')
  for (const unsafe of ['/a//', '//', '/a/./']) assert.throws(() => legacyPath(unsafe), ImportError, unsafe)
  const ok = validateBundle(bundle([page('o-nas', { path: '/o-nas/', legacyPath: '/o-nas/' }), { collection: 'redirects', key: 'r', data: { from: '/stare/', to: '/o-nas/', published: true } }]))
  const byId = new Map(ok.entities.map(entity => [entity.id, entity.data]))
  assert.equal(byId.get('pages:o-nas')!.path, '/o-nas'); assert.equal(byId.get('pages:o-nas')!.legacyPath, '/o-nas')
  assert.equal(byId.get('redirects:r')!.from, '/stare'); assert.equal(byId.get('redirects:r')!.to, '/o-nas')
  assert.throws(() => validateBundle(bundle([page('a', { path: '/o-nas/' }), page('b', { path: '/o-nas.html' })])), /one public address/)
})

test('bundle redirects may not replace the home page, an application route or a fixed section', () => {
  for (const from of ['/', '/index.php', '/koszyk', '/koszyk/x.html', '/kontakt.html', '/galeria.html'])
    assert.throws(() => validateBundle(bundle([{ collection: 'redirects', key: 'r', data: { from, to: '/elsewhere.html', published: true } }])), /application route or fixed section/, from)
})

// ---------------------------------------------------------------- isolated database

const root = mkdtempSync(path.join(tmpdir(), 'underwater-content-safety-'))
mkdirSync(path.join(root, 'media'))
Object.assign(process.env, { UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: root, DATABASE_URI: `file:${root}/underwater-test.db`, MEDIA_DIR: `${root}/media`, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3011', PAYLOAD_SECRET: 'synthetic-content-safety-secret-not-used-in-runtime' })
let payload: Payload
let editor: Record<string, unknown>
let category: number

const published = (where: Where): Where => ({ and: [{ published: { equals: true } }, where] })
const publicFind: RouteFinder = async (collection, where) => (await payload.find({ collection, where: published(where), limit: 1, depth: 0, overrideAccess: false })).docs[0] as never ?? null
const resolve = (key: string, options?: { redirects?: boolean }) => resolveSourceRoute(key, publicFind, { depth: false, ...options })
const createPage = (data: Record<string, unknown>) => payload.create({ collection: 'pages', overrideAccess: true, data: { title: 'Strona', kind: 'page', published: true, ...data } as never })
const createRedirect = (from: string, to: string, extra: Record<string, unknown> = {}) => payload.create({ collection: 'redirects', overrideAccess: true, data: { from, to, published: true, ...extra } as never })
const proxyRequest = async (pathname: string) => {
  const { proxy } = await import('../src/proxy')
  return proxy(new NextRequest(`http://localhost:3011${pathname}`, { headers: { host: 'localhost:3011' } }))
}

test.before(async () => {
  const config = (await import('../src/payload.config')).default
  payload = await getPayload({ config, disableOnInit: true })
  await payload.db.migrate()
  editor = await payload.create({ collection: 'users', overrideAccess: true, context: { systemAction: 'bootstrap-admin' }, data: { email: 'editor@example.invalid', password: 'synthetic-editor-password-0001', role: 'editor' } as never }) as never
  category = (await payload.create({ collection: 'categories', overrideAccess: true, data: { name: 'TEST', slug: 'test-kategoria', published: true } })).id
})
test.after(async () => { if (payload) await payload.destroy(); rmSync(root, { recursive: true, force: true }) })

test('a source page at a fixed section address feeds that section under every spelling', async () => {
  await createPage({ title: 'Kontakt ze źródła', path: '/kontakt.html', legacyPath: '/kontakt.html' })
  for (const key of ['kontakt', 'kontakt.html']) {
    const r = await resolve(key)
    assert.equal(r?.kind, 'fixed'); assert.equal(r?.kind === 'fixed' && r.source?.title, 'Kontakt ze źródła')
  }
  const gallery = await resolve('galeria.html')
  assert.equal(gallery?.kind, 'fixed'); assert.equal(gallery?.kind === 'fixed' && gallery.route, 'albums')
  assert.equal(await resolve('constructor.html'), null)
})

test('a legacy path stored with a trailing slash is reachable at the slashless address', async () => {
  await createPage({ title: 'Stara strona', path: '/stara-strona-nowa.html', legacyPath: '/stara-strona/' })
  const r = await resolve('stara-strona')
  assert.equal(r?.kind, 'page'); assert.equal(r?.kind === 'page' && r.doc.title, 'Stara strona')
})

test('duplicating an imported, published record yields an unpublished copy without provenance', async () => {
  const original = await createPage({ title: 'Oryginał', path: '/oryginal.html', legacyPath: '/oryginal.html', legacyKey: 'page:oryginal.html', sourceHash: 'v2:x:y', importRun: 'import-v3-test', importedAt: '2026-10-08T00:00:00.000Z', sourceUpdatedAt: '2026-10-01T00:00:00.000Z' })
  const copy = await payload.duplicate({ collection: 'pages', id: original.id, overrideAccess: true }) as unknown as Record<string, unknown>
  assert.equal(copy.published, false)
  for (const name of ['legacyKey', 'sourceHash', 'importRun', 'importedAt', 'sourceUpdatedAt', 'legacyPath']) assert.equal(copy[name] ?? null, null, name)
  assert.notEqual(copy.path, '/oryginal.html')
  const r = await resolve('oryginal.html')
  assert.equal(r?.kind === 'page' && r.doc.id, original.id)
})

test('editors cannot set or change import provenance; the local importer still can', async () => {
  const created = await payload.create({ collection: 'pages', user: editor as never, overrideAccess: false, data: { title: 'Redakcja', path: '/redakcja.html', kind: 'page', published: false, legacyKey: 'page:stolen.html', sourceHash: 'forged', importRun: 'forged' } as never }) as unknown as Record<string, unknown>
  assert.equal(created.legacyKey ?? null, null); assert.equal(created.sourceHash ?? null, null); assert.equal(created.importRun ?? null, null)
  const imported = await createPage({ title: 'Import', path: '/import.html', legacyKey: 'page:import.html', sourceHash: 'v2:a:b', importRun: 'import-v3-a' })
  const edited = await payload.update({ collection: 'pages', id: imported.id, user: editor as never, overrideAccess: false, data: { title: 'Poprawione', legacyKey: 'page:other.html', sourceHash: 'forged', importRun: 'forged', importedAt: '2000-01-01T00:00:00.000Z' } as never }) as unknown as Record<string, unknown>
  assert.equal(edited.title, 'Poprawione'); assert.equal(edited.legacyKey, 'page:import.html'); assert.equal(edited.sourceHash, 'v2:a:b'); assert.equal(edited.importRun, 'import-v3-a')
  const media = await payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'Syntetyczny', legacyKey: 'img:a', sourceHash: 'a'.repeat(64), importRun: 'import-v3-a' }, file: { data: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer(), mimetype: 'image/png', name: 'a.png', size: 0 } })
  const mediaEdited = await payload.update({ collection: 'media', id: media.id, user: editor as never, overrideAccess: false, data: { alt: 'Zmieniony', legacyKey: 'img:b', sourceHash: 'b'.repeat(64) } as never }) as unknown as Record<string, unknown>
  assert.equal(mediaEdited.alt, 'Zmieniony'); assert.equal(mediaEdited.legacyKey, 'img:a'); assert.equal(mediaEdited.sourceHash, 'a'.repeat(64))
  const imported2 = await payload.update({ collection: 'pages', id: imported.id, overrideAccess: true, data: { importRun: 'import-v3-b' } as never }) as unknown as Record<string, unknown>
  assert.equal(imported2.importRun, 'import-v3-b')
})

test('redirects cannot hide live content, application routes or fixed sections', async () => {
  await payload.create({ collection: 'products', overrideAccess: true, data: { vmId: 9001, name: 'TEST', slug: '9001-test-produkt', category, price: 10, priceCents: 1000, stock: 1, published: true } as never })
  await createPage({ title: 'Żywa', path: '/zywa-strona.html' })
  for (const from of ['/9001-test-produkt.html', '/zywa-strona.html', '/zywa-strona', '/kontakt.html', '/koszyk', '/'])
    await assert.rejects(createRedirect(from, '/gdzie-indziej.html'), /opublikowana treść|obsługuje sama aplikacja/, from)
  // A draft may be prepared for content that is still live; publishing it is refused while the content is.
  const draft = await createRedirect('/zywa-strona.html', '/gdzie-indziej.html', { published: false })
  await assert.rejects(payload.update({ collection: 'redirects', id: draft.id, overrideAccess: true, data: { published: true } }), /opublikowana treść/)
  await assert.rejects(createRedirect('/x.html', '/x'), /do siebie/)
  const stored = await createRedirect('/stary%20adres/', '/nowy.html')
  assert.equal(stored.from, '/stary adres')
})

test('redirects reject cycles through stored redirects, also when an existing one is edited', async () => {
  await createRedirect('/c-a.html', '/c-b.html')
  const bc = await createRedirect('/c-b.html', '/c-c.html')
  await assert.rejects(createRedirect('/c-c.html', '/c-a.html'), /pętlę/)
  await assert.rejects(createRedirect('/c-c', '/c-a?x=1'), /pętlę/)
  await createRedirect('/c-c.html', '/c-d.html')
  await assert.rejects(payload.update({ collection: 'redirects', id: bc.id, overrideAccess: true, data: { to: '/c-a.html' } }), /pętlę/)
  assert.equal((await payload.update({ collection: 'redirects', id: bc.id, overrideAccess: true, data: { reason: 'bez zmian trasy' } })).to, '/c-c.html')
})

test('redirect validation reads through the caller transaction and leaves it rolled back', async () => {
  await assert.rejects(transaction(payload, 'content-safety-test', async req => {
    await payload.create({ collection: 'pages', req, overrideAccess: true, data: { title: 'W transakcji', path: '/w-transakcji.html', kind: 'page', published: true } })
    await payload.create({ collection: 'redirects', req, overrideAccess: true, data: { from: '/w-transakcji.html', to: '/inna.html', published: true } })
  }), /opublikowana treść/)
  assert.equal((await payload.count({ collection: 'pages', where: { path: { equals: '/w-transakcji.html' } }, overrideAccess: true })).totalDocs, 0)
})

test('proxy: HTTP 301 for a moved address, live content wins, malformed encoding is 400', async () => {
  await createRedirect('/przeniesiona.html', '/cel.html')
  const moved = await proxyRequest('/przeniesiona.html?utm=1')
  assert.equal(moved.status, 301); assert.equal(moved.headers.get('location'), 'http://localhost:3011/cel.html?utm=1')
  // Content published later at the same address is served instead of the stored redirect.
  await createPage({ title: 'Wróciła', path: '/wrocila.html', legacyPath: '/przeniesiona.html' })
  const live = await proxyRequest('/przeniesiona.html')
  assert.notEqual(live.status, 301); assert.equal(live.headers.get('x-middleware-next'), '1')
  assert.equal((await resolve('przeniesiona.html'))?.kind, 'page')
  const malformed = await proxyRequest('/%E0%A4%A')
  assert.equal(malformed.status, 400)
})

test('a stored SEO title is used as the exact document title', async () => {
  const { pageMeta } = await import('../src/views/meta')
  assert.deepEqual(pageMeta({ title: 'Maska X', path: '/x.html', seo: { title: 'Maska X - Underwater.pl' } }).title, { absolute: 'Maska X - Underwater.pl' })
  assert.equal(pageMeta({ title: 'Maska X', path: '/x.html' }).title, 'Maska X')
  assert.equal(pageMeta({ title: 'Maska X', path: '/x.html', seo: { title: '' } }).title, 'Maska X')
})
