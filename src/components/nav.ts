// Plain module (not 'use client') so server components can read the values.
export type NavItem = {
  label: string
  href: string
  /** Extra path prefixes that mark this item as current. */
  match?: string[]
}

// Sections that exist in this build. The client's full menu comes from the source inventory later.
export const SITE_NAV: NavItem[] = [
  { label: 'Kursy', href: '/kursy-nurkowania.html' },
  { label: 'Kalendarz', href: '/kalendarz.html' },
  { label: 'Wyprawy', href: '/wyprawy.html' },
  { label: 'Sklep', href: '/sklep-nurkowy.html' },
  { label: 'Aktualności', href: '/aktualnosci.html', match: ['/relacje'] },
  { label: 'Galerie', href: '/galerie.html' },
  { label: 'Kontakt', href: '/kontakt.html' },
]
