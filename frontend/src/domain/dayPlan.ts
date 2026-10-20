import { diffDays, weekdayOf } from './calendarDate'
import type { ProtocolDocument, Rotation, Schedule } from './planDocuments'
import { resolveDay, type RotationOverrideAt, type WorkoutPlanAt } from './rotation'

/**
 * The day rules (spec "Hoje", section 2): what to do on a date and when. The server twin is `DayPlanner.cs`; both run
 * the shared `fixtures/schedule-cases.json`, so the reminders the server sends match what this screen shows.
 */

export type DayType = 'training' | 'off'
export type DayKind = DayType | 'none'
export type AdherenceTargetType = 'meal' | 'protocol_item' | 'cardio' | 'workout' | 'checkin'

export const CARDIO_KEY = 'cardio'
export const WORKOUT_KEY = 'workout'
/** The two parts of the daily check-in are two targets; the evening one keeps the old `checkin` slot (and its time). */
export const CHECKIN_MORNING_KEY = 'checkin_morning'
export const CHECKIN_EVENING_KEY = 'checkin_evening'
export const CHECKIN_MORNING_SLOT = 'checkin_morning'
export const CHECKIN_EVENING_SLOT = 'checkin'
/** Adherence key of the single check-in target before it was split; a mark with it counts as the evening check-in. */
export const LEGACY_CHECKIN_KEY = 'checkin'

/** A workout version that was active. `activatedOn` is the local date of `activatedAt` (ISO instant). */
export interface DayWorkoutPlan {
  planVersionId: string
  activatedAt: string
  activatedOn: string
  rotation: Rotation | null
}

/** The time of a slot on one type of day. `time` is HH:mm. */
export interface DaySlot {
  slot: string
  dayType: DayType
  time: string
  reminderEnabled: boolean
}

/** Something to do on a day. `slot` null (timing `any`) means no time and no reminder. */
export interface DayTarget {
  type: AdherenceTargetType
  key: string
  label: string
  slot: string | null
  /** HH:mm, null when the slot has no row (or there is no slot). */
  time: string | null
  reminderEnabled: boolean
}

export interface DayPlan {
  dayType: DayKind
  /** The workout day of a training day, else null. */
  workoutDayKey: string | null
  /** By time (untimed last), then slot (null last), key and type. */
  targets: DayTarget[]
}

export interface BuildDayOptions {
  /** Local date the protocol was activated: anchor of `every_n_days` items without one. */
  protocolActivatedOn?: string | null
}

const WITH_MEAL = 'with_meal:'
const TIMING_SLOTS = new Set(['fasting', 'after_meal', 'before_bed', 'pre_workout', 'intra_workout', 'post_workout'])
const TYPE_RANK: Record<AdherenceTargetType, number> = { meal: 0, protocol_item: 1, cardio: 2, workout: 3, checkin: 4 }

const mod = (n: number, m: number) => ((n % m) + m) % m

function isScheduled(schedule: Schedule | null | undefined, date: string, training: boolean, protocolActivatedOn: string | null): boolean {
  if (!schedule) return true
  switch (schedule.type) {
    case 'daily':
      return true
    case 'weekdays':
      return schedule.days?.includes(weekdayOf(date)) === true
    case 'every_n_days': {
      const anchor = schedule.anchor ?? protocolActivatedOn
      const n = schedule.n
      // Before the anchor the cycle runs backwards too (same as the server).
      return n != null && n >= 1 && anchor != null && mod(diffDays(anchor, date), n) === 0
    }
    case 'training_days_only':
      return training
    case 'off_days_only':
      return !training
    default:
      return false
  }
}

function slotOf(timing: string | null | undefined): string | null {
  if (timing == null) return null
  if (timing.startsWith(WITH_MEAL) && timing.length > WITH_MEAL.length) return `meal_${timing.slice(WITH_MEAL.length)}`
  return TIMING_SLOTS.has(timing) ? timing : null
}

/** Ordinal (UTF-16 code unit) comparison, as the server's `string.CompareOrdinal`. */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function compareTargets(a: DayTarget, b: DayTarget): number {
  if (a.time !== b.time) {
    if (a.time === null) return 1
    if (b.time === null) return -1
    return ordinal(a.time, b.time)
  }
  if (a.slot !== b.slot) {
    if (a.slot === null) return 1
    if (b.slot === null) return -1
    return ordinal(a.slot, b.slot)
  }
  return ordinal(a.key, b.key) || TYPE_RANK[a.type] - TYPE_RANK[b.type]
}

/**
 * The plan of `date`: the protocol's meals, the items whose schedule falls on the day, cardio (when planned), the
 * workout (training days) and the check-in, each with the time of its slot for the day's type. A day without a workout
 * plan (`none`) uses the rest-day times and rules. Workout versions may come in any order.
 */
export function buildDay(
  date: string,
  protocol: ProtocolDocument | null,
  workoutPlans: readonly DayWorkoutPlan[],
  overrides: readonly RotationOverrideAt[],
  slots: readonly DaySlot[],
  opts: BuildDayOptions = {},
): DayPlan {
  // `activePlanAt` keeps the later entry on a same-day tie: order by the full instant (stable for equal ones).
  const plans: WorkoutPlanAt[] = [...workoutPlans]
    .sort((a, b) => Date.parse(a.activatedAt) - Date.parse(b.activatedAt))
    .map((p) => ({ planVersionId: p.planVersionId, activatedOn: p.activatedOn, rotation: p.rotation ?? { type: '' } }))
  const resolved = resolveDay(date, plans, [...overrides])
  const training = resolved.kind === 'workout'
  const slotDay: DayType = training ? 'training' : 'off'
  const targets: DayTarget[] = []

  const add = (type: AdherenceTargetType, key: string, label: string, slot: string | null) => {
    const row = slot === null ? undefined : slots.find((s) => s.slot === slot && s.dayType === slotDay)
    targets.push({ type, key, label, slot, time: row?.time ?? null, reminderEnabled: row?.reminderEnabled ?? false })
  }

  if (protocol) {
    const meals = protocol.meals ?? []
    meals.forEach((meal, i) => {
      add('meal', meal.key, meal.label?.trim() ? meal.label : `REF ${i + 1}`, `meal_${meal.key}`)
    })
    for (const item of protocol.items ?? []) {
      if (isScheduled(item.schedule, date, training, opts.protocolActivatedOn ?? null)) add('protocol_item', item.key, item.name, slotOf(item.timing))
    }
    const cardio = protocol.cardio
    if (cardio && (cardio.daily === true || (cardio.sessionsPerWeek ?? 0) > 0)) add('cardio', CARDIO_KEY, 'Cardio', 'cardio')
  }

  if (resolved.kind === 'workout') add('workout', WORKOUT_KEY, `Treino ${resolved.dayKey}`, 'workout')
  add('checkin', CHECKIN_MORNING_KEY, 'Check-in da manhã', CHECKIN_MORNING_SLOT)
  add('checkin', CHECKIN_EVENING_KEY, 'Check-in da noite', CHECKIN_EVENING_SLOT)

  return {
    dayType: resolved.kind === 'workout' ? 'training' : resolved.kind,
    workoutDayKey: resolved.kind === 'workout' ? resolved.dayKey : null,
    targets: targets.sort(compareTargets),
  }
}
