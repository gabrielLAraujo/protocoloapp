import { diffDays } from './calendarDate'

export interface CycleInfo {
  start: string
  /** The next update date; null when the protocol does not carry one. */
  end: string | null
  /** Days until `end` (0 when overdue); null without `end`. */
  daysLeft: number | null
  /** 0..1 share of the cycle elapsed; null without `end`. */
  elapsedRatio: number | null
  billingDate: string | null
  /** Days past `end` (0 when not overdue or without `end`). */
  overdueDays: number
}

export function cycleInfo(
  protocol: { activatedOn: string; updateDate: string | null; billingDate: string | null },
  today: string,
): CycleInfo {
  const { activatedOn: start, updateDate: end, billingDate } = protocol
  if (!end) return { start, end: null, daysLeft: null, elapsedRatio: null, billingDate, overdueDays: 0 }
  const total = diffDays(start, end)
  const elapsed = diffDays(start, today)
  const ratio = total <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / total))
  return { start, end, daysLeft: Math.max(0, diffDays(today, end)), elapsedRatio: ratio, billingDate, overdueDays: Math.max(0, diffDays(end, today)) }
}
