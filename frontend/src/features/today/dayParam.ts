import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useData } from '../../data/dataContext'
import { updateCycleRepo, type UpdateCycleStatus } from '../../data/updateCycleRepo'
import { addDays, isCalendarDate } from '../../domain/calendarDate'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'

/** The query parameter that picks another day (`?dia=yyyy-MM-dd`) on Hoje, the check-ins and /treino. */
export const DAY_PARAM = 'dia'

/** How far back a day can be fixed when no update cycle is in progress. */
export const MAX_BACK_DAYS = 35

export interface DayLimits {
  /** The oldest day that can be fixed (yyyy-MM-dd). */
  min: string
  /** Today: no future day. */
  max: string
}

/**
 * Pure: the days that can be fixed. Back to the start of the update cycle in progress (not sent, already started), else
 * MAX_BACK_DAYS days; never after today.
 */
export function dayLimits(today: string, cycle: { periodStart: string; status: UpdateCycleStatus } | null): DayLimits {
  const inProgress = cycle !== null && cycle.status !== 'sent' && cycle.periodStart <= today
  return { min: inProgress ? cycle.periodStart : addDays(today, -MAX_BACK_DAYS), max: today }
}

/** Pure: the day a `?dia=` asks for. Missing or invalid is today; outside the limits is the nearest limit. */
export function resolveDay(param: string | null, limits: DayLimits): string {
  if (!param || !isCalendarDate(param)) return limits.max
  if (param > limits.max) return limits.max
  if (param < limits.min) return limits.min
  return param
}

/** Pure: the day `by` days from `date`, or null outside the limits. */
export function shiftDay(date: string, by: number, limits: DayLimits): string | null {
  const next = addDays(date, by)
  return next < limits.min || next > limits.max ? null : next
}

/** `path` for `date`: with `?dia=` only when it is not today. */
export function withDay(path: string, date: string, today: string): string {
  return date === today ? path : `${path}?${DAY_PARAM}=${date}`
}

/** "Dia 09/10": the title of a past day. */
export function dayTitle(date: string): string {
  const [, m, d] = date.split('-')
  return `Dia ${d}/${m}`
}

export interface ChosenDay {
  /** The day on screen. */
  date: string
  today: string
  isPast: boolean
  /** Null until the update cycle is read. */
  limits: DayLimits | null
  /** Opens another day (today drops the parameter); replaces the history entry. */
  open(date: string): void
}

/**
 * The day a screen shows: today, or the `?dia=` within the limits (read from the device's update cycle). Without
 * `?dia=` it is today right away; with one, `null` until the limits are known (so nothing is saved on a day out of range).
 */
export function useChosenDay(): ChosenDay | null {
  const data = useData()
  const { dataVersion } = useSync()
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const [limits, setLimits] = useState<DayLimits | null>(null)
  const param = params.get(DAY_PARAM)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    updateCycleRepo.current(data.db).then(
      (cycle) => {
        if (!cancelled) setLimits(dayLimits(today, cycle))
      },
      (e: unknown) => {
        console.error('could not read the update cycle', e)
        if (!cancelled) setLimits(dayLimits(today, null))
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion])

  const open = useCallback(
    (date: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (date === today) next.delete(DAY_PARAM)
          else next.set(DAY_PARAM, date)
          return next
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setParams, today],
  )

  const current = limits && limits.max === today ? limits : null
  if (!param) return { date: today, today, isPast: false, limits: current, open }
  if (!current) return null
  const date = resolveDay(param, current)
  return { date, today, isPast: date < today, limits: current, open }
}
