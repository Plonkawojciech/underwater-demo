// Dates are always shown in Warsaw time, also when the server runs in UTC.
const TZ = 'Europe/Warsaw'
const FORMATS: Record<'long' | 'short' | 'datetime', Intl.DateTimeFormatOptions> = {
  long: { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ },
  short: { day: 'numeric', month: 'short', timeZone: TZ },
  datetime: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ },
}

const parse = (v?: string | Date | null) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Renders a real date from the data, or nothing. Never substitutes "today" or a placeholder. */
export function DateText({ value, format = 'long', className }: { value?: string | Date | null; format?: keyof typeof FORMATS; className?: string }) {
  const d = parse(value)
  if (!d) return null
  return <time className={className} dateTime={d.toISOString()}>{new Intl.DateTimeFormat('pl-PL', FORMATS[format]).format(d)}</time>
}

/** "12–19 października 2026" for trips and multi-day courses. Falls back to the start date alone. */
export function DateRange({ from, to, className }: { from?: string | Date | null; to?: string | Date | null; className?: string }) {
  const a = parse(from)
  const b = parse(to)
  if (!a) return null
  if (!b || b.getTime() <= a.getTime()) return <DateText value={a} className={className} />
  const fmt = new Intl.DateTimeFormat('pl-PL', FORMATS.long)
  const text = typeof fmt.formatRange === 'function' ? fmt.formatRange(a, b) : `${fmt.format(a)} – ${fmt.format(b)}`
  return (
    <span className={className}>
      <time dateTime={a.toISOString()} className="sr-only">{fmt.format(a)}</time>
      <span aria-hidden="true">{text}</span>
      <time dateTime={b.toISOString()} className="sr-only"> do {fmt.format(b)}</time>
    </span>
  )
}
