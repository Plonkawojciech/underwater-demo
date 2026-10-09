import { parseConsent, type Consent } from './presentation'

export const CONSENT_CHANGED_EVENT = 'underwater:consent-changed'
export type ConsentDecision = Consent & { decided: boolean }

/** Invalid or old-shaped values do not dismiss the first-visit notice. */
export function consentDecision(raw: string | null | undefined): ConsentDecision {
  try {
    const value = raw ? JSON.parse(raw) : null
    const decided = !!(value && typeof value === 'object' && !Array.isArray(value) && value.v === 1 && typeof value.analytics === 'boolean')
    return { decided, analytics: decided && parseConsent(raw).analytics }
  } catch { return { decided: false, analytics: false } }
}

export type TestMeasurementEvent = { name: 'page_view'; path: string }
export type TestMeasurementSnapshot = { mode: 'local-test'; consent: boolean; events: TestMeasurementEvent[] }

/** Public path only. Query strings, hashes and confirmation/payment URLs never enter measurement. */
export function measurementPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return null
  const path = value.split(/[?#]/, 1)[0]
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { return null }
  if (/[?#\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some((part) => part === '..' || part === '.')) return null
  if (/^\/(?:api|admin|_next|media|newsletter|zgloszenie|platnosc-testowa|login|logout|token)(?:\/|\.|$)/i.test(decoded)) return null
  return path
}

/** Deliberately has no transport. Bounded, consent-gated memory is discarded on revoke/reload. */
export function createTestMeasurement() {
  let consent = false
  let events: TestMeasurementEvent[] = []
  return {
    setConsent(value: boolean) {
      consent = value === true
      if (!consent) events = []
    },
    pageView(value: unknown): boolean {
      const path = measurementPath(value)
      if (!consent || !path) return false
      // Effect re-runs and same-page preferences changes must not duplicate a visit.
      if (events.at(-1)?.path === path) return false
      events.push({ name: 'page_view', path })
      events = events.slice(-50)
      return true
    },
    snapshot(): TestMeasurementSnapshot {
      return { mode: 'local-test', consent, events: events.map((event) => ({ ...event })) }
    },
  }
}
