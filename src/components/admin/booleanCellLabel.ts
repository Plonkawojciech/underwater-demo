/** Keep imported, unset values distinct from an explicitly disabled checkbox. */
export function booleanCellLabel(value: unknown): 'Tak' | 'Nie' | '—' {
  if (value === true) return 'Tak'
  if (value === false) return 'Nie'
  return '—'
}
