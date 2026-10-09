export type MoneyInput = { cents: number | null; error?: string }

/** Parse the user's decimal text without binary float rounding or silent truncation. */
export function parseMoneyInput(raw: string): MoneyInput {
  const value = raw.trim()
  if (!value) return { cents: null }
  const parts = /^(\d+)(?:[,.](\d{0,2}))?$/.exec(value)
  if (!parts) return { cents: null, error: 'Wpisz kwotę w złotych, np. 129,90, z najwyżej dwoma miejscami po przecinku.' }
  const amount = Number(parts[1]) * 100 + Number((parts[2] || '').padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || amount > 100_000_000) return { cents: null, error: 'Kwota nie może przekraczać 1000000 zł.' }
  return { cents: amount }
}

export function moneyInputValue(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return ''
  return `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`
}

export function moneyStorageValue(cents: number | null, storedInCents: boolean): number | null {
  return cents == null ? null : storedInCents ? cents : cents / 100
}

export function moneyDisplayValue(value: unknown, storedInCents: boolean): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
  return moneyInputValue(storedInCents ? value : Math.round(value * 100))
}

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const decodeText = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_match, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name] || '')

/** Body remains the existing HTML string; ordinary text is escaped and laid out as paragraphs. */
export function plainBodyHTML(value: string): string {
  const paragraphs = value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
  return paragraphs.map(part => `<p>${escapeText(part).replace(/\n/g, '<br>')}</p>`).join('')
}

/** Rich/imported HTML is never stripped or rewritten to offer the plain text editor. */
export function plainBodyValue(value: string | null | undefined): string | null {
  if (!value) return ''
  if (!/<[a-z!/?]/i.test(value)) return /&(?:#[xX][a-fA-F0-9]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.test(value) ? null : value
  if (!/^(?:<p>[^<]*(?:<br>[^<]*)*<\/p>)+$/.test(value)) return null
  // Only the entities produced by our plain-text encoder can round-trip here.
  // Imported named/numeric entities belong to the preserved HTML editor.
  const entities = value.match(/&(?:#[xX][a-fA-F0-9]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g) || []
  if (entities.some(entity => !['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'].includes(entity))) return null
  return [...value.matchAll(/<p>(.*?)<\/p>/gs)].map(match => decodeText(match[1].replace(/<br>/g, '\n'))).join('\n\n')
}

export type RecordActionState = { modified: boolean; processing: boolean; pending: boolean; ready: boolean }
export function canRunRecordAction(state: RecordActionState): boolean {
  return state.ready && !state.modified && !state.processing && !state.pending
}
