import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { firstParam, isToken } from '@/lib/presentation'
import { NewsletterToken } from '@/components/NewsletterToken'
import { Notice } from '@/components/content'

const ACTIONS = {
  potwierdz: { action: 'confirm', title: 'Potwierdzenie zapisu na newsletter', lead: 'Kliknij przycisk, aby potwierdzić, że chcesz otrzymywać newsletter Underwater.pl.' },
  wypisz: { action: 'unsubscribe', title: 'Wypisanie z newslettera', lead: 'Kliknij przycisk, aby przestać otrzymywać newsletter Underwater.pl.' },
} as const

type Props = { params: Promise<{ akcja: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export const metadata: Metadata = { title: 'Newsletter', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function Page({ params, searchParams }: Props) {
  const a = ACTIONS[(await params).akcja as keyof typeof ACTIONS]
  if (!a) notFound()
  const token = firstParam((await searchParams).token)
  return (
    <div className="section light"><div className="wrap narrow">
      <h1 className="h2">{a.title}</h1>
      {isToken(token) ? (
        <>
          <p className="lead">{a.lead}</p>
          <div className="pay-wrap"><NewsletterToken token={token} action={a.action} /></div>
        </>
      ) : <Notice tone="error" title="Nieprawidłowy link">Otwórz pełny link z wiadomości e-mail.</Notice>}
    </div></div>
  )
}
