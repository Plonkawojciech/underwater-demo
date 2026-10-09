'use client'

import { useId } from 'react'
import { DateTimeField, FieldLabel, useFieldPath, withCondition } from '@payloadcms/ui'
import type { ConditionalDateProps, DateFieldClientComponent } from 'payload'

/** Keep Payload's native date picker, with a label attached to its actual input. */
const AccessibleDateField: DateFieldClientComponent = props => {
  const path = useFieldPath() || props.path
  const uniqueID = useId()
  const inputID = `underwater-date-${uniqueID}`
  const { field } = props
  const date = field.admin?.date as ConditionalDateProps | undefined
  return <div className="underwater-accessible-date-field">
    <FieldLabel htmlFor={inputID} path={path} label={field.label} required={field.required} localized={field.localized} />
    <DateTimeField {...props} path={path} field={{
      ...field,
      label: undefined,
      admin: {
        ...field.admin,
        placeholder: field.admin?.placeholder,
        date: {
          ...date,
          overrides: { ...date?.overrides, id: inputID, required: field.required },
        },
      },
    }} />
  </div>
}

export default withCondition(AccessibleDateField)
