/** Calendar-date arithmetic on `yyyy-MM-dd` strings. Uses UTC noon internally, so the device time zone and DST never shift a day. */

const DAY_MS = 86_400_000
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function toUtcNoon(date: string): number {
  const match = PATTERN.exec(date)
  if (!match) throw new Error(`Invalid calendar date: ${date}`)
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ms = Date.UTC(y, m - 1, d, 12)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date: ${date}`)
  }
  return ms
}

const fromUtcNoon = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const isCalendarDate = (value: string): boolean => {
  try {
    toUtcNoon(value)
    return true
  } catch {
    return false
  }
}

export const addDays = (date: string, days: number): string => fromUtcNoon(toUtcNoon(date) + days * DAY_MS)

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const diffDays = (from: string, to: string): number => Math.round((toUtcNoon(to) - toUtcNoon(from)) / DAY_MS)

export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(toUtcNoon(date)).getUTCDay()]

/** Every date from `from` to `to`, inclusive (empty when `to` is before `from`). */
export function dateRange(from: string, to: string): string[] {
  const count = diffDays(from, to)
  return Array.from({ length: Math.max(0, count + 1) }, (_, i) => addDays(from, i))
}
