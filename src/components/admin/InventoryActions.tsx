'use client'
import { useEffect, useId, useState } from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

type Inventory = { stock?: number | null; variants?: Array<{ id?: string; label: string; stock?: number | null }> | null }
export default function InventoryActions() {
  const { id } = useDocumentInfo(), { user } = useAuth()
  const [current, setCurrent] = useState<Inventory | null>(null), [variantId, setVariant] = useState('')
  const [stock, setStock] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const label = useId(), allowed = ['admin', 'operations'].includes(String(user?.role))
  useEffect(() => {
    if (!id || !allowed) return
    const controller = new AbortController()
    fetch(`/api/products/${encodeURIComponent(String(id))}?depth=0`, { credentials: 'same-origin', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('load')
      const data = await response.json() as Inventory
      setCurrent(data); setVariant(data.variants?.[0]?.id || '')
    }).catch(error => { if (error.name !== 'AbortError') setMessage('Nie udało się odczytać stanu. Odśwież produkt.') })
    return () => controller.abort()
  }, [id, allowed])
  if (!id || !allowed) return null
  const variants = current?.variants || [], selected = variants.find(item => item.id === variantId)
  const expectedStock = (variants.length ? selected?.stock : current?.stock) ?? null
  const submit = async () => {
    if (!/^\d{1,7}$/.test(stock) || Number(stock) > 1_000_000) { setMessage('Podaj całkowity stan od 0 do 1000000.'); return }
    setPending(true); setMessage('')
    try {
      const response = await fetch('/api/operations/records', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'inventory-adjustment', id: Number(id), stock: Number(stock), expectedStock, ...(variants.length ? { variantId } : {}) }) })
      const result = await response.json(); setMessage(typeof result.message === 'string' ? result.message : 'Korekta nie została zapisana.')
      if (response.ok && result.ok) window.location.reload()
    } catch { setMessage('Brak połączenia. Sprawdź stan przed ponowieniem korekty.') } finally { setPending(false) }
  }
  return <div className="underwater-inventory-actions" style={{ margin: '16px 0', padding: 16, border: '1px solid var(--theme-elevation-150)' }}>
    <strong>Korekta magazynu w podglądzie</strong>
    {variants.length ? <label style={{ display: 'block', margin: '8px 0' }}>Wariant <select style={{ display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }} value={variantId} onChange={event => { setVariant(event.target.value); setStock('') }}>{variants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
    <p>Stan bieżący: {expectedStock === null ? 'niepotwierdzony' : expectedStock}</p>
    <label htmlFor={label}>Nowy potwierdzony stan</label>{' '}<input id={label} inputMode="numeric" value={stock} onChange={event => setStock(event.target.value)} disabled={pending || !current} />{' '}
    <button type="button" onClick={submit} disabled={pending || !current || !stock}>Zapisz korektę z audytem</button><p role="status">{message}</p>
  </div>
}
