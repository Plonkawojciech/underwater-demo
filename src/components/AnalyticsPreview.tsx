'use client'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { CONSENT_KEY } from '@/lib/presentation'
import { CONSENT_CHANGED_EVENT, consentDecision, createTestMeasurement, type TestMeasurementSnapshot } from '@/lib/analytics'

declare global {
  interface Window { __underwaterMeasurementTest?: { snapshot: () => TestMeasurementSnapshot } }
}

/** QA-only in-memory page measurement. No analytics script, identifier, storage or network transport. */
export function AnalyticsPreview() {
  const pathname = usePathname()
  const measurement = useRef<ReturnType<typeof createTestMeasurement> | null>(null)
  if (!measurement.current) measurement.current = createTestMeasurement()
  const currentPath = useRef(pathname)
  currentPath.current = pathname

  useEffect(() => {
    const collector = measurement.current!
    const diagnostic = { snapshot: () => collector.snapshot() }
    window.__underwaterMeasurementTest = diagnostic
    const refresh = () => {
      let raw: string | null = null
      try { raw = localStorage.getItem(CONSENT_KEY) } catch { /* no stored consent */ }
      collector.setConsent(consentDecision(raw).analytics)
      collector.pageView(currentPath.current)
    }
    const changed = (event: Event) => {
      // A blocked localStorage may still keep an explicit choice for this tab in memory.
      const detail = (event as CustomEvent<unknown>).detail
      const enabled = !!(detail && typeof detail === 'object' && 'analytics' in detail && detail.analytics === true)
      collector.setConsent(enabled)
      collector.pageView(currentPath.current)
    }
    const stored = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) refresh() }
    refresh()
    window.addEventListener(CONSENT_CHANGED_EVENT, changed)
    window.addEventListener('storage', stored)
    return () => {
      collector.setConsent(false)
      window.removeEventListener(CONSENT_CHANGED_EVENT, changed)
      window.removeEventListener('storage', stored)
      if (window.__underwaterMeasurementTest === diagnostic) delete window.__underwaterMeasurementTest
    }
  }, [])

  useEffect(() => { measurement.current!.pageView(pathname) }, [pathname])
  return null
}
