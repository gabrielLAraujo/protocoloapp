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
  /** Days past `end` (0 when not overdue, without `end`, or once the update was sent). */
  overdueDays: number
  /** Local date the update of this protocol was sent; the cycle is then closed while the new protocol does not arrive. */
  sentOn: string | null
}

export function cycleInfo(
  protocol: { activatedOn: string; updateDate: string | null; billingDate: string | null; sentOn?: string | null },
  today: string,
): CycleInfo {
  const { activatedOn: start, updateDate: end, billingDate } = protocol
  const sentOn = protocol.sentOn ?? null
  if (!end) return { start, end: null, daysLeft: null, elapsedRatio: null, billingDate, overdueDays: 0, sentOn }
  if (sentOn) return { start, end, daysLeft: 0, elapsedRatio: 1, billingDate, overdueDays: 0, sentOn }
  const total = diffDays(start, end)
  const elapsed = diffDays(start, today)
  const ratio = total <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / total))
  return { start, end, daysLeft: Math.max(0, diffDays(today, end)), elapsedRatio: ratio, billingDate, overdueDays: Math.max(0, diffDays(end, today)), sentOn }
}
