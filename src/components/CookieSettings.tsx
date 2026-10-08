'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { CONSENT_KEY, parseConsent, serializeConsent, type Consent } from '@/lib/presentation'

/**
 * Privacy preferences. The site uses only what it needs to work (cart and panel session
 * in this browser). Optional measurement stays off by default and cannot be enabled in a
 * preview, where no analytics script is loaded at all.
 */
export function CookieSettings({ preview }: { preview: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const uid = useId()
  const [consent, setConsent] = useState<Consent>({ analytics: false })
  const [draft, setDraft] = useState(false)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    try { setConsent(parseConsent(localStorage.getItem(CONSENT_KEY))) } catch { /* storage blocked: defaults apply */ }
  }, [])

  const open = () => {
    setDraft(preview ? false : consent.analytics)
    setSaved('')
    dialog.current?.showModal()
  }
  const save = () => {
    const next = { analytics: preview ? false : draft }
    setConsent(next)
    try {
      localStorage.setItem(CONSENT_KEY, serializeConsent(next))
      setSaved('Zapisano ustawienia.')
    } catch {
      setSaved('Przeglądarka nie pozwala zapisać ustawień. Obowiązują ustawienia domyślne: tylko niezbędne.')
    }
  }

  return (
    <>
      <button ref={opener} type="button" className="linkbtn" onClick={open}>Ustawienia prywatności</button>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby={`${uid}-t`}
        onClose={() => opener.current?.focus()}
        onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}
      >
        <div className="modal-in">
          <h2 id={`${uid}-t`} className="h3">Ustawienia prywatności</h2>
          <fieldset className="consent">
            <legend className="sr-only">Kategorie</legend>
            <label className="check">
              <input type="checkbox" checked disabled />
              <span><b>Niezbędne</b> Koszyk zapisany w tej przeglądarce i sesja panelu. Bez nich sklep nie działa, dlatego są zawsze włączone.</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={preview ? false : draft} disabled={preview} onChange={(e) => setDraft(e.target.checked)} aria-describedby={`${uid}-a`} />
              <span>
                <b>Statystyka odwiedzin</b>{' '}
                <span id={`${uid}-a`}>
                  {preview
                    ? 'W wersji podglądowej pomiar jest wyłączony i żaden skrypt analityczny nie jest wczytywany.'
                    : 'Anonimowe statystyki odwiedzin. Domyślnie wyłączone.'}
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
