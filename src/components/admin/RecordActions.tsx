'use client'
import { useState, useId } from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

const OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  orders: [{ value: 'shipped', label: 'Oznacz jako wysłane (testowo)' }, { value: 'cancelled', label: 'Anuluj i zwolnij rezerwację' }],
  signups: [{ value: 'contacted', label: 'Skontaktowano' }, { value: 'enrolled', label: 'Zapisany' }, { value: 'rejected', label: 'Odrzuć i zwolnij miejsce' }],
  contacts: [{ value: 'contacted', label: 'Skontaktowano' }, { value: 'closed', label: 'Zamknięta' }],
}
export default function RecordActions() {
  const { collectionSlug, id } = useDocumentInfo(), { user } = useAuth()
  const options = OPTIONS[collectionSlug || ''] || []
  const [status, setStatus] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const label = useId()
  if (!id || !options.length || !['admin', 'operations'].includes(String(user?.role))) return null
  const submit = async () => {
    setPending(true); setMessage('')
    try {
      const response = await fetch('/api/operations/records', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ collection: collectionSlug, id: Number(id), status }) })
      const result = await response.json()
      setMessage(typeof result.message === 'string' ? result.message : 'Nie udało się zapisać statusu.')
      if (result.ok) window.location.reload()
    } catch { setMessage('Brak połączenia. Spróbuj ponownie.') } finally { setPending(false) }
  }
  return <div style={{ margin: '16px 0', padding: 16, border: '1px solid var(--theme-elevation-150)' }}>
    <label htmlFor={label}>Czynność obsługi</label>
    <select id={label} value={status} onChange={e => setStatus(e.target.value)} disabled={pending} style={{ display: 'block', margin: '8px 0', padding: 8 }}><option value="">Wybierz czynność</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <button type="button" onClick={submit} disabled={!status || pending}>{pending ? 'Zapisywanie…' : 'Zapisz status'}</button>
    <p role="status">{message}</p>
  </div>
}
