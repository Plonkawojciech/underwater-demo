'use client'
import { useState, useId, useRef } from 'react'
import { useAuth, useDocumentInfo, useFormFields, useFormModified, useFormProcessing } from '@payloadcms/ui'
import { canRunRecordAction } from './fieldHelpers'

const OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  orders: [
    { value: 'bank-paid', label: 'Potwierdź wpływ przelewu (symulacja testowa)' },
    { value: 'shipped', label: 'Oznacz jako wysłane (testowo)' },
    { value: 'cod-collected', label: 'Potwierdź pobranie przy odbiorze (symulacja testowa)' },
    { value: 'cancelled', label: 'Anuluj i zwolnij rezerwację' },
  ],
  signups: [{ value: 'contacted', label: 'Skontaktowano' }, { value: 'enrolled', label: 'Zapisany' }, { value: 'rejected', label: 'Odrzuć i zwolnij miejsce' }],
  contacts: [{ value: 'contacted', label: 'Skontaktowano' }, { value: 'closed', label: 'Zamknięta' }],
}
export default function RecordActions() {
  const { collectionSlug, id } = useDocumentInfo(), { user } = useAuth()
  const paymentMethod = useFormFields(([fields]) => fields.paymentMethod?.value)
  const recordStatus = useFormFields(([fields]) => fields.status?.value)
  const paymentStatus = useFormFields(([fields]) => fields.paymentStatus?.value)
  // Present only possible order actions; the service enforces state and role again.
  const options = (OPTIONS[collectionSlug || ''] || []).filter(option => {
    if (collectionSlug !== 'orders') return true
    const method = paymentMethod || 'online'
    if (option.value === 'bank-paid') return method === 'bank_transfer' && recordStatus === 'new' && paymentStatus === 'pending'
    if (option.value === 'cod-collected') return method === 'cod' && recordStatus === 'shipped' && paymentStatus === 'pending'
    if (option.value === 'shipped') return ['new', 'paid'].includes(String(recordStatus)) && (paymentStatus === 'paid' || method === 'cod' && paymentStatus === 'pending')
    if (option.value === 'cancelled') return recordStatus === 'new' && paymentStatus === 'pending'
    return false
  })
  const [status, setStatus] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const modified = useFormModified(), processing = useFormProcessing()
  const formState = useRef({ modified, processing }), inFlight = useRef(false)
  formState.current = { modified, processing }
  const label = useId()
  if (!id || !options.length || !['admin', 'operations'].includes(String(user?.role))) return null
  const ready = options.some(option => option.value === status)
  const canSubmit = canRunRecordAction({ modified, processing, pending, ready })
  const submit = async () => {
    if (!canRunRecordAction({ ...formState.current, pending: inFlight.current, ready })) { setMessage('Najpierw zapisz zmiany rekordu, a potem wybierz czynność obsługi.'); return }
    inFlight.current = true
    setPending(true); setMessage('')
    try {
      const response = await fetch('/api/operations/records', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ collection: collectionSlug, id: Number(id), status }) })
      const result = await response.json()
      setMessage(typeof result.message === 'string' ? result.message : 'Nie udało się zapisać statusu.')
      if (response.ok && result.ok) {
        if (!formState.current.modified && !formState.current.processing) window.location.reload()
        else setMessage('Status został zapisany. Formularz zawiera niezapisane zmiany; zachowaj je przed odświeżeniem rekordu.')
      }
    } catch { setMessage('Brak połączenia. Spróbuj ponownie.') } finally { inFlight.current = false; setPending(false) }
  }
  return <div className="underwater-record-actions" style={{ margin: '16px 0', padding: 16, border: '1px solid var(--theme-elevation-150)' }}>
    <label htmlFor={label}>Czynność obsługi</label>
    {modified || processing ? <p>Najpierw zapisz zmiany rekordu. Czynność będzie dostępna po zapisie.</p> : null}
    <select id={label} value={status} onChange={e => setStatus(e.target.value)} disabled={pending} style={{ display: 'block', margin: '8px 0', padding: 8, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}><option value="">Wybierz czynność</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <button type="button" onClick={submit} disabled={!canSubmit}>{pending ? 'Zapisywanie…' : 'Zapisz status'}</button>
    <p role="status">{message}</p>
  </div>
}
