import type { Metadata } from 'next'
import { firstParam, isToken } from '@/lib/presentation'
import { TestPayment } from '@/components/TestPayment'
import { Notice } from '@/components/content'

// The token must not leak to other sites or end up in an index.
export const metadata: Metadata = { title: 'Płatność testowa', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = firstParam((await searchParams).token)
  return (
    <div className="section light"><div className="wrap narrow">
      <h1 className="h2">Płatność testowa</h1>
      <Notice tone="warning" title="To nie jest prawdziwa płatność">
        Wersja podglądowa sklepu. Żadne pieniądze nie zostaną pobrane, a towar nie zostanie wysłany. Przyciski poniżej tylko symulują odpowiedź operatora płatności.
      </Notice>
      <div className="pay-wrap">
        {isToken(token)
          ? <TestPayment token={token} />
          : <Notice tone="error" title="Nieprawidłowy link">Ten adres nie zawiera prawidłowego identyfikatora płatności. Otwórz link z potwierdzenia zamówienia.</Notice>}
      </div>
    </div></div>
  )
}
