'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { NumberFieldClientComponent, Validate } from 'payload'
import { moneyDisplayValue, moneyStorageValue, parseMoneyInput } from './fieldHelpers'

type Draft = { text: string; stored: number | null }

/** Display złoty while retaining each existing field's unit (price vs priceCents). */
const MoneyField: NumberFieldClientComponent = ({ field, path: suppliedPath, readOnly, validate }) => {
  const storedInCents = field.name.endsWith('Cents')
  const [draft, setDraft] = useState<Draft | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const validateMoney = useCallback<Validate>((value, options) => {
    const editing = draftRef.current
    if (editing && (editing.stored ?? null) === (value ?? null)) {
      const result = parseMoneyInput(editing.text)
      if (result.error) return result.error
    }
    if (value != null) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Podaj prawidłową kwotę w złotych.'
      const cents = storedInCents ? value : Math.round(value * 100)
      if (!Number.isSafeInteger(cents) || cents > 100_000_000 || !storedInCents && Math.abs(value * 100 - cents) > 0.000001) return 'Podaj kwotę z najwyżej dwoma miejscami po przecinku.'
    }
    return typeof validate === 'function' ? validate(value as number, { ...options, name: field.name, type: 'number', min: field.min, max: field.max, required: field.required }) : true
  }, [field.name, field.min, field.max, field.required, storedInCents, validate])
  const { value, setValue, path, disabled, showError } = useField<number | null>({ potentiallyStalePath: suppliedPath, validate: validateMoney })
  const text = draft && (draft.stored ?? null) === (value ?? null) ? draft.text : moneyDisplayValue(value, storedInCents)
  const error = parseMoneyInput(text).error
  // Keep native validity in sync as well: Payload's edit form can skip client validators.
  useEffect(() => { input.current?.setCustomValidity(error || '') }, [error, path])
  const inputID = `field-${path.replace(/\./g, '__')}`
  return <div className={`field-type text underwater-money-field${error || showError ? ' error' : ''}`}>
    <FieldLabel label={field.label} path={path} required={field.required} localized={field.localized} />
    <div className="field-type__wrap">
      <FieldError path={path} showError={showError} />
      <input ref={input} id={inputID} name={path} type="text" inputMode="decimal" autoComplete="off" required={field.required} value={text} readOnly={readOnly || disabled} aria-invalid={Boolean(error || showError)} aria-describedby={`${inputID}-description${error ? ` ${inputID}-input-error` : ''}`} onChange={event => {
        const next = event.target.value
        const result = parseMoneyInput(next)
        event.currentTarget.setCustomValidity(result.error || '')
        const editing = { text: next, stored: moneyStorageValue(result.cents, storedInCents) }
        draftRef.current = editing
        setDraft(editing)
        setValue(editing.stored)
      }} onBlur={() => {
        const result = parseMoneyInput(text)
        if (!result.error) {
          const next = moneyStorageValue(result.cents, storedInCents)
          const editing = { text: moneyDisplayValue(next, storedInCents), stored: next }
          draftRef.current = editing
          setDraft(editing)
        }
      }} />
      {error ? <p id={`${inputID}-input-error`} className="underwater-field-error" role="status">{error}</p> : null}
      <div id={`${inputID}-description`}><FieldDescription path={path} description={field.admin?.description} /></div>
    </div>
  </div>
}

export default MoneyField
