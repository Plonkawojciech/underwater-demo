'use client'

import { useRef, useState } from 'react'
import { FormSubmit, useDocumentInfo, useEditDepth, useForm, useFormModified, useHotkey, useOperation, useTranslation } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'

/** Use Payload's save extension while checking raw money inputs before any write. */
export default function ValidatedSaveButton({ label: labelProp }: SaveButtonClientProps) {
  const { formRef, submit, validateForm, setSubmitted } = useForm()
  const { uploadStatus } = useDocumentInfo()
  const { t } = useTranslation()
  const modified = useFormModified(), operation = useOperation(), editDepth = useEditDepth()
  const button = useRef<HTMLButtonElement>(null), inFlight = useRef(false)
  const [validating, setValidating] = useState(false)
  const disabled = operation === 'update' && !modified || uploadStatus === 'uploading' || validating
  useHotkey({ cmdCtrlKey: true, editDepth, keyCodes: ['s'] }, event => {
    event.preventDefault(); event.stopPropagation()
    if (!disabled) button.current?.click()
  })
  const handleSubmit = async () => {
    if (disabled || inFlight.current) return
    inFlight.current = true; setValidating(true)
    try {
      const validInputs = () => {
        const form = formRef.current
        if (!form || form.checkValidity()) return true
        setSubmitted(true); form.reportValidity()
        return false
      }
      if (!validInputs()) return
      if (!await validateForm()) { setSubmitted(true); return }
      // A field can change while an asynchronous validator is running.
      if (!validInputs()) return
      await submit()
    } finally { inFlight.current = false; setValidating(false) }
  }
  return <FormSubmit buttonId="action-save" disabled={disabled} ref={button} size="medium" type="submit" onClick={event => {
    event.preventDefault()
    void handleSubmit()
  }}>{labelProp || t('general:save')}</FormSubmit>
}
