import type { AdherenceStatus } from '../../data/adherenceRepo'
import { CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY } from '../../domain/dayPlan'
import type { ChipTone } from '../../ui/styles'
import { DAY_PARAM } from './dayParam'
import type { TodayRow } from './todayData'

export const STATUS_TEXT: Record<AdherenceStatus, string> = { done: 'Feito', partial: 'Parcial', missed: 'Não fiz' }

export const STATUS_TONE: Record<AdherenceStatus, ChipTone> = { done: 'ok', partial: 'warn', missed: 'danger' }

/**
 * Where a target is done when it is not marked here: the workout on /treino, each check-in part on its own screen. On a
 * past day (`day`) the link carries `?dia=`, so that screen opens that date.
 */
export function linkOf(target: TodayRow['target'], day?: string): string | null {
  const path =
    target.type === 'workout'
      ? '/treino'
      : target.type !== 'checkin'
        ? null
        : target.key === CHECKIN_MORNING_KEY
          ? '/checkin/manha'
          : target.key === CHECKIN_EVENING_KEY
            ? '/checkin/noite'
            : '/checkin'
  return path && day ? `${path}?${DAY_PARAM}=${day}` : path
}
