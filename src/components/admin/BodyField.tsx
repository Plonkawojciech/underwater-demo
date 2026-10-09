'use client'

import { useCallback, useRef, useState } from 'react'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { TextareaFieldClientComponent, Validate } from 'payload'
import { plainBodyHTML, plainBodyValue } from './fieldHelpers'

type BodyDraft = { text: string; stored: string; html: boolean }

/** New descriptions accept plain text. Existing formatted source HTML keeps its exact bytes. */
const BodyField: TextareaFieldClientComponent = ({ field, path: suppliedPath, readOnly, validate }) => {
  const [draft, setDraft] = useState<BodyDraft | null>(null)
  const [editHTML, setEditHTML] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const validateBody = useCallback<Validate>((value, options) => typeof validate === 'function' ? validate(value as string, { ...options, name: field.name, type: 'textarea', maxLength: field.maxLength, minLength: field.minLength, required: field.required }) : true, [validate, field.name, field.maxLength, field.minLength, field.required])
  const { value, setValue, path, disabled, showError } = useField<string | null>({ potentiallyStalePath: suppliedPath, validate: validateBody })
  const stored = value || ''
  const plain = plainBodyValue(stored)
  const current = draft?.stored === stored ? draft : null
  const html = editHTML || (current ? current.html : plain === null)
  const text = current && current.html === html ? current.text : html ? stored : plain || ''
  const inputID = `field-${path.replace(/\./g, '__')}`
  const blocked = Boolean(readOnly || disabled)
  return <div className={`field-type textarea underwater-body-field${showError ? ' error' : ''}`}>
    <FieldLabel label={field.label} path={path} required={field.required} localized={field.localized} />
    <div className="field-type__wrap">
      <FieldError path={path} showError={showError} />
      <p id={`${inputID}-mode`} className="underwater-field-help">{html ? 'Formatowana treść: edytujesz zachowany HTML. Zmiany sprawdź na stronie przed publikacją.' : 'Wpisz zwykły tekst. Pusta linia rozpoczyna nowy akapit; pojedyncza linia łamie wiersz.'}</p>
      <textarea ref={textarea} id={inputID} name={path} rows={field.admin?.rows || 12} value={text} readOnly={blocked} aria-describedby={`${inputID}-mode ${inputID}-description`} aria-invalid={showError} onChange={event => {
        const next = event.target.value
        const body = html ? next : plainBodyHTML(next)
        setDraft({ text: next, stored: body, html })
        setValue(body)
      }} />
      {!html ? <div className="underwater-body-tools">
        <details><summary>Podgląd akapitów</summary><div className="underwater-body-preview">{text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map((part, index) => <p key={index}>{part.split('\n').map((line, row) => <span key={row}>{row > 0 ? <br /> : null}{line}</span>)}</p>)}</div></details>
        <button type="button" disabled={blocked} onClick={() => { setDraft(null); setEditHTML(true); requestAnimationFrame(() => textarea.current?.focus()) }}>Edytuj HTML</button>
      </div> : null}
      <div id={`${inputID}-description`}><FieldDescription path={path} description={field.admin?.description} /></div>
    </div>
  </div>
}

export default BodyField
