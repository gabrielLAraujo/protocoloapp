import type { AdherenceStatus } from '../../data/adherenceRepo'
import { CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY } from '../../domain/dayPlan'
import type { ChipTone } from '../../ui/styles'
import { DAY_PARAM } from './dayParam'
import type { TodayRow } from './todayData'

export const STATUS_TEXT: Record<AdherenceStatus, string> = { done: 'Feito', partial: 'Parcial', missed: 'Não fiz' }

export const STATUS_TONE: Record<AdherenceStatus, ChipTone> = { done: 'ok', partial: 'warn', missed: 'danger' }

/**
 * Where a target is seen or done when it is not marked here. The workout is logged in Hevy and its status comes from the
 * synced sessions: the row opens the Treino tab (only to look things up), on any day. Each check-in part opens its own
 * screen; on a past day (`day`) that link carries `?dia=`, so the screen opens that date.
 */
export function linkOf(target: TodayRow['target'], day?: string): string | null {
  if (target.type === 'workout') return '/treino'
  if (target.type !== 'checkin') return null
  const path = target.key === CHECKIN_MORNING_KEY ? '/checkin/manha' : target.key === CHECKIN_EVENING_KEY ? '/checkin/noite' : '/checkin'
  return day ? `${path}?${DAY_PARAM}=${day}` : path
}
