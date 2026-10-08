import type { Metadata } from 'next'
import { CartPage } from '@/components/CartPage'
import { getLegalLinks } from '@/views/query'

export const metadata: Metadata = { title: 'Koszyk', robots: { index: false, follow: false } }

export default async function Page() {
  const legal = await getLegalLinks()
  return (
    <CartPage
      termsHref={legal.find((l) => l.role === 'terms')?.href}
      privacyHref={legal.find((l) => l.role === 'privacy')?.href}
    />
  )
}
