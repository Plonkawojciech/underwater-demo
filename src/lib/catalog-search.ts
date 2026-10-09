import type { CollectionBeforeValidateHook } from 'payload'

/** SQLite LIKE folds ASCII only; canonical Unicode casing is prepared in JS. */
export function catalogSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ').trim()
}

export const updateCatalogSearch: CollectionBeforeValidateHook = ({ data, originalDoc }) => {
  if (!data) return data
  const record = { ...originalDoc, ...data }
  // Ignore a supplied search index: every write derives it from catalog facts.
  data.searchText = catalogSearchText([record.name, record.manufacturer, record.sku].filter(value => typeof value === 'string').join(' '))
  return data
}
