// Plain module (not 'use client') so server components can read the values.
export type NavItem = {
  label: string
  href: string
  /** Extra path prefixes that mark this item as current (aliases of the same section). */
  match?: string[]
}

// Sections that exist in this build. Links use the canonical section addresses (FIXED_META);
// the old aliases still mark the item as current. The client's full menu comes from the source inventory later.
export const SITE_NAV: NavItem[] = [
  { label: 'Kursy', href: '/kursy-nurkowania.html' },
  { label: 'Kalendarz', href: '/kalendarz.html' },
  { label: 'Wyprawy', href: '/wyprawy-nurkowe.html', match: ['/wyprawy'] },
  { label: 'Sklep', href: '/sklep-nurkowy.html' },
  { label: 'Aktualności', href: '/aktualnosci.html', match: ['/relacje', '/relacje-z-wypraw'] },
  { label: 'Galerie', href: '/galeria.html', match: ['/galerie'] },
  { label: 'Kontakt', href: '/kontakt.html' },
]

/** The section address itself, an alias, or a page below either (`/wyprawy/egipt.html`). */
export function isNavCurrent(path: string, item: NavItem): boolean {
  if (path === item.href) return true
  const prefixes = [item.href.replace(/\.html$/, ''), ...(item.match || [])].filter((p) => p && p !== '/')
  return prefixes.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path === `${p}.html`)
}
