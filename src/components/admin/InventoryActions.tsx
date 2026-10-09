'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { useAuth, useDocumentInfo, useFormModified, useFormProcessing } from '@payloadcms/ui'
import { canRunRecordAction } from './fieldHelpers'

type Inventory = { stock?: number | null; variants?: Array<{ id?: string; label: string; stock?: number | null }> | null }
type InventorySnapshot = { id: string; updatedAt: unknown; inventory: Inventory }
export default function InventoryActions() {
  const { id, data } = useDocumentInfo(), { user } = useAuth()
  const updatedAt = data?.updatedAt
  const [current, setCurrent] = useState<InventorySnapshot | null>(null), [variantId, setVariant] = useState('')
  const [stock, setStock] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const modified = useFormModified(), processing = useFormProcessing()
  const formState = useRef({ modified, processing }), inFlight = useRef(false)
  formState.current = { modified, processing }
  const label = useId(), allowed = ['admin', 'operations'].includes(String(user?.role))
  useEffect(() => {
    setCurrent(null); setVariant(''); setStock(''); setMessage('')
    if (!id || !allowed) return
    const controller = new AbortController()
    fetch(`/api/products/${encodeURIComponent(String(id))}?depth=0`, { credentials: 'same-origin', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('load')
      const inventory = await response.json() as Inventory
      if (controller.signal.aborted) return
      setCurrent({ id: String(id), updatedAt, inventory }); setVariant(inventory.variants?.[0]?.id || '')
    }).catch(() => { if (!controller.signal.aborted) setMessage('Nie udało się odczytać stanu. Odśwież produkt.') })
    return () => controller.abort()
  }, [id, allowed, updatedAt])
  if (!id || !allowed) return null
  // Reject the old snapshot immediately after a save, before the loading effect runs.
  const inventory = current?.id === String(id) && current.updatedAt === updatedAt ? current.inventory : null
  const variants = inventory?.variants || [], selected = variants.find(item => item.id === variantId)
  const expectedStock = (variants.length ? selected?.stock : inventory?.stock) ?? null
  const ready = Boolean(inventory && (!variants.length || selected))
  const canSubmit = canRunRecordAction({ modified, processing, pending, ready })
  const submit = async () => {
    if (!canRunRecordAction({ ...formState.current, pending: inFlight.current, ready })) { setMessage('Najpierw zapisz zmiany produktu. Korekta odświeża zapisany stan.'); return }
    if (!/^\d{1,7}$/.test(stock) || Number(stock) > 1_000_000) { setMessage('Podaj całkowity stan od 0 do 1000000.'); return }
    inFlight.current = true
    setPending(true); setMessage('')
    try {
      const response = await fetch('/api/operations/records', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'inventory-adjustment', id: Number(id), stock: Number(stock), expectedStock, ...(variants.length ? { variantId } : {}) }) })
      const result = await response.json(); setMessage(typeof result.message === 'string' ? result.message : 'Korekta nie została zapisana.')
      if (response.ok && result.ok) {
        if (!formState.current.modified && !formState.current.processing) window.location.reload()
        else setMessage('Korekta została zapisana. Formularz zawiera niezapisane zmiany; zachowaj je przed odświeżeniem produktu.')
      }
    } catch { setMessage('Brak połączenia. Sprawdź stan przed ponowieniem korekty.') } finally { inFlight.current = false; setPending(false) }
  }
  return <div className="underwater-inventory-actions" style={{ margin: '16px 0', padding: 16, border: '1px solid var(--theme-elevation-150)' }}>
    <strong>Korekta magazynu w podglądzie</strong>
    {modified || processing ? <p>Najpierw zapisz zmiany produktu. Korekta będzie dostępna po zapisie.</p> : <p>Korekta zapisuje stan osobno i odświeża produkt. Zmiany cen, opisów i wariantów zapisz wcześniej.</p>}
    {variants.length ? <label style={{ display: 'block', margin: '8px 0' }}>Wariant <select style={{ display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }} value={variantId} onChange={event => { setVariant(event.target.value); setStock('') }}>{variants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
    <p>Stan bieżący: {expectedStock === null ? 'niepotwierdzony' : expectedStock}</p>
    <label htmlFor={label}>Nowy potwierdzony stan</label>{' '}<input id={label} type="text" inputMode="numeric" value={stock} onChange={event => setStock(event.target.value)} disabled={!canSubmit} />{' '}
    <button type="button" onClick={submit} disabled={!canSubmit || !stock}>{pending ? 'Zapisywanie…' : 'Zapisz korektę z audytem'}</button><p role="status">{message}</p>
  </div>
}
