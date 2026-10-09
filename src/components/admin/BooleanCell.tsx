'use client'

import type { CheckboxFieldClient, DefaultCellComponentProps } from 'payload'
import { booleanCellLabel } from './booleanCellLabel'

export default function BooleanCell({ cellData }: DefaultCellComponentProps<CheckboxFieldClient, unknown>) {
  const label = booleanCellLabel(cellData)
  return <span aria-label={label === '—' ? 'Nie ustawiono' : undefined}>{label}</span>
}
