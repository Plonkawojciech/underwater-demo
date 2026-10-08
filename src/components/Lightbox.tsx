'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type Photo = { src: string; thumb: string; alt: string; caption?: string | null; width?: number | null; height?: number | null }

/**
 * Photo grid with a full-screen viewer. Native <dialog> gives the focus trap and Esc;
 * arrows move between photos; closing returns focus to the photo that opened it.
 */
export function AlbumGrid({ photos, label }: { photos: Photo[]; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const [index, setIndex] = useState<number | null>(null)
  const list = photos.filter((p) => p.src)

  const open = (i: number, el: HTMLButtonElement) => {
    opener.current = el
    setIndex(i)
  }
  const close = useCallback(() => dialog.current?.close(), [])
  const step = useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + list.length) % list.length)), [list.length])

  useEffect(() => {
    const d = dialog.current
    if (index === null || !d || d.open) return
    d.showModal()
    d.querySelector<HTMLButtonElement>('.lb-close')?.focus()
  }, [index])

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const onClose = () => {
      setIndex(null)
      opener.current?.focus()
    }
    d.addEventListener('close', onClose)
    return () => d.removeEventListener('close', onClose)
  }, [])

  if (!list.length) return null
  const cur = index === null ? null : list[index]
  return (
    <>
      <ul className="album" aria-label={label}>
        {list.map((p, i) => (
          <li key={`${p.src}-${i}`}>
            <button type="button" onClick={(e) => open(i, e.currentTarget)} aria-label={`Powiększ zdjęcie ${i + 1} z ${list.length}${p.alt ? `: ${p.alt}` : ''}`}>
              <img src={p.thumb || p.src} alt="" loading="lazy" decoding="async" width={p.width || undefined} height={p.height || undefined} />
            </button>
            {p.caption ? <p className="album-cap">{p.caption}</p> : null}
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label={cur ? `Zdjęcie ${(index as number) + 1} z ${list.length}` : label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
        }}
        onClick={(e) => { if (e.target === e.currentTarget) close() }}
      >
        {cur ? (
          <div className="lb-in">
            <figure>
              <img src={cur.src} alt={cur.alt || cur.caption || ''} />
              {cur.caption || list.length > 1 ? (
                <figcaption>
                  {cur.caption ? <span>{cur.caption}</span> : null}
                  <span className="mono lb-n" aria-live="polite">{(index as number) + 1} / {list.length}</span>
                </figcaption>
              ) : null}
            </figure>
            <div className="lb-bar">
              {list.length > 1 ? <button type="button" onClick={() => step(-1)}>Poprzednie</button> : null}
              {list.length > 1 ? <button type="button" onClick={() => step(1)}>Następne</button> : null}
              <button type="button" className="lb-close" onClick={close}>Zamknij</button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  )
}
