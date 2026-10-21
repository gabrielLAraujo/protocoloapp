import type { AdherenceStatus } from '../../data/adherenceRepo'
import { CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY, type AdherenceTargetType } from '../../domain/dayPlan'
import type { IconName } from '../../ui/Icon'
import type { ChipTone } from '../../ui/styles'
import type { TodayRow } from './todayData'

export const STATUS_TEXT: Record<AdherenceStatus, string> = { done: 'Feito', partial: 'Parcial', missed: 'Não fiz' }

export const STATUS_TONE: Record<AdherenceStatus, ChipTone> = { done: 'ok', partial: 'warn', missed: 'danger' }

export const TYPE_ICON: Record<AdherenceTargetType, IconName> = {
  meal: 'meal',
  protocol_item: 'pill',
  cardio: 'flame',
  workout: 'dumbbell',
  checkin: 'note',
}

/** Where a target is done when it is not marked here: the workout on /treino, each check-in part on its own screen. */
export function linkOf(target: TodayRow['target']): string | null {
  if (target.type === 'workout') return '/treino'
  if (target.type !== 'checkin') return null
  return target.key === CHECKIN_MORNING_KEY ? '/checkin/manha' : target.key === CHECKIN_EVENING_KEY ? '/checkin/noite' : '/checkin'
}
