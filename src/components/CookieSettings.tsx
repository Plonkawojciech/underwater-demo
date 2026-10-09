'use client'
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { CONSENT_KEY, parseConsent, serializeConsent, type Consent } from '@/lib/presentation'
import { CONSENT_CHANGED_EVENT, consentDecision } from '@/lib/analytics'

/**
 * Privacy preferences. The site uses only what it needs to work (cart and panel session
 * in this browser). Optional measurement defaults to off. Preview consent drives a
 * memory-only test; no real analytics script or external request is ever enabled.
 */
export function CookieSettings({ preview, privacyHref }: { preview: boolean; privacyHref?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const activeOpener = useRef<HTMLButtonElement | null>(null)
  const uid = useId()
  const [consent, setConsent] = useState<Consent>({ analytics: false })
  const [draft, setDraft] = useState(false)
  const [saved, setSaved] = useState('')
  const [firstVisit, setFirstVisit] = useState(false)
  const [bannerStatus, setBannerStatus] = useState('')
  const [bannerContainer, setBannerContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setBannerContainer(document.getElementById('privacy-notice'))
    const refresh = () => {
      try {
        const raw = localStorage.getItem(CONSENT_KEY)
        setConsent(parseConsent(raw))
        setFirstVisit(!consentDecision(raw).decided)
      } catch { setFirstVisit(true) }
    }
    const stored = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) refresh() }
    refresh()
    window.addEventListener('storage', stored)
    return () => window.removeEventListener('storage', stored)
  }, [])

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    activeOpener.current = event.currentTarget
    setDraft(consent.analytics)
    setSaved('')
    dialog.current?.showModal()
  }
  const commit = (analytics: boolean) => {
    const next = { analytics }
    setConsent(next)
    setFirstVisit(false)
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: next }))
    try {
      localStorage.setItem(CONSENT_KEY, serializeConsent(next))
      return 'Zapisano ustawienia.'
    } catch {
      return 'Ustawienia obowiązują w tej karcie. Przeglądarka nie pozwala ich zapisać na kolejną wizytę.'
    }
  }
  const save = () => setSaved(commit(draft))
  const choose = (analytics: boolean) => {
    setBannerStatus(commit(analytics))
    // The selected banner button disappears; keep keyboard focus at the content.
    document.getElementById('tresc')?.focus({ preventScroll: true })
  }

  return (
    <>
      <button ref={opener} type="button" className="linkbtn" onClick={open}>Ustawienia prywatności</button>
      {firstVisit && bannerContainer ? createPortal((
        <section className="privacy-banner" role="region" aria-label="Prywatność i ustawienia pomiaru">
          <div className="privacy-banner-in">
            <div className="privacy-banner-text">
              <h2 className="h3">Twoja prywatność</h2>
              <p>Koszyk i wybór ustawień zapisujemy w pamięci tej przeglądarki; panel używa niezbędnej sesji.{preview ? ' Pomiar w podglądzie jest wyłącznie testem w tej karcie i nie wysyła danych do usług zewnętrznych.' : ' Opcjonalny pomiar wymaga Twojej zgody.'}</p>
              {privacyHref ? <p><Link href={privacyHref} className="textlink">Polityka prywatności</Link></p> : null}
            </div>
            <div className="privacy-banner-actions">
              <button type="button" className="btn btn-line" onClick={() => choose(false)}>Tylko niezbędne</button>
              <button type="button" className="btn btn-line" onClick={() => choose(true)}>{preview ? 'Zgoda na pomiar (test)' : 'Zgoda na pomiar'}</button>
              <button type="button" className="btn btn-line" onClick={open}>Ustawienia</button>
            </div>
          </div>
        </section>
      ), bannerContainer) : null}
      <span className="sr-only privacy-banner-status" role="status">{bannerStatus}</span>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby={`${uid}-t`}
        onClose={() => {
          if (activeOpener.current?.isConnected) activeOpener.current.focus({ preventScroll: true })
          else (document.getElementById('tresc') || opener.current)?.focus()
        }}
        onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}
      >
        <div className="modal-in">
          <h2 id={`${uid}-t`} className="h3">Ustawienia prywatności</h2>
          <fieldset className="consent">
            <legend className="sr-only">Kategorie</legend>
            <label className="check">
              <input type="checkbox" checked disabled />
              <span><b>Niezbędne</b> Koszyk i wybór ustawień w pamięci tej przeglądarki oraz sesja panelu. Koszyk może działać tylko w tej karcie, jeśli przeglądarka blokuje zapis.</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} aria-describedby={`${uid}-a`} />
              <span>
                <b>{preview ? 'Test zgody na pomiar' : 'Statystyka odwiedzin'}</b>{' '}
                <span id={`${uid}-a`}>
                  {preview
                    ? 'Po zgodzie liczymy odwiedziny wyłącznie w pamięci tej karty. Dane znikają po wycofaniu zgody lub przeładowaniu. Żaden skrypt analityczny nie jest wczytywany.'
                    : 'Opcjonalne statystyki odwiedzin. Domyślnie wyłączone.'}
                </span>
              </span>
            </label>
          </fieldset>
          <p className="form-ok" role="status">{saved}</p>
          <div className="modal-bar">
            <button type="button" className="btn btn-solid" onClick={save}>Zapisz ustawienia</button>
            <button type="button" className="btn btn-line" onClick={() => dialog.current?.close()}>Zamknij</button>
          </div>
        </div>
      </dialog>
    </>
  )
}
